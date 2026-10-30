import type { Track } from '../store/types';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { rememberResolvedPath, parseStreamMetadata, pathsEqual, onlineTrackCache, resolvedPathMap, isGenericStreamTitle, isGenericStreamArtist } from '../utils';

const TIDAL_ID = '253975903';
const TIDAL_URL = 'https://Lgf.audio.tidal.com/segment/abcdef.flac';

describe('Stream queue metadata persistence (regression: "Lgf.audio.tidal.com" queue titles)', () => {
  beforeEach(() => {
    localStorage.clear();
    onlineTrackCache.clear();
    resolvedPathMap.clear();
    useStore.setState({
      tracks: [],
      queue: [],
      currentTrack: null,
      playHistory: [],
      recommendationEngine: 'our',
      appMode: 'hybrid',
      repeat: 'all',
      autoplayEnabled: true,
      sourceQueueManaged: false,
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
    localStorage.clear();
    onlineTrackCache.clear();
    resolvedPathMap.clear();
  });

  it('rememberResolvedPath persists the URL→track-ID mapping to localStorage', () => {
    rememberResolvedPath(TIDAL_URL, TIDAL_ID);
    const saved = JSON.parse(localStorage.getItem('aideo_resolved_paths') || '[]');
    expect(saved).toContainEqual([TIDAL_URL, TIDAL_ID]);
    expect(resolvedPathMap.get(TIDAL_URL)).toBe(TIDAL_ID);
  });

  it('pathsEqual maps a resolved stream URL back to its track ID', () => {
    rememberResolvedPath(TIDAL_URL, TIDAL_ID);
    expect(pathsEqual(TIDAL_URL, TIDAL_ID)).toBe(true);
  });

  it('caches track metadata under the resolved URL so parseStreamMetadata returns the real title', () => {
    const track = { id: -1, path: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Blue Valentine', artist: 'NMIXX', duration: 186, format: 'YouTube Direct', lyric_offset: 0 };
    onlineTrackCache.set(TIDAL_URL, track as Track);
    rememberResolvedPath(TIDAL_URL, track.path);
    const meta = parseStreamMetadata(TIDAL_URL);
    expect(meta.title).toBe('Blue Valentine');
    expect(meta.artist).toBe('NMIXX');
  });

  it('refuses to queue a retired Tidal track and tells the user why', async () => {
    const toasts: string[] = [];
    const onToast = (e: Event) => toasts.push((e as CustomEvent).detail.message);
    window.addEventListener('ui-toast', onToast);
    vi.mocked(invoke).mockResolvedValue(null);
    const queued = await useStore.getState().addToQueue({ id: -1, path: TIDAL_ID, title: 'Blue Valentine', artist: 'NMIXX', duration: 186, format: 'Tidal FLAC', lyric_offset: 0 });
    window.removeEventListener('ui-toast', onToast);
    expect(queued).toBeUndefined();
    expect(useStore.getState().queue).toEqual([]);
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'add_to_queue')).toBe(false);
    expect(toasts.some(m => m.includes('no longer built in'))).toBe(true);
  });

  it.each(['addToQueue', 'playNextInQueue'] as const)('rejects a bare retired track in a source-managed queue through %s', async action => {
    vi.mocked(invoke).mockClear();
    useStore.setState({ sourceQueueManaged: true });
    await useStore.getState()[action]({ id: -1, path: TIDAL_ID, title: 'Song', artist: 'Artist', duration: 180, format: 'Tidal FLAC', lyric_offset: 0 });
    expect(useStore.getState().queue).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith('set_source_queue_mode', expect.anything());
  });

  it.each(['addToQueue', 'playNextInQueue'] as const)('hydrates a saved live fallback before retired-track rejection through %s', async action => {
    const context = { recording_id: 'saved-fallback', sources: [{ provider: 'addon', id: 'com.test.mock:123' }], selection: { mode: 'auto' } };
    localStorage.setItem('aideo_library_source_choices', JSON.stringify({ [`Tidal FLAC:${TIDAL_ID}`]: context }));
    vi.mocked(invoke).mockResolvedValue(null);
    await useStore.getState()[action]({ id: -1, path: TIDAL_ID, title: 'Song', artist: 'Artist', duration: 180, format: 'Tidal FLAC', lyric_offset: 0 });
    expect(useStore.getState().queue[0]?.source_context).toMatchObject(context);
  });

  it('initializeQueue keeps retired Tidal entries out of the backend queue', async () => {
    const bulkPaths: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'check_files_exist') return [];
      if (cmd === 'add_to_queue_bulk') { bulkPaths.push(...args.paths); return null; }
      return null;
    });
    localStorage.setItem('aideo_queue', JSON.stringify([
      { id: -1, path: TIDAL_ID, title: 'Blue Valentine', artist: 'NMIXX', duration: 186, format: 'Tidal FLAC', lyric_offset: 0 },
      { id: -2, path: 'https://example.com/live.mp3', title: 'Live', artist: 'Radio', duration: 0, format: 'Web Stream', lyric_offset: 0 },
    ]));

    await useStore.getState().initializeQueue();

    expect(bulkPaths).not.toContain(TIDAL_ID);
    expect(bulkPaths).toContain('https://example.com/live.mp3');
  });

  it('initializeQueue heals queue entries whose title degraded to a bare hostname', async () => {
    rememberResolvedPath(TIDAL_URL, TIDAL_ID);
    onlineTrackCache.set(TIDAL_URL, { id: -1, path: TIDAL_ID, title: 'Blue Valentine', artist: 'NMIXX', format: 'Tidal FLAC' });
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
      if (cmd === 'check_files_exist') return [];
      if (cmd === 'clear_queue') return null;
      if (cmd === 'add_to_queue_bulk') return null;
      return null;
    });
    localStorage.setItem('aideo_queue', JSON.stringify([
      { id: -1, path: TIDAL_URL, title: 'Lgf.audio.tidal.com', artist: 'Online Stream', duration: null, format: 'Tidal FLAC', lyric_offset: 0 },
    ]));

    await useStore.getState().initializeQueue();

    expect(useStore.getState().queue[0].title).toBe('Blue Valentine');
    expect(useStore.getState().queue[0].artist).toBe('NMIXX');
  });

  it('initializeQueue never mangles legitimate single-word titles', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
      if (cmd === 'check_files_exist') return [];
      if (cmd === 'clear_queue') return null;
      if (cmd === 'add_to_queue_bulk') return null;
      return null;
    });
    localStorage.setItem('aideo_queue', JSON.stringify([
      { id: -1, path: 'https://example.com/stream', title: 'Hello', artist: 'Adele', duration: 200, format: 'URL', lyric_offset: 0 },
    ]));

    await useStore.getState().initializeQueue();

    expect(useStore.getState().queue[0].title).toBe('Hello');
  });
});

