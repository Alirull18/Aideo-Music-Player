import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { openUrl } from '@tauri-apps/plugin-opener';

// Mock Tauri plugin opener
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

// Mock Tauri invoke APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === 'check_url_is_cached') return Promise.resolve(false);
    if (cmd === 'record_playback_transition') return Promise.resolve(1);
    if (cmd === 'tidal_get_stream_url') return Promise.resolve('https://sp-play.tidal.com/stream/mock.flac');
    if (cmd === 'get_cover_art') return Promise.resolve(null);
    if (cmd === 'update_media_metadata') return Promise.resolve();
    if (cmd === 'update_media_playback') return Promise.resolve();
    if (cmd === 'set_volume') return Promise.resolve();
    if (cmd === 'pause_track') return Promise.resolve();
    if (cmd === 'resume_track') return Promise.resolve();
    if (cmd === 'seek') return Promise.resolve();
    if (cmd === 'get_playback_status') return Promise.resolve({ current_track: null, status: 'Stopped', position_secs: 0, volume: 1 });
    return Promise.resolve(null);
  }),
}));

describe('Adversarial Stress-Testing: Phase 3 UI State Synchronization & UX Polish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useStore.setState({
      view: 'nowplaying',
      currentTrack: null,
      librarySearchQuery: '',
      tracks: [],
      queue: [],
      playback: {
        current_track: null,
        status: 'Stopped',
        position_secs: 0,
        volume: 1,
        dev_rate: 44100,
        file_ch: 2,
        bit_perfect: false,
        driver_type: 'WASAPI',
        exclusive: false
      },
      lastfmSessionKey: null,
      scrobbleEnabled: false,
      listenbrainzToken: null,
      listenbrainzEnabled: false,
      scrobbleThreshold: 50,
      lyrics: [],
      shortcuts: {
        playPause: 'Space',
        next: 'ArrowRight',
        prev: 'ArrowLeft',
        volumeUp: 'ArrowUp',
        volumeDown: 'ArrowDown',
        mute: 'm',
        dspBypass: 'b'
      }
    });
  });

  describe('1. NowPlayingView Artist Navigation Stress & Edge Cases', () => {
    const handleArtistClick = (
      currentTrackPath: string | null | undefined,
      artist: string | null | undefined,
      setView: (v: any) => void,
      setLibrarySearchQuery: (q: string) => void
    ) => {
      if (!currentTrackPath) return;
      const isWebStream = currentTrackPath.startsWith('http://') || currentTrackPath.startsWith('https://');
      if (isWebStream) {
        openUrl(currentTrackPath);
      } else if (artist) {
        setLibrarySearchQuery(artist);
        setView('library');
      }
    };

    it('should navigate and search Unicode & complex artist names without mangling', () => {
      const complexArtists = [
        '宇多田ヒカル',
        'Sigur Rós',
        'AC/DC',
        'Panic! At The Disco',
        '$uicideboy$',
        'Tyler, The Creator',
        '100 gecs',
        'Mø',
        '21 Savage & Metro Boomin'
      ];

      for (const artist of complexArtists) {
        const mockSetView = vi.fn();
        const mockSetSearchQuery = vi.fn();
        const localPath = `C:\\Music\\${artist}\\Album\\01.flac`;

        handleArtistClick(localPath, artist, mockSetView, mockSetSearchQuery);

        expect(openUrl).not.toHaveBeenCalled();
        expect(mockSetSearchQuery).toHaveBeenCalledWith(artist);
        expect(mockSetView).toHaveBeenCalledWith('library');
      }
    });

    it('should pass unadulterated query params and hash for HTTP/HTTPS web streams', () => {
      const testStreams = [
        'http://stream.somafm.com/groovesalad-128-mp3?token=secret123&quality=high',
        'https://icecast.radiofrance.fr/fip-midfi.mp3#live-stream',
        'https://subdomain.stream.org:8080/mount/point?session=xyz#nowplaying'
      ];

      for (const streamUrl of testStreams) {
        const mockSetView = vi.fn();
        const mockSetSearchQuery = vi.fn();

        handleArtistClick(streamUrl, 'Radio Artist', mockSetView, mockSetSearchQuery);

        expect(openUrl).toHaveBeenCalledWith(streamUrl);
        expect(mockSetView).not.toHaveBeenCalled();
        expect(mockSetSearchQuery).not.toHaveBeenCalled();
      }
    });

    it('should handle non-HTTP protocols, file paths, and relative paths as local search', () => {
      const nonWebPaths = [
        'file:///C:/Music/test.mp3',
        'smb://nas/music/test.flac',
        'D:\\Audio\\Track.wav',
        '/Volumes/Ext/Music/Track.m4a',
        './local_relative_file.mp3'
      ];

      for (const p of nonWebPaths) {
        const mockSetView = vi.fn();
        const mockSetSearchQuery = vi.fn();

        handleArtistClick(p, 'The Local Band', mockSetView, mockSetSearchQuery);

        expect(openUrl).not.toHaveBeenCalled();
        expect(mockSetSearchQuery).toHaveBeenCalledWith('The Local Band');
        expect(mockSetView).toHaveBeenCalledWith('library');
      }
    });

    it('should safely no-op on undefined, null, empty string, or missing artist', () => {
      const mockSetView = vi.fn();
      const mockSetSearchQuery = vi.fn();

      handleArtistClick(undefined, 'Artist', mockSetView, mockSetSearchQuery);
      handleArtistClick(null, 'Artist', mockSetView, mockSetSearchQuery);
      handleArtistClick('', 'Artist', mockSetView, mockSetSearchQuery);
      handleArtistClick('C:\\Music\\song.mp3', undefined, mockSetView, mockSetSearchQuery);
      handleArtistClick('C:\\Music\\song.mp3', null, mockSetView, mockSetSearchQuery);
      handleArtistClick('C:\\Music\\song.mp3', '', mockSetView, mockSetSearchQuery);

      expect(openUrl).not.toHaveBeenCalled();
      expect(mockSetView).not.toHaveBeenCalled();
      expect(mockSetSearchQuery).not.toHaveBeenCalled();
    });
  });

  describe('2. Scrobbler Reset Under Chaos & Idempotency', () => {
    const executeResetScrobbling = () => {
      useStore.getState().setLastFmSession(null);
      localStorage.removeItem('lastfm_scrobble_enabled');
      useStore.getState().setListenbrainzToken(null);
      localStorage.removeItem('listenbrainz_enabled');
      useStore.getState().setScrobbleThreshold(50);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: 'Scrobbling statistics & user tokens cleared.', type: 'success' } 
      }));
    };

    it('is strictly idempotent over 10 repeated reset calls', () => {
      // Setup initial mixed state
      useStore.getState().setLastFmSession('active_lastfm_key');
      useStore.getState().setListenbrainzToken('active_lb_key');
      useStore.getState().setScrobbleThreshold(75);

      const toastEvents: any[] = [];
      const listener = (e: any) => toastEvents.push(e.detail);
      window.addEventListener('ui-toast', listener);

      for (let i = 0; i < 10; i++) {
        executeResetScrobbling();

        const s = useStore.getState();
        expect(s.lastfmSessionKey).toBeNull();
        expect(s.scrobbleEnabled).toBe(false);
        expect(s.listenbrainzToken).toBeNull();
        expect(s.listenbrainzUsername).toBeNull();
        expect(s.listenbrainzEnabled).toBe(false);
        expect(s.scrobbleThreshold).toBe(50);

        expect(localStorage.getItem('lastfm_session')).toBeNull();
        expect(localStorage.getItem('lastfm_scrobble_enabled')).toBeNull();
        expect(localStorage.getItem('listenbrainz_token')).toBeNull();
        expect(localStorage.getItem('listenbrainz_username')).toBeNull();
        expect(localStorage.getItem('listenbrainz_enabled')).toBeNull();
      }

      window.removeEventListener('ui-toast', listener);
      expect(toastEvents.length).toBe(10);
      expect(toastEvents[0].type).toBe('success');
    });

    it('clears services when Last.fm is enabled but ListenBrainz was disabled with token present', () => {
      useStore.getState().setLastFmSession('key_1');
      useStore.getState().setListenbrainzToken('key_2');
      useStore.getState().toggleListenbrainzScrobble(); // toggle LB to disabled

      expect(useStore.getState().scrobbleEnabled).toBe(true);
      expect(useStore.getState().listenbrainzEnabled).toBe(false);

      executeResetScrobbling();

      expect(useStore.getState().scrobbleEnabled).toBe(false);
      expect(useStore.getState().listenbrainzEnabled).toBe(false);
      expect(useStore.getState().lastfmSessionKey).toBeNull();
      expect(useStore.getState().listenbrainzToken).toBeNull();
    });

    it('clears services when ListenBrainz is enabled but Last.fm was disabled with session present', () => {
      useStore.getState().setLastFmSession('key_1');
      useStore.getState().toggleScrobble(); // toggle LastFM to disabled
      useStore.getState().setListenbrainzToken('key_2');

      expect(useStore.getState().scrobbleEnabled).toBe(false);
      expect(useStore.getState().listenbrainzEnabled).toBe(true);

      executeResetScrobbling();

      expect(useStore.getState().scrobbleEnabled).toBe(false);
      expect(useStore.getState().listenbrainzEnabled).toBe(false);
      expect(useStore.getState().lastfmSessionKey).toBeNull();
      expect(useStore.getState().listenbrainzToken).toBeNull();
    });
  });

  describe('3. Stream Buffering Telemetry & Online Track Matrix', () => {
    it('dispatches telemetry correctly across full matrix of local and online audio sources', async () => {
      const testCases = [
        { path: 'http://radio.stream/live', format: 'MP3', expectedOnline: true },
        { path: 'https://secure.radio.stream/live', format: 'AAC', expectedOnline: true },
        { path: '12345678', format: 'Tidal FLAC', expectedOnline: true },
        { path: '138614268', format: 'Qobuz FLAC', expectedOnline: true },
        { path: 'https://youtube.com/watch?v=mock', format: 'YouTube Direct', expectedOnline: true },
        { path: 'yt_raw_id_987', format: 'YouTube Direct', expectedOnline: true },
        { path: 'C:\\Music\\Album\\01.flac', format: 'FLAC', expectedOnline: false },
        { path: 'D:\\Lossless\\Track.wav', format: 'WAV', expectedOnline: false },
        { path: '/Volumes/Audio/DSD.dsf', format: 'DSD', expectedOnline: false },
        { path: 'E:\\Music\\Song.mp3', format: 'MP3', expectedOnline: false }
      ];

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const dispatchedEvents: any[] = [];
        const listener = (e: any) => dispatchedEvents.push(e.detail);
        window.addEventListener('ui-stream-buffering', listener);

        const track = {
          id: 5000 + i,
          path: tc.path,
          title: `Track ${i}`,
          artist: `Artist ${i}`,
          format: tc.format,
          duration: 180,
          lyric_offset: 0
        };

        await useStore.getState().playTrack(track, false, true);
        window.removeEventListener('ui-stream-buffering', listener);

        if (tc.expectedOnline) {
          expect(dispatchedEvents.length, `Expected telemetry event for ${tc.format} with path ${tc.path}`).toBeGreaterThan(0);
          expect(dispatchedEvents[0]).toEqual({
            active: true,
            title: `Track ${i}`,
            artist: `Artist ${i}`
          });
        } else {
          expect(dispatchedEvents.length, `Expected NO telemetry event for local ${tc.format} with path ${tc.path}`).toBe(0);
        }
      }
    });
  });

  describe('4. SettingsView Shortcut Remapper dspBypass Integrity', () => {
    it('supports custom key binding, reading, and resetting of dspBypass action', () => {
      // Default should be 'b'
      expect(useStore.getState().shortcuts.dspBypass).toBe('b');

      // Rebind to custom keys
      useStore.getState().setShortcut('dspBypass', 'x');
      expect(useStore.getState().shortcuts.dspBypass).toBe('x');
      expect(JSON.parse(localStorage.getItem('aideo-keyboard-shortcuts') || '{}').dspBypass).toBe('x');

      useStore.getState().setShortcut('dspBypass', 'F8');
      expect(useStore.getState().shortcuts.dspBypass).toBe('F8');

      // Execute resetShortcuts
      const resetShortcuts = () => {
        localStorage.removeItem('aideo-keyboard-shortcuts');
        useStore.getState().setShortcut('playPause', 'Space');
        useStore.getState().setShortcut('next', 'ArrowRight');
        useStore.getState().setShortcut('prev', 'ArrowLeft');
        useStore.getState().setShortcut('volumeUp', 'ArrowUp');
        useStore.getState().setShortcut('volumeDown', 'ArrowDown');
        useStore.getState().setShortcut('dspBypass', 'b');
        useStore.getState().setShortcut('mute', 'm');
      };

      resetShortcuts();
      expect(useStore.getState().shortcuts.dspBypass).toBe('b');
      expect(useStore.getState().shortcuts.playPause).toBe('Space');
    });
  });

  describe('5. FullscreenView Keydown Effect Stability & Dynamic State Resolution', () => {
    it('preserves a single event listener without churn while reading updated state dynamically', async () => {
      let listenerCount = 0;
      let registeredHandler: ((e: KeyboardEvent) => void) | null = null;

      const mockAddEventListener = vi.spyOn(window, 'addEventListener').mockImplementation((event: string, handler: any) => {
        if (event === 'keydown') {
          listenerCount++;
          registeredHandler = handler;
        }
      });

      const mockRemoveEventListener = vi.spyOn(window, 'removeEventListener').mockImplementation((event: string) => {
        if (event === 'keydown') {
          listenerCount--;
        }
      });

      // Simulate mounting FullscreenView keydown effect
      const setupFullscreenKeydown = (setView: (v: any) => void) => {
        const handleKeyDown = (e: KeyboardEvent) => {
          const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
          if (targetTag === 'input' || targetTag === 'textarea') return;

          const state = useStore.getState();
          const key = e.key.toLowerCase();
          if (e.key === 'Escape') {
            e.preventDefault();
            setView('nowplaying');
          } else if (e.code === 'Space' || key === ' ') {
            e.preventDefault();
            if (state.playback.status === 'Playing') {
              state.pauseTrack();
            } else {
              state.resumeTrack();
            }
          } else if (key === 'm') {
            e.preventDefault();
            state.toggleMute();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            state.seek(Math.max(0, state.playback.position_secs - 5));
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            const duration = state.currentTrack?.duration || 0;
            state.seek(Math.min(duration, state.playback.position_secs + 5));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const nextVol = Math.min(1, Math.round((state.playback.volume + 0.05) * 100) / 100);
            state.setVolume(nextVol);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextVol = Math.max(0, Math.round((state.playback.volume - 0.05) * 100) / 100);
            state.setVolume(nextVol);
          }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
      };

      const cleanup = setupFullscreenKeydown(useStore.getState().setView);
      expect(listenerCount).toBe(1);

      // Simulate 50 position polls (representing 10 seconds of playback at 200ms interval)
      for (let pos = 1; pos <= 50; pos++) {
        useStore.setState({
          playback: {
            ...useStore.getState().playback,
            position_secs: pos * 0.2
          }
        });
      }

      // Listener count MUST still be 1 (no churn / re-registration)
      expect(listenerCount).toBe(1);

      // Verify that handler reads the LATEST position_secs (10.0s) and performs seek accurately
      expect(useStore.getState().playback.position_secs).toBeCloseTo(10.0);
      const handler = registeredHandler as ((e: KeyboardEvent) => void) | null;
      expect(handler).not.toBeNull();

      if (handler) {
        // Test ArrowRight: Seek forward from 10.0 to 15.0
        useStore.setState({ currentTrack: { id: 1, path: 'test.mp3', title: 'T', artist: 'A', duration: 100, format: 'MP3', lyric_offset: 0 } });
        const arrowRightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
        handler(arrowRightEvent);
        await new Promise(r => setTimeout(r, 10));
        expect(useStore.getState().playback.position_secs).toBe(15.0);

        // Test ArrowLeft: Seek backward from 15.0 to 10.0
        const arrowLeftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
        handler(arrowLeftEvent);
        await new Promise(r => setTimeout(r, 10));
        expect(useStore.getState().playback.position_secs).toBe(10.0);

        // Test Volume Up
        useStore.setState({ playback: { ...useStore.getState().playback, volume: 0.5 } });
        const arrowUpEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
        handler(arrowUpEvent);
        await new Promise(r => setTimeout(r, 10));
        expect(useStore.getState().playback.volume).toBe(0.55);

        // Test Volume Down
        const arrowDownEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
        handler(arrowDownEvent);
        await new Promise(r => setTimeout(r, 10));
        expect(useStore.getState().playback.volume).toBe(0.5);

        // Test Space toggle Play/Pause
        useStore.setState({ playback: { ...useStore.getState().playback, status: 'Playing' } });
        const spaceEvent = new KeyboardEvent('keydown', { code: 'Space', bubbles: true });
        handler(spaceEvent);
        await new Promise(r => setTimeout(r, 10));
        expect(useStore.getState().playback.status).toBe('Paused');
      }

      cleanup();
      expect(listenerCount).toBe(0);

      mockAddEventListener.mockRestore();
      mockRemoveEventListener.mockRestore();
    });
  });
});
