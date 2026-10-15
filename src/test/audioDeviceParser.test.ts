import { describe, it, expect, beforeEach } from 'vitest';
import { parseWindowsAudioDevice, formatAudioDeviceOption } from '../utils/audioDeviceParser';
import { findAutoEqPreset, AUTO_EQ_PRESET_CATALOG } from '../utils/autoEqCatalog';
import { useStore } from '../store';

describe('Windows Audio Device Name Parser', () => {
  it('strips Windows port prefix and driver noise for Bluetooth headphones', () => {
    const raw = 'Headphones (2- Sony WH-1000XM5 Stereo)';
    const parsed = parseWindowsAudioDevice(raw);

    expect(parsed.rawName).toBe(raw);
    expect(parsed.displayName).toBe('Sony WH-1000XM5');
    expect(parsed.category).toBe('headphones');
    expect(parsed.endpointLabel).toBe('Headphones');
    expect(parsed.isTelephonyHandsFree).toBe(false);
    expect(parsed.driverType).toBe('Standard');
  });

  it('strips trademark symbols and driver tags for motherboard speakers', () => {
    const raw = 'Speakers (Realtek(R) Audio)';
    const parsed = parseWindowsAudioDevice(raw);

    expect(parsed.rawName).toBe(raw);
    expect(parsed.displayName).toBe('Realtek Audio');
    expect(parsed.category).toBe('speakers');
    expect(parsed.endpointLabel).toBe('Speakers');
    expect(parsed.isTelephonyHandsFree).toBe(false);
  });

  it('correctly parses external USB DAC and nested parentheses', () => {
    const raw = 'Digital Audio (S/PDIF) (3- FiiO KA13)';
    const parsed = parseWindowsAudioDevice(raw);

    expect(parsed.rawName).toBe(raw);
    expect(parsed.displayName).toBe('FiiO KA13');
    expect(parsed.category).toBe('dac');
    expect(parsed.endpointLabel).toBe('USB / External DAC');
    expect(parsed.isTelephonyHandsFree).toBe(false);
  });

  it('detects low-quality Bluetooth Hands-Free / AG Audio profiles', () => {
    const raw = 'Headphones (WF-1000XM4 Hands-Free AG Audio)';
    const parsed = parseWindowsAudioDevice(raw);

    expect(parsed.rawName).toBe(raw);
    expect(parsed.displayName).toBe('WF-1000XM4');
    expect(parsed.category).toBe('handsfree');
    expect(parsed.endpointLabel).toBe('Hands-Free Audio');
    expect(parsed.isTelephonyHandsFree).toBe(true);
  });

  it('detects Bose hands-free headset profile', () => {
    const raw = 'Headset (Bose QC35 II Hands-Free)';
    const parsed = parseWindowsAudioDevice(raw);

    expect(parsed.isTelephonyHandsFree).toBe(true);
    expect(parsed.category).toBe('handsfree');
    expect(parsed.displayName).toBe('Bose QC35 II');
  });

  it('handles [WASAPI] and [ASIO] driver prefixes cleanly', () => {
    const wasapi = '[WASAPI] Headphones (Sony WH-1000XM4)';
    const parsedWasapi = parseWindowsAudioDevice(wasapi);
    expect(parsedWasapi.driverType).toBe('WASAPI');
    expect(parsedWasapi.displayName).toBe('Sony WH-1000XM4');
    expect(parsedWasapi.category).toBe('headphones');

    const asio = '[ASIO] FiiO USB Audio ASIO Driver';
    const parsedAsio = parseWindowsAudioDevice(asio);
    expect(parsedAsio.driverType).toBe('ASIO');
    expect(parsedAsio.category).toBe('dac');
  });

  it('formats System Default device option while preserving raw string for backend IPC', () => {
    const raw = '[System Default Device]';
    const parsed = parseWindowsAudioDevice(raw, true, 'Sony WH-1000XM5');

    expect(parsed.rawName).toBe('[System Default Device]');
    expect(parsed.category).toBe('default');
    expect(parsed.endpointLabel).toBe('System Default');
    expect(parsed.formattedLabel).toBe('System Default — Sony WH-1000XM5');

    const optionLabel = formatAudioDeviceOption(raw, 'Sony WH-1000XM5');
    expect(optionLabel).toBe('System Default — Sony WH-1000XM5');
  });

  it('handles optical / S-PDIF digital output endpoints', () => {
    const raw = 'Digital Output (Optical) (Realtek USB Audio)';
    const parsed = parseWindowsAudioDevice(raw);
    expect(parsed.category).toBe('digital');
    expect(parsed.endpointLabel).toBe('Optical / S/PDIF');
  });

  it('handles empty strings, undefined inputs, and two-digit port prefixes', () => {
    const emptyParsed = parseWindowsAudioDevice('');
    expect(emptyParsed.category).toBe('default');
    expect(emptyParsed.rawName).toBe('[System Default Device]');

    const port12 = parseWindowsAudioDevice('Headphones (12- Sony WH-1000XM4 Stereo)');
    expect(port12.displayName).toBe('Sony WH-1000XM4');
    expect(port12.category).toBe('headphones');
  });

  it('differentiates Bluetooth Stereo from Hands-Free on the same headset model', () => {
    const stereo = parseWindowsAudioDevice('Headphones (Sony WH-1000XM4 Stereo)');
    const handsfree = parseWindowsAudioDevice('Headphones (Sony WH-1000XM4 Hands-Free AG Audio)');

    expect(stereo.isTelephonyHandsFree).toBe(false);
    expect(stereo.category).toBe('headphones');

    expect(handsfree.isTelephonyHandsFree).toBe(true);
    expect(handsfree.category).toBe('handsfree');
    expect(handsfree.endpointLabel).toBe('Hands-Free Audio');
  });
});

