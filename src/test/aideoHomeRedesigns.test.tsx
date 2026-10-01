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




  it('resumes the paused session from each home layout', () => {
    for (const Home of [EditorialHome, CommandDeckHome, StageHome]) {
      cleanup();
      const onResume = vi.fn();
      const { container } = render(<Home {...baseProps} resume={{ ...baseProps.resume!, onResume }} />);
      const resumeButton = container.querySelector('.ah-resume-btn, .ah-deck-resume-btn, .ah-resume-card .ah-play-btn');
      fireEvent.click(resumeButton!);
      expect(onResume).toHaveBeenCalledTimes(1);
    }
  });


  it('Ambient Stage discovery rows are playable (regression: invisible play button, dead rows)', () => {
    const onPlayTrack = vi.fn();
    const { getAllByText } = render(<StageHome {...baseProps} onPlayTrack={onPlayTrack} />);
    const rowTitle = getAllByText('Harbour Lights').find(el => el.className === 'ah-row-title')!;
    fireEvent.click(rowTitle.closest('.ah-row') as HTMLElement);
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

  it('Editorial Feed renders Cover Story lead feature and publication masthead folio', () => {
    const onPlayTrack = vi.fn();
    const { getByText } = render(<EditorialHome {...baseProps} onPlayTrack={onPlayTrack} />);
    expect(getByText(/Listen Now/i)).toBeTruthy();

    fireEvent.click(getByText(/Listen Now/i));
    expect(onPlayTrack).toHaveBeenCalledTimes(1);
    expect(onPlayTrack.mock.calls[0][0].title).toBe('Harbour Lights');
  });

  it('plays a track from the filtered lossless category', () => {
    const onPlayTrack = vi.fn();
    const { getByRole, getAllByText } = render(<StageHome {...baseProps} onPlayTrack={onPlayTrack} />);
    fireEvent.click(getByRole('button', { name: 'Lossless' }));
    const rowTitle = getAllByText('Slow Tide Radio').find(el => el.className === 'ah-row-title')!;
    fireEvent.click(rowTitle.closest('.ah-row') as HTMLElement);
    expect(onPlayTrack.mock.calls[0][0].title).toBe('Slow Tide Radio');
  });
});