describe('Queue clear behavior (regression: cleared songs repopulate after Clear)', () => {
  const onlineTrack = { id: -1, path: '253975903', title: 'Blue Valentine', artist: 'NMIXX', duration: 186, format: 'Tidal FLAC', lyric_offset: 0, is_autoplay: true };

  beforeEach(() => {
    localStorage.clear();
    onlineTrackCache.clear();
    resolvedPathMap.clear();
    useStore.setState({
      tracks: [],
      currentTrack: { ...onlineTrack },
      playHistory: [],
      queue: [{ ...onlineTrack }, { ...onlineTrack, path: '111222333', title: 'DICE', artist: 'NMIXX' }],
      autoplayEnabled: true,
      recentlyClearedAutoplayPaths: [],
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: '197775124',
        last_stop_time: 0,
      },
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
    localStorage.clear();
    onlineTrackCache.clear();
    resolvedPathMap.clear();
  });

  it('Clear empties the queue without stopping playback or rebuilding the radio', async () => {
    const commands: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
      commands.push(cmd);
      if (cmd === 'get_queue') return [];
      return null;
    });

    await useStore.getState().clearQueue();

    expect(useStore.getState().queue).toEqual([]);
    expect(JSON.parse(localStorage.getItem('aideo_queue') || '[]')).toEqual([]);
    // Playback untouched: no stop, no radio rebuild, no auto-play of a new track
    expect(useStore.getState().playback.status).toBe('Playing');
    expect(commands).not.toContain('stop_track');
    expect(commands).not.toContain('get_tidal_autoplay_recommendations');
    expect(commands).not.toContain('get_queue'); // no immediate re-sync that could resurrect items
  });

  it('Clear records cleared paths so a later radio refill skips them', async () => {
    vi.mocked(invoke).mockResolvedValue(null);

    await useStore.getState().clearQueue();

    const cleared = useStore.getState().recentlyClearedAutoplayPaths;
    expect(cleared).toContain('253975903');
    expect(cleared).toContain('111222333');
  });

  it('a fetchQueue after Clear keeps the queue empty (no resurrection)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
      if (cmd === 'get_queue') return []; // backend was cleared
      return null;
    });

    await useStore.getState().clearQueue();
    await useStore.getState().fetchQueue();

    expect(useStore.getState().queue).toEqual([]);
    expect(JSON.parse(localStorage.getItem('aideo_queue') || '[]')).toEqual([]);
  });
});

