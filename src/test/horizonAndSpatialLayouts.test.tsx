import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { HorizonHome } from '../components/aideo/HorizonHome';
import { SpatialGlassHome } from '../components/aideo/SpatialGlassHome';
import { AideoView } from '../components/AideoView';
import { useStore } from '../store';
import { DiscoveryHubData, YoutubeTrack } from '../store/types';

describe('Horizon and Spatial Glass Layout Suite', () => {
  const dummyTrack: YoutubeTrack = {
    id: 'track-1',
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    url: 'https://example.com/bohemian',
    cover_url: 'https://example.com/queen.jpg',
    duration_raw: '5:55',
  };

  const dummyTrack2: YoutubeTrack = {
    id: 'track-2',
    title: 'Starboy',
    artist: 'The Weeknd',
    url: 'https://example.com/starboy',
    cover_url: 'https://example.com/starboy.jpg',
    duration_raw: '3:50',
  };

  const dummyHub: DiscoveryHubData = {
    recently_played: [dummyTrack],
    heavy_rotation: [dummyTrack2],
    forgotten_gems: [],
    recommendations: [dummyTrack, dummyTrack2],
    tidal_hifi: [],
    global_charts: [],
    mixed_for_you: [],
  };

  const dummySearch = {
    query: '',
    onQueryChange: vi.fn(),
    focused: false,
    onFocusChange: vi.fn(),
    suggestions: [],
    quickResults: [],
    history: [],
    source: 'all' as const,
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

  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      aideoPageDesign: 'classic',
      tracks: [],
      playHistory: [],
      playCounts: {},
      discoveryData: dummyHub,
      isLoadingRecs: false,
    });
  });

  it('renders HorizonHome layout with greeting, pills, quick-launch cards, and shelf carousels', () => {
    const onPlayTrack = vi.fn();
    const onRefreshRecs = vi.fn();

    render(
      createElement(HorizonHome, {
        greeting: 'Good evening',
        trackCount: 1420,
        totalPlays: 9800,
        discoveryData: dummyHub,
        isLoadingRecs: false,
        isRefreshingRecs: false,
        onRefreshRecs,
        onPlayTrack,
        renderDownloadAction: () => null,
        resume: null,
        search: dummySearch,
      })
    );

    // Verify greeting and stats
    expect(screen.getByText('Good evening')).toBeInTheDocument();
    expect(screen.getByText(/1,420 tracks in library/)).toBeInTheDocument();
    expect(screen.getByText(/9,800 total plays/)).toBeInTheDocument();

    // Verify filter pills
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Music' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hi-Res Lossless' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recently Played' })).toBeInTheDocument();

    // Verify Quick-Launch items
    expect(screen.getByRole('button', { name: /Quick play Bohemian Rhapsody by Queen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick play Starboy by The Weeknd/i })).toBeInTheDocument();

    // Play button click trigger
    fireEvent.click(screen.getByRole('button', { name: /Quick play Bohemian Rhapsody by Queen/i }));
    expect(onPlayTrack).toHaveBeenCalledWith(expect.objectContaining({ title: 'Bohemian Rhapsody' }));
  });

  it('renders SpatialGlassHome layout with Spatial Hero Marquee, top picks, and frosted shelves', () => {
    const onPlayTrack = vi.fn();
    const onRefreshRecs = vi.fn();

    render(
      createElement(SpatialGlassHome, {
        greeting: 'Good afternoon',
        trackCount: 850,
        totalPlays: 3200,
        discoveryData: dummyHub,
        isLoadingRecs: false,
        isRefreshingRecs: false,
        onRefreshRecs,
        onPlayTrack,
        renderDownloadAction: () => null,
        resume: null,
        search: dummySearch,
      })
    );

    // Verify header
    expect(screen.getByText('SPATIAL AUDIO ARCHIVE')).toBeInTheDocument();
    expect(screen.getByText('Good afternoon')).toBeInTheDocument();

    // Verify tabs
    expect(screen.getByRole('tab', { name: 'Browse' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Top Picks' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'New Discoveries' })).toBeInTheDocument();

    // Verify Spatial Hero Marquee & Listen Now button
    expect(screen.getByText('FEATURED DISCOVERY')).toBeInTheDocument();
    const listenNowBtn = screen.getByRole('button', { name: /Listen now to /i });
    expect(listenNowBtn).toBeInTheDocument();
    fireEvent.click(listenNowBtn);
    expect(onPlayTrack).toHaveBeenCalled();

    // Verify Quick Listen section
    expect(screen.getByText('Quick Listen')).toBeInTheDocument();
  });

  it('allows one-click switching between layouts via the collapsible Layout Filter', () => {
    render(createElement(AideoView));

    // Verify collapsible layout filter summary is present
    expect(screen.getByText('Layout: Classic')).toBeInTheDocument();

    // Verify all 6 buttons exist
    expect(screen.getByRole('button', { name: 'Classic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Horizon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spatial Glass' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editorial' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Command' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stage' })).toBeInTheDocument();

    // Click Horizon pill
    fireEvent.click(screen.getByRole('button', { name: 'Horizon' }));
    expect(useStore.getState().aideoPageDesign).toBe('spotify');

    // Click Spatial Glass pill
    fireEvent.click(screen.getByRole('button', { name: 'Spatial Glass' }));
    expect(useStore.getState().aideoPageDesign).toBe('apple');

    // Click Editorial pill
    fireEvent.click(screen.getByRole('button', { name: 'Editorial' }));
    expect(useStore.getState().aideoPageDesign).toBe('editorial');

    // Click Command pill
    fireEvent.click(screen.getByRole('button', { name: 'Command' }));
    expect(useStore.getState().aideoPageDesign).toBe('command');

    // Click Stage pill
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    expect(useStore.getState().aideoPageDesign).toBe('stage');

    // Click Classic pill
    fireEvent.click(screen.getByRole('button', { name: 'Classic' }));
    expect(useStore.getState().aideoPageDesign).toBe('classic');
  });

  it('renders empty lossless callout when no lossless files are found and displays lossless tracks when local FLAC or Tidal tracks exist in HorizonHome', () => {
    const { rerender } = render(
      createElement(HorizonHome, {
        greeting: 'Good evening',
        trackCount: 0,
        totalPlays: 0,
        discoveryData: dummyHub,
        isLoadingRecs: false,
        isRefreshingRecs: false,
        onRefreshRecs: vi.fn(),
        onPlayTrack: vi.fn(),
        renderDownloadAction: () => null,
        resume: null,
        search: dummySearch,
      })
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Hi-Res Lossless' }));
    expect(screen.getByText('No Hi-Res Lossless Audio Found')).toBeInTheDocument();

    // Add local FLAC track to store
    const localFlac: any = {
      id: 999,
      title: 'Comfortably Numb',
      artist: 'Pink Floyd',
      path: 'C:/Music/comfortably_numb.flac',
      format: 'flac',
      lyric_offset: 0,
      duration: 380,
    };
    useStore.setState({ tracks: [localFlac] });

    rerender(
      createElement(HorizonHome, {
        greeting: 'Good evening',
        trackCount: 1,
        totalPlays: 0,
        discoveryData: dummyHub,
        isLoadingRecs: false,
        isRefreshingRecs: false,
        onRefreshRecs: vi.fn(),
        onPlayTrack: vi.fn(),
        renderDownloadAction: () => null,
        resume: null,
        search: dummySearch,
      })
    );

    expect(screen.queryByText('No Hi-Res Lossless Audio Found')).toBeNull();
    expect(screen.getByText('Comfortably Numb')).toBeInTheDocument();
  });

  it('renders empty lossless callout in SpatialGlassHome when lossless tab is active and shows tracks when available', () => {
    useStore.setState({ tracks: [] });
    const { rerender } = render(
      createElement(SpatialGlassHome, {
        greeting: 'Good afternoon',
        trackCount: 0,
        totalPlays: 0,
        discoveryData: dummyHub,
        isLoadingRecs: false,
        isRefreshingRecs: false,
        onRefreshRecs: vi.fn(),
        onPlayTrack: vi.fn(),
        renderDownloadAction: () => null,
        resume: null,
        search: dummySearch,
      })
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Lossless Hi-Fi' }));
    expect(screen.getByText('No Hi-Res Lossless Audio Found')).toBeInTheDocument();

    // Add Tidal lossless track into discovery hub
    const tidalTrack: YoutubeTrack = {
      id: 'tidal-101',
      title: 'Time',
      artist: 'Hans Zimmer',
      format: 'Tidal FLAC',
      url: 'https://tidal.com/101',
      cover_url: null,
      duration_raw: '4:35',
    };
    const hubWithTidal: DiscoveryHubData = {
      ...dummyHub,
      tidal_hifi: [tidalTrack],
    };

    rerender(
      createElement(SpatialGlassHome, {
        greeting: 'Good afternoon',
        trackCount: 1,
        totalPlays: 0,
        discoveryData: hubWithTidal,
        isLoadingRecs: false,
        isRefreshingRecs: false,
        onRefreshRecs: vi.fn(),
        onPlayTrack: vi.fn(),
        renderDownloadAction: () => null,
        resume: null,
        search: dummySearch,
      })
    );

    expect(screen.queryByText('No Hi-Res Lossless Audio Found')).toBeNull();
    expect(screen.getAllByText('Time').length).toBeGreaterThanOrEqual(1);
  });
});
