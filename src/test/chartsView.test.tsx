import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { ChartsView } from '../components/ChartsView';
import { useStore } from '../store';
import type { ChartPage } from '../utils/charts';

const page: ChartPage = {
  source: 'lastfm',
  source_label: 'Last.fm',
  scope_label: 'Worldwide',
  period_label: 'Current popularity',
  updated_at: null,
  offset: 0,
  limit: 20,
  total: null,
  has_more: false,
  fallback: null,
  entries: [
    {
      chart_id: 'lastfm:1:signal-artist:signal-song',
      rank: 1,
      title: 'Signal Song',
      artist: 'Signal Artist',
      artwork_url: null,
      previous_rank: 3,
      weeks_on_chart: 7,
      listen_count: 2450000,
      recording_mbid: null,
      playback_track: {
        id: 'video-1',
        title: 'Signal Song',
        artist: 'Signal Artist',
        cover_url: null,
        duration_raw: '3:21',
        url: 'https://youtube.test/signal-song',
        recommendation_source: 'Last.fm chart',
      },
    },
    {
      chart_id: 'lastfm:2:archive-artist:archive-song',
      rank: 2,
      title: 'Archive Song',
      artist: 'Archive Artist',
      artwork_url: null,
      previous_rank: null,
      weeks_on_chart: null,
      listen_count: 1200000,
      recording_mbid: null,
      playback_track: null,
    },
  ],
};

describe('ChartsView', () => {
  const playStream = vi.fn().mockResolvedValue(undefined);
  const addToQueue = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(invoke).mockResolvedValue(page);
    useStore.setState({ playStream, addToQueue });
  });

  it('renders published ranks even when a track has no playback match', async () => {
    render(<ChartsView />);

    expect(await screen.findByText('Signal Song')).toBeInTheDocument();
    expect(screen.getByText('Archive Song')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play Signal Song' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Playback unavailable for Archive Song' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Play Signal Song' }));
    await waitFor(() => {
      expect(playStream).toHaveBeenCalledWith(
        'https://youtube.test/signal-song',
        expect.objectContaining({ title: 'Signal Song', duration: 201 }),
      );
    });
  });

  it('clears Last.fm filters when a fixed-scope provider is selected', async () => {
    render(<ChartsView />);
    await screen.findByText('Signal Song');

    fireEvent.click(screen.getByRole('tab', { name: 'Billboard' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenLastCalledWith('get_worldwide_leaderboard', {
        genre: '',
        country: null,
        source: 'billboard',
        range: null,
        offset: 0,
        limit: 20,
      });
    });
  });

  it('plays and queues only available entries in published rank order', async () => {
    localStorage.setItem('aideo-charts-source', 'listenbrainz');
    vi.mocked(invoke).mockResolvedValue({
      ...page,
      source: 'listenbrainz',
      source_label: 'ListenBrainz',
      entries: [
        page.entries[0],
        page.entries[1],
        {
          ...page.entries[0],
          chart_id: 'listenbrainz:3:third-artist:third-song',
          rank: 3,
          title: 'Third Song',
          artist: 'Third Artist',
          playback_track: {
            ...page.entries[0].playback_track!,
            id: 'video-3',
            url: 'https://youtube.test/third-song',
          },
        },
      ],
    });

    render(<ChartsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play chart · 2' }));

    await waitFor(() => expect(addToQueue).toHaveBeenCalledTimes(1));
    expect(playStream).toHaveBeenCalledWith(
      'https://youtube.test/signal-song',
      expect.objectContaining({ title: 'Signal Song' }),
    );
    expect(addToQueue).toHaveBeenCalledWith(expect.objectContaining({
      path: 'https://youtube.test/third-song',
      title: 'Third Song',
      id: 3,
    }));
  });
});
