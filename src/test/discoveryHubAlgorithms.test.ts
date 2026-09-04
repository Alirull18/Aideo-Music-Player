import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { DiscoveryHubData, YoutubeTrack, YoutubeMix } from '../store/types';

describe('Discovery Hub Algorithms & Layout Tests (TDD)', () => {
  beforeEach(() => {
    useStore.setState({
      discoveryData: null,
      isLoadingRecs: false,
      discoveryLayout: 'shelves',
      appMode: 'hybrid',
    });
    localStorage.clear();
  });

  it('initializes and toggles discoveryLayout between shelves and unified', () => {
    expect(useStore.getState().discoveryLayout).toBe('shelves');

    useStore.getState().setDiscoveryLayout('unified');
    expect(useStore.getState().discoveryLayout).toBe('unified');
    expect(localStorage.getItem('aideo-discovery-layout')).toBe('unified');

    useStore.getState().setDiscoveryLayout('shelves');
    expect(useStore.getState().discoveryLayout).toBe('shelves');
    expect(localStorage.getItem('aideo-discovery-layout')).toBe('shelves');
  });

  it('correctly handles rich DiscoveryHubData with multiple algorithmic shelves', () => {
    const mockTrack = (id: string, title: string, artist: string, source: string): YoutubeTrack => ({
      id,
      title,
      artist,
      cover_url: 'https://example.com/cover.jpg',
      duration_raw: '3:45',
      url: `/music/${id}.flac`,
      recommendation_source: source,
    });

    const mockMix = (id: string, title: string, desc: string): YoutubeMix => ({
      id,
      title,
      description: desc,
      cover_url: null,
      tracks: [mockTrack(`t-${id}`, `${title} Track`, 'Various Artists', title)],
    });

    const fullDiscoveryData: DiscoveryHubData = {
      recommendations: [mockTrack('rec-1', 'Rec Song 1', 'Artist A', 'Similar to Loved Tracks')],
      global_charts: [mockTrack('chart-1', 'Chart Song 1', 'Top Artist', 'Global Top Hits')],
      mixed_for_you: [
        mockMix('mix-supermix', 'My Supermix', 'Your personal mix station'),
        mockMix('mix-spotlight', 'Artist Spotlight', 'Deep dive into top artist'),
        mockMix('mix-forgotten', 'Forgotten Favorites', 'Beloved tracks you haven\'t played in a while'),
        mockMix('mix-repeat', 'On Repeat', 'Current obsessions and most repeated tracks'),
      ],
      recently_played: [
        mockTrack('recent-1', 'Yesterday Jam', 'Artist B', 'Recently Played'),
        mockTrack('recent-2', 'Morning Coffee', 'Artist C', 'Recently Played'),
      ],
      heavy_rotation: [
        mockTrack('top-1', 'Most Played Anthem', 'Artist D', 'Heavy Rotation'),
        mockTrack('top-2', 'Daily Loop', 'Artist E', 'Heavy Rotation'),
      ],
      forgotten_gems: [
        mockTrack('gem-1', 'Old Favorite', 'Artist F', 'Time Capsule'),
      ],
      playlist_mixes: [
        mockMix('playlist-1', 'Summer Roadtrip', 'Local playlist collection'),
      ],
    };

    useStore.getState().setDiscoveryData(fullDiscoveryData);
    const stored = useStore.getState().discoveryData;

    expect(stored).not.toBeNull();
    expect(stored?.mixed_for_you.length).toBe(4);
    expect(stored?.recently_played?.length).toBe(2);
    expect(stored?.heavy_rotation?.length).toBe(2);
    expect(stored?.forgotten_gems?.length).toBe(1);
    expect(stored?.playlist_mixes?.length).toBe(1);
    expect(stored?.mixed_for_you.some(m => m.title.includes('Supermix'))).toBe(true);
    expect(stored?.mixed_for_you.some(m => m.title.includes('Spotlight'))).toBe(true);
    expect(stored?.mixed_for_you.some(m => m.title.includes('Forgotten Favorites'))).toBe(true);
    expect(stored?.mixed_for_you.some(m => m.title.includes('On Repeat'))).toBe(true);
  });

  it('supports local mode offline discovery data without internet dependency', () => {
    useStore.setState({ appMode: 'local' });

    const localData: DiscoveryHubData = {
      recommendations: [
        {
          id: 'local_1',
          title: 'Local Discovery Song',
          artist: 'Offline Artist',
          cover_url: null,
          duration_raw: '4:12',
          url: 'C:/Music/Track1.flac',
          recommendation_source: 'Local Library Gems',
        }
      ],
      global_charts: [
        {
          id: 'local_2',
          title: 'Top Local Track',
          artist: 'Local Hero',
          cover_url: null,
          duration_raw: '3:30',
          url: 'C:/Music/Track2.mp3',
          recommendation_source: 'Local Top Hits',
        }
      ],
      mixed_for_you: [
        {
          id: 'local_mix_supermix',
          title: 'My Supermix',
          description: 'Your favorite local tracks mixed with hidden library gems.',
          cover_url: null,
          tracks: []
        }
      ],
      recently_played: [],
      heavy_rotation: [],
      forgotten_gems: [],
      playlist_mixes: []
    };

    useStore.getState().setDiscoveryData(localData);
    expect(useStore.getState().appMode).toBe('local');
    expect(useStore.getState().discoveryData?.recommendations[0].url).toContain('C:/Music');
  });

  it('allows Aideo Discovery Hub page view in local appMode', () => {
    useStore.setState({ appMode: 'local', view: 'aideo' });
    expect(useStore.getState().appMode).toBe('local');
    expect(useStore.getState().view).toBe('aideo');
  });
});
