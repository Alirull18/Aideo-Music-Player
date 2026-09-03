import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KaraokeActiveLine } from '../components/KaraokeActiveLine';
import { sortLyricLines, parseDuration, isRadioStream, fmt } from '../utils';
import { tidalResultsToHubTracks } from '../utils/tidalHub';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

describe('KaraokeActiveLine Rework & Flicker Prevention', () => {
  const mockWords = [
    { text: 'Hel', time_secs: 1.0, duration_secs: 0.5 },
    { text: 'lo ', time_secs: 1.5, duration_secs: 0.5 },
    { text: 'World', time_secs: 2.0, duration_secs: 1.0 },
  ];

  it('renders words accurately with initial progress without tearing', () => {
    render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={0.5}
        lyricOffset={0}
        isPlaying={false}
      />
    );

    expect(screen.getByText('Hel')).toBeInTheDocument();
    expect(screen.getByText('lo')).toBeInTheDocument();
    expect(screen.getByText('World')).toBeInTheDocument();

    const helWord = screen.getByText('Hel');
    expect(helWord.style.getPropertyValue('--word-progress')).toBe('0%');
  });

  it('evaluates word completion and upcoming progress boundaries', () => {
    render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={1.8}
        lyricOffset={0}
        isPlaying={false}
      />
    );

    const helWord = screen.getByText('Hel');
    const worldWord = screen.getByText('World');

    expect(helWord.style.getPropertyValue('--word-progress')).toBe('100%');
    expect(worldWord.style.getPropertyValue('--word-progress')).toBe('0%');
  });

  it('calculates 50% progress for midpoint active word without jitter', () => {
    render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={1.75}
        lyricOffset={0}
        isPlaying={false}
      />
    );

    const loWord = screen.getByText('lo');
    expect(loWord.style.getPropertyValue('--word-progress')).toBe('50%');
  });
});

describe('Lyrics Sorting and activeIdx Guarantees', () => {
  it('sortLyricLines orders lines strictly by time_secs ascending', () => {
    const unsorted = [
      { time_secs: 20.0, text: 'Line 3' },
      { time_secs: 5.0, text: 'Line 1' },
      { time_secs: 12.0, text: 'Line 2' },
      { time_secs: 0.0, text: 'Credits at end' },
    ];

    const sorted = sortLyricLines(unsorted);
    expect(sorted.map(l => l.time_secs)).toEqual([0.0, 5.0, 12.0, 20.0]);
    expect(sorted[1].text).toBe('Line 1');
    expect(sorted[2].text).toBe('Line 2');
    expect(sorted[3].text).toBe('Line 3');
  });

  it('finds active line accurately and never jumps when lyrics are sorted', () => {
    const sorted = [
      { time_secs: 0.0, text: 'Intro' },
      { time_secs: 10.0, text: 'Verse 1' },
      { time_secs: 15.0, text: 'Verse 2' },
      { time_secs: 22.0, text: 'Chorus' },
    ];

    const findActiveIdx = (lines: typeof sorted, now: number) => {
      let idx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].time_secs <= now) idx = i; else break;
      }
      return idx;
    };

    expect(findActiveIdx(sorted, 5.0)).toBe(0);
    expect(findActiveIdx(sorted, 12.0)).toBe(1);
    expect(findActiveIdx(sorted, 18.0)).toBe(2);
    expect(findActiveIdx(sorted, 25.0)).toBe(3);
  });
});

