import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useStore } from '../store';
import type { Track } from '../store/types';
import { notifyTidalAuthFailure } from '../store/tidalSlice';
import { trackIdToStreamUrl, rememberResolvedPath } from '../utils';

const tauriListeners: Record<string, Array<(event: { payload: any }) => void>> = {};

function emitTauriEvent(name: string, payload: any) {
  (tauriListeners[name] || []).forEach(fn => fn({ payload }));
}

function spyOnWindowEvents(...names: string[]) {
  const fired: CustomEvent[] = [];
  const orig = window.dispatchEvent.bind(window);
  vi.spyOn(window, 'dispatchEvent').mockImplementation((ev: Event) => {
    if (names.includes(ev.type)) fired.push(ev as CustomEvent);
    return orig(ev);
  });
  return fired;
}

vi.mocked(listen).mockImplementation(async (event: any, handler: any) => {
  if (!tauriListeners[event]) tauriListeners[event] = [];
  tauriListeners[event].push(handler);
  return () => {
    tauriListeners[event] = tauriListeners[event].filter(f => f !== handler);
  };
});

const initialPlayTrack = useStore.getState().playTrack;

beforeEach(() => {
  vi.clearAllMocks();
  trackIdToStreamUrl.clear();
  vi.mocked(listen).mockImplementation(async (event: any, handler: any) => {
    if (!tauriListeners[event]) tauriListeners[event] = [];
    tauriListeners[event].push(handler);
    return () => {
      tauriListeners[event] = tauriListeners[event].filter(f => f !== handler);
    };
  });
  for (const k of Object.keys(tauriListeners)) delete tauriListeners[k];
  useStore.setState({
    playTrack: initialPlayTrack,
    tidalConnected: false,
    tidalSearching: false,
    tidalSearchResults: [],
    pendingSettingsTab: null,
    tracks: [],
    queue: [],
    currentTrack: null,
    autoplayEnabled: false
  } as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Tidal Store Slice', () => {
  describe('checkTidalStatus', () => {
    it('should set tidalConnected=true when backend reports an existing session', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_login_poll_status') return true;
        return null;
      });

      await useStore.getState().checkTidalStatus();

      expect(invoke).toHaveBeenCalledWith('tidal_login_poll_status');
      expect(useStore.getState().tidalConnected).toBe(true);
    });

    it('should remain disconnected when backend reports no session', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_login_poll_status') return false;
        return null;
      });

      await useStore.getState().checkTidalStatus();

      expect(useStore.getState().tidalConnected).toBe(false);
    });

    it('should tolerate backend errors without throwing', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('backend down'));

      await expect(useStore.getState().checkTidalStatus()).resolves.not.toThrow();
      expect(useStore.getState().tidalConnected).toBe(false);
    });
  });

  describe('searchTidal', () => {
    it('should map TidalTrackResult objects into Tidal FLAC library tracks', async () => {
      const mockResults = [
        { id: '9988776', title: 'Aerials', artist: 'System Of A Down', album: 'Toxicity', duration: 211, cover_url: 'https://cover.tidal.com/x.jpg', quality: 'LOSSLESS' },
        { id: '5544332', title: 'Chop Suey!', artist: 'System Of A Down', album: 'Toxicity', duration: 210, cover_url: '', quality: 'HI_RES' }
      ];
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_search') return mockResults;
        return null;
      });

      await useStore.getState().searchTidal('system of a down');

      expect(invoke).toHaveBeenCalledWith('tidal_search', { query: 'system of a down' });
      const results = useStore.getState().tidalSearchResults;
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        path: '9988776',
        title: 'Aerials',
        artist: 'System Of A Down',
        album: 'Toxicity',
        duration: 211,
        format: 'Tidal FLAC'
      });
      expect(results[1].path).toBe('5544332');
      expect(useStore.getState().tidalSearching).toBe(false);
    });

    it('should tolerate null/undefined backend responses', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_search') return null;
        return null;
      });

      await expect(useStore.getState().searchTidal('anything')).resolves.not.toThrow();
      expect(useStore.getState().tidalSearchResults).toEqual([]);
      expect(useStore.getState().tidalSearching).toBe(false);
    });
  });

  describe('playTidalResult', () => {
    it('should play the mapped Tidal track through playTrack', async () => {
      const playTrackSpy = vi.fn().mockResolvedValue(undefined);
      useStore.setState({ playTrack: playTrackSpy } as any);

      const resultTrack = {
        path: '1234567',
        title: 'Aerials',
        artist: 'System Of A Down',
        album: 'Toxicity',
        duration: 211,
        cover_url: 'https://cover.tidal.com/x.jpg',
        format: 'Tidal FLAC'
      };

      await useStore.getState().playTidalResult(resultTrack as any);

      expect(playTrackSpy).toHaveBeenCalledTimes(1);
      const playedArg = playTrackSpy.mock.calls[0][0];
      expect(playedArg.format).toBe('Tidal FLAC');
      expect(playedArg.path).toBe('1234567');
    });
  });

  describe('downloadTidalTrack', () => {
    it('should invoke tidal_download with sanitized filename and track metadata', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_download') return true;
        return null;
      });

      const track = {
        path: '4242424',
        title: 'Toxicity!',
        artist: 'System Of A Down',
        album: 'Toxicity',
        duration: 210,
        format: 'Tidal FLAC'
      } as any;

      await useStore.getState().downloadTidalTrack(track);

      expect(invoke).toHaveBeenCalledWith('tidal_download', {
        trackId: '4242424',
        filename: expect.stringContaining('System Of A Down - Toxicity'),
        title: 'Toxicity!',
        artist: 'System Of A Down',
        album: 'Toxicity',
        duration: 210
      });
    });

    it('should fire an error toast when download kickoff fails', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_download') throw new Error('User is not authenticated with Tidal');
        return null;
      });

      const events = spyOnWindowEvents('ui-toast');

      await expect(
        useStore.getState().downloadTidalTrack({
          path: '42', title: 'X', artist: 'Y', album: 'Z', duration: 100, format: 'Tidal FLAC'
        } as any)
      ).rejects.not.toBeNull();

      const toast = events.find(e => String(e.detail?.message || '').includes('Tidal'));
      expect(toast).toBeTruthy();
    });
  });
});

