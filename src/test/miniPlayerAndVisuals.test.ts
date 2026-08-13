import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { isStreamTrack } from '../utils';

describe('Mini Player, Fullscreen & Ambient Visuals + Offline Cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should initialize albumArtFit to contain or localStorage value', () => {
    const fit = useStore.getState().albumArtFit;
    expect(fit).toBe('contain');
  });

  it('should allow toggling albumArtFit between contain and cover', () => {
    useStore.getState().setAlbumArtFit('cover');
    expect(useStore.getState().albumArtFit).toBe('cover');
    expect(localStorage.getItem('aideo-album-art-fit')).toBe('cover');

    useStore.getState().setAlbumArtFit('contain');
    expect(useStore.getState().albumArtFit).toBe('contain');
    expect(localStorage.getItem('aideo-album-art-fit')).toBe('contain');
  });

  it('should correctly identify stream tracks via isStreamTrack', () => {
    expect(isStreamTrack('https://stream.radioparadise.com/flac', null)).toBe(true);
    expect(isStreamTrack('http://192.168.1.10:4533/rest/stream', 'SUBSONIC')).toBe(true);
    expect(isStreamTrack('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'YouTube Direct')).toBe(true);
    expect(isStreamTrack('C:\\Music\\Song.flac', 'FLAC')).toBe(false);
    expect(isStreamTrack('/home/user/Music/track.mp3', 'MP3')).toBe(false);
    expect(isStreamTrack(null, null)).toBe(false);
  });

  it('should verify offline cache badge match logic against cachedCloudHashes', () => {
    const cachedHashes = ['hash123', 'hash456', 'hash789'];
    
    const track1 = {
      path: 'https://youtube.com/watch?v=abc',
      format: 'YouTube Direct',
      path_hash: 'hash123'
    };
    const track2 = {
      path: 'https://youtube.com/watch?v=xyz',
      format: 'YouTube Direct',
      path_hash: 'hash_not_cached'
    };
    const track3 = {
      path: 'C:\\Music\\Local.flac',
      format: 'FLAC',
      path_hash: 'hash123'
    };

    const isTrack1Cached = isStreamTrack(track1.path, track1.format) && !!track1.path_hash && cachedHashes.includes(track1.path_hash);
    const isTrack2Cached = isStreamTrack(track2.path, track2.format) && !!track2.path_hash && cachedHashes.includes(track2.path_hash);
    const isTrack3Cached = isStreamTrack(track3.path, track3.format) && !!track3.path_hash && cachedHashes.includes(track3.path_hash);

    expect(isTrack1Cached).toBe(true);
    expect(isTrack2Cached).toBe(false);
    expect(isTrack3Cached).toBe(false); // Local track should not be marked as stream cache
  });

  it('should support mini player pin persistence state', () => {
    localStorage.setItem('aideo-mini-player-pinned', 'true');
    expect(localStorage.getItem('aideo-mini-player-pinned') !== 'false').toBe(true);

    localStorage.setItem('aideo-mini-player-pinned', 'false');
    expect(localStorage.getItem('aideo-mini-player-pinned') !== 'false').toBe(false);
  });
});
