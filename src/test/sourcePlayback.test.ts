import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore, type Track } from '../store';
import type { PlaybackSource } from '../store/types';
import {
  cancelSourcePlayback,
  handleSourceFailure,
  boundedSearchSources,
  getActiveEnrichmentCount,
  getEnrichmentQueueLength,
  clearEnrichmentState,
  playbackRequest,
} from '../store/sourcePlayback';
import { clearSourceCache, groupRecordings, inFlightResolutions, resolveSource } from '../utils/unifiedSources';

const track: Track = {
  id: 1, path: '123', title: 'Song', artist: 'Artist', duration: 180, format: 'Tidal FLAC', lyric_offset: 0,
  source_context: { recording_id: 'recording', sources: [{ provider: 'tidal', id: '123' }, { provider: 'qobuz', id: '123' }], selection: { mode: 'explicit', source: { provider: 'tidal', id: '123' } } },
};
describe('Source playback fallback', () => {
  beforeEach(() => {
    cancelSourcePlayback(); clearSourceCache(); clearEnrichmentState(); localStorage.clear();
    useStore.setState({ queue: [], tracks: [], currentTrack: null, playHistory: [], playCounts: {}, playbackError: null,
      tidalConnected: true, qobuzConnected: true, qobuzExperimentalEnabled: true, sourceQueueManaged: false,
      chromecast_connected: false, upnp_connected: false, streamingQuality: 'best_available',
      currentPlaylist: null,
      recordPlaybackTransition: vi.fn().mockResolvedValue(undefined), autoFetchLyricsOnline: vi.fn().mockResolvedValue(undefined), updateDiscordPresence: vi.fn(),
    });
    vi.mocked(invoke).mockReset().mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: { lossless: true } };
      if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: { lossless: true } };
      return null;
    });
  });

  it('falls back after resolution failure while retaining the explicit preference', async () => {
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') throw new Error('Unavailable');
      if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: { lossless: true } };
      return null;
    });
    const row = groupRecordings([
      track, { ...track, format: 'Qobuz FLAC', album: 'Album', cover_url: 'https://example.com/qobuz.jpg', duration: 181 },
    ], '')[0];
    await useStore.getState().playTrack({ ...row, source_context: { ...row.source_context!, selection: track.source_context!.selection } });
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('qobuz');
    expect(useStore.getState().currentTrack).toMatchObject({ album: 'Album', duration: 181, cover_url: 'https://example.com/qobuz.jpg' });
    expect(useStore.getState().coverArt).toBe('https://example.com/qobuz.jpg');
    expect(useStore.getState().currentTrack?.source_context?.selection).toEqual(track.source_context?.selection);
    expect(JSON.parse(localStorage.getItem('aideo_current_track')!).source_context.selection).toEqual(track.source_context?.selection);
  });

  it('bounds native decoder fallback and stops after exhaustion', async () => {
    const notices = vi.spyOn(window, 'dispatchEvent');
    await useStore.getState().playTrack(track);
    handleSourceFailure('https://tidal.example/audio', 'Decode failed');
    await vi.waitFor(() => expect(useStore.getState().currentTrack?.active_source?.provider).toBe('qobuz'));
    handleSourceFailure('https://qobuz.example/audio', 'Decode failed');
    await vi.waitFor(() => expect(useStore.getState().playback.status).toBe('Stopped'));
    expect(useStore.getState().playbackError).toContain('No source');
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'play_track')).toHaveLength(2);
    expect(notices).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui-toast', detail: expect.objectContaining({ type: 'error', message: expect.stringContaining('No source') }) }));
    notices.mockRestore();
  });

  it('prevents a late resolution from playing after stop', async () => {
    let finish!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementation(async cmd => cmd === 'tidal_resolve_source' ? new Promise(resolve => { finish = resolve; }) : null);
    const pending = useStore.getState().playTrack(track);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await useStore.getState().stopTrack();
    finish({ url: 'https://tidal.example/audio', quality: {} });
    await pending;
    expect(invoke).not.toHaveBeenCalledWith('play_track', expect.anything());
    expect(useStore.getState().playback.status).toBe('Stopped');
  });

  it('does not start audio when paused during source resolution', async () => {
    let finish!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementation(async cmd => cmd === 'tidal_resolve_source' ? new Promise(resolve => { finish = resolve; }) : null);
    const pending = useStore.getState().playTrack(track);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await useStore.getState().pauseTrack();
    finish({ url: 'https://tidal.example/audio', quality: {} });
    await pending;
    expect(invoke).not.toHaveBeenCalledWith('play_track', expect.anything());
    expect(useStore.getState().playback.status).toBe('Paused');
  });

  it('queues and restores choices without resolving temporary URLs', async () => {
    await useStore.getState().addToQueue(track);
    expect(useStore.getState().queue[0].source_context).toEqual(track.source_context);
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => String(cmd).includes('resolve_source'))).toBe(false);
    useStore.setState({ queue: [] });
    await useStore.getState().initializeQueue();
    expect(useStore.getState().queue[0].source_context).toEqual(track.source_context);
    await useStore.getState().playFromQueue(0);
    expect(useStore.getState().currentTrack?.source_context).toEqual(track.source_context);
  });

  it('consumes exactly one duplicate when starting an entry from the queue', async () => {
    useStore.setState({ queue: [track, { ...track }], sourceQueueManaged: true });
    await useStore.getState().playFromQueue(0);
    expect(useStore.getState().queue).toHaveLength(1);
  });

  it('selects actual lossless audio when a higher catalog resolution resolves to lossy', async () => {
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: { lossless: false } };
      if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } };
      return null;
    });
    await useStore.getState().playTrack({ ...track, source_context: {
      ...track.source_context!, selection: { mode: 'auto' }, sources: [
        { provider: 'tidal', id: '123', catalog_quality: { lossless: true, sample_rate: 192000, bit_depth: 24 } },
        { provider: 'qobuz', id: '123', catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } },
      ],
    } });
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('qobuz');
    expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ path: 'https://qobuz.example/audio', startPos: 0 }));
  });

  it('switches source at the current position without starting a new playback session', async () => {
    const lyrics = [{ time_secs: 0, text: 'Line' }];
    const history = [{ ...track, id: 2 }];
    useStore.setState({ currentTrack: track, playHistory: history, playCounts: { recording: 4 }, lyrics, lyricStatus: 'found', scrobbledCurrent: true });
    const qobuzTrack = { ...track, source_context: { ...track.source_context!, selection: { mode: 'explicit' as const, source: { provider: 'qobuz' as const, id: '123' } } } };

    await useStore.getState().playTrack(qobuzTrack, true, false, undefined, 83, true);

    expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ path: 'https://qobuz.example/audio', startPos: 83 }));
    expect(useStore.getState().recordPlaybackTransition).not.toHaveBeenCalled();
    expect(useStore.getState()).toMatchObject({ playHistory: history, playCounts: { recording: 4 }, lyrics, lyricStatus: 'found', scrobbledCurrent: true });
  });

  it('seeks UPnP after switching source because UPnP play has no start position', async () => {
    useStore.setState({ currentTrack: track, upnp_connected: true });

    await useStore.getState().playTrack(track, true, false, undefined, 83, true);

    expect(invoke).toHaveBeenCalledWith('upnp_play', expect.objectContaining({ path: 'https://tidal.example/audio' }));
    expect(invoke).toHaveBeenCalledWith('upnp_control', { action: 'seek', value: 83 });
  });

  it('falls back from a missing local file and keeps that explicit preference', async () => {
    const local = { provider: 'local' as const, id: 'C:/missing.flac' };
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'check_files_exist') return [false];
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: { lossless: true } };
      return null;
    });
    await useStore.getState().playTrack({ ...track, source_context: { ...track.source_context!, sources: [local, { provider: 'tidal', id: '123' }], selection: { mode: 'explicit', source: local } } });
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('tidal');
    expect(useStore.getState().currentTrack?.source_context?.selection).toEqual({ mode: 'explicit', source: local });
  });

  it('cannot overwrite the active fallback when an older metadata update finishes late', async () => {
    let finish!: () => void;
    let metadataCalls = 0;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: { lossless: true } };
      if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: { lossless: true } };
      if (cmd === 'update_media_metadata' && metadataCalls++ === 0) await new Promise<void>(r => { finish = r; });
      return null;
    });
    const pending = useStore.getState().playTrack(track);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    handleSourceFailure('https://tidal.example/audio', 'Decode failed');
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('aideo_current_track')!).active_source?.provider).toBe('qobuz'));
    finish(); await pending;
    expect(JSON.parse(localStorage.getItem('aideo_current_track')!).active_source.provider).toBe('qobuz');
  });
});

