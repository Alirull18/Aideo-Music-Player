import { sampleListening } from '../utils/recommendations';
import { createElement } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ListeningInsightsView } from '../components/ListeningInsightsView';
import { useStore } from '../store';
import type { ListeningInsightsPayload, Track } from '../store/types';

const track: Track = {
  id: 1, path: 'C:/Music/song.flac', title: 'Song', artist: 'Artist',
  duration: 240, format: 'FLAC', lyric_offset: 0,
};

describe('Insight recording IPC contract', () => {
  let payload: ListeningInsightsPayload;

  beforeEach(() => {
    vi.clearAllMocks();
    payload = {
      total_plays: 0, total_listening_time_secs: 0, skip_count: 0, skip_rate: 0,
      top_songs: [], top_artists: [], top_albums: [], top_genres: [],
      hourly_activity: [], daily_activity: [],
      audiophile_stats: {
        lossless_count: 0, hi_res_count: 0, bit_perfect_count: 0,
        total_analyzed: 0, avg_sample_rate: 96000,
      },
      source_distribution: [],
    };
    useStore.setState({
      currentTrack: null, currentHistoryId: null, autoplaySessionHistory: [],
      playback: { ...useStore.getState().playback, position_secs: 0, bit_perfect: true },
    });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const values = args as Record<string, unknown>;
      if (command === 'get_listening_insights') return structuredClone(payload);
      if (command === 'log_playback_start') {
        // Tauri deserializes this argument as Rust Option<i32>, not bool.
        if (values.bitPerfect !== 0 && values.bitPerfect !== 1) {
          throw new Error('invalid args: bitPerfect must be an integer');
        }
        payload.total_plays++;
        payload.audiophile_stats = {
          lossless_count: 1, hi_res_count: 1, bit_perfect_count: Number(values.bitPerfect),
          total_analyzed: 1, avg_sample_rate: 96000,
        };
        payload.source_distribution = [{ source: 'local', play_count: 1 }];
        return 11;
      }
      if (command === 'log_playback_end') {
        payload.total_listening_time_secs = Number(values.durationPlayed);
      }
      return undefined;
    });
  });

  afterEach(cleanup);

  it.each([true, false])('records playback with bit-perfect mode %s', async bitPerfect => {
    useStore.setState({ playback: { ...useStore.getState().playback, bit_perfect: bitPerfect } });
    await useStore.getState().recordPlaybackTransition(track);
    expect(useStore.getState().currentHistoryId).toBe(11);
    expect(payload.total_plays).toBe(1);
  });

  it('closes a delayed start row when a newer playback request is resolving', async () => {
    let releaseStart!: () => void;
    const start = new Promise<number>(resolve => { releaseStart = () => resolve(31); });
    let releaseQueue!: () => void;
    const queue = new Promise<void>(resolve => { releaseQueue = resolve; });
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'log_playback_start') return start;
      if (command === 'clear_queue') return queue;
      return null;
    });
    const abandoned = useStore.getState().recordPlaybackTransition(track);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('log_playback_start', expect.anything()));
    useStore.setState({ autoplayEnabled: false });
    const next = useStore.getState().playTrack({ ...track, path: 'next', title: 'Next' });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('clear_queue'));
    releaseStart();
    await abandoned;
    expect(useStore.getState().currentHistoryId).toBeNull();
    expect(invoke).toHaveBeenCalledWith('log_playback_end', expect.objectContaining({ historyId: 31, endReason: 'error' }));
    releaseQueue();
    await next;
  });

  it('refreshes the open dashboard after start and end using the backend payload', async () => {
    render(createElement(ListeningInsightsView));
    await screen.findByText('Your play log is empty');

    await act(async () => { await useStore.getState().recordPlaybackTransition(track); });
    await screen.findByText('100.0%');
    expect(screen.getByText('96.0 kHz')).toBeDefined();
    expect(screen.getByTitle('Local: 1')).toBeDefined();

    useStore.setState({
      currentTrack: track,
      playback: { ...useStore.getState().playback, position_secs: 120 },
    });
    let clock = 0;
    const time = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    sampleListening(11, 0, true);
    for (clock = 1000; clock <= 120000; clock += 1000) sampleListening(11, clock / 1000, true);
    time.mockRestore();
    await act(async () => { await useStore.getState().recordPlaybackTransition(null); });
    await screen.findByText('2 mins');
    expect(invoke).toHaveBeenCalledWith('log_playback_end', {
      historyId: 11, durationPlayed: 120, skipped: false, completionRate: null, endReason: 'stopped',
    });
    await waitFor(() => expect(useStore.getState().currentHistoryId).toBeNull());
  });
});
