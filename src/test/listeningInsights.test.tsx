import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ListeningInsightsView } from '../components/ListeningInsightsView';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import type { ListeningInsightsPayload, Track } from '../store/types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Aideo Insights & Telemetry', () => {
  const mockInsights: ListeningInsightsPayload = {
    total_listening_time_secs: 7200,
    total_plays: 42,
    skip_count: 5,
    skip_rate: 11.9,
    top_songs: [
      { title: 'Lateralus', artist: 'Tool', track_path: 'C:/Music/Tool/Lateralus.flac', play_count: 14 },
      { title: 'Time', artist: 'Pink Floyd', track_path: 'C:/Music/Pink Floyd/Time.flac', play_count: 9 },
    ],
    top_artists: [
      { artist: 'Tool', play_count: 20 },
      { artist: 'Pink Floyd', play_count: 12 },
    ],
    top_albums: [
      { album: 'Lateralus', artist: 'Tool', cover_url: 'https://example.com/lateralus.jpg', play_count: 14 },
      { album: 'The Dark Side of the Moon', artist: 'Pink Floyd', cover_url: null, play_count: 10 },
    ],
    top_genres: [
      { genre: 'Progressive Metal', play_count: 20 },
      { genre: 'Progressive Rock', play_count: 12 },
    ],
    hourly_activity: [
      { hour: 23, play_count: 15 },
      { hour: 0, play_count: 10 },
    ],
    daily_activity: [
      { day: 5, play_count: 25 },
      { day: 6, play_count: 17 },
    ],
    audiophile: {
      lossless_count: 35,
      hires_count: 20,
      standard_count: 7,
      bit_perfect_count: 30,
      bit_perfect_rate: 71.4,
      avg_sample_rate: 96000,
      top_resolution: '24-bit / 192.0 kHz FLAC',
    },
    sources: {
      local_count: 30,
      tidal_count: 8,
      qobuz_count: 4,
      webstream_count: 5,
      youtube_count: 0,
    },
  };

  const existingTrack: Track = {
    id: 101,
    path: 'C:/Music/Tool/Lateralus.flac',
    title: 'Lateralus',
    artist: 'Tool',
    album: 'Lateralus',
    genre: 'Progressive Metal',
    duration: 577,
    format: 'FLAC',
    lyric_offset: 0,
    loved: 1,
    disliked: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      tracks: [existingTrack],
      currentTrack: null,
      currentHistoryId: null,
      playback: {
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        volume: 1,
        exclusive: false,
        bit_perfect: true,
        dev_rate: 96000,
        driver_type: 'WASAPI',
        file_rate: 96000,
      },
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_listening_insights') {
        return mockInsights;
      }
      if (cmd === 'log_playback_start') {
        return 999;
      }
      if (cmd === 'log_playback_end') {
        return undefined;
      }
      return undefined;
    });
  });

  it('renders core metrics, top albums, audiophile fidelity, and sources', async () => {
    render(<ListeningInsightsView />);

    await waitFor(() => {
      expect(screen.getByText('Aideo Insights')).toBeDefined();
    });

    // Core metrics
    expect(screen.getByText('2 hrs')).toBeDefined();
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('11.9%')).toBeDefined();

    // Top Songs & Albums (both contain Lateralus)
    expect(screen.getAllByText('Lateralus').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Time')).toBeDefined();

    // Top Artists
    expect(screen.getAllByText('Tool').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pink Floyd').length).toBeGreaterThanOrEqual(1);

    // Top Albums
    expect(screen.getByText('The Dark Side of the Moon')).toBeDefined();

    // Audiophile fidelity
    expect(screen.getByText('Audiophile Fidelity')).toBeDefined();
    expect(screen.getAllByText('20').length).toBeGreaterThanOrEqual(1); // Hi-Res Plays
    expect(screen.getByText('35')).toBeDefined(); // Lossless Plays
    expect(screen.getByText('96.0 kHz')).toBeDefined(); // Avg Sample Rate
    expect(screen.getByText('24-bit / 192.0 kHz FLAC')).toBeDefined();

    // Sources distribution
    expect(screen.getByText('Playback Sources')).toBeDefined();
    expect(screen.getByText('30')).toBeDefined(); // Local
    expect(screen.getAllByText('8').length).toBeGreaterThanOrEqual(1); // Tidal
    expect(screen.getByText(/Webstream:/)).toBeDefined();
    expect(screen.queryByText(/YouTube:/)).toBeNull();
  });

  it('plays the real track from library when clicking play on top songs', async () => {
    const playTrackSpy = vi.fn();
    useStore.setState({ playTrack: playTrackSpy });

    render(<ListeningInsightsView />);

    await waitFor(() => {
      expect(screen.getAllByText('Lateralus').length).toBeGreaterThanOrEqual(1);
    });

    const playButtons = screen.getAllByTitle('Play Track');
    fireEvent.click(playButtons[0]);

    expect(playTrackSpy).toHaveBeenCalledWith(existingTrack);
    expect(useStore.getState().view).toBe('nowplaying');
  });

  it('advances Wrapped slides including Top Album and Audiophile Signature', async () => {
    useStore.setState({ playTrack: vi.fn() });
    render(<ListeningInsightsView />);

    await waitFor(() => {
      expect(screen.getByText('Generate Wrapped')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Generate Wrapped'));

    // Slide 0: Intro
    await waitFor(() => {
      expect(screen.getByText(/Your Sound Profile/i)).toBeDefined();
    });

    const clickNext = () => {
      const btn = document.querySelector('.wrapped-nav-overlay-right');
      if (btn) fireEvent.click(btn);
    };

    // Advance to Slide 1: Stats
    clickNext();
    await waitFor(() => {
      expect(screen.getByText('You lived inside the music.')).toBeDefined();
      expect(screen.getByText('120')).toBeDefined(); // 7200s / 60 = 120 mins
    });

    // Advance to Slide 2: Top Artist
    clickNext();
    await waitFor(() => {
      expect(screen.getByText('Your ultimate companion.')).toBeDefined();
    });

    // Advance to Slide 3: Top Album
    clickNext();
    await waitFor(() => {
      expect(screen.getByText('The full experience.')).toBeDefined();
    });

    // Advance to Slide 4: Top Songs
    clickNext();
    await waitFor(() => {
      expect(screen.getByText('Your heavy rotations.')).toBeDefined();
    });

    // Advance to Slide 5: Audiophile Signature
    clickNext();
    await waitFor(() => {
      expect(screen.getByText('Audiophile Signature')).toBeDefined();
      expect(screen.getByText('Sound without compromises.')).toBeDefined();
      expect(screen.getAllByText('71.4%').length).toBeGreaterThanOrEqual(1);
    });

    // Advance to Slide 6: Persona
    clickNext();
    await waitFor(() => {
      expect(screen.getByText('The verdict is in.')).toBeDefined();
      expect(screen.getByText('The Master Tape Purist')).toBeDefined();
    });
  });

  it('correctly calculates standardized skip rate and completion rate in recordPlaybackTransition', async () => {
    const store = useStore.getState();

    // Set current track and history ID
    useStore.setState({
      currentTrack: existingTrack, // duration 577s
      currentHistoryId: 888,
      playback: {
        ...useStore.getState().playback,
        position_secs: 550, // Stopped at outro (550s out of 577s)
      },
    });

    // Transition to new track
    await store.recordPlaybackTransition({
      id: 202,
      path: 'C:/Music/Tool/Schism.flac',
      title: 'Schism',
      artist: 'Tool',
      album: 'Lateralus',
      genre: 'Progressive Metal',
      duration: 400,
      format: 'FLAC',
      lyric_offset: 0,
    });

    // Verify log_playback_end was called with skipped = false (since 550s >= 30s and >= 50%)
    expect(invoke).toHaveBeenCalledWith('log_playback_end', {
      historyId: 888,
      durationPlayed: 550,
      skipped: false,
      completionRate: 550 / 577,
    });

    // Verify log_playback_start was called with real album, genre, and audiophile telemetry
    expect(invoke).toHaveBeenCalledWith('log_playback_start', {
      path: 'C:/Music/Tool/Schism.flac',
      title: 'Schism',
      artist: 'Tool',
      album: 'Lateralus',
      duration: 400,
      format: 'FLAC',
      genre: 'Progressive Metal',
      playbackSource: null,
      sampleRate: 96000,
      bitDepth: null,
      bitPerfect: true,
    });
  });

  it('marks a track as skipped only when stopped early (<30s and <50%)', async () => {
    const store = useStore.getState();

    useStore.setState({
      currentTrack: existingTrack, // duration 577s
      currentHistoryId: 777,
      playback: {
        ...useStore.getState().playback,
        position_secs: 15, // Stopped after 15s
      },
    });

    await store.recordPlaybackTransition(null);

    expect(invoke).toHaveBeenCalledWith('log_playback_end', {
      historyId: 777,
      durationPlayed: 15,
      skipped: true,
      completionRate: 15 / 577,
    });
  });
});