describe('AutoEQ Preset Catalog and Fuzzy Matching', () => {
  it('indexes all required popular headphone models', () => {
    const catalogNames = AUTO_EQ_PRESET_CATALOG.map(p => p.name);

    // Apple
    expect(catalogNames).toContain('Apple AirPods 2');
    expect(catalogNames).toContain('Apple AirPods 3');
    expect(catalogNames).toContain('Apple AirPods 4');
    expect(catalogNames).toContain('Apple AirPods Pro');
    expect(catalogNames).toContain('Apple AirPods Pro 2');
    expect(catalogNames).toContain('Apple AirPods Pro 3');
    expect(catalogNames).toContain('Apple AirPods Max');

    // Sony
    expect(catalogNames).toContain('Sony WH-1000XM3');
    expect(catalogNames).toContain('Sony WH-1000XM4');
    expect(catalogNames).toContain('Sony WH-1000XM5');
    expect(catalogNames).toContain('Sony WH-1000XM6');
    expect(catalogNames).toContain('Sony WF-1000XM4');
    expect(catalogNames).toContain('Sony WF-1000XM5');
    expect(catalogNames).toContain('Sony WF-1000XM6');

    // Bose
    expect(catalogNames).toContain('Bose QuietComfort 35 II');
    expect(catalogNames).toContain('Bose QuietComfort 45');
    expect(catalogNames).toContain('Bose QuietComfort Ultra');

    // Samsung
    expect(catalogNames).toContain('Samsung Galaxy Buds Pro');
    expect(catalogNames).toContain('Samsung Galaxy Buds 2 Pro');
    expect(catalogNames).toContain('Samsung Galaxy Buds 3 Pro');
    expect(catalogNames).toContain('Samsung Galaxy Buds 4 Pro');
    expect(catalogNames).toContain('Samsung Galaxy Buds FE');

    // Sennheiser
    expect(catalogNames).toContain('Sennheiser Momentum 4');
    expect(catalogNames).toContain('Sennheiser Accentum');
    expect(catalogNames).toContain('Sennheiser HD 600');

    // JBL, Beats, Jabra, Soundcore, Nothing, HiFiMan, FiiO
    expect(catalogNames).toContain('JBL Tune 770NC');
    expect(catalogNames).toContain('JBL Live 660NC');
    expect(catalogNames).toContain('JBL Tour One M2');
    expect(catalogNames).toContain('Beats Studio Pro');
    expect(catalogNames).toContain('Beats Solo 4');
    expect(catalogNames).toContain('Beats Fit Pro');
    expect(catalogNames).toContain('Jabra Elite 75t');
    expect(catalogNames).toContain('Jabra Elite 7 Pro');
    expect(catalogNames).toContain('Jabra Elite 8 Active');
    expect(catalogNames).toContain('Soundcore Space Q45');
    expect(catalogNames).toContain('Soundcore Liberty 4 NC');
    expect(catalogNames).toContain('Nothing Ear (2)');
    expect(catalogNames).toContain('HiFiMan Sundara');
    expect(catalogNames).toContain('FiiO FT1 Pro');
  });

  it('fuzzy matches Windows parsed display names to the correct headphone preset', () => {
    // Sony WH-1000XM5
    const sonyParsed = parseWindowsAudioDevice('Headphones (2- Sony WH-1000XM5 Stereo)');
    const sonyMatch = findAutoEqPreset(sonyParsed.displayName);
    expect(sonyMatch).not.toBeNull();
    expect(sonyMatch?.id).toBe('sony-wh-1000xm5');

    // AirPods Pro 2
    const airpodsParsed = parseWindowsAudioDevice('Headphones (Apple AirPods Pro 2)');
    const airpodsMatch = findAutoEqPreset(airpodsParsed.displayName);
    expect(airpodsMatch).not.toBeNull();
    expect(airpodsMatch?.id).toBe('apple-airpods-pro-2');

    // Bose QC45
    const boseParsed = parseWindowsAudioDevice('Headphones (Bose QC45)');
    const boseMatch = findAutoEqPreset(boseParsed.displayName);
    expect(boseMatch).not.toBeNull();
    expect(boseMatch?.id).toBe('bose-qc45');

    // HiFiMan Sundara
    const sundaraParsed = parseWindowsAudioDevice('Headphones (HiFiMan Sundara)');
    const sundaraMatch = findAutoEqPreset(sundaraParsed.displayName);
    expect(sundaraMatch).not.toBeNull();
    expect(sundaraMatch?.id).toBe('hifiman-sundara');

    // FiiO FT1 Pro
    const fiioParsed = parseWindowsAudioDevice('Headphones (FiiO FT1 Pro)');
    const fiioMatch = findAutoEqPreset(fiioParsed.displayName);
    expect(fiioMatch).not.toBeNull();
    expect(fiioMatch?.id).toBe('fiio-ft1-pro');
  });

  it('returns null for non-headphone devices', () => {
    const realtek = parseWindowsAudioDevice('Speakers (Realtek(R) Audio)');
    expect(findAutoEqPreset(realtek.displayName)).toBeNull();

    const monitor = parseWindowsAudioDevice('LG UltraFine (DisplayPort)');
    expect(findAutoEqPreset(monitor.displayName)).toBeNull();
  });
});

