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
});
