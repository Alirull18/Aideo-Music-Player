import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, screen, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import App from '../App';
import { useStore } from '../store';
import type { Track } from '../store/types';
import { clearRecentToasts } from '../components/Toast';

const realStopTrack = useStore.getState().stopTrack;

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
  clearRecentToasts();
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
  const handlers = new Map<string, Array<(event: { payload: unknown }) => void>>();

  beforeEach(async () => {
    handlers.clear();
    vi.mocked(invoke).mockImplementation(async cmd => /playlists|devices|queue|tracks|history|recap|library/i.test(cmd) ? [] : null);
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      const callback = handler as (event: { payload: unknown }) => void;
      handlers.set(event, [...(handlers.get(event) || []), callback]);
      return () => { handlers.set(event, (handlers.get(event) || []).filter(item => item !== callback)); };
    });
    render(<App />);
    await waitFor(() => expect(handlers.has('stream-buffering-end')).toBe(true));
  });

  function emit(name: string, payload: unknown) {
    const listeners = handlers.get(name);
    if (!listeners?.length) throw new Error(`Missing ${name} listener`);
    listeners.forEach(handler => handler({ payload }));
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
    expect(stopTrack).not.toHaveBeenCalled();
    expect(useStore.getState().playbackRecovery).toMatchObject({ track: unified, action: 'output' });
    expect(useStore.getState().playbackError).toBe('No audio output device');
  });

  it('shows one current-attempt recovery and none for a stale attempt', () => {
    const originalStopTrack = useStore.getState().stopTrack;
    const stopTrack = vi.fn();
    useStore.setState({ stopTrack, notificationsEnabled: true, developerNotifications: false, currentTrack: track, currentAttemptId: 'live', playbackError: null,
      playback: { ...useStore.getState().playback, current_track: track.path, attempt_id: 'live', status: 'Playing' } });
    try {
      act(() => emit('playback-error', { path: track.path, attempt_id: 'stale', error: 'Expired media URL' }));
      expect(screen.queryByText('Expired media URL')).toBeNull();
      act(() => emit('playback-error', { path: track.path, attempt_id: 'live', error: 'Media URL expired' }));
      expect(screen.getAllByText('Media URL expired')).toHaveLength(1);
      expect(stopTrack).not.toHaveBeenCalled();
      expect(useStore.getState().playbackRecovery?.track.path).toBe(track.path);
      expect(useStore.getState().playbackError).toBe('Media URL expired');
    } finally {
      useStore.setState({ stopTrack: originalStopTrack });
    }
  });

  it('shows asynchronous provider and scanner failures without JSON payloads', () => {
    useStore.setState({ notificationsEnabled: true, developerNotifications: false });
    act(() => {
      emit('tidal-download-error', { filename: 'Tidal song', track_id: '1', error: 'Session expired' });
      emit('qobuz-download-error', { filename: 'Qobuz song', track_id: '2', error: 'Download denied' });
      emit('scanner-error', 'Cannot open selected folder');
    });
    expect(screen.getByText('Tidal download failed (Tidal song): Session expired')).toBeInTheDocument();
    expect(screen.getByText('Qobuz download failed (Qobuz song): Download denied')).toBeInTheDocument();
    expect(screen.getByText('Cannot open selected folder')).toBeInTheDocument();
  });
  it('ignores stale buffering feedback and clears the live buffering card on completion', async () => {
    useStore.setState({ currentTrack: track, currentAttemptId: 'live', playback: {
      ...useStore.getState().playback, current_track: track.path, attempt_id: 'live', status: 'Playing', position_secs: 0, is_buffering: false,
    } });
    act(() => emit('stream-buffering-start', { path: track.path, attempt_id: 'stale' }));
    expect(screen.queryByText('Buffering audio stream...')).toBeNull();
    act(() => emit('stream-buffering-start', { path: track.path, attempt_id: 'live' }));
    await screen.findByText('Buffering audio stream...');
    act(() => emit('stream-buffering-end', { path: track.path, attempt_id: 'stale' }));
    expect(screen.getByText('Buffering audio stream...')).toBeInTheDocument();
    act(() => emit('stream-buffering-end', { path: track.path, attempt_id: 'live' }));
    await waitFor(() => expect(screen.queryByText('Buffering audio stream...')).toBeNull());
    expect(useStore.getState().playback.is_buffering).toBe(false);
  });
  it('user stop clears live buffering immediately even when the old native end is discarded', async () => {
    const previousStopTrack = useStore.getState().stopTrack;
    useStore.setState({ stopTrack: realStopTrack, chromecast_connected: false, upnp_connected: false, currentTrack: track, currentAttemptId: 'stopping', playback: {
      ...useStore.getState().playback, current_track: track.path, attempt_id: 'stopping', status: 'Playing', position_secs: 0, is_buffering: false,
    } });
    try {
      act(() => emit('stream-buffering-start', { path: track.path, attempt_id: 'stopping' }));
      await screen.findByText('Buffering audio stream...');
      await act(async () => { await useStore.getState().stopTrack(); });
      act(() => emit('stream-buffering-end', { path: track.path, attempt_id: 'stopping' }));
      await waitFor(() => expect(screen.queryByText('Buffering audio stream...')).toBeNull());
      expect(useStore.getState().currentAttemptId).toBeUndefined();
      expect(useStore.getState().playback.status).toBe('Stopped');
      expect(useStore.getState().playback.is_buffering).toBe(false);
    } finally {
      useStore.setState({ stopTrack: previousStopTrack });
    }
  });
});
