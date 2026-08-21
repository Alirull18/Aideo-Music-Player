import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

describe('Adversarial Stress Test: Bit-Perfect Mode & DSP Deactivation Edge Cases', () => {
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
        convolution_enabled: false,
        subsonic_enabled: false,
        night_mode_enabled: false,
        saturation_enabled: false,
        aideo_filter_enabled: false,
        crossfade_transition_enabled: false,
        upsample_rate: 0,
      },
    });
  });

  it('preserves bit_perfect when disabling individual or multiple DSP boolean flags', async () => {
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

    // 1. { eq_enabled: false }
    await store.setDSP({ eq_enabled: false });
    expect(useStore.getState().playback.bit_perfect).toBe(true);
    expect(useStore.getState().dsp.enabled).toBe(false);
    expect(useStore.getState().dsp.eq_enabled).toBe(false);

    // 2. { spatial_enabled: false, crossfeed_enabled: false }
    await store.setDSP({ spatial_enabled: false, crossfeed_enabled: false });
    expect(useStore.getState().playback.bit_perfect).toBe(true);
    expect(useStore.getState().dsp.enabled).toBe(false);
    expect(useStore.getState().dsp.spatial_enabled).toBe(false);
    expect(useStore.getState().dsp.crossfeed_enabled).toBe(false);

    // 3. { upsample_rate: 0 }
    await store.setDSP({ upsample_rate: 0 });
    expect(useStore.getState().playback.bit_perfect).toBe(true);
    expect(useStore.getState().dsp.enabled).toBe(false);
    expect(useStore.getState().dsp.upsample_rate).toBe(0);

    // 4. Multiple simultaneous deactivations
    await store.setDSP({
      eq_enabled: false,
      spatial_enabled: false,
      crossfeed_enabled: false,
      convolution_enabled: false,
      subsonic_enabled: false,
      night_mode_enabled: false,
      saturation_enabled: false,
      aideo_filter_enabled: false,
      crossfade_transition_enabled: false,
      r128_enabled: false,
      upsample_rate: 0,
      enabled: false,
    });
    expect(useStore.getState().playback.bit_perfect).toBe(true);
    expect(useStore.getState().dsp.enabled).toBe(false);
  });

  it('disables bit_perfect immediately when any active DSP setting is enabled', async () => {
    const store = useStore.getState();
    
    // Case A: eq_enabled: true
    useStore.setState({
      playback: { ...useStore.getState().playback, bit_perfect: true },
      dsp: { ...useStore.getState().dsp, enabled: false },
    });
    await store.setDSP({ eq_enabled: true });
    expect(useStore.getState().playback.bit_perfect).toBe(false);
    expect(useStore.getState().dsp.enabled).toBe(true);
    expect(useStore.getState().dsp.eq_enabled).toBe(true);

    // Case B: upsample_rate: 48000
    useStore.setState({
      playback: { ...useStore.getState().playback, bit_perfect: true },
      dsp: { ...useStore.getState().dsp, enabled: false, eq_enabled: false },
    });
    await store.setDSP({ upsample_rate: 48000 });
    expect(useStore.getState().playback.bit_perfect).toBe(false);
    expect(useStore.getState().dsp.enabled).toBe(true);
    expect(useStore.getState().dsp.upsample_rate).toBe(48000);

    // Case C: spatial_enabled: true
    useStore.setState({
      playback: { ...useStore.getState().playback, bit_perfect: true },
      dsp: { ...useStore.getState().dsp, enabled: false, upsample_rate: 0 },
    });
    await store.setDSP({ spatial_enabled: true });
    expect(useStore.getState().playback.bit_perfect).toBe(false);
    expect(useStore.getState().dsp.enabled).toBe(true);
    expect(useStore.getState().dsp.spatial_enabled).toBe(true);
  });
});
