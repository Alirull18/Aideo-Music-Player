import { createElement } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AideoView } from '../components/AideoView';
import { useStore, type Track } from '../store';
import { hubHasOnlineTracks } from '../utils/recommendationHub';

const initialState = useStore.getState();
const local = (id: number): Track => ({ id, path: `C:/Music/Local ${id}.flac`, title: `Local ${id}`, artist: 'Kora', duration: 180, format: 'FLAC', lyric_offset: 0 });
const library = [local(1), local(2), local(3)];
const online = (id: string) => ({ id, title: `Online ${id}`, artist: 'Someone New', cover_url: '', duration_raw: '3:00', url: `https://www.youtube.com/watch?v=${id}`, recommendation_source: 'From Kora' });
const cachedHub = { recommendations: [online('aaaaaaaaaaa'), online('bbbbbbbbbbb')], global_charts: [online('ccccccccccc')], mixed_for_you: [] };
const toasts: string[] = [];
const collect = (event: Event) => toasts.push((event as CustomEvent).detail.message);

describe('Discovery hub when the online refresh fails', () => {
  beforeEach(() => {
    localStorage.clear();
    toasts.length = 0;
    window.addEventListener('ui-toast', collect);
    vi.mocked(listen).mockResolvedValue(() => {});
    useStore.setState({ ...initialState, tracks: library, playCounts: {}, playHistory: [], discoveryData: null, addons: [],
      aideoPageDesign: 'classic', appMode: 'hybrid', recommendationEngine: 'our', autoplayDiscoveryLevel: 'balanced',
      activeDiscoveryTab: 'all', discoveryLayout: 'unified', discoveryViewMode: 'grid', isLoadingRecs: false });
  });

  afterEach(() => {
    window.removeEventListener('ui-toast', collect);
    cleanup();
    vi.restoreAllMocks();
    useStore.setState(initialState, true);
  });

  const mockBackend = (cache: unknown) => vi.mocked(invoke).mockReset().mockImplementation(async (command, args: any) => {
    if (command === 'get_personalized_discovery_hub') throw new Error('Recommendation deadline exceeded');
    if (command === 'get_cached_discovery_hub') return cache;
    if (command === 'get_recommendations') return { tracks: args.request.candidates, generation: args.request.generation, reasons: {} };
    return null;
  });
  const urls = () => (useStore.getState().discoveryData?.recommendations || []).map(t => t.url || t.path || '');

  it('shows the last online recommendations instead of relabelling the library', async () => {
    mockBackend(cachedHub);
    render(createElement(AideoView));
    await waitFor(() => expect(urls().some(u => u.startsWith('https://'))).toBe(true));
    expect(urls().some(u => u.startsWith('https://www.youtube.com/watch?v=aaaaaaaaaaa'))).toBe(true);
    await waitFor(() => expect(toasts).toContain('Could not reach online sources. Showing your last online recommendations.'));
  });

  it('says so when it can only show the library', async () => {
    mockBackend(null);
    render(createElement(AideoView));
    await waitFor(() => expect(urls().length).toBeGreaterThan(0));
    expect(urls().every(u => !u.startsWith('http'))).toBe(true);
    await waitFor(() => expect(toasts).toContain('Could not load online recommendations. Showing your library for now.'));
  });

  it('ignores a cache that holds only local tracks', async () => {
    mockBackend({ recommendations: library.map(t => ({ id: String(t.id), title: t.title, artist: t.artist, path: t.path, url: t.path })), global_charts: [], mixed_for_you: [] });
    render(createElement(AideoView));
    await waitFor(() => expect(toasts).toContain('Could not load online recommendations. Showing your library for now.'));
  });

  it('stays quiet in Local mode, where the library is the whole point', async () => {
    useStore.setState({ appMode: 'local' });
    mockBackend(null);
    render(createElement(AideoView));
    await waitFor(() => expect(urls().length).toBeGreaterThan(0));
    expect(toasts.filter(m => m.startsWith('Could not'))).toEqual([]);
  });
});

describe('hubHasOnlineTracks', () => {
  it('looks at every shelf, including mixes', () => {
    expect(hubHasOnlineTracks(null)).toBe(false);
    expect(hubHasOnlineTracks({ recommendations: [], global_charts: [], mixed_for_you: [] })).toBe(false);
    expect(hubHasOnlineTracks({ recommendations: [], global_charts: [online('ddddddddddd')], mixed_for_you: [] } as any)).toBe(true);
    expect(hubHasOnlineTracks({ recommendations: [], global_charts: [], mixed_for_you: [{ id: 'm', title: 'Mix', tracks: [online('eeeeeeeeeee')] }] } as any)).toBe(true);
  });
});