describe('notifyTidalAuthFailure', () => {
  it('should fire nudge toast, navigation event and pending tab on auth failure', () => {
    const events = spyOnWindowEvents('ui-toast', 'ui-goto-settings-tab');

    const handled = notifyTidalAuthFailure('User is not authenticated with Tidal');

    expect(handled).toBe(true);
    const toast = events.find(e => e.type === 'ui-toast' && String(e.detail?.message || '').includes('Tidal'));
    expect(toast).toBeTruthy();
    const nav = events.find(e => e.type === 'ui-goto-settings-tab');
    expect(nav?.detail?.tab).toBe('library');
    expect(useStore.getState().pendingSettingsTab).toBe(null);
  });

  it('should ignore unrelated errors', () => {
    const events = spyOnWindowEvents('ui-toast', 'ui-goto-settings-tab');

    const handled = notifyTidalAuthFailure('Network timeout while streaming');

    expect(handled).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe('TidalConnectCard', () => {
  it('should show Connect button when no session exists', async () => {
    const { default: TidalConnectCard } = await import('../components/TidalConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'tidal_login_poll_status') return false;
      return null;
    });

    render(<TidalConnectCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /connect.*tidal/i })).toBeInTheDocument();
    });
  });

  it('should show connected state with disconnect when session exists', async () => {
    const { default: TidalConnectCard } = await import('../components/TidalConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'tidal_login_poll_status') return true;
      return null;
    });

    render(<TidalConnectCard />);

    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('should start device flow, open pairing link and display user code on Connect', async () => {
    const { default: TidalConnectCard } = await import('../components/TidalConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'tidal_login_poll_status') return false;
      if (cmd === 'tidal_login_start')
        return { userCode: 'ABCD-EFGH', verificationUriComplete: 'https://link.tidal.com/auth?code=xyz' };
      return null;
    });

    render(<TidalConnectCard />);

    fireEvent.click(await screen.findByRole('button', { name: /connect.*tidal/i }));

    await waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith('https://link.tidal.com/auth?code=xyz');
    });
    expect(await screen.findByText(/ABCD-EFGH/)).toBeInTheDocument();
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });

  it('should transition to connected when tidal-login-success arrives', async () => {
    const { default: TidalConnectCard } = await import('../components/TidalConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'tidal_login_poll_status') return false;
      if (cmd === 'tidal_login_start')
        return { userCode: 'ZZZZ-YYYY', verificationUriComplete: 'https://link.tidal.com/auth?code=1' };
      return null;
    });

    render(<TidalConnectCard />);
    fireEvent.click(await screen.findByRole('button', { name: /connect.*tidal/i }));
    await screen.findByText(/waiting/i);

    emitTauriEvent('tidal-login-success', null);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    });
  });

  it('should reset to connect state when pairing expires', async () => {
    const { default: TidalConnectCard } = await import('../components/TidalConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'tidal_login_poll_status') return false;
      if (cmd === 'tidal_login_start')
        return { userCode: 'EXPI-CODE', verificationUriComplete: 'https://link.tidal.com/auth?code=2' };
      return null;
    });

    render(<TidalConnectCard />);
    fireEvent.click(await screen.findByRole('button', { name: /connect.*tidal/i }));
    await screen.findByText(/waiting/i);

    emitTauriEvent('tidal-login-expired', null);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /connect.*tidal/i })).toBeInTheDocument();
    });
  });

  it('should invoke tidal_logout on Disconnect', async () => {
    const { default: TidalConnectCard } = await import('../components/TidalConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'tidal_login_poll_status') return true;
      if (cmd === 'tidal_logout') return true;
      return null;
    });

    render(<TidalConnectCard />);
    fireEvent.click(await screen.findByRole('button', { name: /disconnect/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('tidal_logout');
      expect(screen.getByRole('button', { name: /connect.*tidal/i })).toBeInTheDocument();
    });
  });

  describe('Tidal Playback Resolution Guards', () => {
    const tidalTrack = {
      id: -30001,
      path: '455738980',
      title: 'Tidal Test Song',
      artist: 'Tidal Artist',
      album: 'Tidal Album',
      duration: 210,
      format: 'Tidal FLAC' as const,
      lyric_offset: 0,
      cover_url: null,
    };

    it('should abort playback and never call play_track with raw ID when stream resolution fails', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string, args: any) => {
        if (cmd === 'tidal_get_stream_url') {
          throw new Error('User is not authenticated with Tidal');
        }
        if (cmd === 'play_track') {
          throw new Error(`play_track should not be called with ${args?.path}`);
        }
        return null;
      });

      await useStore.getState().playTrack(tidalTrack);

      const state = useStore.getState();
      expect(state.playback.status).toBe('Stopped');
      expect(state.playback.current_track).toBeNull();
      expect(invoke).not.toHaveBeenCalledWith('play_track', expect.anything());
    });

    it('should resolve stream URL and pass resolved CDN URL to play_track on success', async () => {
      const cdnUrl = 'https://sp-play.tidal.com/stream/455738980.flac?token=mock';
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_get_stream_url') return cdnUrl;
        if (cmd === 'play_track') return null;
        if (cmd === 'check_url_is_cached') return false;
        return null;
      });

      await useStore.getState().playTrack(tidalTrack);

      expect(invoke).toHaveBeenCalledWith('play_track', { path: cdnUrl, startPos: 0 });
    });

    it('should reject addToQueue when stream resolution fails', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_get_stream_url') {
          throw new Error('User is not authenticated with Tidal');
        }
        return null;
      });

      await useStore.getState().addToQueue(tidalTrack);

      expect(invoke).not.toHaveBeenCalledWith('add_to_queue', expect.anything());
      expect(useStore.getState().queue).toEqual([]);
    });

    it('should not push raw Tidal track ID to backend queue when playing from library/album', async () => {
      const cdnUrl = 'https://sp-play.tidal.com/stream/455738980.flac?token=mock';
      const track2 = { ...tidalTrack, id: -30002, path: '455738981', title: 'Next Song' };

      useStore.setState({
        tracks: [tidalTrack, track2],
        currentTrackIndex: 0,
        queue: [],
        repeat: 'all',
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_get_stream_url') return cdnUrl;
        if (cmd === 'play_track') return null;
        if (cmd === 'check_url_is_cached') return false;
        return null;
      });

      await useStore.getState().playTrack(tidalTrack);

      // Verify that add_to_queue was never called with raw track ID '455738981'
      expect(invoke).not.toHaveBeenCalledWith('add_to_queue', { path: '455738981' });
      expect(invoke).not.toHaveBeenCalledWith('add_to_queue', expect.anything());
    });

    it('should request a fresh stream URL if pre-resolved cached URL is older than 30s', async () => {
      const staleUrl = 'https://sp-play.tidal.com/stream/old.flac?token=expired';
      const freshUrl = 'https://sp-play.tidal.com/stream/fresh.flac?token=new';

      // Seed cache with a 2-minute-old URL (older than 30s)
      trackIdToStreamUrl.set(tidalTrack.path, { url: staleUrl, resolvedAt: Date.now() - 120_000 });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_get_stream_url') return freshUrl;
        if (cmd === 'play_track') return null;
        if (cmd === 'check_url_is_cached') return false;
        return null;
      });

      await useStore.getState().playTrack(tidalTrack);

      // Verify tidal_get_stream_url was called and play_track received freshUrl
      expect(invoke).toHaveBeenCalledWith('tidal_get_stream_url', { trackId: tidalTrack.path });
      expect(invoke).toHaveBeenCalledWith('play_track', { path: freshUrl, startPos: 0 });
    });

    it('triggerAutoplayRadio should not push stream URLs to backend queue in bulk', async () => {
      const recTracks = [
        { id: '1001', title: 'Rec 1', artist: 'Artist 1', duration: 180, cover_url: null },
        { id: '1002', title: 'Rec 2', artist: 'Artist 2', duration: 200, cover_url: null },
      ];

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'get_tidal_autoplay_recommendations') return recTracks;
        if (cmd === 'clear_queue') return null;
        if (cmd === 'add_to_queue_bulk') return null;
        return null;
      });

      useStore.setState({ autoplayEnabled: true, queue: [] });

      await useStore.getState().triggerAutoplayRadio(tidalTrack, true);

      // Queue state should contain the recommended tracks with provider IDs
      const queue = useStore.getState().queue;
      expect(queue.length).toBe(2);
      expect(queue[0].path).toBe('1001');
      expect(queue[0].format).toBe('Tidal FLAC');

      // Backend bulk add should not be called with stream URLs
      expect(invoke).not.toHaveBeenCalledWith('add_to_queue_bulk', expect.anything());
    });

    it('playTrack should recover track ID from resolvedPathMap if track.path is an HTTP URL', async () => {
      const oldCdnUrl = 'https://sp-play.tidal.com/stream/expired.flac?token=old';
      const freshCdnUrl = 'https://sp-play.tidal.com/stream/fresh.flac?token=new';

      rememberResolvedPath(oldCdnUrl, tidalTrack.path);

      const trackWithUrlPath: Track = {
        ...tidalTrack,
        path: oldCdnUrl,
      };

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_get_stream_url') return freshCdnUrl;
        if (cmd === 'play_track') return null;
        if (cmd === 'check_url_is_cached') return false;
        return null;
      });

      await useStore.getState().playTrack(trackWithUrlPath);

      // Should have recovered original track ID and fetched fresh URL
      expect(invoke).toHaveBeenCalledWith('tidal_get_stream_url', { trackId: tidalTrack.path });
      expect(invoke).toHaveBeenCalledWith('play_track', { path: freshCdnUrl, startPos: 0 });
    });

    it('fetchQueue should preserve upcoming stream tracks when backend queue is empty', async () => {
      useStore.setState({
        queue: [tidalTrack],
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'get_queue') return []; // Backend queue is empty
        return null;
      });

      await useStore.getState().fetchQueue();

      // Frontend queue should NOT have been wiped
      expect(useStore.getState().queue.length).toBe(1);
      expect(useStore.getState().queue[0].path).toBe(tidalTrack.path);
    });

    it('playNext should advance to queued Tidal track and resolve its stream URL', async () => {
      const nextTidalTrack: Track = {
        id: -20002,
        path: '99887766',
        title: 'Next Tidal Track',
        artist: 'Next Artist',
        duration: 210,
        format: 'Tidal FLAC',
        lyric_offset: 0,
      };

      const resolvedStreamUrl = 'https://sp-play.tidal.com/stream/next_track.flac?token=valid';

      useStore.setState({
        queue: [nextTidalTrack],
        currentTrack: tidalTrack,
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'tidal_get_stream_url') return resolvedStreamUrl;
        if (cmd === 'play_track') return null;
        if (cmd === 'remove_from_queue') return null;
        if (cmd === 'check_url_is_cached') return false;
        return null;
      });

      await useStore.getState().playNext();

      // Should have resolved the stream URL for the queued track
      expect(invoke).toHaveBeenCalledWith('tidal_get_stream_url', { trackId: nextTidalTrack.path });
      expect(invoke).toHaveBeenCalledWith('play_track', { path: resolvedStreamUrl, startPos: 0 });

      // Queue should have popped the played track
      expect(useStore.getState().queue.length).toBe(0);
      expect(useStore.getState().currentTrack?.title).toBe('Next Tidal Track');
    });

    it('pollStatus should trigger fallback playNext if backend stays Stopped while queue has tracks', async () => {
      const queuedTrack: Track = {
        id: -20003,
        path: '33445566',
        title: 'Queued Track',
        artist: 'Queued Artist',
        duration: 190,
        format: 'Tidal FLAC',
        lyric_offset: 0,
      };

      await new Promise(r => setTimeout(r, 400));
      const resolvedUrl = 'https://sp-play.tidal.com/stream/fallback_track.flac?token=valid';

      useStore.setState({
        queue: [queuedTrack],
        currentTrack: tidalTrack,
        playback: {
          ...useStore.getState().playback,
          status: 'Playing',
          current_track: 'https://lgf.audio.tidal.com/prev.flac',
          backend_stop_detected_at: Date.now() - 4000, // 4 seconds ago (> 3000ms threshold)
          last_skip_time: Date.now() - 5000,
        },
      });

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'get_playback_status') {
          return {
            status: 'Stopped',
            current_track: null,
            position_secs: 0,
            volume: 1.0,
          };
        }
        if (cmd === 'tidal_get_stream_url') return resolvedUrl;
        if (cmd === 'play_track') return null;
        if (cmd === 'remove_from_queue') return null;
        if (cmd === 'check_url_is_cached') return false;
        return null;
      });

      await useStore.getState().pollStatus();

      // Poll status should have triggered fallback playNext
      expect(invoke).toHaveBeenCalledWith('tidal_get_stream_url', { trackId: queuedTrack.path });
      expect(invoke).toHaveBeenCalledWith('play_track', { path: resolvedUrl, startPos: 0 });
    });
  });
});


