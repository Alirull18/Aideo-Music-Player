import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

describe('Playback Engine, Queue & Audio Routing', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists selected audio output device across restarts', async () => {
    const store = useStore.getState();
    await store.setAudioDevice('External DAC (USB Audio 2.0)');
    
    expect(localStorage.getItem('aideo_target_device')).toBe('External DAC (USB Audio 2.0)');
    expect(useStore.getState().currentDevice).toBe('External DAC (USB Audio 2.0)');
  });

  it('correctly toggles and persists EBU R128 Loudness Normalization in DSP state', async () => {
    const store = useStore.getState();
    await store.setDSP({ r128_enabled: true });

    expect(localStorage.getItem('aideo_r128_enabled')).toBe('true');
    expect(useStore.getState().dsp.r128_enabled).toBe(true);

    await store.setDSP({ r128_enabled: false });
    expect(localStorage.getItem('aideo_r128_enabled')).toBe('false');
    expect(useStore.getState().dsp.r128_enabled).toBe(false);
  });

  it('persists and cycles repeat modes (none -> all -> one -> none)', () => {
    const store = useStore.getState();
    useStore.setState({ repeat: 'none' });

    store.toggleRepeat();
    expect(useStore.getState().repeat).toBe('all');
    expect(localStorage.getItem('aideo_repeat')).toBe('all');

    store.toggleRepeat();
    expect(useStore.getState().repeat).toBe('one');
    expect(localStorage.getItem('aideo_repeat')).toBe('one');

    store.toggleRepeat();
    expect(useStore.getState().repeat).toBe('none');
    expect(localStorage.getItem('aideo_repeat')).toBe('none');
  });

  it('preserves volume levels during mute / unmute cycles', async () => {
    const store = useStore.getState();
    await store.setVolume(0.85);
    expect(useStore.getState().playback.volume).toBe(0.85);
    expect(useStore.getState().isMuted).toBe(false);

    // Mute
    await store.toggleMute();
    expect(useStore.getState().playback.volume).toBe(0);
    expect(useStore.getState().isMuted).toBe(true);
    expect(useStore.getState().mutedPrevVolume).toBe(0.85);

    // Unmute
    await store.toggleMute();
    expect(useStore.getState().playback.volume).toBe(0.85);
    expect(useStore.getState().isMuted).toBe(false);
  });

  it('allows actual mute but rejects attenuation during bit-perfect playback', async () => {
    const store = useStore.getState();
    useStore.setState({ playback: { ...useStore.getState().playback, bit_perfect: true, volume: 1 }, isMuted: false });
    await store.setVolume(0.4);
    expect(useStore.getState().playback.volume).toBe(1);
    await store.toggleMute();
    expect(useStore.getState().isMuted).toBe(true);
    expect(useStore.getState().playback.volume).toBe(0);
    await store.toggleMute();
    expect(useStore.getState().isMuted).toBe(false);
    expect(useStore.getState().playback.volume).toBe(1);
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

    await store.setDSP({ eq_enabled: false });
    expect(useStore.getState().playback.bit_perfect).toBe(true);

    await store.setDSP({ spatial_enabled: false, crossfeed_enabled: false });
    expect(useStore.getState().playback.bit_perfect).toBe(true);
  });
  it('keeps the displayed rate unchanged until accepted and after a rejection', async () => {
    const original = useStore.getState();
    useStore.setState({ playbackRate: 1, playback: { ...original.playback, bit_perfect: false } });
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'set_playback_rate') throw new Error('Output mode changed');
      return null;
    });
    try {
      const request = useStore.getState().setPlaybackRate(1.5);
      expect(useStore.getState().playbackRate).toBe(1);
      await request;
      expect(useStore.getState().playbackRate).toBe(1);
      vi.mocked(invoke).mockResolvedValue(null);
      await useStore.getState().setPlaybackRate(1.25);
      expect(useStore.getState().playbackRate).toBe(1.25);
    } finally {
      vi.mocked(invoke).mockReset().mockResolvedValue(null);
      useStore.setState({ playbackRate: original.playbackRate, playback: original.playback });
    }
  });

  it('rejects speed changes under Bit-Perfect without changing the active rate', async () => {
    const original = useStore.getState();
    useStore.setState({ playbackRate: 1, playback: { ...original.playback, bit_perfect: true } });
    try {
      await useStore.getState().setPlaybackRate(1.5);
      expect(useStore.getState().playbackRate).toBe(1);
    } finally {
      useStore.setState({ playbackRate: original.playbackRate, playback: original.playback });
    }
  });
  it('resets the displayed speed when Bit-Perfect is accepted', async () => {
    const original = useStore.getState();
    useStore.setState({ playbackRate: 1.5, playback: { ...original.playback, bit_perfect: false } });
    vi.mocked(invoke).mockImplementation(async command => command === 'toggle_bit_perfect_mode' ? true : null);
    try {
      await useStore.getState().toggleBitPerfect(true);
      expect(useStore.getState().playback.bit_perfect).toBe(true);
      expect(useStore.getState().playbackRate).toBe(1);
    } finally {
      vi.mocked(invoke).mockReset().mockResolvedValue(null);
      useStore.setState({ playbackRate: original.playbackRate, playback: original.playback, dsp: original.dsp });
    }
  });
});
