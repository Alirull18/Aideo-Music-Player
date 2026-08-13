import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

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
});
