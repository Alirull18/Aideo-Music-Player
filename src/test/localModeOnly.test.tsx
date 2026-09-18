import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useStore, Track } from '../store';
import { UnifiedSearchResults } from '../components/UnifiedSearchResults';
import { AideoSearchBar, SearchBarProps } from '../components/aideo/HomeParts';

describe('Local File Only Mode (appMode === "local")', () => {
  const localTrack: Track = {
    id: 101,
    path: 'C:/Music/test_track.flac',
    title: 'Local FLAC Track',
    artist: 'Local Artist',
    album: 'Local Album',
    duration: 200,
    format: 'FLAC',
    lyric_offset: 0,
    cover_url: null,
  };

  const streamTrack: Track = {
    id: 102,
    path: 'https://www.youtube.com/watch?v=stream123',
    title: 'Stream Track',
    artist: 'Stream Artist',
    duration: 180,
    format: 'URL',
    lyric_offset: 0,
    cover_url: null,
  };

  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
    useStore.setState({
      appMode: 'hybrid',
      view: 'library',
      tracks: [localTrack],
      currentTrack: null,
      queue: [],
      playbackError: null,
      lyrics: [],
      lyricStatus: 'idle',
      streamingQuality: 'best_available',
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

  afterEach(() => {
    cleanup();
  });

  it('sets appMode to local and updates localStorage', () => {
    useStore.getState().setAppMode('local');
    expect(useStore.getState().appMode).toBe('local');
    expect(localStorage.getItem('aideo-app-mode')).toBe('local');
  });

  it('redirects from charts and loved_streams to library when switching to local mode', () => {
    useStore.setState({ view: 'charts' });
    useStore.getState().setAppMode('local');
    expect(useStore.getState().view).toBe('library');

    useStore.setState({ view: 'loved_streams' });
    useStore.getState().setAppMode('local');
    expect(useStore.getState().view).toBe('library');

    // Should not redirect other views like settings or library
    useStore.setState({ view: 'settings' });
    useStore.getState().setAppMode('local');
    expect(useStore.getState().view).toBe('settings');
  });

  it('stops active playback if playing an online stream when switching to local mode', async () => {
    const stopTrackSpy = vi.spyOn(useStore.getState(), 'stopTrack');
    useStore.setState({
      currentTrack: streamTrack,
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: streamTrack.path,
      },
    });

    useStore.getState().setAppMode('local');
    expect(stopTrackSpy).toHaveBeenCalledTimes(1);
  });

  it('does not stop playback when switching to local mode if playing a local track', () => {
    const stopTrackSpy = vi.spyOn(useStore.getState(), 'stopTrack');
    useStore.setState({
      currentTrack: localTrack,
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: localTrack.path,
      },
    });

    useStore.getState().setAppMode('local');
    expect(stopTrackSpy).not.toHaveBeenCalled();
  });

  it('blocks playStream with remote HTTP/HTTPS URLs in local mode', async () => {
    useStore.setState({ appMode: 'local' });
    await useStore.getState().playStream('https://www.youtube.com/watch?v=xyz123', {
      title: 'YouTube Song',
      artist: 'Artist',
    });

    expect(useStore.getState().playbackError).toBe('Online streaming is disabled in Local File Only Mode.');
    expect(useStore.getState().currentTrack).toBeNull();
  });

  it('allows playStream with local file paths in local mode', async () => {
    useStore.setState({ appMode: 'local' });
    const playTrackSpy = vi.spyOn(useStore.getState(), 'playTrack');

    await useStore.getState().playStream('C:/Music/test_track.flac', {
      title: 'Local FLAC Track',
      artist: 'Local Artist',
    });

    expect(playTrackSpy).toHaveBeenCalledTimes(1);
    expect(playTrackSpy.mock.calls[0][0].path).toBe('C:/Music/test_track.flac');
  });

  it('blocks playTrack with online stream tracks in local mode', async () => {
    useStore.setState({ appMode: 'local' });
    await useStore.getState().playTrack(streamTrack);

    expect(useStore.getState().playbackError).toBe('Online playback is disabled in Local File Only Mode.');
    expect(useStore.getState().currentTrack).toBeNull();
  });

  it('allows playTrack with local tracks in local mode', async () => {
    useStore.setState({ appMode: 'local' });
    await useStore.getState().playTrack(localTrack);

    expect(useStore.getState().playbackError).toBeNull();
    expect(useStore.getState().currentTrack?.path).toBe(localTrack.path);
  });

  it('does not fetch lyrics online when appMode is local', async () => {
    useStore.setState({ appMode: 'local', lyrics: [] });
    await useStore.getState().autoFetchLyricsOnline(localTrack);

    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('search_lyrics_online', expect.anything());
    expect(useStore.getState().lyricStatus).toBe('not_found');
  });

  it('fetches lyrics online when appMode is hybrid', async () => {
    useStore.setState({ appMode: 'hybrid', lyrics: [] });
    await useStore.getState().autoFetchLyricsOnline(localTrack);

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('search_lyrics_online', expect.anything());
  });

  it('renders "Local Library Only" status in UnifiedSearchResults when appMode is local', () => {
    useStore.setState({ appMode: 'local' });
    render(<UnifiedSearchResults result={{ tracks: [], pending: [], errors: {} }} />);

    expect(screen.getByText('Local Library Only')).toBeInTheDocument();
    expect(screen.getByText(/No matching local songs found/i)).toBeInTheDocument();
  });

  it('renders streaming quality status in UnifiedSearchResults when appMode is hybrid', () => {
    useStore.setState({ appMode: 'hybrid', streamingQuality: 'best_available' });
    render(<UnifiedSearchResults result={{ tracks: [], pending: [], errors: {} }} />);

    expect(screen.getByText('Auto / Best available')).toBeInTheDocument();
  });

  it('hides source filter dropdown in AideoSearchBar when appMode is local', () => {
    const mockSearchProps: SearchBarProps = {
      appMode: 'local',
      query: '',
      onQueryChange: vi.fn(),
      focused: false,
      onFocusChange: vi.fn(),
      suggestions: [],
      quickResults: [],
      history: [],
      source: 'all',
      onSourceChange: vi.fn(),
      tidalConnected: false,
      qobuzEnabled: false,
      qobuzConnected: false,
      onSubmit: vi.fn(),
      onPickQuery: vi.fn(),
      onDeleteHistory: vi.fn(),
      onPlayQuickTrack: vi.fn(),
      isSearching: false,
    };

    const { container } = render(<AideoSearchBar variant="pill" props={mockSearchProps} />);
    expect(container.querySelector('.unified-source-filter')).toBeNull();
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Search local music library…');
  });

  it('shows source filter dropdown in AideoSearchBar when appMode is hybrid', () => {
    const mockSearchProps: SearchBarProps = {
      appMode: 'hybrid',
      query: '',
      onQueryChange: vi.fn(),
      focused: false,
      onFocusChange: vi.fn(),
      suggestions: [],
      quickResults: [],
      history: [],
      source: 'all',
      onSourceChange: vi.fn(),
      tidalConnected: false,
      qobuzEnabled: false,
      qobuzConnected: false,
      onSubmit: vi.fn(),
      onPickQuery: vi.fn(),
      onDeleteHistory: vi.fn(),
      onPlayQuickTrack: vi.fn(),
      isSearching: false,
    };

    const { container } = render(<AideoSearchBar variant="pill" props={mockSearchProps} />);
    expect(container.querySelector('.unified-source-filter')).toBeInTheDocument();
  });
});