describe('Autoplay seed sanitization (regression: random songs fill queue on stream errors)', () => {
  beforeEach(() => {
    localStorage.clear();
    onlineTrackCache.clear();
    resolvedPathMap.clear();
    useStore.setState({
      tracks: [],
      queue: [],
      currentTrack: null,
      playHistory: [],
      autoplayEnabled: true,
      autoplaySeedTrack: null,
      autoplaySessionHistory: [],
      recentlyClearedAutoplayPaths: [],
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
    localStorage.clear();
    onlineTrackCache.clear();
    resolvedPathMap.clear();
  });

  it('never queries the providers with a degraded hostname/placeholder seed', async () => {
    const commands: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
      commands.push(cmd);
      if (cmd === 'get_tidal_autoplay_recommendations') {
        return [{ id: '999', title: 'Random Instrumental', artist: 'Unknown Band', duration: 200, cover_url: null }];
      }
      return null;
    });

    // Degraded virtual track: hostname title + placeholder artist (post-error state)
    await useStore.getState().triggerAutoplayRadio({
      id: -1001,
      path: 'https://Lgf.audio.tidal.com/segment/abcdef.flac',
      title: 'Lgf.audio.tidal.com',
      artist: 'Online Stream',
      duration: null,
      format: 'Tidal FLAC',
      lyric_offset: 0,
    }, true);

    expect(commands).not.toContain('get_tidal_autoplay_recommendations');
    expect(useStore.getState().queue).toEqual([]);
  });

  it('sanitizes a partially degraded seed instead of searching the placeholder artist', async () => {
    let received: any = null;
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
      if (cmd === 'get_youtube_autoplay_recommendations') {
        received = args;
        return [];
      }
      return null;
    });

    await useStore.getState().triggerAutoplayRadio({
      id: -1002,
      path: 'aaaaaaaaaaa',
      title: 'Blue Valentine',
      artist: 'Online Stream',
      duration: 186,
      format: 'YouTube Direct',
      lyric_offset: 0,
    }, true);

    expect(received).not.toBeNull();
    expect(received.artist).toBe('Unknown Artist'); // backend falls back to the real title
    expect(received.title).toBe('Blue Valentine');
  });

  it('isGenericStreamTitle/Artist detect the degraded metadata shapes', () => {
    expect(isGenericStreamTitle('Lgf.audio.tidal.com')).toBe(true);
    expect(isGenericStreamTitle('Web Audio Stream')).toBe(true);
    expect(isGenericStreamTitle('https://example.com/x')).toBe(true);
    expect(isGenericStreamTitle('')).toBe(true);
    expect(isGenericStreamTitle('Blue Valentine')).toBe(false);
    expect(isGenericStreamTitle('Hello')).toBe(false);
    expect(isGenericStreamTitle('song.mp3')).toBe(false);

    expect(isGenericStreamArtist('Online Stream')).toBe(true);
    expect(isGenericStreamArtist('Web Stream')).toBe(true);
    expect(isGenericStreamArtist('Unknown Artist')).toBe(true);
    expect(isGenericStreamArtist('NMIXX')).toBe(false);
  });
});

describe('resumeTrack recovery (regression: dead play button after playback dies)', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      tracks: [],
      currentTrack: null,
      playHistory: [],
      queue: [],
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: null,
        last_played_track: null,
        last_stop_time: 0,
        position_secs: 0,
      },
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
    localStorage.clear();
  });

  it('falls back to playing from the queue when there is nothing to resume', async () => {
    useStore.setState({
      queue: [{ id: -1, path: 'C:\\music\\song.mp3', title: 'Song', artist: 'Artist', duration: 180, format: 'MP3', lyric_offset: 0 }],
    });
    vi.mocked(invoke).mockResolvedValue(null);

    await useStore.getState().resumeTrack();

    const s = useStore.getState();
    expect(s.playback.status).toBe('Playing');
    expect(s.playback.current_track).toBe('C:\\music\\song.mp3');
    expect(s.queue.length).toBe(0);
  });

  it('does nothing harmful when stopped with an empty queue', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await useStore.getState().resumeTrack();
    const s = useStore.getState();
    expect(s.playback.status).toBe('Stopped');
    expect(s.playback.current_track).toBeNull();
  });
});

describe('pollStatus accepts a genuine backend stop after the grace window', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      currentTrack: null,
      currentAttemptId: undefined,
      queue: [],
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: 'https://example.com/dead-stream',
        last_skip_time: Date.now() - 10000,
        last_stop_time: 0,
        backend_stop_detected_at: 0,
        is_buffering: false,
        attempt_id: undefined,
        last_poll_time: 0,
      },
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
    localStorage.clear();
  });

  it('keeps the UI stable during the grace period (autoplay refill window)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
      if (cmd === 'get_playback_status') return { status: 'Stopped', current_track: null, position_secs: 0, volume: 1 };
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    expect(s.playback.status).toBe('Playing');
    expect(s.playback.current_track).toBe('https://example.com/dead-stream');
    expect(s.playback.backend_stop_detected_at).toBeGreaterThan(0);
  });

  it('syncs to Stopped once the grace window expires instead of freezing forever', async () => {
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        backend_stop_detected_at: Date.now() - 6000,
      },
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
      if (cmd === 'get_playback_status') return { status: 'Stopped', current_track: null, position_secs: 0, volume: 1 };
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    expect(s.playback.status).toBe('Stopped');
    expect(s.playback.current_track).toBeNull();
  });

  it('still ignores a Stopped+null report inside the 2s skip window', async () => {
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        last_skip_time: Date.now() - 500,
        backend_stop_detected_at: 0,
      },
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
      if (cmd === 'get_playback_status') return { status: 'Stopped', current_track: null, position_secs: 0, volume: 1 };
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    expect(s.playback.status).toBe('Playing');
    expect(s.playback.backend_stop_detected_at).toBe(0);
  });
});
