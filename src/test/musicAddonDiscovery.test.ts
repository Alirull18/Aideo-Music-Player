import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import type { AddonInfo } from '../store/addonSlice';
import type { Track } from '../store/types';
import { filterMusicSource, musicAddons, musicSearchOptions } from '../utils/musicAddons';
import { AideoSearchBar, type SearchBarProps } from '../components/aideo/HomeParts';
import { SourceMenu } from '../components/SourceMenu';
import { boundedSearchSources, clearEnrichmentState } from '../store/sourcePlayback';

const addon = (id: string, resources = ['search', 'stream']): AddonInfo => ({ id, name: id, version: '1', origin: 'https://example.com', resources });
const installed = [addon('org.example.music'), addon('org.example.lyrics', ['lyrics']), addon('org.aideo.youtube'), addon('org.aideo.lyrics'), addon('org.aideo.translation'), { ...addon('org.example.builtin'), builtin: true }, addon('org.example.music')];
const seed: Track = { id: 1, path: 'C:/Music/seed.flac', title: 'Seed', artist: 'Artist', duration: 180, format: 'FLAC', lyric_offset: 0 };

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args: any) => {
    if (command === 'addon_search') return [{ id: `${args.addonId}:next`, title: 'Next', artist: 'Artist', duration: 180 }];
    if (command === 'get_recommendations') return { tracks: args.request.candidates, generation: args.request.generation, reasons: {} };
    return [];
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); }) });
  localStorage.clear();
  clearEnrichmentState();
  useStore.setState({ addons: installed, appMode: 'hybrid', recommendationEngine: 'our', currentTrack: seed,
    queue: [], tracks: [], autoplayEnabled: true, autoplaySeedTrack: null, autoplaySessionHistory: [],
    recentlyClearedAutoplayPaths: [], albumSession: null, stopBoundary: null, sourceRegistry: {},
    syncBackendQueue: vi.fn().mockResolvedValue(undefined), preCacheNextTracks: vi.fn().mockResolvedValue(undefined) });
});
afterEach(cleanup);

describe('installed music addon discovery', () => {
  it('accepts unique enabled search+stream addons, excluding lyrics-only entries, builtins and disabled addons', () => {
    expect(musicAddons(installed).map(a => a.id)).toEqual(['org.example.music']);
    expect(musicAddons([addon('org.example.search', ['search']), addon('org.example.stream', ['stream'])])).toEqual([]);
    expect(musicAddons([{ ...addon('org.example.off'), enabled: false }])).toEqual([]);
    expect(musicAddons([])).toEqual([]);
  });

  it('uses exact addon IDs for quick/full search options and result filters', () => {
    expect(musicSearchOptions('hybrid', installed, 'org.example.music')).toEqual({ youtube: false, addons: ['org.example.music'] });
    expect(musicSearchOptions('local', installed)).toEqual({ youtube: false, addons: [] });
    expect(musicSearchOptions('hybrid', installed, 'youtube')).toEqual({ youtube: true, addons: [] });
    const row = (id: string): Track => ({ ...seed, source_context: { recording_id: id, sources: [{ provider: 'addon', id }], selection: { mode: 'auto' } } });
    const rows = [row('org.example.music:1'), row('org.example.music-other:1')];
    expect(filterMusicSource(rows, 'org.example.music')).toEqual([rows[0]]);
    expect(filterMusicSource(rows, 'all')).toEqual(rows);
  });

  it('shows installed music addon filters and returns the addon ID when selected', () => {
    const onSourceChange = vi.fn();
    const props: SearchBarProps = { appMode: 'hybrid', query: '', onQueryChange: vi.fn(), focused: false,
      onFocusChange: vi.fn(), suggestions: [], quickResults: [], history: [], source: 'all', onSourceChange,
      onSubmit: vi.fn(), onPickQuery: vi.fn(), onDeleteHistory: vi.fn(), onPlayQuickTrack: vi.fn(), isSearching: false };
    const view = render(createElement(AideoSearchBar, { variant: 'column', props }));
    fireEvent.click(screen.getByRole('button', { name: 'org.example.music', hidden: true }));
    expect(onSourceChange).toHaveBeenCalledWith('org.example.music');
    expect(screen.queryByRole('button', { name: 'org.example.lyrics', hidden: true })).toBeNull();
    view.rerender(createElement(AideoSearchBar, { variant: 'column', props: { ...props, appMode: 'local' } }));
    expect(screen.queryByText('Source filter:', { exact: false })).toBeNull();
  });

  it('keys coalesced background searches by the normalized addon set', async () => {
    let finish!: (value: any[]) => void;
    const pending = new Promise<any[]>(resolve => { finish = resolve; });
    vi.mocked(invoke).mockImplementation(async command => command === 'addon_search' ? pending : []);
    const first = boundedSearchSources('Song', { youtube: false, addons: ['org.example.b', 'org.example.a'] });
    const same = boundedSearchSources('Song', { youtube: false, addons: ['org.example.a', 'org.example.b', 'org.example.a'] });
    const different = boundedSearchSources('Song', { youtube: false, addons: ['org.example.c'] });
    expect(same).toBe(first);
    expect(different).not.toBe(first);
    finish([]);
    await Promise.all([first, same, different]);
    expect(invoke).toHaveBeenCalledWith('addon_search', { addonId: 'org.example.c', query: 'Song' });
  });

  it.each(['hybrid', 'local'] as const)('source picker discovers only eligible addons in %s mode', async appMode => {
    useStore.setState({ appMode });
    render(createElement(SourceMenu, { track: seed, initialOpen: true }));
    await vi.waitFor(() => expect(screen.queryByText('Checking available copies...')).toBeNull());
    const searches = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'addon_search');
    expect(searches.map(([, args]: any) => args.addonId)).toEqual(appMode === 'local' ? [] : ['org.example.music']);
    if (appMode === 'local') expect(invoke).not.toHaveBeenCalledWith('search_youtube', expect.anything());
  });

  it.each(['hybrid', 'local'] as const)('radio uses addon_search candidates without a radio endpoint in %s mode', async appMode => {
    useStore.setState({ appMode });
    await useStore.getState().triggerAutoplayRadio(seed, true);
    const searches = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'addon_search');
    expect(searches.map(([, args]: any) => args.addonId)).toEqual(appMode === 'local' ? [] : ['org.example.music']);
    expect(vi.mocked(invoke).mock.calls.some(([command]) => /addon.*radio/.test(command))).toBe(false);
    if (appMode === 'hybrid') expect(useStore.getState().queue.some(t => t.path === 'org.example.music:next' && t.format === 'Addon')).toBe(true);
    else expect(invoke).not.toHaveBeenCalledWith('get_youtube_autoplay_recommendations', expect.anything());
  });
});