describe('Milestone 1: Background discovery and non-interruption lifecycle', () => {
  beforeEach(() => {
    cancelSourcePlayback();
    clearSourceCache();
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    useStore.setState({
      queue: [],
      tracks: [],
      currentTrack: null,
      playHistory: [],
      playCounts: {},
      playbackError: null,
      appMode: 'hybrid',
      tidalConnected: true,
      qobuzConnected: false,
      qobuzExperimentalEnabled: false,
      sourceQueueManaged: false,
      chromecast_connected: false,
      upnp_connected: false,
      streamingQuality: 'best_available',
      currentPlaylist: null,
      recordPlaybackTransition: vi.fn().mockResolvedValue(undefined),
      autoFetchLyricsOnline: vi.fn().mockResolvedValue(undefined),
      updateDiscordPresence: vi.fn(),
    });
  });

  it('does NOT trigger attempt(), does NOT interrupt audio, and does NOT fire mid-song switch toasts when background discovery finds higher-quality sources', async () => {
    const notices: any[] = [];
    const listener = (e: any) => notices.push(e.detail);
    window.addEventListener('ui-toast', listener);

    const initialTrack: Track = {
      id: 10,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Midnight City',
      artist: 'M83',
      duration: 244,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_m83_midnight',
        sources: [{ provider: 'youtube', id: '11111111111', catalog_quality: { lossless: false } }],
        selection: { mode: 'auto' },
      },
    };

    const queuedCopy: Track = {
      ...initialTrack,
      id: 11,
      playlist_entry_id: 101,
    };
    useStore.setState({ queue: [queuedCopy] });

    let resolveDiscoverySearch!: (v: any) => void;
    const discoveryPromise = new Promise(r => { resolveDiscoverySearch = r; });

    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') {
        await discoveryPromise;
        return [{
          id: '99988877',
          title: 'Midnight City',
          artist: 'M83',
          duration: 244,
          catalog_quality: { lossless: true, sample_rate: 96000, bit_depth: 24 },
        }];
      }
      if (cmd === 'search_youtube') return [];
      if (cmd === 'search_local_sources') return [];
      if (cmd === 'tidal_resolve_source') {
        return { url: 'https://tidal.example/m83.flac', quality: { lossless: true, sample_rate: 96000, bit_depth: 24 } };
      }
      if (cmd === 'play_track') return null;
      if (cmd === 'stop_track') return null;
      if (cmd === 'set_source_queue_mode') return null;
      if (cmd === 'update_media_metadata') return null;
      return null;
    });

    // Start playing initial track
    await useStore.getState().playTrack(initialTrack);

    // Initial state: playing YouTube
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('youtube');
    expect(useStore.getState().currentTrack?.active_source?.id).toBe('11111111111');
    const playTrackCallsBefore = vi.mocked(invoke).mock.calls.filter(([c]) => c === 'play_track').length;
    expect(playTrackCallsBefore).toBe(1);
    const noticesBeforeDiscovery = notices.length;

    // Now resolve the background discovery search
    resolveDiscoverySearch(null);

    // Wait for the background discovery task to enrich currentTrack.source_context.sources
    await vi.waitFor(() => {
      const sources = useStore.getState().currentTrack?.source_context?.sources || [];
      expect(sources.length).toBeGreaterThan(1);
    });

    // 1. Verify audio was NOT interrupted: play_track was NOT called again
    const playTrackCallsAfter = vi.mocked(invoke).mock.calls.filter(([c]) => c === 'play_track').length;
    expect(playTrackCallsAfter).toBe(1);

    // 2. Active source remains YouTube (audio not switched mid-song)
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('youtube');
    expect(useStore.getState().currentTrack?.active_source?.id).toBe('11111111111');

    // 3. No mid-song switch toasts were fired by background discovery
    expect(notices.length).toBe(noticesBeforeDiscovery);

    // 4. Discovered source IS appended to currentTrack.source_context.sources for manual picker
    const currentSources = useStore.getState().currentTrack?.source_context?.sources || [];
    expect(currentSources.some(s => s.provider === 'tidal' && s.id === '99988877')).toBe(true);

    // 5. Discovered source IS appended to queued track copies with matching recording_id
    const updatedQueue = useStore.getState().queue;
    expect(updatedQueue[0].source_context?.sources.some(s => s.provider === 'tidal' && s.id === '99988877')).toBe(true);

    // 6. Persisted to localStorage
    const savedChoices = JSON.parse(localStorage.getItem('aideo_library_source_choices') || '{}');
    expect(savedChoices['source:tidal:99988877']?.recording_id).toBe('rec_m83_midnight');

    window.removeEventListener('ui-toast', listener);
  });

  it('uses newly discovered sources for the next play without interrupting the first', async () => {
    const trackWithDiscovered: Track = {
      id: 20,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Midnight City',
      artist: 'M83',
      duration: 244,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_m83_midnight',
        sources: [
          { provider: 'youtube', id: '11111111111', catalog_quality: { lossless: false } },
          { provider: 'tidal', id: '99988877', catalog_quality: { lossless: true, sample_rate: 96000, bit_depth: 24 } },
        ],
        selection: { mode: 'auto' },
      },
    };

    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') {
        return { url: 'https://tidal.example/m83.flac', quality: { lossless: true, sample_rate: 96000, bit_depth: 24 } };
      }
      return null;
    });

    // When this enriched track is played on the *next* play, auto-mode selects the higher-quality Tidal source
    await useStore.getState().playTrack(trackWithDiscovered);

    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('tidal');
    expect(useStore.getState().currentTrack?.active_source?.id).toBe('99988877');
    expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ path: 'https://tidal.example/m83.flac', startPos: 0 }));
  });

  it('preserves user manual explicit source selection made while background discovery is in-flight', async () => {
    let resolveDiscoverySearch!: (v: any) => void;
    const discoveryPromise = new Promise(r => { resolveDiscoverySearch = r; });

    const track: Track = {
      id: 30,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Song',
      artist: 'Artist',
      duration: 180,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_preserve_manual',
        sources: [{ provider: 'youtube', id: '11111111111' }],
        selection: { mode: 'auto' },
      },
    };

    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') {
        await discoveryPromise;
        return [{ id: '88877766', title: 'Song', artist: 'Artist', duration: 180 }];
      }
      return null;
    });

    // Play track in auto mode -> discovery starts
    await useStore.getState().playTrack(track);

    // User explicitly selects YouTube source before discovery finishes
    const current = useStore.getState().currentTrack!;
    useStore.setState({
      currentTrack: {
        ...current,
        source_context: {
          ...current.source_context!,
          selection: { mode: 'explicit', source: { provider: 'youtube', id: '11111111111' } },
        },
      },
    });

    // Now discovery finishes
    resolveDiscoverySearch(null);

    // Wait for discovery to complete
    await vi.waitFor(() => {
      expect(useStore.getState().currentTrack?.source_context?.sources.length).toBeGreaterThan(1);
    });

    // Selection MUST remain explicit, not reverted to auto!
    expect(useStore.getState().currentTrack?.source_context?.selection.mode).toBe('explicit');
    expect((useStore.getState().currentTrack?.source_context?.selection as any).source.id).toBe('11111111111');
  });

  it('manual source switching remains available and seamlessly updates active source and position', async () => {
    const notices: any[] = [];
    const listener = (e: any) => notices.push(e.detail);
    window.addEventListener('ui-toast', listener);

    const playingTrack: Track = {
      id: 40,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Song',
      artist: 'Artist',
      duration: 200,
      format: 'YouTube Direct',
      lyric_offset: 0,
      active_source: { provider: 'youtube', id: '11111111111' },
      source_context: {
        recording_id: 'rec_manual_switch',
        sources: [
          { provider: 'youtube', id: '11111111111' },
          { provider: 'tidal', id: '88877766' },
        ],
        selection: { mode: 'auto' },
      },
    };

    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') {
        return { url: 'https://tidal.example/song.flac', quality: { lossless: true } };
      }
      return null;
    });

    useStore.setState({
      currentTrack: playingTrack,
      playback: { ...useStore.getState().playback, status: 'Playing', position_secs: 52 },
    });

    // Trigger manual switch to tidal at position 52 preserving session
    const manualSwitchTrack: Track = {
      ...playingTrack,
      source_context: {
        ...playingTrack.source_context!,
        selection: { mode: 'explicit', source: { provider: 'tidal', id: '88877766' } },
      },
    };

    await useStore.getState().playTrack(manualSwitchTrack, true, false, undefined, 52, true);

    // Switched to tidal at position 52
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('tidal');
    expect(useStore.getState().currentTrack?.active_source?.id).toBe('88877766');
    expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ path: 'https://tidal.example/song.flac', startPos: 52 }));

    window.removeEventListener('ui-toast', listener);
  });

  it('does not interrupt playback or crash if background discovery fails with an error', async () => {
    const track: Track = {
      id: 50,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Song',
      artist: 'Artist',
      duration: 180,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_err',
        sources: [{ provider: 'youtube', id: '11111111111' }],
        selection: { mode: 'auto' },
      },
    };

    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') throw new Error('Network timeout during discovery');
      return null;
    });

    await useStore.getState().playTrack(track);

    // Playback must continue healthy
    expect(useStore.getState().playback.status).toBe('Playing');
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('youtube');
    expect(useStore.getState().playbackError).toBeNull();
  });

  it('rapid track skip while discovery is in-flight does not corrupt the new track or interrupt audio', async () => {
    let resolveSongADiscovery!: (v: any) => void;
    const songADiscoveryPromise = new Promise(r => { resolveSongADiscovery = r; });

    const songA: Track = {
      id: 60,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Song A',
      artist: 'Artist A',
      duration: 180,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_song_a',
        sources: [{ provider: 'youtube', id: '11111111111' }],
        selection: { mode: 'auto' },
      },
    };

    const songB: Track = {
      id: 61,
      path: 'https://www.youtube.com/watch?v=22222222222',
      title: 'Song B',
      artist: 'Artist B',
      duration: 200,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_song_b',
        sources: [{ provider: 'youtube', id: '22222222222' }],
        selection: { mode: 'auto' },
      },
    };

    vi.mocked(invoke).mockImplementation(async (cmd, _args: any) => {
      if (cmd === 'tidal_search') {
        if (_args?.query?.includes('Song A')) {
          await songADiscoveryPromise;
          return [{ id: '99988877', title: 'Song A', artist: 'Artist A', duration: 180 }];
        }
        return [];
      }
      return null;
    });

    // 1. Start Song A (discovery begins)
    await useStore.getState().playTrack(songA);
    expect(useStore.getState().currentTrack?.title).toBe('Song A');

    // 2. User immediately skips to Song B
    await useStore.getState().playTrack(songB);
    expect(useStore.getState().currentTrack?.title).toBe('Song B');
    expect(useStore.getState().currentTrack?.source_context?.recording_id).toBe('rec_song_b');

    // 3. Now late Song A discovery resolves
    resolveSongADiscovery(null);
    await new Promise(r => setTimeout(r, 50));

    // Song B must remain currentTrack and completely uncorrupted
    expect(useStore.getState().currentTrack?.title).toBe('Song B');
    expect(useStore.getState().currentTrack?.source_context?.recording_id).toBe('rec_song_b');
    expect(useStore.getState().currentTrack?.source_context?.sources).toHaveLength(1);
    expect(useStore.getState().currentTrack?.source_context?.sources[0].id).toBe('22222222222');
  });

  it('stopping playback while discovery is in-flight prevents late discovery from restarting audio', async () => {
    let resolveDiscovery!: (v: any) => void;
    const discoveryPromise = new Promise(r => { resolveDiscovery = r; });

    const track: Track = {
      id: 70,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Song',
      artist: 'Artist',
      duration: 180,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_stop_cancel',
        sources: [{ provider: 'youtube', id: '11111111111' }],
        selection: { mode: 'auto' },
      },
    };

    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') {
        await discoveryPromise;
        return [{ id: '99988877', title: 'Song', artist: 'Artist', duration: 180 }];
      }
      return null;
    });

    await useStore.getState().playTrack(track);
    const playTrackCalls = vi.mocked(invoke).mock.calls.filter(([c]) => c === 'play_track').length;

    // User stops playback
    await useStore.getState().stopTrack();
    expect(useStore.getState().playback.status).toBe('Stopped');

    // Discovery resolves late
    resolveDiscovery(null);
    await new Promise(r => setTimeout(r, 50));

    // Must remain stopped, play_track must not be called again
    expect(useStore.getState().playback.status).toBe('Stopped');
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === 'play_track').length).toBe(playTrackCalls);
  });

  it('enforces 32-source durable ceiling when combined with discovered sources', async () => {
    // Generate 30 initial sources
    const initialSources: PlaybackSource[] = Array.from({ length: 30 }, (_, i) => ({
      provider: 'tidal' as const,
      id: `100000${i.toString().padStart(2, '0')}`,
    }));

    const track: Track = {
      id: 80,
      path: '10000000',
      title: 'Song',
      artist: 'Artist',
      duration: 180,
      format: 'Tidal FLAC',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_ceiling',
        sources: initialSources,
        selection: { mode: 'auto' },
      },
    };

    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: { lossless: true } };
      if (cmd === 'tidal_search') {
        // Return 10 more distinct sources
        return Array.from({ length: 10 }, (_, i) => ({
          id: `200000${i.toString().padStart(2, '0')}`,
          title: 'Song',
          artist: 'Artist',
          duration: 180,
        }));
      }
      return null;
    });

    await useStore.getState().playTrack(track);

    await vi.waitFor(() => {
      expect(useStore.getState().currentTrack?.source_context?.sources.length).toBe(32);
    });

    // Capped at 32 sources max
    expect(useStore.getState().currentTrack?.source_context?.sources.length).toBe(32);
  });

  it('deduplicates existing sources so identical discoveries do not mutate state or queue needlessly', async () => {
    const track: Track = {
      id: 90,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Song',
      artist: 'Artist',
      duration: 180,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_dedup',
        sources: [
          { provider: 'youtube', id: '11111111111' },
          { provider: 'tidal', id: '99988877' },
        ],
        selection: { mode: 'auto' },
      },
    };

    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') {
        // Return the exact same source that is already present
        return [{ id: '99988877', title: 'Song', artist: 'Artist', duration: 180 }];
      }
      return null;
    });

    await useStore.getState().playTrack(track);

    // Wait brief moment for discovery cycle
    await new Promise(r => setTimeout(r, 60));

    // Sources length remains 2, no duplicates created
    expect(useStore.getState().currentTrack?.source_context?.sources).toHaveLength(2);
  });

  it('rejects unverified or non-matching discovery results from being appended to sources', async () => {
    const track: Track = {
      id: 100,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Everlong',
      artist: 'Foo Fighters',
      duration: 250,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_everlong',
        sources: [{ provider: 'youtube', id: '11111111111' }],
        selection: { mode: 'auto' },
      },
    };

    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') {
        // Return acoustic version (version qualifier mismatch) and live version (mismatch)
        return [
          { id: '11122233', title: 'Everlong (Acoustic)', artist: 'Foo Fighters', duration: 250 },
          { id: '44455566', title: 'Everlong (Live)', artist: 'Foo Fighters', duration: 250 },
          { id: '77788899', title: 'Everlong', artist: 'Different Artist', duration: 250 },
        ];
      }
      return null;
    });

    await useStore.getState().playTrack(track);

    await new Promise(r => setTimeout(r, 60));

    // Non-matching versions must NOT be added to safe playback cohort
    expect(useStore.getState().currentTrack?.source_context?.sources).toHaveLength(1);
    expect(useStore.getState().currentTrack?.source_context?.sources[0].id).toBe('11111111111');
  });

  it('skips background discovery entirely when streamingQuality is data_saver', async () => {
    useStore.setState({ streamingQuality: 'data_saver' });

    const track: Track = {
      id: 110,
      path: 'https://www.youtube.com/watch?v=11111111111',
      title: 'Song',
      artist: 'Artist',
      duration: 180,
      format: 'YouTube Direct',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_datasaver',
        sources: [{ provider: 'youtube', id: '11111111111' }],
        selection: { mode: 'auto' },
      },
    };

    const searchSpy = vi.fn();
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search' || cmd === 'search_youtube') searchSpy();
      return null;
    });

    await useStore.getState().playTrack(track);
    await new Promise(r => setTimeout(r, 60));

    // No discovery search should have been dispatched
    expect(searchSpy).not.toHaveBeenCalled();
    expect(useStore.getState().currentTrack?.source_context?.sources).toHaveLength(1);
  });

  it('boundedSearchSources limits concurrency to 2 and coalesces identical in-flight requests', async () => {
    let resolve1: (v: any) => void;
    let resolve2: (v: any) => void;
    let resolve3: (v: any) => void;

    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === 'tidal_search') {
        if (args?.query === 'Song 1') return new Promise(r => { resolve1 = r; });
        if (args?.query === 'Song 2') return new Promise(r => { resolve2 = r; });
        if (args?.query === 'Song 3') return new Promise(r => { resolve3 = r; });
      }
      return [];
    });

    // Launch first two jobs: both should become active (limit 2)
    const p1a = boundedSearchSources('Song 1', { tidal: true, qobuz: false });
    const p1b = boundedSearchSources('Song 1', { tidal: true, qobuz: false }); // Identical: coalesced
    expect(p1a).toBe(p1b); // Exact same promise returned

    const p2 = boundedSearchSources('Song 2', { tidal: true, qobuz: false });
    expect(getActiveEnrichmentCount()).toBe(2);
    expect(getEnrichmentQueueLength()).toBe(0);

    // Launch third job: must be queued because max concurrent jobs = 2
    let p3Resolved = false;
    const p3 = boundedSearchSources('Song 3', { tidal: true, qobuz: false }).then(res => {
      p3Resolved = true;
      return res;
    });
    expect(getActiveEnrichmentCount()).toBe(2);
    expect(getEnrichmentQueueLength()).toBe(1);
    expect(p3Resolved).toBe(false);

    // Resolving job 1 unblocks job 3 from the queue
    resolve1!([]);
    await p1a;

    expect(getActiveEnrichmentCount()).toBe(2); // Job 2 + Job 3 now active
    expect(getEnrichmentQueueLength()).toBe(0);

    // Resolving remaining jobs
    resolve2!([]);
    await p2;
    resolve3!([]);
    await p3;
    expect(p3Resolved).toBe(true);
    expect(getActiveEnrichmentCount()).toBe(0);
  });

  it('registerDiscoveredSources reactively updates registry, currentTrack, and queue with up to 32 deduplicated sources', () => {
    const initialTrack: Track = {
      id: 99,
      path: 'C:/music/track.flac',
      title: 'Reactive Track',
      artist: 'Reactive Artist',
      duration: 200,
      format: 'FLAC',
      lyric_offset: 0,
      source_context: {
        recording_id: 'rec_reactive_99',
        sources: [{ provider: 'local', id: 'C:/music/track.flac' }],
        selection: { mode: 'auto' },
      },
    };

    const queuedTrack: Track = {
      ...initialTrack,
      id: 100,
      queue_occurrence_id: 'occ_100',
    };

    useStore.setState({
      currentTrack: initialTrack,
      queue: [queuedTrack],
    });

    const discoveredSources: PlaybackSource[] = [
      { provider: 'local', id: 'C:/music/track.flac' }, // duplicate, should dedupe
      { provider: 'tidal', id: 'tidal_99', catalog_quality: { lossless: true } },
      { provider: 'youtube', id: 'yt_99_video' },
    ];

    useStore.getState().registerDiscoveredSources(discoveredSources, 'rec_reactive_99');

    // 1. Check sourceRegistry
    const registryEntry = useStore.getState().sourceRegistry['rec_reactive_99'];
    expect(registryEntry).toBeDefined();
    expect(registryEntry.sources).toHaveLength(3);
    expect(registryEntry.sources.map(s => s.provider)).toEqual(['local', 'tidal', 'youtube']);

    // 2. Check currentTrack reactive update
    const updatedCurrent = useStore.getState().currentTrack;
    expect(updatedCurrent?.source_context?.sources).toHaveLength(3);
    expect(updatedCurrent?.source_context?.sources.some(s => s.provider === 'tidal')).toBe(true);

    // 3. Check queue reactive update
    const updatedQueue = useStore.getState().queue;
    expect(updatedQueue[0].source_context?.sources).toHaveLength(3);

    // 4. Test 32 sources cap
    const manySources: PlaybackSource[] = Array.from({ length: 40 }, (_, i) => ({
      provider: 'tidal' as const,
      id: `tidal_batch_${i}`,
    }));
    useStore.getState().registerDiscoveredSources(manySources, 'rec_reactive_99');
    expect(useStore.getState().sourceRegistry['rec_reactive_99'].sources.length).toBe(32);
    expect(useStore.getState().currentTrack?.source_context?.sources.length).toBe(32);
  });
});

