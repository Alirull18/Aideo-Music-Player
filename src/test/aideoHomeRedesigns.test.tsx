import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { EditorialHome } from '../components/aideo/EditorialHome';
import { CommandDeckHome } from '../components/aideo/CommandDeckHome';
import { StageHome } from '../components/aideo/StageHome';
import { AideoHomeProps, SearchBarProps } from '../components/aideo/HomeParts';
import { DiscoveryHubData } from '../store/types';

const hub: DiscoveryHubData = {
  recommendations: [
    { id: 'r1', title: 'Harbour Lights', artist: 'Violet Era', cover_url: null, duration_raw: '3:42', url: 'https://example.com/r1' },
    { id: 'r2', title: 'Amber Static', artist: 'The Kiln', cover_url: null, duration_raw: '3:27', url: 'https://example.com/r2' },
  ],
  global_charts: [
    { id: 'c1', title: 'Copper Wires', artist: 'Red Meridian', cover_url: null, duration_raw: '4:10', url: 'D:\\music\\copper.flac' },
  ],
  mixed_for_you: [],
  recently_played: [
    { id: 'p1', title: 'Paper Planes at Dawn', artist: 'Marlow Fields', cover_url: null, duration_raw: '3:58', url: 'https://example.com/p1' },
  ],
  heavy_rotation: [],
  forgotten_gems: [],
  playlist_mixes: [],
  tidal_hifi: [
    { id: 't1', title: 'Slow Tide Radio', artist: 'Casimir Bluff', cover_url: null, duration_raw: '5:02', url: 'https://example.com/t1', format: 'Tidal FLAC' } as any,
  ],
};

const search: SearchBarProps = {
  query: '',
  onQueryChange: () => {},
  focused: false,
  onFocusChange: () => {},
  suggestions: [],
  quickResults: [],
  history: [],
  source: 'youtube',
  onSourceChange: () => {},
  tidalConnected: true,
  qobuzEnabled: false,
  qobuzConnected: false,
  onSubmit: () => {},
  onPickQuery: () => {},
  onDeleteHistory: () => {},
  onPlayQuickTrack: () => {},
  isSearching: false,
};

const baseProps: AideoHomeProps = {
  greeting: 'Good evening',
  trackCount: 1284,
  totalPlays: 9412,
  discoveryData: hub,
  isLoadingRecs: false,
  isRefreshingRecs: false,
  onRefreshRecs: () => {},
  onPlayTrack: () => {},
  renderDownloadAction: () => null,
  resume: {
    title: 'Paper Planes at Dawn',
    artist: 'Marlow Fields',
    positionLabel: 'paused at 1:12',
    coverUrl: null,
    onResume: () => {},
    onDismiss: () => {},
  },
  search,
};

describe('Aideo home redesigns render suite', () => {
  beforeEach(() => {
    cleanup();
  });

  it('Editorial Feed renders masthead, shelves and history rows', () => {
    const { getByText } = render(<EditorialHome {...baseProps} />);
    expect(getByText('Made for Your Taste')).toBeTruthy();
    expect(getByText('Lossless Picks')).toBeTruthy();
    expect(getByText('Pick up where you left off')).toBeTruthy();
    expect(getByText('Harbour Lights')).toBeTruthy();
    expect(getByText('1,284')).toBeTruthy();
  });

  it('Command Deck renders rail, feed tabs and reason column', () => {
    const { getByText, getAllByText } = render(<CommandDeckHome {...baseProps} />);
    expect(getByText('Command Deck')).toBeTruthy();
    expect(getByText('Discovery feed')).toBeTruthy();
    expect(getByText('Track')).toBeTruthy();
    expect(getByText('Reason')).toBeTruthy();
    expect(getAllByText('Harbour Lights').length).toBeGreaterThan(0);
    expect(getByText('Radar Spotlight')).toBeTruthy();
    expect(getByText('STUDIO CONSOLE · COMMAND DECK')).toBeTruthy();
  });

  it('Ambient Stage renders hero, grouped feed and recently played strip', () => {
    const { getAllByText, getByText } = render(<StageHome {...baseProps} />);
    expect(getByText('Discovery')).toBeTruthy();
    expect(getByText('Lossless Picks')).toBeTruthy();
    expect(getByText('Recently played')).toBeTruthy();
    expect(getByText('Slow Tide Radio')).toBeTruthy();
    expect(getAllByText('Paper Planes at Dawn').length).toBeGreaterThan(0);
  });

  it('All designs show the resume prompt when a paused session exists', () => {
    for (const Home of [EditorialHome, CommandDeckHome, StageHome]) {
      cleanup();
      const { getByText } = render(<Home {...baseProps} />);
      expect(getByText(/Resume/)).toBeTruthy();
    }
  });

  it('Designs degrade gracefully with an empty discovery hub', () => {
    const empty: AideoHomeProps = { ...baseProps, discoveryData: null, resume: null };
    for (const Home of [EditorialHome, CommandDeckHome, StageHome]) {
      cleanup();
      const { getByText } = render(<Home {...empty} />);
      expect(getByText(/Good evening/)).toBeTruthy();
    }
  });

  it('Ambient Stage discovery rows are playable (regression: invisible play button, dead rows)', () => {
    const onPlayTrack = vi.fn();
    const { getByText } = render(<StageHome {...baseProps} onPlayTrack={onPlayTrack} />);
    fireEvent.click(getByText('Harbour Lights').closest('.ah-row') as HTMLElement);
    expect(onPlayTrack).toHaveBeenCalledTimes(1);
    expect(onPlayTrack.mock.calls[0][0].title).toBe('Harbour Lights');
  });

  it('Editorial history rows are playable from the row itself', () => {
    const onPlayTrack = vi.fn();
    const { getAllByText } = render(<EditorialHome {...baseProps} onPlayTrack={onPlayTrack} />);
    const rowTitle = getAllByText('Paper Planes at Dawn').find(el => el.className === 'ah-row-title')!;
    fireEvent.click(rowTitle.closest('.ah-row') as HTMLElement);
    expect(onPlayTrack).toHaveBeenCalledTimes(1);
  });

  it('Command Deck stream rows and spotlight cards are playable from click', () => {
    const onPlayTrack = vi.fn();
    const { getAllByText } = render(<CommandDeckHome {...baseProps} onPlayTrack={onPlayTrack} />);
    const rowTitle = getAllByText('Harbour Lights').find(el => el.className === 'ah-row-title')!;
    fireEvent.click(rowTitle.closest('.ah-trow') as HTMLElement);
    expect(onPlayTrack).toHaveBeenCalledTimes(1);
    expect(onPlayTrack.mock.calls[0][0].title).toBe('Harbour Lights');
  });
});
