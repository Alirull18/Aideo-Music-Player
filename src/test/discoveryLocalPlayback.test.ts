import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore, Track } from '../store';
import { sourceTypeColor } from '../components/aideo/HomeParts';
import { classifyDiscoveryPlayback } from '../utils';

describe('Discovery Hub Local Track Playback & Tag Resolution', () => {
  const sampleLocalTrack: Track = {
    id: 101,
    path: 'C:/Music/Copper Wires.flac',
    title: 'Copper Wires',
    artist: 'Red Meridian',
    album: 'Electric Horizon',
    duration: 250,
    format: 'FLAC',
    lyric_offset: 0,
    cover_url: null,
  };

  const sampleMp3Track: Track = {
    id: 102,
    path: 'D:/Audios/Neon City.mp3',
    title: 'Neon City',
    artist: 'Synthwave Boy',
    album: 'Retrowave 80s',
    duration: 180,
    format: 'MP3',
    lyric_offset: 0,
    cover_url: null,
  };

  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      tracks: [sampleLocalTrack, sampleMp3Track],
      currentTrack: null,
      coverArt: null,
      queue: [],
      playback: {
        current_track: null,
        status: 'Stopped',
        volume: 1,
        position_secs: 0,
        backend_position_secs: 0,
        is_buffering: false,
        bit_perfect: false,
        exclusive: false,
        dev_rate: 44100,
        driver_type: 'WASAPI',
      },
    });
  });

  it('delegates to playTrack with full FLAC metadata when playStream is called with a local library path', async () => {
    const playTrackSpy = vi.spyOn(useStore.getState(), 'playTrack');

    await useStore.getState().playStream('C:/Music/Copper Wires.flac', {
      title: 'Copper Wires',
      artist: 'Red Meridian',
      duration: 250,
    });

    expect(playTrackSpy).toHaveBeenCalledTimes(1);
    const playedTrack = playTrackSpy.mock.calls[0][0];
    expect(playedTrack.format).toBe('FLAC');
    expect(playedTrack.format).not.toBe('URL');
    expect(playedTrack.title).toBe('Copper Wires');
    expect(playedTrack.id).toBe(101);
  });

  it('delegates to playTrack when an online stream matches an owned local library song by title and artist', async () => {
    const playTrackSpy = vi.spyOn(useStore.getState(), 'playTrack');

    // Simulate clicking a discovery hub online recommendation that matches local library
    await useStore.getState().playStream('https://www.youtube.com/watch?v=mock123', {
      title: 'Copper Wires',
      artist: 'Red Meridian',
      duration: 250,
    });

    expect(playTrackSpy).toHaveBeenCalledTimes(1);
    const playedTrack = playTrackSpy.mock.calls[0][0];
    expect(playedTrack.path).toBe('C:/Music/Copper Wires.flac');
    expect(playedTrack.format).toBe('FLAC');
    expect(playedTrack.format).not.toBe('URL');
  });

  it('preserves file extension format and never sets format to URL when playing an untracked local file', async () => {
    const playTrackSpy = vi.spyOn(useStore.getState(), 'playTrack');

    await useStore.getState().playStream('E:/Unscanned/Acoustic Session.flac', {
      title: 'Acoustic Session',
      artist: 'Indie Artist',
      duration: 210,
    });

    expect(playTrackSpy).toHaveBeenCalledTimes(1);
    const playedTrack = playTrackSpy.mock.calls[0][0];
    expect(playedTrack.format).toBe('FLAC');
    expect(playedTrack.format).not.toBe('URL');
  });

  it('sets format to Web Stream instead of URL for pure web audio streams', async () => {
    // Calling playStream with an arbitrary online URL not matching any local library track
    await useStore.getState().playStream('https://stream.radioparadise.com/flac', {
      title: 'Radio Paradise',
      artist: 'Web Radio',
    });

    const current = useStore.getState().currentTrack;
    expect(current).not.toBeNull();
    expect(current?.format).toBe('Web Stream');
    expect(current?.format).not.toBe('URL');
  });

  it.each([
    ['Tidal FLAC', '455738980', 'tidal'],
    ['Qobuz FLAC', '138614268', 'qobuz'],
  ] as const)('routes numeric %s catalog IDs to their provider resolver', (format, path, expected) => {
    expect(classifyDiscoveryPlayback({ path, url: path, format })).toBe(expected);
  });

  it('routes an unowned filesystem path as a local track', () => {
    expect(classifyDiscoveryPlayback({ path: 'E:/Unscanned/Acoustic Session.flac', format: 'FLAC' })).toBe('local');
  });

  it('prefers an owned local match over the provider copy', () => {
    expect(classifyDiscoveryPlayback({ path: '455738980', format: 'Tidal FLAC' }, true)).toBe('local');
  });

  it('routes an HTTP recommendation as a web stream', () => {
    expect(classifyDiscoveryPlayback({ url: 'https://example.com/preview.m4a' })).toBe('stream');
  });

  it('sourceTypeColor identifies owned local tracks and assigns lossless purple or local green outline', () => {
    // Local track by path
    const localColor = sourceTypeColor({ url: 'C:/Music/Copper Wires.flac' });
    expect(localColor).toBe('#c084fc'); // FLAC lossless

    // Online stream that matches local track by title/artist
    const matchedColor = sourceTypeColor({
      url: 'https://youtube.com/watch?v=stream1',
      title: 'Copper Wires',
      artist: 'Red Meridian',
    });
    expect(matchedColor).toBe('#c084fc'); // Resolves to local FLAC color, not online red (#f87171)

    // Unowned stream
    const streamColor = sourceTypeColor({
      url: 'https://youtube.com/watch?v=unowned',
      title: 'Random Song',
      artist: 'Random Artist',
    });
    expect(streamColor).toBe('#f87171');
  });
});
