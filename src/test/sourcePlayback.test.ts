import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore, type Track } from '../store';
import { cancelSourcePlayback, handleSourceFailure } from '../store/sourcePlayback';
import { clearSourceCache, groupRecordings } from '../utils/unifiedSources';

const track: Track = {
  id: 1, path: '123', title: 'Song', artist: 'Artist', duration: 180, format: 'Tidal FLAC', lyric_offset: 0,
  source_context: { recording_id: 'recording', sources: [{ provider: 'tidal', id: '123' }, { provider: 'qobuz', id: '123' }], selection: { mode: 'explicit', source: { provider: 'tidal', id: '123' } } },
};
describe('Source playback fallback', () => {
  beforeEach(() => {
    cancelSourcePlayback(); clearSourceCache(); localStorage.clear();
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
    expect(invoke).toHaveBeenCalledWith('play_track', { path: 'https://qobuz.example/audio', startPos: 0 });
  });

  it('switches source at the current position without starting a new playback session', async () => {
    const lyrics = [{ time_secs: 0, text: 'Line' }];
    const history = [{ ...track, id: 2 }];
    useStore.setState({ currentTrack: track, playHistory: history, playCounts: { recording: 4 }, lyrics, lyricStatus: 'found', scrobbledCurrent: true });
    const qobuzTrack = { ...track, source_context: { ...track.source_context!, selection: { mode: 'explicit' as const, source: { provider: 'qobuz' as const, id: '123' } } } };

    await useStore.getState().playTrack(qobuzTrack, true, false, undefined, 83, true);

    expect(invoke).toHaveBeenCalledWith('play_track', { path: 'https://qobuz.example/audio', startPos: 83 });
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
