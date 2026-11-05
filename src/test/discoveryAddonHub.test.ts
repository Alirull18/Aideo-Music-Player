import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AideoView } from '../components/AideoView';
import { useStore, type Track } from '../store';
import type { AddonInfo } from '../store/addonSlice';
import { addonHubTracks, hubContext, hubTrack } from '../utils/recommendationHub';
import { discoveryTrack } from '../utils/discoveryFeed';
import { enabledAddonKey } from '../utils/musicAddons';

const initialState = useStore.getState();
const track: Track = { id: 1, path: 'C:/Music/stable.flac', title: 'Stable Song', artist: 'Artist', duration: 180, format: 'FLAC', lyric_offset: 0 };
const hub = { recommendations: [hubTrack(track)], global_charts: [], mixed_for_you: [] };
const addon = (id: string, extra: Partial<AddonInfo> = {}): AddonInfo => ({ id, name: id, version: '1', origin: 'http://127.0.0.1:1', resources: ['search', 'stream'], ...extra });
const on = addon('org.example.music');
const off = addon('org.example.off', { enabled: false });
const found = { id: 'org.example.music:next', title: 'Next', artist: 'Artist', album: 'Album', duration: 200, catalog_quality: { lossless: true } };

describe('Discovery hub addon feed', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(listen).mockResolvedValue(() => {});
    useStore.setState({ ...initialState, tracks: [track], playCounts: {}, playHistory: [], discoveryData: null, addons: [on, off],
      aideoPageDesign: 'classic', appMode: 'hybrid', recommendationEngine: 'our', autoplayDiscoveryLevel: 'balanced',
      activeDiscoveryTab: 'all', discoveryLayout: 'unified', discoveryViewMode: 'grid', isLoadingRecs: false });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useStore.setState(initialState, true);
  });

  const mockBackend = (addonSearch: (args: any) => Promise<any>) => vi.mocked(invoke).mockReset().mockImplementation(async (command, args: any) => {
    if (command === 'get_personalized_discovery_hub') return hub;
    if (command === 'get_recommendations') return { tracks: args.request.candidates, generation: args.request.generation, reasons: {} };
    if (command === 'addon_search') return addonSearch(args);
    return null;
  });
  const searched = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'addon_search').map(([, args]) => args);

  it('puts enabled addon tracks in the hub and keeps them through ranking', async () => {
    mockBackend(async () => [found]);
    render(createElement(AideoView));
    await waitFor(() => expect(useStore.getState().discoveryData?.tidal_hifi?.map(t => t.path)).toEqual(['org.example.music:next']));
    expect(useStore.getState().discoveryData?.tidal_hifi?.[0].format).toBe('Addon');
    expect(searched()).toEqual([{ addonId: 'org.example.music', query: 'Artist' }]);
  });

  it('makes no addon search in local mode', async () => {
    useStore.setState({ appMode: 'local' });
    mockBackend(async () => [found]);
    render(createElement(AideoView));
    expect(await screen.findByTitle('Re-run discovery algorithm')).toBeEnabled();
    await waitFor(() => expect(useStore.getState().discoveryData).not.toBeNull());
    expect(searched()).toEqual([]);
  });

  it('still loads the hub when an addon search fails', async () => {
    mockBackend(async () => { throw new Error('addon down'); });
    render(createElement(AideoView));
    await waitFor(() => expect(useStore.getState().discoveryData?.recommendations.length).toBeGreaterThan(0));
    expect(useStore.getState().discoveryData?.tidal_hifi).toEqual([]);
  });

  it('dedupes, caps, and skips disabled addons', async () => {
    const search = vi.fn(async (_addonId: string, query: string) => Array.from({ length: 8 }, (_, i) => ({ ...found, id: `org.example.music:${query}${i}`, title: `${query} ${i}` })));
    const tracks = await addonHubTracks([on, off], ['A', 'B', 'C', 'D'], search, 10);
    expect(tracks).toHaveLength(10);
    expect(new Set(tracks.map(t => t.path)).size).toBe(10);
    expect(search.mock.calls.map(([id, query]) => `${id}:${query}`)).toEqual(['org.example.music:A', 'org.example.music:B', 'org.example.music:C']);
  });

  it('shares the cap between addons instead of letting the first one fill it', async () => {
    const two = addon('org.example.two');
    const search = async (addonId: string, query: string) => Array.from({ length: 8 }, (_, i) => ({ ...found, id: `${addonId}:${query}${i}`, title: `${addonId} ${query} ${i}` }));
    const tracks = await addonHubTracks([on, two], ['A', 'B'], search, 6);
    expect(tracks).toHaveLength(6);
    expect(new Set(tracks.map(t => (t.path ?? '').split(':')[0]))).toEqual(new Set(['org.example.music', 'org.example.two']));
  });

  it('keeps addon quality and provider through discoveryTrack', async () => {
    const [hubItem] = await addonHubTracks([on], ['Artist'], async () => [found]);
    const playable = discoveryTrack(hubItem);
    expect(playable.format).toBe('Addon');
    expect(playable.path).toBe('org.example.music:next');
    expect(playable.catalog_quality?.lossless).toBe(true);
  });

  it('changes the hub context when the enabled addon set changes', () => {
    const state = useStore.getState();
    expect(enabledAddonKey([on, off])).toBe('org.example.music');
    expect(hubContext({ ...state, addons: [on, addon('org.example.two')] }, 0)).not.toBe(hubContext(state, 0));
    expect(hubContext({ ...state, addons: [on, addon('org.example.off', { enabled: false })] }, 0)).toBe(hubContext(state, 0));
  });
});
