import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { rememberResolvedPath, setOnlineTrackCache, trackIdToStreamUrl, onlineTrackCache, resolvedPathMap } from '../utils';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === 'get_playback_status') {
      return Promise.resolve({
        current_track: 'https://sp-play.tidal.com/stream/142857.flac',
        status: 'Playing',
        position_secs: 120,
        volume: 1,
      });
    }
    if (cmd === 'lastfm_scrobble') return Promise.resolve();
    if (cmd === 'listenbrainz_scrobble') return Promise.resolve();
    return Promise.resolve(null);
  }),
}));

describe('Last.fm and ListenBrainz Scrobbling on Tidal and Online Sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineTrackCache.clear();
    resolvedPathMap.clear();
    trackIdToStreamUrl.clear();
    useStore.setState({
      tracks: [], // Empty local library
      queue: [],
      currentTrack: null,
      scrobbledCurrent: false,
      lastScrobble: null,
      scrobbleEnabled: true,
      lastfmSessionKey: 'test_lfm_session',
      listenbrainzEnabled: false,
      listenbrainzToken: null,
      scrobbleThreshold: 50,
      playback: {
        current_track: 'https://sp-play.tidal.com/stream/142857.flac',
        status: 'Playing',
        position_secs: 120,
        volume: 1,
        dev_rate: 44100,
        file_ch: 2,
        bit_perfect: false,
        driver_type: 'WASAPI',
        exclusive: false,
      },
    });
  });

  it('scrobbles Tidal track to Last.fm when track is resolved via currentTrack', async () => {
    const tidalTrack = {
      id: -1,
      path: '142857',
      title: 'Starboy',
      artist: 'The Weeknd',
      format: 'Tidal FLAC',
      duration: 230,
      cover_url: null,
      lyric_offset: 0,
    };

    rememberResolvedPath('https://sp-play.tidal.com/stream/142857.flac', '142857');
    setOnlineTrackCache('https://sp-play.tidal.com/stream/142857.flac', tidalTrack);

    useStore.setState({
      currentTrack: tidalTrack,
    });

    await useStore.getState().pollStatus();

    expect(invoke).toHaveBeenCalledWith('lastfm_scrobble', expect.objectContaining({
      artist: 'The Weeknd',
      track: 'Starboy',
      sessionKey: 'test_lfm_session',
    }));
    expect(useStore.getState().scrobbledCurrent).toBe(true);
  });

  it('scrobbles Tidal track to ListenBrainz when only ListenBrainz is enabled', async () => {
    const tidalTrack = {
      id: -1,
      path: '142857',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      format: 'Tidal FLAC',
      duration: 200,
      cover_url: null,
      lyric_offset: 0,
    };

    rememberResolvedPath('https://sp-play.tidal.com/stream/142857.flac', '142857');
    setOnlineTrackCache('https://sp-play.tidal.com/stream/142857.flac', tidalTrack);

    useStore.setState({
      currentTrack: tidalTrack,
      scrobbleEnabled: false,
      lastfmSessionKey: null,
      listenbrainzEnabled: true,
      listenbrainzToken: 'test_lb_token',
    });

    await useStore.getState().pollStatus();

    expect(invoke).toHaveBeenCalledWith('listenbrainz_scrobble', expect.objectContaining({
      artist: 'The Weeknd',
      track: 'Blinding Lights',
      token: 'test_lb_token',
    }));
    expect(useStore.getState().scrobbledCurrent).toBe(true);
  });

  it('scrobbles Tidal track when found in onlineTrackCache fallback', async () => {
    const tidalTrack = {
      id: -1,
      path: '999999',
      title: 'Save Your Tears',
      artist: 'The Weeknd',
      format: 'Tidal FLAC',
      duration: 215,
      cover_url: null,
      lyric_offset: 0,
    };

    // currentTrack is null (e.g. after stream restoration), but onlineTrackCache has it
    setOnlineTrackCache('https://sp-play.tidal.com/stream/142857.flac', tidalTrack);

    await useStore.getState().pollStatus();

    expect(invoke).toHaveBeenCalledWith('lastfm_scrobble', expect.objectContaining({
      artist: 'The Weeknd',
      track: 'Save Your Tears',
      sessionKey: 'test_lfm_session',
    }));
    expect(useStore.getState().scrobbledCurrent).toBe(true);
  });

  it('does NOT scrobble generic placeholder/URL streams without valid artist or title', async () => {
    // Neither currentTrack nor cache has valid metadata, only raw stream URL
    await useStore.getState().pollStatus();

    expect(invoke).not.toHaveBeenCalledWith('lastfm_scrobble', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('listenbrainz_scrobble', expect.anything());
    expect(useStore.getState().scrobbledCurrent).toBe(false);
  });
});
