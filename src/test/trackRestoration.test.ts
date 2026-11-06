import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { isRadioStream, parseStreamMetadata, onlineTrackCache, resolvedPathMap, setOnlineTrackCache } from '../utils';

describe('Track restoration and playbar resume metadata tests (YouTube, retired providers, Local, Radio)', () => {
  beforeEach(() => {
    localStorage.clear();
    onlineTrackCache.clear();
    resolvedPathMap.clear();
    useStore.setState({
      tracks: [],
      queue: [],
      currentTrack: null,
      coverArt: null,
      playHistory: [],
      playback: {
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        volume: 1.0,
        exclusive: false,
        bit_perfect: false,
        dev_rate: 0,
        driver_type: 'WASAPI',
        is_buffering: false,
      }
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
    localStorage.clear();
    onlineTrackCache.clear();
    resolvedPathMap.clear();
  });

  it('correctly identifies on-demand tracks vs live radio streams with isRadioStream', () => {
    // YouTube on-demand track
    const ytTrack = {
      id: -30001,
      path: 'https://www.youtube.com/watch?v=IVE_LOVE_DIVE',
      title: 'LOVE DIVE',
      artist: 'IVE',
      duration: 177,
      format: 'YouTube Direct',
      cover_url: 'https://i.ytimg.com/vi/IVE_LOVE_DIVE/hqdefault.jpg'
    };
    expect(isRadioStream(ytTrack)).toBe(false);

    // YouTube on-demand track with no duration yet
    const ytTrackLoading = {
      id: -30001,
      path: 'https://www.youtube.com/watch?v=IVE_LOVE_DIVE',
      title: 'LOVE DIVE',
      artist: 'IVE',
      duration: null,
      format: 'YouTube Direct',
      cover_url: 'https://i.ytimg.com/vi/IVE_LOVE_DIVE/hqdefault.jpg'
    };
    expect(isRadioStream(ytTrackLoading)).toBe(false);

    // Tidal track
    const tidalTrack = {
      id: -1,
      path: '253975903',
      title: 'Blue Valentine',
      artist: 'NMIXX',
      duration: 186,
      format: 'Tidal FLAC',
      cover_url: 'https://resources.tidal.com/images/cover.jpg'
    };
    expect(isRadioStream(tidalTrack)).toBe(false);

    // Qobuz track
    const qobuzTrack = {
      id: -2,
      path: '98765432',
      title: 'After LIKE',
      artist: 'IVE',
      duration: 180,
      format: 'Qobuz FLAC',
      cover_url: 'https://static.qobuz.com/covers/cover.jpg'
    };
    expect(isRadioStream(qobuzTrack)).toBe(false);

    // Local track
    const localTrack = {
      id: 101,
      path: 'C:\\Music\\KPop\\LOVE_DIVE.flac',
      title: 'LOVE DIVE',
      artist: 'IVE',
      duration: 177,
      format: 'FLAC',
      cover_url: null
    };
    expect(isRadioStream(localTrack)).toBe(false);

    // Legitimate online radio stream
    const radioStream = {
      id: -9999,
      path: 'https://icecast.somafm.com/groovesalad-128-mp3',
      title: 'Groove Salad (SomaFM)',
      artist: 'Online Stream',
      duration: null,
      format: 'URL',
      cover_url: null
    };
    expect(isRadioStream(radioStream)).toBe(true);
  });

  it('restores YouTube track on app startup without URL or LIVE tags and with artwork', () => {
    const ytTrack = {
      id: -30001,
      path: 'https://www.youtube.com/watch?v=IVE_LOVE_DIVE',
      title: 'LOVE DIVE',
      artist: 'IVE',
      duration: 177,
      format: 'YouTube Direct',
      cover_url: 'https://i.ytimg.com/vi/IVE_LOVE_DIVE/hqdefault.jpg'
    };
    localStorage.setItem('aideo_current_track', JSON.stringify(ytTrack));

    // Verify onlineTrackCache and parseStreamMetadata retain format, duration, cover
    setOnlineTrackCache(ytTrack.path, ytTrack);
    const meta = parseStreamMetadata(ytTrack.path);
    expect(meta.title).toBe('LOVE DIVE');
    expect(meta.artist).toBe('IVE');
    expect(meta.duration).toBe(177);
    expect(meta.format).toBe('YouTube Direct');
    expect(meta.cover_url).toBe('https://i.ytimg.com/vi/IVE_LOVE_DIVE/hqdefault.jpg');
  });

  it('heals degraded URL format YouTube tracks on startup from URL heuristics', () => {
    const degradedTrack = {
      id: -9999,
      path: 'https://www.youtube.com/watch?v=IVE_LOVE_DIVE',
      title: 'LOVE DIVE',
      artist: 'IVE',
      duration: null,
      format: 'URL',
      cover_url: null
    };
    localStorage.setItem('aideo_current_track', JSON.stringify(degradedTrack));
    setOnlineTrackCache(degradedTrack.path, {
      ...degradedTrack,
      duration: 177,
      format: 'YouTube Direct',
      cover_url: 'https://i.ytimg.com/vi/IVE_LOVE_DIVE/hqdefault.jpg'
    });

    const meta = parseStreamMetadata(degradedTrack.path);
    expect(meta.format).toBe('YouTube Direct');
    expect(meta.duration).toBe(177);
    expect(meta.cover_url).toBe('https://i.ytimg.com/vi/IVE_LOVE_DIVE/hqdefault.jpg');
  });

  it('resumes last played YouTube track properly when resumeTrack is called', async () => {
    const playedPaths: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'play_track') {
        playedPaths.push(args.path);
        return null;
      }
      return null;
    });

    const ytTrack = {
      id: -30001,
      path: 'https://www.youtube.com/watch?v=IVE_LOVE_DIVE',
      title: 'LOVE DIVE',
      artist: 'IVE',
      duration: 177,
      format: 'YouTube Direct',
      cover_url: 'https://i.ytimg.com/vi/IVE_LOVE_DIVE/hqdefault.jpg',
      lyric_offset: 0
    };

    useStore.setState({
      currentTrack: ytTrack,
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: ytTrack.path
      }
    });

    await useStore.getState().resumeTrack();

    expect(playedPaths).toContain(ytTrack.path);
    expect(useStore.getState().currentTrack?.format).toBe('YouTube Direct');
    expect(useStore.getState().currentTrack?.title).toBe('LOVE DIVE');
    expect(useStore.getState().coverArt).toBe('https://i.ytimg.com/vi/IVE_LOVE_DIVE/hqdefault.jpg');
    expect(isRadioStream(useStore.getState().currentTrack)).toBe(false);
  });

  it.each([['Tidal FLAC', '253975903'], ['Qobuz FLAC', '98765432']])('does not try to play a retired %s track when resumed', async (format, id) => {
    const toasts: string[] = [];
    const onToast = (e: Event) => toasts.push((e as CustomEvent).detail.message);
    window.addEventListener('ui-toast', onToast);
    const played: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'play_track') played.push(args.path);
      return null;
    });
    useStore.setState({
      currentTrack: { id: -1, path: id, title: 'Blue Valentine', artist: 'NMIXX', duration: 186, format, lyric_offset: 0 },
      playback: { ...useStore.getState().playback, status: 'Stopped', current_track: id },
    });

    await useStore.getState().resumeTrack();
    window.removeEventListener('ui-toast', onToast);

    expect(played).toEqual([]);
    expect(toasts.some(m => m.includes('no longer built in'))).toBe(true);
  });

  it('resumes last played Local track and preserves format and artwork', async () => {
    const LOCAL_PATH = 'C:\\Music\\IVE\\LOVE_DIVE.flac';
    const playedPaths: string[] = [];

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'play_track') {
        playedPaths.push(args.path);
        return null;
      }
      if (cmd === 'get_cover_art') return 'data:image/jpeg;base64,localCoverArt';
      return null;
    });

    const localTrack = {
      id: 50,
      path: LOCAL_PATH,
      title: 'LOVE DIVE',
      artist: 'IVE',
      duration: 177,
      format: 'FLAC',
      cover_url: null,
      lyric_offset: 0
    };

    useStore.setState({
      tracks: [localTrack],
      currentTrack: localTrack,
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: LOCAL_PATH
      }
    });

    await useStore.getState().resumeTrack();

    expect(playedPaths).toContain(LOCAL_PATH);
    expect(useStore.getState().currentTrack?.format).toBe('FLAC');
    expect(useStore.getState().currentTrack?.title).toBe('LOVE DIVE');
    expect(isRadioStream(useStore.getState().currentTrack)).toBe(false);
  });
});