describe('AutoEQ Strength Scaling & Output Mode Store Actions', () => {
  beforeEach(() => {
    useStore.setState({
      autoEqStrength: 100,
      activeAutoEq: null,
      dsp: {
        ...useStore.getState().dsp,
        eq_enabled: false,
        eq_parametric: false,
        preamp_gain: 0,
      },
    });
  });

  it('applies AutoEQ preset and scales biquad bands and preamp by autoEqStrength', async () => {
    const preset = AUTO_EQ_PRESET_CATALOG.find(p => p.id === 'sony-wh-1000xm5')!;
    expect(preset).toBeDefined();

    // Apply at 100%
    await useStore.getState().applyAutoEqPreset(preset, 100);
    const state100 = useStore.getState();
    expect(state100.activeAutoEq?.name).toBe('Sony WH-1000XM5');
    expect(state100.dsp.eq_enabled).toBe(true);
    expect(state100.dsp.eq_parametric).toBe(true);
    expect(state100.dsp.preamp_gain).toBe(preset.preamp);
    expect(state100.dsp.eq_parametric_bands[0].gain).toBe(preset.bands[0].gain);

    // Change intensity slider to 50%
    useStore.getState().setAutoEqStrength(50);
    const state50 = useStore.getState();
    expect(state50.autoEqStrength).toBe(50);
    expect(state50.dsp.preamp_gain).toBe(Number((preset.preamp * 0.5).toFixed(2)));
    expect(state50.dsp.eq_parametric_bands[0].gain).toBe(Number((preset.bands[0].gain * 0.5).toFixed(2)));

    // Change intensity slider to 0% (dry / flat)
    useStore.getState().setAutoEqStrength(0);
    const state0 = useStore.getState();
    expect(state0.dsp.preamp_gain).toBe(0);
    expect(state0.dsp.eq_parametric_bands[0].gain).toBe(0);

    // Boost intensity slider to 150%
    useStore.getState().setAutoEqStrength(150);
    const state150 = useStore.getState();
    expect(state150.autoEqStrength).toBe(150);
    expect(state150.dsp.preamp_gain).toBe(Number((preset.preamp * 1.5).toFixed(2)));
    expect(state150.dsp.eq_parametric_bands[0].gain).toBe(Number((preset.bands[0].gain * 1.5).toFixed(2)));

    // Clamps values out of range
    useStore.getState().setAutoEqStrength(-20);
    expect(useStore.getState().autoEqStrength).toBe(0);
    useStore.getState().setAutoEqStrength(200);
    expect(useStore.getState().autoEqStrength).toBe(150);

    // Disable AutoEQ
    await useStore.getState().disableAutoEq();
    const disabledState = useStore.getState();
    expect(disabledState.activeAutoEq).toBeNull();
    expect(disabledState.dsp.preamp_gain).toBe(0);
  });

  it('setAudioOutputPath cleanly toggles shared, exclusive, and bitperfect modes', async () => {
    const store = useStore.getState();

    // Shared mode
    await store.setAudioOutputPath('shared');
    expect(useStore.getState().exclusiveMode).toBe(false);
    expect(useStore.getState().bitPerfectMode).toBe(false);

    // Hardware exclusive mode
    await store.setAudioOutputPath('exclusive');
    expect(useStore.getState().exclusiveMode).toBe(true);
    expect(useStore.getState().bitPerfectMode).toBe(false);

    // Pure bit-perfect mode
    await store.setAudioOutputPath('bitperfect');
    expect(useStore.getState().exclusiveMode).toBe(true);
    expect(useStore.getState().bitPerfectMode).toBe(true);

    // Back to shared
    await store.setAudioOutputPath('shared');
    expect(useStore.getState().exclusiveMode).toBe(false);
    expect(useStore.getState().bitPerfectMode).toBe(false);
  });
});
