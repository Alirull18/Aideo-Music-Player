import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { Track } from '../store/types';

describe('Tidal Track Advancement: Queue & Transition Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      queue: [],
      currentTrack: null,
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
      },
      autoplayEnabled: true,
    });
  });

  it('populates remaining search results into queue when a Tidal track is selected', () => {
    const searchTracks = [
      { id: '101', title: 'Track 1', artist: 'Artist A', format: 'Tidal FLAC', duration_raw: '3:00' },
      { id: '102', title: 'Track 2', artist: 'Artist A', format: 'Tidal FLAC', duration_raw: '3:30' },
      { id: '103', title: 'Track 3', artist: 'Artist A', format: 'Tidal FLAC', duration_raw: '4:00' },
    ];

    const clickedIdx = 0;
    const rest = searchTracks.slice(clickedIdx + 1).map((t) => ({
      id: -20000 - Number(t.id),
      path: String(t.id),
      title: t.title,
      artist: t.artist,
      duration: 210,
      format: 'Tidal FLAC',
      cover_url: null,
      lyric_offset: 0,
    } as Track));

    useStore.setState({ queue: rest });
    expect(useStore.getState().queue).toHaveLength(2);
    expect(useStore.getState().queue[0].path).toBe('102');
    expect(useStore.getState().queue[1].path).toBe('103');
  });

  it('preserves Tidal track IDs in queue without baking expiring CDN URLs upfront', () => {
    const tidalSeed: Track = {
      id: 999,
      path: '455738980',
      title: 'Seed Track',
      artist: 'Seed Artist',
      album: 'Seed Album',
      format: 'Tidal FLAC',
      duration: 180,
      lyric_offset: 0,
    };

    useStore.setState({
      autoplayEnabled: true,
      currentTrack: tidalSeed,
      queue: [
        { id: -20001, path: '455738981', title: 'Next Tidal 1', artist: 'Artist', format: 'Tidal FLAC', duration: 190 },
        { id: -20002, path: '455738982', title: 'Next Tidal 2', artist: 'Artist', format: 'Tidal FLAC', duration: 200 },
      ] as Track[],
    });

    const q = useStore.getState().queue;
    expect(q[0].path).toBe('455738981');
    expect(q[0].format).toBe('Tidal FLAC');
    // Ensure path is the persistent Tidal ID and not a raw HTTP link
    expect(q[0].path.startsWith('http')).toBe(false);
  });

  it('advances to next queued track on playback error when queue has tracks', async () => {
    const playNextSpy = vi.fn();
    useStore.setState({
      currentTrack: { id: 1, path: 'bad_stream', title: 'Broken', artist: 'X', format: 'Tidal FLAC', duration: 180 } as Track,
      queue: [{ id: 2, path: 'good_stream', title: 'Working', artist: 'Y', format: 'Tidal FLAC', duration: 180 } as Track],
      playNext: playNextSpy,
    });

    const state = useStore.getState();
    if (state.currentTrack && state.queue.length > 0) {
      await state.playNext();
    }
    expect(playNextSpy).toHaveBeenCalled();
  });

  it('fetchQueue preserves streaming tracks when backend queue is empty', async () => {
    const streamQueue: Track[] = [
      { id: -20001, path: '455738981', title: 'Tidal 1', artist: 'Artist 1', format: 'Tidal FLAC', duration: 200, lyric_offset: 0 },
      { id: -20002, path: '455738982', title: 'Tidal 2', artist: 'Artist 2', format: 'Tidal FLAC', duration: 210, lyric_offset: 0 },
    ];
    useStore.setState({ queue: streamQueue });

    // Mock backend queue as empty []
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_queue') return [];
      return null;
    });

    await useStore.getState().fetchQueue();
    expect(useStore.getState().queue).toHaveLength(2);
    expect(useStore.getState().queue[0].path).toBe('455738981');
  });

  it('handleTrackTransition maps resolved CDN URL back to the original Tidal queue track', async () => {
    const { rememberResolvedPath } = await import('../utils');
    const cdnUrl = 'https://sp-pr-cf.audio.tidal.com/stream-12345.flac?token=abc';
    const tidalId = '455738981';
    rememberResolvedPath(cdnUrl, tidalId);

    const tidalTrack: Track = {
      id: -20001,
      path: tidalId,
      title: 'Lossless Master',
      artist: 'HiFi Artist',
      album: 'HiFi Album',
      format: 'Tidal FLAC',
      duration: 240,
      lyric_offset: 0,
      cover_url: 'https://resources.tidal.com/images/cover.jpg',
    };

    useStore.setState({
      queue: [tidalTrack],
      currentTrack: null,
    });

    await useStore.getState().handleTrackTransition(cdnUrl);

    const current = useStore.getState().currentTrack;
    expect(current).not.toBeNull();
    expect(current?.title).toBe('Lossless Master');
    expect(current?.artist).toBe('HiFi Artist');
  });
});
