import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../store';
import { notifyQobuzAuthFailure } from '../store/qobuzSlice';

const tauriListeners: Record<string, Array<(event: { payload: any }) => void>> = {};

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
    qobuzExperimentalEnabled: true,
    qobuzConnected: false,
    qobuzSearching: false,
    qobuzSearchResults: [],
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

describe('Qobuz Store Slice', () => {
  describe('checkQobuzStatus', () => {
    it('should set qobuzConnected=true when backend reports an existing session', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'qobuz_status') return true;
        return null;
      });

      await useStore.getState().checkQobuzStatus();

      expect(invoke).toHaveBeenCalledWith('qobuz_status');
      expect(useStore.getState().qobuzConnected).toBe(true);
    });

    it('should remain disconnected when backend reports no session', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'qobuz_status') return false;
        return null;
      });

      await useStore.getState().checkQobuzStatus();

      expect(useStore.getState().qobuzConnected).toBe(false);
    });

    it('should tolerate backend errors without throwing', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('backend down'));

      await expect(useStore.getState().checkQobuzStatus()).resolves.not.toThrow();
      expect(useStore.getState().qobuzConnected).toBe(false);
    });
  });

  describe('searchQobuz', () => {
    it('should map QobuzTrackResult objects into Qobuz FLAC library tracks with a distinct negative id range', async () => {
      const mockResults = [
        { id: '138614268', title: 'Aerials', artist: 'System Of A Down', album: 'Toxicity', duration: 212, cover_url: 'https://static.qobuz.com/x_large.jpg', quality: 'LOSSLESS' },
        { id: '138614269', title: 'Aerials Live', artist: 'System Of A Down', album: 'Live', duration: 240, cover_url: '', quality: 'HI_RES_192' }
      ];
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'qobuz_search') return mockResults;
        return null;
      });

      await useStore.getState().searchQobuz('aerials');

      expect(invoke).toHaveBeenCalledWith('qobuz_search', { query: 'aerials' });
      const results = useStore.getState().qobuzSearchResults;
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        path: '138614268',
        title: 'Aerials',
        artist: 'System Of A Down',
        album: 'Toxicity',
        duration: 212,
        format: 'Qobuz FLAC'
      });
      // Qobuz ids must never collide with Tidal search ids (-30000 range) or radio ids (-20000 range)
      expect(results[0].id).toBe(-60000 - 138614268);
      expect(results[1].path).toBe('138614269');
      expect(useStore.getState().qobuzSearching).toBe(false);
    });

    it('should tolerate null/undefined backend responses', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'qobuz_search') return null;
        return null;
      });

      await expect(useStore.getState().searchQobuz('anything')).resolves.not.toThrow();
      expect(useStore.getState().qobuzSearchResults).toEqual([]);
      expect(useStore.getState().qobuzSearching).toBe(false);
    });
  });

  describe('playQobuzResult', () => {
    it('should play the mapped Qobuz track through playTrack', async () => {
      const playTrackSpy = vi.fn().mockResolvedValue(undefined);
      useStore.setState({ playTrack: playTrackSpy } as any);

      const resultTrack = {
        path: '138614268',
        title: 'Aerials',
        artist: 'System Of A Down',
        album: 'Toxicity',
        duration: 212,
        cover_url: 'https://static.qobuz.com/x_large.jpg',
        format: 'Qobuz FLAC'
      };

      await useStore.getState().playQobuzResult(resultTrack as any);

      expect(playTrackSpy).toHaveBeenCalledTimes(1);
      const playedArg = playTrackSpy.mock.calls[0][0];
      expect(playedArg.format).toBe('Qobuz FLAC');
      expect(playedArg.path).toBe('138614268');
    });
  });

  describe('downloadQobuzTrack', () => {
    it('should invoke qobuz_download with sanitized filename and track metadata', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'qobuz_download') return true;
        return null;
      });

      const track = {
        path: '138614268',
        title: 'Aerials!',
        artist: 'System Of A Down',
        album: 'Toxicity',
        duration: 212,
        format: 'Qobuz FLAC'
      } as any;

      await useStore.getState().downloadQobuzTrack(track);

      expect(invoke).toHaveBeenCalledWith('qobuz_download', {
        trackId: '138614268',
        filename: expect.stringContaining('System Of A Down - Aerials'),
        title: 'Aerials!',
        artist: 'System Of A Down',
        album: 'Toxicity',
        duration: 212
      });
    });

    it('should fire an error toast when download kickoff fails', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'qobuz_download') throw new Error('User is not authenticated with Qobuz');
        return null;
      });

      const events = spyOnWindowEvents('ui-toast');

      await expect(
        useStore.getState().downloadQobuzTrack({
          path: '42', title: 'X', artist: 'Y', album: 'Z', duration: 100, format: 'Qobuz FLAC'
        } as any)
      ).rejects.not.toBeNull();

      const toast = events.find(e => String(e.detail?.message || '').includes('Qobuz'));
      expect(toast).toBeTruthy();
    });
  });
});

