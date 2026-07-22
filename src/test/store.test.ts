import { describe, it, expect } from 'vitest';
import { useStore } from '../store';

describe('Store Actions & Slices', () => {
  it('should initialize default playback state correctly', () => {
    const state = useStore.getState();
    expect(state.playback.status).toBe('Stopped');
    expect(state.playback.volume).toBe(1.0);
    expect(state.dsp.enabled).toBe(false);
  });

  it('should set volume within 0..1 bounds', async () => {
    const { setVolume } = useStore.getState();
    
    await setVolume(0.5);
    expect(useStore.getState().playback.volume).toBe(0.5);

    await setVolume(1.5);
    expect(useStore.getState().playback.volume).toBe(1.0);

    await setVolume(-0.5);
    expect(useStore.getState().playback.volume).toBe(0.0);
  });

  it('should manage scan directories cleanly', () => {
    const { addScanDir, removeScanDir } = useStore.getState();
    const initialDirs = [...useStore.getState().scanDirs];
    const testDir = 'C:\\TestMusicFolder';

    addScanDir(testDir);
    expect(useStore.getState().scanDirs).toContain(testDir);

    removeScanDir(testDir);
    expect(useStore.getState().scanDirs).not.toContain(testDir);
    expect(useStore.getState().scanDirs.length).toBe(initialDirs.length);
  });
});
