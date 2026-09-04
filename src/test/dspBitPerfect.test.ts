import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

describe('Bit-Perfect Mode and DSP State Protection', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        bit_perfect: false,
      },
      dsp: {
        ...useStore.getState().dsp,
        enabled: false,
        eq_enabled: false,
        spatial_enabled: false,
        crossfeed_enabled: false,
        r128_enabled: false,
      },
    });
  });

  it('preserves bit-perfect mode when setDSP is called with false/disabled parameters', async () => {
    const store = useStore.getState();
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        bit_perfect: true,
      },
      dsp: {
        ...useStore.getState().dsp,
        enabled: false,
      },
    });

    // 1. Setting disabled EQ should preserve bit-perfect
    await store.setDSP({ eq_enabled: false });
    expect(useStore.getState().playback.bit_perfect).toBe(true);
    expect(useStore.getState().dsp.enabled).toBe(false);

    // 2. Setting disabled spatial/crossfeed should preserve bit-perfect
    await store.setDSP({ spatial_enabled: false, crossfeed_enabled: false });
    expect(useStore.getState().playback.bit_perfect).toBe(true);
    expect(useStore.getState().dsp.enabled).toBe(false);

    // 3. Setting upsample_rate to 0 should preserve bit-perfect
    await store.setDSP({ upsample_rate: 0 });
    expect(useStore.getState().playback.bit_perfect).toBe(true);
    expect(useStore.getState().dsp.enabled).toBe(false);

    // 4. Explicitly passing enabled: false should preserve bit-perfect
    await store.setDSP({ enabled: false });
    expect(useStore.getState().playback.bit_perfect).toBe(true);
  });

  it('disables bit-perfect mode and enables DSP when an active DSP feature is turned on', async () => {
    const store = useStore.getState();
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        bit_perfect: true,
      },
      dsp: {
        ...useStore.getState().dsp,
        enabled: false,
      },
    });

    // Enabling EQ should disable bit-perfect and activate DSP
    await store.setDSP({ eq_enabled: true });
    expect(useStore.getState().playback.bit_perfect).toBe(false);
    expect(useStore.getState().dsp.enabled).toBe(true);
    expect(useStore.getState().dsp.eq_enabled).toBe(true);
  });

  it('disables bit-perfect mode when positive upsample rate is requested', async () => {
    const store = useStore.getState();
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        bit_perfect: true,
      },
      dsp: {
        ...useStore.getState().dsp,
        enabled: false,
      },
    });

    await store.setDSP({ upsample_rate: 96000 });
    expect(useStore.getState().playback.bit_perfect).toBe(false);
    expect(useStore.getState().dsp.enabled).toBe(true);
    expect(useStore.getState().dsp.upsample_rate).toBe(96000);
  });

  it('turns off bit-perfect automatically when exclusive mode is turned off', async () => {
    const store = useStore.getState();
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        exclusive: true,
        bit_perfect: true,
      },
    });

    // Turning off exclusive mode MUST also disable bit-perfect
    await store.toggleExclusive(false);
    expect(useStore.getState().playback.exclusive).toBe(false);
    expect(useStore.getState().playback.bit_perfect).toBe(false);
  });

  it('turns on exclusive mode when bit-perfect is activated, and turns off cleanly', async () => {
    const store = useStore.getState();
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        exclusive: false,
        bit_perfect: false,
      },
    });

    // Activating bit-perfect should enable exclusive mode
    await store.toggleBitPerfect(true);
    expect(useStore.getState().playback.bit_perfect).toBe(true);
    expect(useStore.getState().playback.exclusive).toBe(true);

    // Turning off exclusive mode clears both
    await store.toggleExclusive(false);
    expect(useStore.getState().playback.exclusive).toBe(false);
    expect(useStore.getState().playback.bit_perfect).toBe(false);
  });

  it('persists output mode preferences and restores them for a new backend session', async () => {
    const store = useStore.getState();

    await store.toggleBitPerfect(true);

    expect(localStorage.getItem('aideo_bit_perfect_mode')).toBe('true');
    expect(localStorage.getItem('aideo_exclusive_mode')).toBe('true');

    // A new Tauri backend starts with process-local mode flags cleared. Keep the
    // saved preference and simulate that fresh frontend/backend state here.
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        exclusive: false,
        bit_perfect: false,
      },
    });

    await useStore.getState().restoreAudioModes();

    expect(useStore.getState().playback.exclusive).toBe(true);
    expect(useStore.getState().playback.bit_perfect).toBe(true);

    await useStore.getState().toggleExclusive(false);
    expect(localStorage.getItem('aideo_bit_perfect_mode')).toBe('false');
    expect(localStorage.getItem('aideo_exclusive_mode')).toBe('false');
  });
});
