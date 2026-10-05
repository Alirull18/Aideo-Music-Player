import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { deviceProfileKey, readDeviceProfile, parseDeviceProfile } from '../utils/deviceProfiles';

const baseline = useStore.getState();
beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args) =>
    command === 'get_audio_devices' ? ['A', 'B', '[System Default Device]'] : command.startsWith('toggle_') ? (args as Record<string, unknown>)?.enable : null);
  useStore.setState({ ...baseline, currentDevice: null, devices: ['A', 'B'], audioDeviceSwitching: false,
    playback: { ...baseline.playback, volume: 0.4, bit_perfect: false, exclusive: false } });
});
const seed = (name: string, volume: number, extra = {}) => localStorage.setItem(deviceProfileKey(name), JSON.stringify({
  version: 1, volume, dsp: { ...baseline.dsp, preamp_gain: -4 }, autoEq: null, exclusive: false, bitPerfect: false, ...extra,
}));

describe('per output settings', () => {
  it('saves edits immediately and restores A → B → A with offline AutoEQ identity', async () => {
    await useStore.getState().setAudioDevice('A');
    await useStore.getState().setVolume(0.25);
    await useStore.getState().setDSP({ preamp_gain: -5 });
    const identity = { url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/A.txt', name: 'Same name', fullSource: 'Measurement A' };
    useStore.getState().setActiveAutoEq(identity);
    expect(readDeviceProfile('A', baseline.dsp)?.volume).toBe(0.25);
    seed('B', 0.7);
    await useStore.getState().setAudioDevice('B');
    expect(useStore.getState().playback.volume).toBe(0.7);
    await useStore.getState().setAudioDevice('A');
    expect(useStore.getState().dsp.preamp_gain).toBe(-5);
    expect(useStore.getState().activeAutoEq).toEqual(identity);
    expect(useStore.getState().playback.volume).toBe(0.25);
  });
  it('restores startup settings without needing a previous switch', async () => {
    seed('A', 0.2);
    localStorage.setItem('aideo_target_device', 'A');
    await useStore.getState().fetchDevices();
    expect(useStore.getState().currentDevice).toBe('A');
    expect(useStore.getState().playback.volume).toBe(0.2);
  });
  it('migrates valid legacy settings, rejects malformed and nonfinite values', async () => {
    localStorage.setItem('aideo_dev_vol_A', '0.3');
    localStorage.setItem('aideo_dev_dsp_A', JSON.stringify({ preamp_gain: -3 }));
    await useStore.getState().setAudioDevice('A');
    expect(useStore.getState().dsp.preamp_gain).toBe(-3);
    expect(useStore.getState().playback.volume).toBe(0.3);
    localStorage.setItem('aideo_dev_vol_B', 'Infinity');
    localStorage.setItem('aideo_dev_dsp_B', '{');
    expect(readDeviceProfile('B', baseline.dsp)).toBeNull();
    await useStore.getState().setVolume(NaN);
    expect(useStore.getState().playback.volume).toBe(0.3);
  });
  it('caps fallback gain and refuses automatic unity gain for a saved bit-perfect mode', async () => {
    useStore.setState({ currentDevice: 'A' });
    seed('', 0.9, { bitPerfect: true, exclusive: true });
    await useStore.getState().setAudioDevice('[System Default Device]', { backendSelected: true, fallback: true });
    expect(useStore.getState().playback.volume).toBe(0.4);
    expect(useStore.getState().playback.bit_perfect).toBe(false);
    expect(readDeviceProfile('', baseline.dsp)?.bitPerfect).toBe(true);
  });
  it('keeps failed selection truthful and muted', async () => {
    useStore.setState({ currentDevice: 'A' });
    vi.mocked(invoke).mockImplementation(async command => { if (command === 'set_audio_device') throw new Error('missing output'); return null; });
    await useStore.getState().setAudioDevice('B');
    expect(useStore.getState().currentDevice).toBe('A');
    expect(useStore.getState().playback.volume).toBe(0);
    expect(localStorage.getItem('aideo_target_device')).toBeNull();
  });
  it('serializes rapid switches and commits only the newest acknowledged profile', async () => {
    seed('A', 0.2); seed('B', 0.6);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'set_audio_device' && (args as Record<string, unknown>)?.name === 'A') await blocked;
      return command.startsWith('toggle_') ? (args as Record<string, unknown>)?.enable : null;
    });
    const first = useStore.getState().setAudioDevice('A');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('set_audio_device', { name: 'A' }));
    const second = useStore.getState().setAudioDevice('B');
    release(); await Promise.all([first, second]);
    expect(useStore.getState().currentDevice).toBe('B');
    expect(useStore.getState().playback.volume).toBe(0.6);
  });
  it('does not treat an unsupported exclusive request as effective', async () => {
    seed('A', 0.3, { exclusive: true });
    vi.mocked(invoke).mockResolvedValue(false);
    await useStore.getState().setAudioDevice('A');
    expect(useStore.getState().playback.exclusive).toBe(false);
    expect(readDeviceProfile('A', baseline.dsp)?.exclusive).toBe(true);
  });
  it('blocks native duplicate-name suffixes instead of sharing a profile', async () => {
    useStore.setState({ devices: ['DAC', 'DAC #2'] });
    await useStore.getState().setAudioDevice('DAC');
    expect(invoke).not.toHaveBeenCalledWith('set_audio_device', { name: 'DAC' });
    await useStore.getState().setAudioDevice('DAC #2');
    expect(invoke).not.toHaveBeenCalledWith('set_audio_device', { name: 'DAC #2' });
  });
  it('rejects unknown nested backup fields and unsafe DSP values', () => {
    seed('A', 0.3);
    const saved = JSON.parse(localStorage.getItem(deviceProfileKey('A'))!);
    expect(parseDeviceProfile(saved)).not.toBeNull();
    expect(parseDeviceProfile({ ...saved, token: 'credential' })).toBeNull();
    expect(parseDeviceProfile({ ...saved, dsp: { ...saved.dsp, token: 'credential' } })).toBeNull();
    expect(parseDeviceProfile({ ...saved, dsp: { ...saved.dsp, spatial_wet: 50 } })).toBeNull();
    expect(parseDeviceProfile({ ...saved, dsp: { ...saved.dsp, convolution_ir_path: 'https://example.test/ir.wav?token=secret' } })).toBeNull();
    expect(parseDeviceProfile({ ...saved, dsp: { ...saved.dsp, convolution_ir_path: 'C:/Audio/IR.wav' } })).not.toBeNull();
    expect(parseDeviceProfile({ ...saved, autoEq: { url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/A.txt?token=secret', name: 'A', fullSource: 'A' } })).toBeNull();
  });
  it('remembers EQ while bit-perfect bypasses it and restores it on return', async () => {
    seed('A', 0.3, { bitPerfect: true, exclusive: true });
    await useStore.getState().setAudioDevice('A');
    expect(useStore.getState().playback.bit_perfect).toBe(true);
    expect(useStore.getState().dsp.enabled).toBe(false);
    expect(readDeviceProfile('A', baseline.dsp)?.dsp.preamp_gain).toBe(-4);
    await useStore.getState().toggleBitPerfect(false);
    expect(useStore.getState().dsp.preamp_gain).toBe(-4);
  });
  it('waits for old bit-perfect DSP work before routing and preserves the new profile', async () => {
    seed('A', 0.3, { bitPerfect: true, exclusive: true });
    seed('B', 0.6, { dsp: { ...baseline.dsp, preamp_gain: -8 } });
    await useStore.getState().setAudioDevice('A');
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'set_dsp_state' && (args as { dsp: { preamp_gain: number } }).dsp.preamp_gain === -4) await blocked;
      return command.startsWith('toggle_') ? (args as Record<string, unknown>)?.enable : null;
    });
    const disable = useStore.getState().toggleBitPerfect(false);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('set_dsp_state', { dsp: expect.objectContaining({ preamp_gain: -4 }) }));
    const switching = useStore.getState().setAudioDevice('B');
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalledWith('set_audio_device', { name: 'B' });
    release();
    await Promise.all([disable, switching]);
    expect(useStore.getState().currentDevice).toBe('B');
    expect(useStore.getState().dsp.preamp_gain).toBe(-8);
    expect(useStore.getState().playback.volume).toBe(0.6);
    expect(useStore.getState().requestedAudioModes).toEqual({ exclusive: false, bitPerfect: false });
    expect(readDeviceProfile('B', baseline.dsp)?.dsp.preamp_gain).toBe(-8);
  });
});