describe('Milestone 3: Playback attempt lifecycle, cancellation, 15s deadline & in-flight deduplication', () => {
  beforeEach(() => {
    cancelSourcePlayback();
    clearSourceCache();
    clearEnrichmentState();
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    useStore.setState({
      queue: [],
      tracks: [],
      currentTrack: null,
      playHistory: [],
      playCounts: {},
      playbackError: null,
      appMode: 'hybrid',
      tidalConnected: true,
      qobuzConnected: true,
      qobuzExperimentalEnabled: true,
      sourceQueueManaged: false,
      chromecast_connected: false,
      upnp_connected: false,
      streamingQuality: 'best_available',
      currentPlaylist: null,
      recordPlaybackTransition: vi.fn().mockResolvedValue(undefined),
      autoFetchLyricsOnline: vi.fn().mockResolvedValue(undefined),
      updateDiscordPresence: vi.fn(),
    });
  });

  it('Feature 24: generates runtime attempt ID and passes attempt_id to play_track', async () => {
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/stream', quality: { lossless: true } };
      if (cmd === 'play_track') return null;
      return null;
    });

    await useStore.getState().playTrack(track);

    const currentAttemptId = useStore.getState().currentAttemptId;
    expect(currentAttemptId).toBeDefined();
    expect(currentAttemptId).toMatch(/^attempt_\d+_\d+_\d+$/);
    expect(useStore.getState().playback.attempt_id).toBe(currentAttemptId);
    expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({
      path: 'https://tidal.example/stream',
      attempt_id: currentAttemptId,
    }));
  });

  it('Feature 25: playPrev() immediately cancels in-flight playback resolution', async () => {
    let finishResolve!: (v: any) => void;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') return new Promise(r => { finishResolve = r; });
      return null;
    });

    const pending = useStore.getState().playTrack(track);
    await vi.waitFor(() => expect(finishResolve).toBeTypeOf('function'));

    // Calling playPrev cancels the in-flight resolution
    await useStore.getState().playPrev();
    finishResolve({ url: 'https://tidal.example/stream', quality: {} });
    await pending;

    expect(invoke).not.toHaveBeenCalledWith('play_track', expect.anything());
  });

  it('Feature 25: setAppMode("local") cancels in-flight resolution and stops active stream', async () => {
    let finishResolve!: (v: any) => void;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') return new Promise(r => { finishResolve = r; });
      if (cmd === 'stop_track') return null;
      return null;
    });

    const pending = useStore.getState().playTrack(track);
    await vi.waitFor(() => expect(finishResolve).toBeTypeOf('function'));

    // Switching to local mode must cancel and abort
    useStore.getState().setAppMode('local');
    expect(useStore.getState().appMode).toBe('local');

    finishResolve({ url: 'https://tidal.example/stream', quality: {} });
    await pending;

    expect(invoke).not.toHaveBeenCalledWith('play_track', expect.anything());
  });

  it('Feature 25: clearQueue() cancels in-flight playback', async () => {
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'clear_queue') return null;
      return null;
    });

    const initialSeq = playbackRequest();
    await useStore.getState().clearQueue();
    const newSeq = playbackRequest();
    expect(newSeq).toBeGreaterThan(initialSeq);
  });

  it('Feature 26: 15-second overall deadline aborts across multiple hanging fallback sources', async () => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source' || cmd === 'qobuz_resolve_source') {
        return new Promise(() => {}); // never resolves
      }
      return null;
    });

    const pending = useStore.getState().playTrack(track);
    vi.advanceTimersByTime(15001);
    await pending;

    expect(useStore.getState().playback.status).toBe('Stopped');
    expect(useStore.getState().playbackError).toContain('timed out');
    vi.useRealTimers();
  });

  it('Feature 27: inFlightResolutions coalesces concurrent calls to the same source', async () => {
    let callCount = 0;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') {
        callCount++;
        await new Promise(r => setTimeout(r, 50));
        return { url: 'https://tidal.example/audio', quality: { lossless: true } };
      }
      return null;
    });

    const s: PlaybackSource = { provider: 'tidal', id: 'coalesce_test' };
    const p1 = resolveSource(s, 'best_available');
    const p2 = resolveSource(s, 'best_available');
    expect(inFlightResolutions.has('tidal:coalesce_test:best_available')).toBe(true);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.url).toBe('https://tidal.example/audio');
    expect(r2.url).toBe('https://tidal.example/audio');
    expect(callCount).toBe(1);
    expect(inFlightResolutions.has('tidal:coalesce_test:best_available')).toBe(false);
  });

  it('Feature 27: clearSourceCache empties inFlightResolutions and result cache', () => {
    vi.mocked(invoke).mockImplementation(() => new Promise(() => {}));
    const s: PlaybackSource = { provider: 'tidal', id: 'clear_test' };
    const p = resolveSource(s, 'best_available');
    p.catch(() => {});
    expect(inFlightResolutions.size).toBeGreaterThan(0);
    clearSourceCache();
    expect(inFlightResolutions.size).toBe(0);
  });
});
