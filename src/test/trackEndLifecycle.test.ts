import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { getContiguousLocalPrefix } from '../store/playbackSlice';
import { Track } from '../store/types';

describe('Track-End Playback Lifecycle & Queue Invariants', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      currentTrack: null,
      currentAttemptId: undefined,
      queue: [],
      tracks: [],
      repeat: 'all',
      shuffle: false,
      autoplayEnabled: true,
      sourceQueueManaged: false,
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: null,
        attempt_id: undefined,
        position_secs: 0,
        last_stop_time: 0,
      },
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
  });

  describe('getContiguousLocalPrefix', () => {
    it('returns empty array when queue is empty', () => {
      expect(getContiguousLocalPrefix([])).toEqual([]);
    });

    it('returns all paths when all tracks in queue are local files', () => {
      const queue: Track[] = [
        { id: 1, path: 'C:/music/track1.flac', title: 'Track 1', artist: 'Artist', format: 'FLAC', duration: 180, lyric_offset: 0 },
        { id: 2, path: 'C:/music/track2.mp3', title: 'Track 2', artist: 'Artist', format: 'MP3', duration: 200, lyric_offset: 0 },
      ];
      expect(getContiguousLocalPrefix(queue)).toEqual(['C:/music/track1.flac', 'C:/music/track2.mp3']);
    });

    it('stops at the first online stream or remote unified track to prevent skipping online songs', () => {
      const queue: Track[] = [
        { id: 1, path: 'C:/music/local1.flac', title: 'Local 1', artist: 'Artist', format: 'FLAC', duration: 180, lyric_offset: 0 },
        { id: 2, path: 'https://tidal.stream/track.m4a', title: 'Stream Track', artist: 'Stream Artist', format: 'Tidal FLAC', duration: 210, lyric_offset: 0 },
        { id: 3, path: 'C:/music/local2.flac', title: 'Local 2', artist: 'Artist', format: 'FLAC', duration: 190, lyric_offset: 0 },
      ];
      // Must only return local1, NOT local2!
      expect(getContiguousLocalPrefix(queue)).toEqual(['C:/music/local1.flac']);
    });

    it('returns empty array if the very first track in queue is an online track', () => {
      const queue: Track[] = [
        { id: 1, path: 'https://youtube.com/watch?v=12345', title: 'YT Stream', artist: 'Artist', format: 'YouTube Direct', duration: 180, lyric_offset: 0 },
        { id: 2, path: 'C:/music/local1.flac', title: 'Local 1', artist: 'Artist', format: 'FLAC', duration: 180, lyric_offset: 0 },
      ];
      expect(getContiguousLocalPrefix(queue)).toEqual([]);
    });

    it('considers tracks with source_context as non-local streams', () => {
      const queue: Track[] = [
        {
          id: 1,
          path: 'tidal-id-123',
          title: 'Remote Tidal Track',
          artist: 'Artist',
          format: 'Tidal FLAC',
          duration: 200,
          lyric_offset: 0,
          source_context: { recording_id: 'rec_123', sources: [{ provider: 'tidal', id: '123' }], selection: { mode: 'auto' } },
        },
        { id: 2, path: 'C:/music/local.mp3', title: 'Local', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 },
      ];
      expect(getContiguousLocalPrefix(queue)).toEqual([]);
    });
  });

  describe('syncBackendQueue', () => {
    it('clears backend queue and sends only contiguous local prefix', async () => {
      const invokeCalls: Array<{ cmd: string; args: any }> = [];
      vi.mocked(invoke).mockImplementation(async (cmd: string, args: any) => {
        invokeCalls.push({ cmd, args });
        return null;
      });

      const queue: Track[] = [
        { id: 1, path: 'C:/music/local1.mp3', title: 'Local 1', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 },
        { id: 2, path: 'https://stream.com/online.mp3', title: 'Online', artist: 'Artist', format: 'URL', duration: 180, lyric_offset: 0 },
        { id: 3, path: 'C:/music/local2.mp3', title: 'Local 2', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 },
      ];
      useStore.setState({ queue });

      await useStore.getState().syncBackendQueue();

      expect(invokeCalls).toEqual([
        { cmd: 'clear_queue', args: undefined },
        { cmd: 'add_to_queue_bulk', args: { paths: ['C:/music/local1.mp3'] } },
      ]);
    });
  });

  it('shows fresh recommendations instead of retaining an old queue after a direct local selection', async () => {
    const old: Track = { id: 1, path: 'C:/music/old.mp3', title: 'Old', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
    const selected: Track = { id: 2, path: 'C:/music/selected.mp3', title: 'Selected', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
    const recommended: Track = { id: 3, path: 'C:/music/new.mp3', title: 'New', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0, is_autoplay: true };
    vi.mocked(invoke).mockImplementation(async cmd => cmd === 'get_similar_tracks' ? [recommended] : null);
    useStore.setState({ queue: [old], tracks: [selected, recommended], recordPlaybackTransition: vi.fn().mockResolvedValue(undefined) });

    await useStore.getState().playTrack(selected);
    await vi.waitFor(() => expect(useStore.getState().queue.map(t => t.path)).toEqual([recommended.path]));
    expect(JSON.parse(localStorage.getItem('aideo_queue')!).map((t: Track) => t.path)).toEqual([recommended.path]);
    await vi.waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'add_to_queue_bulk').slice(-1)[0]?.[1]).toEqual({ paths: [recommended.path] }));
  });


  it('restores native queue ownership when a direct local selection replaces an online queue', async () => {
    const stream: Track = { id: 1, path: 'tidal-song', title: 'Stream', artist: 'Artist', format: 'Tidal FLAC', duration: 180, lyric_offset: 0, source_context: { recording_id: 'old', sources: [{ provider: 'tidal', id: 'tidal-song' }], selection: { mode: 'auto' } } };
    const local: Track = { id: 2, path: 'C:/music/local.mp3', title: 'Local', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
    const radio: Track = { id: 3, path: 'C:/music/radio.mp3', title: 'Radio', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
    vi.mocked(invoke).mockImplementation(async cmd => cmd === 'get_similar_tracks' ? [radio] : null);
    useStore.setState({ sourceQueueManaged: true, queue: [stream], tracks: [local, radio], recordPlaybackTransition: vi.fn().mockResolvedValue(undefined) });

    await useStore.getState().playTrack(local);
    await vi.waitFor(() => expect(useStore.getState().queue.map(t => t.path)).toEqual([radio.path]));
    expect(useStore.getState().sourceQueueManaged).toBe(false);
    await vi.waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([cmd, args]) => cmd === 'add_to_queue_bulk' && (args as { paths: string[] }).paths[0] === radio.path)).toBe(true));
  });

  it('refills an empty queue before advancing to the next library song', async () => {
    vi.useFakeTimers();
    try {
      const current: Track = { id: 1, path: 'C:/music/current.mp3', title: 'Current', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
      const next: Track = { ...current, id: 2, path: 'C:/music/library-next.mp3', title: 'Library Next' };
      const radio: Track = { ...current, id: 3, path: 'C:/music/radio.mp3', title: 'Radio', is_autoplay: true };
      vi.mocked(invoke).mockImplementation(async cmd => cmd === 'get_similar_tracks' ? [radio] : null);
      useStore.setState({ currentTrack: current, tracks: [current, next, radio], queue: [], repeat: 'none', recordPlaybackTransition: vi.fn().mockResolvedValue(undefined) });

      await useStore.getState().playNext();
      expect(useStore.getState().currentTrack?.path).toBe(radio.path);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('does not hand off to an invisible library successor while radio queue is empty', async () => {
    const current: Track = { id: 1, path: 'C:/music/current.mp3', title: 'Current', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
    const next: Track = { ...current, id: 2, path: 'C:/music/next.mp3', title: 'Next' };
    vi.mocked(invoke).mockResolvedValue(null);
    useStore.setState({ tracks: [current, next], queue: [], autoplayEnabled: true, repeat: 'none', recordPlaybackTransition: vi.fn().mockResolvedValue(undefined) });

    await useStore.getState().playTrack(current);
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'add_to_queue' || cmd === 'add_to_queue_bulk')).toEqual([]);
  });

  it('stops rather than playing an unlisted library song when radio has no candidates', async () => {
    vi.useFakeTimers();
    try {
      const current: Track = { id: 1, path: 'C:/music/current.mp3', title: 'Current', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
      const next: Track = { ...current, id: 2, path: 'C:/music/next.mp3', title: 'Next' };
      vi.mocked(invoke).mockResolvedValue(null);
      useStore.setState({ currentTrack: current, tracks: [current, next], queue: [], repeat: 'none', autoplayEnabled: true });
      await useStore.getState().playNext();
      expect(useStore.getState().playback.status).toBe('Stopped');
      expect(vi.mocked(invoke).mock.calls.some(([cmd, args]) => cmd === 'play_track' && (args as { path?: string })?.path === next.path)).toBe(false);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('does not hand off to an autoplay recommendation while repeat-one is active', async () => {
    const current: Track = { id: 1, path: 'C:/music/current.mp3', title: 'Current', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
    const recommendation: Track = { id: 2, path: 'C:/music/radio.mp3', title: 'Radio', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0, is_autoplay: true };
    const commands: string[] = [];
    vi.mocked(invoke).mockImplementation(async cmd => { commands.push(cmd); return null; });
    useStore.setState({ currentTrack: current, repeat: 'one', queue: [recommendation] });

    await useStore.getState().syncBackendQueue();

    expect(commands).toEqual(['clear_queue']);
    expect(useStore.getState().queue).toEqual([recommendation]);
  });

  it('uses the newest frontend queue after a pending backend operation completes', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const first: Track = { id: 1, path: 'C:/music/first.mp3', title: 'First', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
    const second: Track = { ...first, id: 2, path: 'C:/music/second.mp3', title: 'Second' };
    const bulkPaths: string[][] = [];
    let blocks = true;
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === 'clear_queue' && blocks) { blocks = false; await pending; }
      if (cmd === 'add_to_queue_bulk' && args && typeof args === 'object' && 'paths' in args && Array.isArray(args.paths)) bulkPaths.push(args.paths);
      return null;
    });
    useStore.setState({ queue: [first], repeat: 'none' });
    const firstSync = useStore.getState().syncBackendQueue();
    useStore.setState({ queue: [second] });
    const secondSync = useStore.getState().syncBackendQueue();
    release();
    await Promise.all([firstSync, secondSync]);
    expect(bulkPaths[bulkPaths.length - 1]).toEqual([second.path]);
  });

  it('does not rebuild a local backend queue after source management takes over', async () => {
    let release!: () => void;
    let clearStarted!: () => void;
    const started = new Promise<void>(resolve => { clearStarted = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const track: Track = { id: 1, path: 'C:/music/local.mp3', title: 'Local', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
    const commands: string[] = [];
    vi.mocked(invoke).mockImplementation(async cmd => {
      commands.push(cmd);
      if (cmd === 'clear_queue' && commands.length === 1) { clearStarted(); await pending; }
      return null;
    });
    useStore.setState({ sourceQueueManaged: false, queue: [track] });
    const first = useStore.getState().syncBackendQueue();
    await started;
    const second = useStore.getState().syncBackendQueue();
    useStore.setState({ sourceQueueManaged: true });
    release();
    await Promise.all([first, second]);
    expect(commands.filter(cmd => cmd === 'clear_queue')).toHaveLength(1);
    expect(commands).not.toContain('add_to_queue_bulk');
  });

  describe('handleNativeTrackTransition', () => {
    it('updates currentAttemptId and pops the matching track from the queue', async () => {
      const track1: Track = { id: 1, path: 'C:/music/song1.mp3', title: 'Song 1', artist: 'Artist 1', format: 'MP3', duration: 180, lyric_offset: 0 };
      const track2: Track = { id: 2, path: 'C:/music/song2.mp3', title: 'Song 2', artist: 'Artist 2', format: 'MP3', duration: 200, lyric_offset: 0 };

      useStore.setState({
        tracks: [track1, track2],
        currentTrack: track1,
        currentAttemptId: 'attempt_old',
        queue: [track2],
        playback: {
          ...useStore.getState().playback,
          status: 'Playing',
          current_track: track1.path,
          attempt_id: 'attempt_old',
        },
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'get_playback_queue') return [];
        return null;
      });

      await useStore.getState().handleNativeTrackTransition('C:/music/song2.mp3', 'attempt_native_handoff_456');

      const state = useStore.getState();
      expect(state.currentAttemptId).toBe('attempt_native_handoff_456');
      expect(state.playback.attempt_id).toBe('attempt_native_handoff_456');
      expect(state.playback.current_track).toBe('C:/music/song2.mp3');
      expect(state.currentTrack?.path).toBe('C:/music/song2.mp3');
      // track2 was at queue[0], so it must be popped
      expect(state.queue).toEqual([]);
    });
  });

  describe('Repeat-One vs Autoplay Queue Precedence', () => {
    it('loops current track in getNextTrackToPlay when repeat is one and queue only has autoplay tracks', () => {
      const currentTrack: Track = { id: 1, path: 'C:/music/song1.mp3', title: 'Song 1', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
      const autoplayTrack: Track = { id: -1, path: 'C:/music/rec1.mp3', title: 'Rec 1', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0, is_autoplay: true };

      useStore.setState({
        currentTrack,
        repeat: 'one',
        queue: [autoplayTrack],
      });

      const nextTrack = useStore.getState().getNextTrackToPlay();
      expect(nextTrack?.path).toBe(currentTrack.path);
    });

    it('prioritizes manual queue track over repeat-one in getNextTrackToPlay', () => {
      const currentTrack: Track = { id: 1, path: 'C:/music/song1.mp3', title: 'Song 1', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
      const manualTrack: Track = { id: 2, path: 'C:/music/manual.mp3', title: 'Manual', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0, is_autoplay: false };

      useStore.setState({
        currentTrack,
        repeat: 'one',
        queue: [manualTrack],
      });

      const nextTrack = useStore.getState().getNextTrackToPlay();
      expect(nextTrack?.path).toBe(manualTrack.path);
    });

    it('playNext replays current track when repeat is one and queue contains only autoplay tracks', async () => {
      const currentTrack: Track = { id: 1, path: 'C:/music/song1.mp3', title: 'Song 1', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0 };
      const autoplayTrack: Track = { id: -1, path: 'C:/music/rec1.mp3', title: 'Rec 1', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0, is_autoplay: true };

      const playTrackSpy = vi.fn();
      useStore.setState({
        currentTrack,
        repeat: 'one',
        queue: [autoplayTrack],
        playTrack: playTrackSpy,
      });

      await useStore.getState().playNext();

      expect(playTrackSpy).toHaveBeenCalledWith(currentTrack, true, false);
    });
  });

  describe('toggleAutoplay', () => {
    it('removes autoplay tracks from queue and syncs backend when disabled', async () => {
      const manualTrack: Track = { id: 1, path: 'C:/music/manual.mp3', title: 'Manual', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0, is_autoplay: false };
      const autoplayTrack: Track = { id: -1, path: 'C:/music/rec1.mp3', title: 'Rec 1', artist: 'Artist', format: 'MP3', duration: 180, lyric_offset: 0, is_autoplay: true };

      const invokeCalls: Array<{ cmd: string; args: any }> = [];
      vi.mocked(invoke).mockImplementation(async (cmd: string, args: any) => {
        invokeCalls.push({ cmd, args });
        return null;
      });

      useStore.setState({
        autoplayEnabled: true,
        queue: [manualTrack, autoplayTrack],
      });

      await useStore.getState().toggleAutoplay();

      const state = useStore.getState();
      expect(state.autoplayEnabled).toBe(false);
      expect(state.queue).toEqual([manualTrack]);
      expect(invokeCalls).toEqual([
        { cmd: 'clear_queue', args: undefined },
        { cmd: 'add_to_queue_bulk', args: { paths: ['C:/music/manual.mp3'] } },
      ]);
    });
  });

  describe('fetchQueue SSOT preservation', () => {
    it('preserves existing frontend queue containing online tracks', async () => {
      const onlineTrack: Track = { id: 1, path: 'https://stream.url/audio.mp3', title: 'Stream', artist: 'Online', format: 'URL', duration: 180, lyric_offset: 0 };
      useStore.setState({ queue: [onlineTrack] });

      // Backend returns empty or local tracks
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'get_playback_queue') return ['C:/music/different.mp3'];
        return null;
      });

      await useStore.getState().fetchQueue();

      // Frontend queue must NOT be wiped or overridden
      expect(useStore.getState().queue).toEqual([onlineTrack]);
    });
  });
});