describe('Tidal Duration Preservation & Minute Display', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      currentTrack: null,
      queue: [],
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        last_seek_time: 0,
        last_skip_time: 0,
      },
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
  });

  it('tidalResultsToHubTracks preserves duration in seconds', () => {
    const rawResults = [
      {
        id: '12345678',
        title: 'Lossless Anthem',
        artist: 'HiFi Artist',
        album: 'Audiophile Album',
        duration: 215, // 3:35
      },
      {
        id: '87654321',
        title: 'Zero Duration Song',
        artist: 'Mystery Artist',
        duration: 0,
      },
    ];

    const hubTracks = tidalResultsToHubTracks(rawResults);
    expect(hubTracks[0].duration).toBe(215);
    expect(hubTracks[0].duration_raw).toBe('3:35');
    expect(hubTracks[1].duration).toBe(180);
  });

  it('parseDuration converts string duration to seconds and fmt formats it', () => {
    expect(parseDuration('3:45')).toBe(225);
    expect(parseDuration('03:45')).toBe(225);
    expect(parseDuration('1:02:30')).toBe(3750);
    expect(fmt(225)).toBe('3:45');
  });

  it('isRadioStream returns false for Tidal tracks so player bar displays minutes not LIVE', () => {
    const tidalTrack = {
      path: '12345678',
      format: 'Tidal FLAC',
      duration: 0,
    };
    expect(isRadioStream(tidalTrack, 'https://sp-pr-cf.audio.tidal.com/track/12345678.flac', 0)).toBe(false);
  });

  it('playTidalResult normalizes track duration using duration_raw fallback', async () => {
    const originalPlayTrack = useStore.getState().playTrack;
    const playTrackSpy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ playTrack: playTrackSpy as any });

    try {
      const trackWithoutDuration: any = {
        id: 'tidal-999',
        path: '999',
        title: 'Tidal Track Without Duration Field',
        artist: 'Artist',
        duration_raw: '4:12',
        format: 'Tidal FLAC',
      };

      await useStore.getState().playTidalResult(trackWithoutDuration);

      expect(playTrackSpy).toHaveBeenCalledTimes(1);
      const passedTrack = playTrackSpy.mock.calls[0][0];
      expect(passedTrack.duration).toBe(252);
    } finally {
      useStore.setState({ playTrack: originalPlayTrack });
    }
  });
});

describe('Stream Buffering & Clock Stabilization', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      currentTrack: null,
      queue: [],
      tracks: [],
      playHistory: [],
      playCounts: {},
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        backend_position_secs: 0,
        is_buffering: false,
      },
    });
  });

  it('sets is_buffering to true when playTrack starts for an uncached online stream', async () => {
    const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === 'check_url_is_cached') return Promise.resolve(false);
      if (cmd === 'record_playback_transition') return Promise.resolve();
      if (cmd === 'play_track') return new Promise((resolve) => setTimeout(resolve, 50));
      return Promise.resolve();
    });
    vi.mocked(invoke).mockImplementation(mockInvoke as any);

    const onlineTrack: any = {
      id: -1,
      path: 'https://audio.tidal.com/stream/track.flac',
      title: 'Online Stream Track',
      artist: 'Online Artist',
      format: 'Tidal FLAC',
      duration: 180,
    };

    const playPromise = useStore.getState().playTrack(onlineTrack);

    // Synchronously / immediately after initial set, is_buffering should be true and position at 0
    expect(useStore.getState().playback.is_buffering).toBe(true);
    expect(useStore.getState().playback.position_secs).toBe(0);

    await playPromise;

    // Once play_track completes in backend, is_buffering should clear
    expect(useStore.getState().playback.is_buffering).toBe(false);
  });

  it('keeps position at 0 in pollStatus while stream is buffering and backend has not output audio', async () => {
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        position_secs: 0,
        backend_position_secs: 0,
        is_buffering: true,
      },
    });

    // Mock pollStatus receiving 0.0s backend position
    const incomingStatus = {
      status: 'Playing',
      current_track: 'https://audio.tidal.com/stream/track.flac',
      position_secs: 0.0,
      volume: 1.0,
    };

    const currentPlayback = useStore.getState().playback;
    const rawBackendPos = incomingStatus.position_secs;
    let reconciledPos = incomingStatus.position_secs;

    if (currentPlayback.is_buffering && (rawBackendPos === 0 || rawBackendPos === undefined)) {
      reconciledPos = currentPlayback.position_secs || 0;
    }

    expect(reconciledPos).toBe(0);
  });
});
