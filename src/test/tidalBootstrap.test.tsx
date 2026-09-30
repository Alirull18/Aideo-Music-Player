import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import App from '../App';
import { useStore } from '../store';
import type { Track } from '../store/types';

// jsdom does not implement matchMedia; App reads prefers-color-scheme on mount
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// jsdom lacks ResizeObserver (used by library view virtualization)
if (!(window as any).ResizeObserver) {
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ tidalConnected: false } as any);
});

afterEach(() => {
  cleanup();
});

describe('Tidal session restoration on app boot', () => {
  function mockBackend(tidalLoggedIn: boolean) {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'tidal_login_poll_status') return tidalLoggedIn;
      if (cmd === 'check_update') return { available: false };
      if (/playlists|devices|queue|tracks|history|recap|library/i.test(cmd)) return [];
      return null;
    });
  }

  it('restores tidalConnected=true on startup without visiting Settings', async () => {
    mockBackend(true);

    render(<App />);

    await waitFor(() => {
      expect(useStore.getState().tidalConnected).toBe(true);
    });
    expect(invoke).toHaveBeenCalledWith('tidal_login_poll_status');
  });

  it('stays disconnected and does not crash when no session exists', async () => {
    mockBackend(false);

    render(<App />);

    // Give the bootstrap effect a tick to settle
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('tidal_login_poll_status');
    });
    expect(useStore.getState().tidalConnected).toBe(false);
  });
});

describe('Playback lifecycle attempt correlation', () => {
  const track: Track = { id: 1, path: 'C:/same.flac', title: 'Same', artist: 'Artist', album: '', duration: 180, format: 'FLAC', lyric_offset: 0 };
  const handlers = new Map<string, (event: { payload: unknown }) => void>();

  beforeEach(async () => {
    handlers.clear();
    vi.mocked(invoke).mockImplementation(async cmd => /playlists|devices|queue|tracks|history|recap|library/i.test(cmd) ? [] : null);
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return () => { handlers.delete(event); };
    });
    render(<App />);
    await waitFor(() => expect(handlers.has('stream-buffering-end')).toBe(true));
  });

  function emit(name: string, payload: unknown) {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Missing ${name} listener`);
    handler({ payload });
  }

  it('ignores stale same-path ready, end, error and buffering events after replay', async () => {
    const playNext = vi.fn();
    useStore.setState({ playNext, currentTrack: track, currentAttemptId: 'new', playback: {
      ...useStore.getState().playback, current_track: track.path, attempt_id: 'new', status: 'Playing', is_buffering: true, last_stop_time: 0,
    } });
    emit('playback-ready', { path: track.path, attempt_id: 'old' });
    emit('track-ended', { path: track.path, attempt_id: 'old' });
    emit('playback-error', { path: track.path, attempt_id: 'old', error: 'old decoder' });
    emit('source-playback-error', { path: track.path, attempt_id: 'old', error: 'old decoder' });
    emit('stream-buffering-end', { path: track.path, attempt_id: 'old' });
    emit('stream-buffering-end', track.path);
    expect(useStore.getState().playback.is_buffering).toBe(true);
    expect(playNext).not.toHaveBeenCalled();
    emit('playback-ready', { path: track.path, attempt_id: 'new' });
    expect(useStore.getState().playback.is_buffering).toBe(false);
    emit('stream-buffering-start', { path: track.path, attempt_id: 'old' });
    expect(useStore.getState().playback.is_buffering).toBe(false);
    emit('stream-buffering-start', { path: track.path, attempt_id: 'new' });
    expect(useStore.getState().playback.is_buffering).toBe(true);
    emit('stream-buffering-end', { path: track.path, attempt_id: 'new' });
    expect(useStore.getState().playback.is_buffering).toBe(false);
    emit('track-ended', { path: track.path, attempt_id: 'new' });
    expect(playNext).toHaveBeenCalledTimes(1);
  });

  it('ignores a delayed native handoff after the user starts another attempt', () => {
    const handleNativeTrackTransition = vi.fn();
    useStore.setState({
      currentTrack: track,
      currentAttemptId: 'manual-new',
      handleNativeTrackTransition,
      playback: { ...useStore.getState().playback, current_track: track.path, attempt_id: 'manual-new', status: 'Playing' },
    });

    emit('track-transitioned', {
      previous_path: track.path,
      previous_attempt_id: 'old',
      path: 'C:/queued.flac',
      attempt_id: 'native-next',
    });

    expect(handleNativeTrackTransition).not.toHaveBeenCalled();
    expect(useStore.getState().currentAttemptId).toBe('manual-new');
  });

  it('advances a new attempt that ends shortly after a previous Stop', () => {
    const playNext = vi.fn();
    useStore.setState({
      playNext,
      currentTrack: track,
      currentAttemptId: 'after-stop',
      playback: {
        ...useStore.getState().playback,
        current_track: track.path,
        attempt_id: 'after-stop',
        status: 'Playing',
        last_stop_time: Date.now(),
      },
    });

    emit('track-ended', { path: track.path, attempt_id: 'after-stop' });

    expect(playNext).toHaveBeenCalledTimes(1);
  });

  it('ignores native events after the active attempt is invalidated', () => {
    const playNext = vi.fn();
    useStore.setState({ playNext, currentTrack: track, currentAttemptId: undefined, playback: {
      ...useStore.getState().playback, current_track: track.path, attempt_id: undefined, status: 'Stopped', is_buffering: true,
    } });
    emit('playback-ready', { path: track.path, attempt_id: 'old' });
    emit('stream-buffering-end', { path: track.path, attempt_id: 'old' });
    emit('track-ended', { path: track.path, attempt_id: 'old' });
    emit('playback-error', { path: track.path, attempt_id: 'old', error: 'old error' });
    expect(useStore.getState().playback.is_buffering).toBe(true);
    expect(playNext).not.toHaveBeenCalled();
  });

  it('accepts a resolved URL event for the current non-unified stream attempt', () => {
    const stream: Track = { ...track, path: '455738980', format: 'Tidal FLAC' };
    useStore.setState({ currentTrack: stream, currentAttemptId: 'stream-attempt', playback: {
      ...useStore.getState().playback, current_track: stream.path, attempt_id: 'stream-attempt', status: 'Playing', is_buffering: true,
    } });
    emit('playback-ready', { path: 'https://cdn.example/resolved.flac', attempt_id: 'stream-attempt' });
    expect(useStore.getState().playback.is_buffering).toBe(false);
  });

  it('accepts resolved URL readiness and reports terminal unified hardware errors', () => {
    const stopTrack = vi.fn();
    const unified: Track = { ...track, path: '455738980', source_context: { recording_id: 'recording', sources: [], selection: { mode: 'auto' } } };
    const url = 'https://cdn.example/stream.flac';
    useStore.setState({ stopTrack, currentTrack: unified, currentAttemptId: 'current', playbackError: null, playback: {
      ...useStore.getState().playback, current_track: url, attempt_id: 'current', status: 'Playing', is_buffering: true,
    } });
    emit('source-playback-error', { path: url, attempt_id: 'old', error: 'decoder' });
    emit('playback-ready', { path: url, attempt_id: 'current' });
    expect(useStore.getState().playback.is_buffering).toBe(false);
    expect(stopTrack).not.toHaveBeenCalled();
    emit('playback-error', { path: url, attempt_id: 'old', error: 'old device' });
    expect(stopTrack).not.toHaveBeenCalled();
    emit('playback-error', { path: url, attempt_id: 'current', error: 'No audio output device' });
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(useStore.getState().playbackError).toBe('No audio output device');
  });
});
