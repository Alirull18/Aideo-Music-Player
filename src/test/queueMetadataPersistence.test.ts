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
      autoplayEnabled: true,
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
    const track = { id: -1, path: TIDAL_ID, title: 'Blue Valentine', artist: 'NMIXX', duration: 186, format: 'Tidal FLAC', lyric_offset: 0 };

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'tidal_get_stream_url') return TIDAL_URL;
      if (cmd === 'add_to_queue') {
        expect(args.path).toBe(TIDAL_URL);
        return null;
      }
      return null;
    });

    return useStore.getState().addToQueue({ ...track }).then(() => {
      expect(resolvedPathMap.get(TIDAL_URL)).toBe(TIDAL_ID);
      const meta = parseStreamMetadata(TIDAL_URL);
      expect(meta.title).toBe('Blue Valentine');
      expect(meta.artist).toBe('NMIXX');
    });
  });

  it('initializeQueue resolves Tidal track IDs to stream URLs before pushing to the backend', async () => {
    const bulkPaths: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'tidal_get_stream_url') return TIDAL_URL;
      if (cmd === 'check_files_exist') return [];
      if (cmd === 'clear_queue') return null;
      if (cmd === 'add_to_queue_bulk') {
        bulkPaths.push(...args.paths);
        return null;
      }
      return null;
    });
    localStorage.setItem('aideo_queue', JSON.stringify([
      { id: -1, path: TIDAL_ID, title: 'Blue Valentine', artist: 'NMIXX', duration: 186, format: 'Tidal FLAC', lyric_offset: 0 },
    ]));

    await useStore.getState().initializeQueue();

    expect(bulkPaths).toEqual([TIDAL_URL]);
    expect(useStore.getState().queue[0].title).toBe('Blue Valentine');
    // Metadata is recoverable from the URL alone (survives restarts)
    expect(parseStreamMetadata(TIDAL_URL).title).toBe('Blue Valentine');
  });

  it('initializeQueue heals queue entries whose title degraded to a bare hostname', async () => {
    rememberResolvedPath(TIDAL_URL, TIDAL_ID);
    onlineTrackCache.set(TIDAL_URL, { id: -1, path: TIDAL_ID, title: 'Blue Valentine', artist: 'NMIXX', format: 'Tidal FLAC' });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
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
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
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
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
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
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
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
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
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
      if (cmd === 'get_tidal_autoplay_recommendations') {
        received = args;
        return [];
      }
      return null;
    });

    await useStore.getState().triggerAutoplayRadio({
      id: -1002,
      path: '253975903',
      title: 'Blue Valentine',
      artist: 'Online Stream',
      duration: 186,
      format: 'Tidal FLAC',
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
      queue: [],
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: 'https://example.com/dead-stream',
        last_skip_time: Date.now() - 10000,
        last_stop_time: 0,
        backend_stop_detected_at: 0,
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
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
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
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
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
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_playback_status') return { status: 'Stopped', current_track: null, position_secs: 0, volume: 1 };
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    expect(s.playback.status).toBe('Playing');
    expect(s.playback.backend_stop_detected_at).toBe(0);
  });
});