describe('notifyQobuzAuthFailure', () => {
  it('should fire nudge toast and navigation event on auth failure', () => {
    const events = spyOnWindowEvents('ui-toast', 'ui-goto-settings-tab');

    const handled = notifyQobuzAuthFailure('User is not authenticated with Qobuz');

    expect(handled).toBe(true);
    const toast = events.find(e => e.type === 'ui-toast' && String(e.detail?.message || '').includes('Qobuz'));
    expect(toast).toBeTruthy();
    const nav = events.find(e => e.type === 'ui-goto-settings-tab');
    expect(nav?.detail?.tab).toBe('library');
  });

  it('should ignore unrelated errors', () => {
    const events = spyOnWindowEvents('ui-toast', 'ui-goto-settings-tab');

    const handled = notifyQobuzAuthFailure('Network timeout while streaming');

    expect(handled).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe('QobuzConnectCard', () => {
  it('should show Log In button and Advanced toggle when no session exists', async () => {
    const { default: QobuzConnectCard } = await import('../components/QobuzConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'qobuz_status') return false;
      return null;
    });

    render(<QobuzConnectCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /log in to qobuz/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(screen.getByText(/advanced: enter token manually/i)).toBeInTheDocument();
  });

  it('should invoke openQobuzLoginWindow when clicking Log In to Qobuz', async () => {
    const { default: QobuzConnectCard } = await import('../components/QobuzConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'qobuz_status') return false;
      if (cmd === 'qobuz_open_login_window') return undefined;
      return null;
    });

    render(<QobuzConnectCard />);
    const loginBtn = await screen.findByRole('button', { name: /log in to qobuz/i });
    fireEvent.click(loginBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('qobuz_open_login_window');
    });
  });

  it('should show connected state with disconnect when session exists', async () => {
    const { default: QobuzConnectCard } = await import('../components/QobuzConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'qobuz_status') return true;
      return null;
    });

    render(<QobuzConnectCard />);

    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('should submit pasted token in advanced section and flip to connected', async () => {
    const { default: QobuzConnectCard } = await import('../components/QobuzConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'qobuz_status') return false;
      if (cmd === 'qobuz_connect') {
        expect(args.token).toBe('test-token-123');
        return { displayName: 'Test User' };
      }
      return null;
    });

    render(<QobuzConnectCard />);

    // Expand the advanced section
    const toggleBtn = await screen.findByText(/advanced: enter token manually/i);
    fireEvent.click(toggleBtn);

    const input = await screen.findByPlaceholderText(/paste x-user-auth-token/i);
    fireEvent.change(input, { target: { value: 'test-token-123' } });
    fireEvent.click(screen.getByRole('button', { name: /connect with token/i }));

    await waitFor(() => {
      expect(useStore.getState().qobuzConnected).toBe(true);
    });
    expect(await screen.findByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('should surface an error toast when manual token connection fails', async () => {
    const { default: QobuzConnectCard } = await import('../components/QobuzConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'qobuz_status') return false;
      if (cmd === 'qobuz_connect') throw new Error('Qobuz rejected your session token.');
      return null;
    });

    render(<QobuzConnectCard />);
    const events = spyOnWindowEvents('ui-toast');

    // Expand the advanced section
    const toggleBtn = await screen.findByText(/advanced: enter token manually/i);
    fireEvent.click(toggleBtn);

    const input = await screen.findByPlaceholderText(/paste x-user-auth-token/i);
    fireEvent.change(input, { target: { value: 'bad-token' } });
    fireEvent.click(screen.getByRole('button', { name: /connect with token/i }));

    await waitFor(() => {
      const toast = events.find(e => e.type === 'ui-toast' && String(e.detail?.message || '').includes('failed'));
      expect(toast).toBeTruthy();
    });
    expect(useStore.getState().qobuzConnected).toBe(false);
  });

  it('should invoke qobuz_logout on Disconnect', async () => {
    const { default: QobuzConnectCard } = await import('../components/QobuzConnectCard');
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'qobuz_status') return true;
      if (cmd === 'qobuz_logout') return true;
      return null;
    });

    render(<QobuzConnectCard />);
    fireEvent.click(await screen.findByRole('button', { name: /disconnect/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('qobuz_logout');
      expect(screen.getByRole('button', { name: /log in to qobuz/i })).toBeInTheDocument();
    });
  });
});
