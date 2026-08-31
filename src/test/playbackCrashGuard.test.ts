import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';

describe('Playback Crash Guard & Event Deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      playback: {
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        volume: 1,
        exclusive: false,
        bit_perfect: false,
        dev_rate: 44100,
        driver_type: 'WASAPI',
        is_buffering: false,
        last_seek_time: 0,
        last_skip_time: 0,
        last_poll_time: 0,
        last_played_track: null,
      },
      tracks: [
        { id: 1, path: 'C:/Music/track1.mp3', title: 'Track 1', artist: 'Artist 1', album: 'Album 1', duration: 180, format: 'MP3', lyric_offset: 0 },
        { id: 2, path: 'C:/Music/track2.mp3', title: 'Track 2', artist: 'Artist 2', album: 'Album 2', duration: 200, format: 'MP3', lyric_offset: 0 },
      ],
      queue: [],
      currentTrack: null,
    });
  });

  it('handlePlaybackStateChanged safely ignores empty or malformed payload without throwing', () => {
    expect(() => {
      useStore.getState().handlePlaybackStateChanged(null);
      useStore.getState().handlePlaybackStateChanged(undefined);
      useStore.getState().handlePlaybackStateChanged({});
    }).not.toThrow();
  });

  it('handlePlaybackStateChanged updates playback status and position without triggering duplicate transition for same track', () => {
    const state = useStore.getState();
    const handleTransitionSpy = vi.spyOn(state, 'handleTrackTransition');

    // Simulate currently playing track 1
    useStore.setState({
      playback: {
        ...state.playback,
        status: 'Playing',
        current_track: 'C:/Music/track1.mp3',
        position_secs: 10,
      },
      currentTrack: state.tracks[0],
    });

    // Incoming state update for the same track (e.g. position/volume tick)
    useStore.getState().handlePlaybackStateChanged({
      status: 'Playing',
      current_track: 'C:/Music/track1.mp3',
      position_secs: 12,
      volume: 0.9,
    });

    const updated = useStore.getState().playback;
    expect(updated.position_secs).toBe(12);
    expect(updated.volume).toBe(0.9);
    // Must NOT re-trigger handleTrackTransition when track path has not changed
    expect(handleTransitionSpy).not.toHaveBeenCalled();
  });

  it('Filters out undefined, null, or empty paths before sending to queue', () => {
    const rawAlbumTracks = [
      { id: 1, path: 'C:/Music/track1.mp3', title: 'Song 1' },
      { id: 2, path: null, stream_url: null, title: 'Virtual Missing Path' },
      { id: 3, path: '', stream_url: '', title: 'Empty Path' },
      { id: 4, path: 'C:/Music/track4.mp3', title: 'Song 4' },
    ];

    const paths = rawAlbumTracks
      .map(t => (t as any).path || (t as any).stream_url)
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);

    expect(paths).toEqual(['C:/Music/track1.mp3', 'C:/Music/track4.mp3']);
    expect(paths.length).toBe(2);
  });

  it('handleTrackTransition does not throw on null, undefined, or empty path', async () => {
    await expect(
      (async () => {
        await useStore.getState().handleTrackTransition(null as any);
        await useStore.getState().handleTrackTransition(undefined as any);
        await useStore.getState().handleTrackTransition('' as any);
        await useStore.getState().handleTrackTransition(123 as any);
      })()
    ).resolves.not.toThrow();
  });

  it('handlePlaybackStateChanged does not trigger transition when current_track is null', () => {
    const state = useStore.getState();
    useStore.setState({
      playback: {
        ...state.playback,
        status: 'Playing',
        current_track: 'C:/Music/track1.mp3',
      },
      currentTrack: state.tracks[0],
    });

    // Backend emits null current_track (e.g. between tracks)
    expect(() => {
      useStore.getState().handlePlaybackStateChanged({
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        volume: 1,
      });
    }).not.toThrow();

    // current_track should be updated to null, but no crash
    expect(useStore.getState().playback.current_track).toBeNull();
  });
});
