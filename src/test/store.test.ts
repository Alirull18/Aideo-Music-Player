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

  it('should prioritize manual queue ahead of repeat-one mode in getNextTrackToPlay', () => {
    const track1 = { id: 1, path: 'C:/music/1.mp3', title: 'Song 1', artist: 'A', album: '', duration: 100, format: 'mp3', lyric_offset: 0 };
    const queuedTrack = { id: 2, path: 'C:/music/2.mp3', title: 'Queued Song', artist: 'B', album: '', duration: 120, format: 'mp3', lyric_offset: 0 };
    
    useStore.setState({
      currentTrack: track1,
      repeat: 'one',
      queue: [queuedTrack],
      tracks: [track1]
    });

    const nextTrack = useStore.getState().getNextTrackToPlay();
    expect(nextTrack?.path).toBe(queuedTrack.path);

    const lookahead = useStore.getState().getNextTracksToPlay(2);
    expect(lookahead[0].path).toBe(queuedTrack.path);
  });
});
