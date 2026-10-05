import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AideoView } from '../components/AideoView';
import { useStore, type Track } from '../store';
import { hubContext, hubTrack } from '../utils/recommendationHub';

const initialState = useStore.getState();
const track: Track = { id: 1, path: 'C:/Music/stable.flac', title: 'Stable Song', artist: 'Artist', duration: 180, format: 'FLAC', lyric_offset: 0 };
const hub = { recommendations: [hubTrack(track)], global_charts: [], mixed_for_you: [] };

describe('Discovery refresh boundaries', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(listen).mockResolvedValue(() => {});
    useStore.setState({ ...initialState, tracks: [track], playCounts: {}, playHistory: [], discoveryData: null,
      aideoPageDesign: 'classic', appMode: 'local', recommendationEngine: 'our', autoplayDiscoveryLevel: 'balanced',
      activeDiscoveryTab: 'all', discoveryLayout: 'unified', discoveryViewMode: 'grid', isLoadingRecs: false });
    vi.mocked(invoke).mockReset().mockImplementation(async (command, args: any) => {
      if (command === 'get_personalized_discovery_hub') return hub;
      if (command === 'get_recommendations') return { tracks: args.request.candidates, generation: args.request.generation, reasons: {} };
      return null;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    useStore.setState(initialState, true);
  });

  it('does not invalidate an in-flight hub request when listening counts change', () => {
    const state = useStore.getState();
    expect(hubContext({ ...state, playCounts: { [track.path]: 1 } }, 0)).toBe(hubContext(state, 0));
    expect(hubContext(state, 1)).not.toBe(hubContext(state, 0));
    expect(hubContext({ ...state, appMode: 'hybrid' }, 0)).not.toBe(hubContext(state, 0));
  });

  it('keeps the visible feed and selected tab stable after playing a Discovery song', async () => {
    const play = vi.spyOn(useStore.getState(), 'playTrack').mockImplementation(async playing => {
      useStore.setState({ currentTrack: playing, playCounts: { [playing.path]: 1 } });
      window.dispatchEvent(new Event('playback-history-updated'));
    });
    const { container } = render(createElement(AideoView));
    const refresh = await screen.findByTitle('Re-run discovery algorithm');
    await waitFor(() => expect(refresh).toBeEnabled());
    const data = useStore.getState().discoveryData;
    act(() => useStore.getState().setActiveDiscoveryTab('recs'));
    vi.useFakeTimers();
    const playButton = container.querySelector('.discovery-grid-play-circle');
    expect(playButton).not.toBeNull();
    await act(async () => { fireEvent.click(playButton!); });
    expect(play).toHaveBeenCalledOnce();
    await act(async () => {
      window.dispatchEvent(new Event('playback-history-updated'));
      await vi.advanceTimersByTimeAsync(10001);
    });
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_personalized_discovery_hub')).toHaveLength(1);
    expect(useStore.getState().discoveryData).toBe(data);
    expect(useStore.getState().activeDiscoveryTab).toBe('recs');
    expect(refresh).toBeEnabled();
  });

  it('still rebuilds for manual refresh, explicit feedback, and recommendation settings', async () => {
    render(createElement(AideoView));
    const refresh = await screen.findByTitle('Re-run discovery algorithm');
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
    await waitFor(() => expect(refresh).toBeEnabled());
    act(() => { window.dispatchEvent(new Event('recommendation-feedback-updated')); });
    await waitFor(() => expect(refresh).toBeEnabled());
    act(() => useStore.setState({ autoplayDiscoveryLevel: 'discovery' }));
    await waitFor(() => expect(refresh).toBeEnabled());
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_personalized_discovery_hub')).toHaveLength(4);
  });
});
