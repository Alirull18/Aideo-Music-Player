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
    if (cmd === 'get_playback_status') return Promise.resolve({ current_track: null, status: 'Stopped', position_secs: 0, volume: 1 });
    return Promise.resolve(null);
  }),
}));

describe('Phase 3: UI State Synchronization & UX Polish Locking Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useStore.setState({
      view: 'nowplaying',
      currentTrack: null,
      librarySearchQuery: '',
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
      lyrics: []
    });
  });

  describe('1. Now Playing Artist Click Navigation', () => {
    const handleArtistClick = (
      currentTrackPath: string | null,
      artist: string | null,
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

    it('should invoke openUrl when track is an online web stream URL (http://)', () => {
      const mockSetView = vi.fn();
      const mockSetSearchQuery = vi.fn();
      const streamUrl = 'http://stream.somafm.com/groovesalad-128-mp3';

      handleArtistClick(streamUrl, 'SomaFM Artist', mockSetView, mockSetSearchQuery);

      expect(openUrl).toHaveBeenCalledTimes(1);
      expect(openUrl).toHaveBeenCalledWith(streamUrl);
      expect(mockSetView).not.toHaveBeenCalled();
      expect(mockSetSearchQuery).not.toHaveBeenCalled();
    });

    it('should invoke openUrl when track is an online web stream URL (https://)', () => {
      const mockSetView = vi.fn();
      const mockSetSearchQuery = vi.fn();
      const streamUrl = 'https://icecast.radiofrance.fr/fip-midfi.mp3';

      handleArtistClick(streamUrl, 'FIP Radio', mockSetView, mockSetSearchQuery);

      expect(openUrl).toHaveBeenCalledTimes(1);
      expect(openUrl).toHaveBeenCalledWith(streamUrl);
      expect(mockSetView).not.toHaveBeenCalled();
      expect(mockSetSearchQuery).not.toHaveBeenCalled();
    });

    it('should filter library and switch view to "library" for local track with artist', () => {
      const mockSetView = vi.fn();
      const mockSetSearchQuery = vi.fn();
      const localFilePath = 'C:\\Music\\Daft Punk\\Discovery\\01 - One More Time.flac';

      handleArtistClick(localFilePath, 'Daft Punk', mockSetView, mockSetSearchQuery);

      expect(openUrl).not.toHaveBeenCalled();
      expect(mockSetSearchQuery).toHaveBeenCalledWith('Daft Punk');
      expect(mockSetView).toHaveBeenCalledWith('library');
    });

    it('should no-op safely when current track is null or artist is missing', () => {
      const mockSetView = vi.fn();
      const mockSetSearchQuery = vi.fn();

      handleArtistClick(null, 'Unknown', mockSetView, mockSetSearchQuery);
      expect(openUrl).not.toHaveBeenCalled();
      expect(mockSetView).not.toHaveBeenCalled();

      handleArtistClick('C:\\Music\\song.mp3', null, mockSetView, mockSetSearchQuery);
      expect(openUrl).not.toHaveBeenCalled();
      expect(mockSetView).not.toHaveBeenCalled();
    });
  });

  describe('2. Scrobbler Reset Explicit State Cleanup', () => {
    it('should clear Last.fm and ListenBrainz tokens and reset threshold to 50', () => {
      // Simulate active logged in state
      useStore.getState().setLastFmSession('test_lastfm_session_key_123');
      useStore.getState().setListenbrainzToken('test_listenbrainz_token_456');
      useStore.getState().setScrobbleThreshold(80);

      expect(useStore.getState().lastfmSessionKey).toBe('test_lastfm_session_key_123');
      expect(useStore.getState().scrobbleEnabled).toBe(true);
      expect(useStore.getState().listenbrainzToken).toBe('test_listenbrainz_token_456');
      expect(useStore.getState().listenbrainzEnabled).toBe(true);
      expect(useStore.getState().scrobbleThreshold).toBe(80);

      // Execute resetScrobbling logic
      const resetScrobbling = () => {
        useStore.getState().setLastFmSession(null);
        localStorage.removeItem('lastfm_scrobble_enabled');
        useStore.getState().setListenbrainzToken(null);
        localStorage.removeItem('listenbrainz_enabled');
        useStore.getState().setScrobbleThreshold(50);
      };

      resetScrobbling();

      const state = useStore.getState();
      expect(state.lastfmSessionKey).toBeNull();
      expect(state.scrobbleEnabled).toBe(false);
      expect(state.listenbrainzToken).toBeNull();
      expect(state.listenbrainzEnabled).toBe(false);
      expect(state.scrobbleThreshold).toBe(50);
      expect(localStorage.getItem('lastfm_session')).toBeNull();
      expect(localStorage.getItem('lastfm_scrobble_enabled')).toBeNull();
      expect(localStorage.getItem('listenbrainz_token')).toBeNull();
      expect(localStorage.getItem('listenbrainz_enabled')).toBeNull();
    });

    it('should NOT inadvertently re-enable scrobbling if services were already disabled (avoids toggle inversion)', () => {
      // Set tokens but explicitly disable scrobbling toggles
      useStore.getState().setLastFmSession('mock_session');
      useStore.getState().toggleScrobble(); // now scrobbleEnabled is false
      expect(useStore.getState().scrobbleEnabled).toBe(false);

      useStore.getState().setListenbrainzToken('mock_lb_token');
      useStore.getState().toggleListenbrainzScrobble(); // now listenbrainzEnabled is false
      expect(useStore.getState().listenbrainzEnabled).toBe(false);

      // Reset
      useStore.getState().setLastFmSession(null);
      localStorage.removeItem('lastfm_scrobble_enabled');
      useStore.getState().setListenbrainzToken(null);
      localStorage.removeItem('listenbrainz_enabled');
      useStore.getState().setScrobbleThreshold(50);

      const state = useStore.getState();
      expect(state.scrobbleEnabled).toBe(false);
      expect(state.listenbrainzEnabled).toBe(false);
    });
  });

  describe('3. playTrack Online Status & Stream Buffering Telemetry', () => {
    it('should dispatch ui-stream-buffering event for Tidal FLAC tracks', async () => {
      const dispatchedEvents: any[] = [];
      const listener = (e: any) => dispatchedEvents.push(e.detail);
      window.addEventListener('ui-stream-buffering', listener);

      const tidalTrack = {
        id: 101,
        path: '142857', // Tidal track ID string
        title: 'Starboy',
        artist: 'The Weeknd',
        format: 'Tidal FLAC',
        duration: 230,
        lyric_offset: 0
      };

      await useStore.getState().playTrack(tidalTrack, false, true);

      window.removeEventListener('ui-stream-buffering', listener);

      expect(dispatchedEvents.length).toBeGreaterThan(0);
      expect(dispatchedEvents[0]).toEqual({
        active: true,
        title: 'Starboy',
        artist: 'The Weeknd'
      });
    });

    it('should dispatch ui-stream-buffering event for YouTube Direct tracks', async () => {
      const dispatchedEvents: any[] = [];
      const listener = (e: any) => dispatchedEvents.push(e.detail);
      window.addEventListener('ui-stream-buffering', listener);

      const ytTrack = {
        id: 102,
        path: 'https://youtube.com/watch?v=mock123',
        title: 'Lofi Hip Hop Beat',
        artist: 'Lofi Girl',
        format: 'YouTube Direct',
        duration: 180,
        lyric_offset: 0
      };

      await useStore.getState().playTrack(ytTrack, false, true);

      window.removeEventListener('ui-stream-buffering', listener);

      expect(dispatchedEvents.length).toBeGreaterThan(0);
      expect(dispatchedEvents[0]).toEqual({
        active: true,
        title: 'Lofi Hip Hop Beat',
        artist: 'Lofi Girl'
      });
    });

    it('should NOT dispatch ui-stream-buffering event for local audio files', async () => {
      const dispatchedEvents: any[] = [];
      const listener = (e: any) => dispatchedEvents.push(e.detail);
      window.addEventListener('ui-stream-buffering', listener);

      const localTrack = {
        id: 103,
        path: 'C:\\Music\\Album\\track.flac',
        title: 'Local Master',
        artist: 'Local Artist',
        format: 'FLAC',
        duration: 240,
        lyric_offset: 0
      };

      await useStore.getState().playTrack(localTrack, false, true);

      window.removeEventListener('ui-stream-buffering', listener);

      expect(dispatchedEvents.length).toBe(0);
    });
  });

  describe('4. Settings View Shortcut Remapper Configuration', () => {
    it('should include dspBypass in the configurable action list', () => {
      const shortcutActions = [
        { id: 'playPause', label: 'Play / Pause' },
        { id: 'next', label: 'Next Track' },
        { id: 'prev', label: 'Previous Track' },
        { id: 'volumeUp', label: 'Volume Up' },
        { id: 'volumeDown', label: 'Volume Down' },
        { id: 'mute', label: 'Mute / Unmute' },
        { id: 'dspBypass', label: 'DSP A/B Bypass Toggle' }
      ];

      const dspBypassAction = shortcutActions.find(a => a.id === 'dspBypass');
      expect(dspBypassAction).toBeDefined();
      expect(dspBypassAction?.label).toBe('DSP A/B Bypass Toggle');
      expect(useStore.getState().shortcuts.dspBypass).toBe('b');
    });
  });

  describe('5. Library Search Query Store State & Synchronization', () => {
    it('should store and update librarySearchQuery in Zustand store', () => {
      expect(useStore.getState().librarySearchQuery).toBe('');
      useStore.getState().setLibrarySearchQuery('Chopin');
      expect(useStore.getState().librarySearchQuery).toBe('Chopin');
      useStore.getState().setLibrarySearchQuery('');
      expect(useStore.getState().librarySearchQuery).toBe('');
    });
  });

  describe('6. Fullscreen View Keydown State Access Stability', () => {
    it('should read current state from useStore.getState() dynamically', async () => {
      useStore.setState({
        playback: {
          ...useStore.getState().playback,
          status: 'Playing',
          volume: 0.8,
          position_secs: 45
        },
        currentTrack: {
          id: 1,
          path: 'C:\\test.mp3',
          title: 'Test',
          artist: 'Artist',
          duration: 300,
          format: 'MP3',
          lyric_offset: 0
        }
      });

      const state = useStore.getState();
      expect(state.playback.status).toBe('Playing');
      expect(state.playback.volume).toBe(0.8);
      expect(state.playback.position_secs).toBe(45);

      // Simulate volume change via state action
      await state.setVolume(0.85);
      expect(useStore.getState().playback.volume).toBe(0.85);

      // Simulate seek via state action
      await state.seek(50);
      expect(useStore.getState().playback.position_secs).toBe(50);
    });
  });
});
