import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useStore } from '../store';
import { notifyTidalAuthFailure } from '../store/tidalSlice';

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listen).mockImplementation(async (event: any, handler: any) => {
    if (!tauriListeners[event]) tauriListeners[event] = [];
    tauriListeners[event].push(handler);
    return () => {
      tauriListeners[event] = tauriListeners[event].filter(f => f !== handler);
    };
  });
  for (const k of Object.keys(tauriListeners)) delete tauriListeners[k];
  useStore.setState({
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
});
