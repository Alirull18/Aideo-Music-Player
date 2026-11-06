import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  applySourcePreference,
  clearSourceCache,
  deduplicateSourcesForDisplay,
  registerAddonNames,
  resolveSource,
  searchSources,
  sourceFor,
  sourceName,
} from '../utils/unifiedSources';

const ADDON = 'com.test.mock';
const addonTrack = {
  id: `${ADDON}:t1`, title: 'Song', artist: 'Artist', album: 'Album', duration: 200,
  cover_url: null, recording_evidence: { isrc: 'USRC12345678' }, catalog_quality: { lossless: true },
};

describe('Eclipse addon sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSourceCache();
  });

  it('searches an installed addon via addon_search and maps results to addon sources', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'addon_search') return [addonTrack];
      return [];
    });
    const result = await searchSources('song', { youtube: false, addons: [ADDON] }, () => {});
    expect(invoke).toHaveBeenCalledWith('addon_search', { addonId: ADDON, query: 'song' });
    const track = result.tracks.find(t => t.format === 'Addon');
    expect(track?.path).toBe(`${ADDON}:t1`);
    expect(sourceFor(track!)).toMatchObject({ provider: 'addon', id: `${ADDON}:t1` });
    expect(sourceName(sourceFor(track!)!)).toBe('Addon');
  });

  it('a failing addon reports an error without losing other providers', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'addon_search') throw new Error('Addon timed out');
      return [];
    });
    const result = await searchSources('song', { youtube: false, addons: [ADDON] }, () => {});
    expect(result.errors[`addon:${ADDON}`]).toContain('Addon timed out');
    expect(result.pending).toEqual([]);
  });

  it('resolves through the dynamic addon_resolve_source command', async () => {
    vi.mocked(invoke).mockResolvedValue({ url: 'https://cdn.example/x.flac', quality: { lossless: true } });
    const out = await resolveSource({ provider: 'addon', id: `${ADDON}:t1` }, 'best_available');
    expect(invoke).toHaveBeenCalledWith('addon_resolve_source', { trackId: `${ADDON}:t1`, requestedQuality: 'best_available' });
    expect(out.url).toBe('https://cdn.example/x.flac');
  });

  it('applySourcePreference keeps valid addon sources and drops contexts with dotless addon ids', () => {
    const track = (id: string) => ({
      id: -1, path: id, format: 'Addon', title: 'S', artist: 'A', lyric_offset: 0,
      source_context: {
        recording_id: 'r1', selection: { mode: 'auto' as const },
        sources: [{ provider: 'addon' as const, id }, { provider: 'youtube' as const, id: 'abcdefghijk' }],
      },
    }) as any;
    expect(applySourcePreference(track(`${ADDON}:t1`)).source_context).toBeDefined();
    expect(applySourcePreference(track('nodot:t1')).source_context).toBeUndefined();
  });

  it('a drive-letter path is a local source, never an addon source', () => {
    const local = sourceFor({ id: 1, path: 'C:/Music/a.flac', format: 'FLAC' } as any);
    expect(local?.provider).toBe('local');
    expect(sourceFor({ id: -1, path: 'C:/Music/a.flac', format: 'Addon' } as any)).toBeNull();
  });

  it('registerAddonNames formats sourceName as Addon (<Name>) when registered and resets on clearSourceCache', () => {
    const tidalSource = { provider: 'addon' as const, id: 'org.aideo.tidal:12345' };
    expect(sourceName(tidalSource)).toBe('Addon');

    registerAddonNames([
      { id: 'org.aideo.tidal', name: 'Tidal', builtin: false },
      { id: 'org.aideo.builtin', name: 'BuiltIn', builtin: true },
    ]);
    expect(sourceName(tidalSource)).toBe('Addon (Tidal)');

    clearSourceCache();
    expect(sourceName(tidalSource)).toBe('Addon');
  });

  it('deduplicateSourcesForDisplay keeps independent 4-track quotas for distinct addon IDs', () => {
    const makeAddonSources = (addonId: string) =>
      [1, 2, 3, 4, 5].map((i) => ({
        provider: 'addon' as const,
        id: `${addonId}:${i}`,
        metadata: {
          title: 'Song',
          artist: 'Artist',
          album: `Album Edition ${i}`,
          duration: 200,
        },
        catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 },
      }));

    const combined = [
      ...makeAddonSources('org.aideo.tidal'),
      ...makeAddonSources('org.aideo.qobuz'),
    ];
    const deduped = deduplicateSourcesForDisplay(combined);
    const tidalCount = deduped.filter((s) => s.id.startsWith('org.aideo.tidal:')).length;
    const qobuzCount = deduped.filter((s) => s.id.startsWith('org.aideo.qobuz:')).length;

    expect(tidalCount).toBe(4);
    expect(qobuzCount).toBe(4);
    expect(deduped).toHaveLength(8);
  });
});
