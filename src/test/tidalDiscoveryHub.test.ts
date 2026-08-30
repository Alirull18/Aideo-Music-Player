import { describe, it, expect } from 'vitest';
import {
  TIDAL_SOURCE_LABEL,
  tidalResultsToHubTracks,
  mergeTidalIntoHub,
  TidalHubTrack,
} from '../utils/tidalHub';
import { buildUnifiedTabs, getUnifiedTabTracks } from '../utils/discoveryFeed';
import { DiscoveryHubData, YoutubeTrack } from '../store/types';

const isTidal = (t: YoutubeTrack): boolean => (t as TidalHubTrack).format === 'Tidal FLAC';

const yt = (id: string, title: string, artist: string): YoutubeTrack => ({
  id,
  title,
  artist,
  cover_url: null,
  duration_raw: '3:30',
  url: `https://youtube.com/watch?v=${id}`,
});

const hub = (overrides: Partial<DiscoveryHubData> = {}): DiscoveryHubData => ({
  recommendations: [yt('r1', 'Alpha', 'One'), yt('r2', 'Beta', 'Two'), yt('r3', 'Gamma', 'Three')],
  global_charts: [yt('c1', 'Chart Hit', 'Chart Artist')],
  mixed_for_you: [],
  recently_played: [],
  heavy_rotation: [],
  forgotten_gems: [],
  ...overrides,
});

const tidalRaw = (id: string, title: string, artist: string, duration = 210) => ({
  id,
  title,
  artist,
  album: 'Album',
  duration,
  cover_url: 'http://cover/img.jpg',
  quality: 'LOSSLESS',
});

describe('tidalResultsToHubTracks', () => {
  it('maps raw Tidal results to hub-card shape with Tidal FLAC format', () => {
    const [t] = tidalResultsToHubTracks([tidalRaw('77', 'Northern Lights', 'Aurora', 245)]);
    expect(isTidal(t)).toBe(true);
    expect(t.path).toBe('77');
    expect(t.title).toBe('Northern Lights');
    expect(t.artist).toBe('Aurora');
    expect(t.recommendation_source).toBe(TIDAL_SOURCE_LABEL);
    expect(t.duration_raw).toBe('4:05');
    expect(t.cover_url).toBe('http://cover/img.jpg');
  });

  it('produces unique ids so React keys never collide with other sources', () => {
    const tracks = tidalResultsToHubTracks([tidalRaw('77', 'A', 'X'), tidalRaw('88', 'B', 'Y')]);
    const ids = new Set(tracks.map(t => t.id));
    expect(ids.size).toBe(2);
  });
});

describe('mergeTidalIntoHub', () => {
  it('adds uncapped tidal_hifi shelf and blends at most maxBlend picks into recommendations', () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      tidalResultsToHubTracks([tidalRaw(String(i), `Song ${i}`, `Artist ${i}`)])[0]
    );
    const merged = mergeTidalIntoHub(hub(), pool, 8);

    expect(merged.tidal_hifi).toHaveLength(12);
    const blended = merged.recommendations.filter(t => isTidal(t));
    expect(blended.length).toBeLessThanOrEqual(8);
    expect(blended.length).toBeGreaterThan(0);
  });

  it('never duplicates a track already present in any hub shelf or within the pool itself', () => {
    const pool = [
      tidalResultsToHubTracks([tidalRaw('1', 'Alpha', 'One')])[0],      // duplicate of recommendations[0] (case-insensitive match)
      tidalResultsToHubTracks([tidalRaw('2', 'chart hit', 'chart artist')])[0], // duplicate of global_charts
      tidalResultsToHubTracks([tidalRaw('3', 'Fresh', 'New')])[0],
      tidalResultsToHubTracks([tidalRaw('4', 'FRESH', 'NEW')])[0],      // self-duplicate
    ];
    const merged = mergeTidalIntoHub(hub(), pool, 8);

    expect(merged.tidal_hifi).toHaveLength(1);
    expect(merged.tidal_hifi![0].title).toBe('Fresh');

    const allTitles = merged.recommendations.map(t => t.title.toLowerCase());
    expect(new Set(allTitles).size).toBe(allTitles.length);
  });

  it('preserves original recommendation order while interleaving the blend', () => {
    const pool = [
      tidalResultsToHubTracks([tidalRaw('9', 'Tide One', 'Sea')])[0],
      tidalResultsToHubTracks([tidalRaw('8', 'Tide Two', 'Ocean')])[0],
    ];
    const merged = mergeTidalIntoHub(hub(), pool, 8);
    const originals = merged.recommendations.filter(t => !isTidal(t));
    expect(originals.map(t => t.id)).toEqual(['r1', 'r2', 'r3']);
    expect(merged.recommendations.length).toBe(5);
  });

  it('is a no-op for recommendations when the tidal pool is empty', () => {
    const base = hub();
    const merged = mergeTidalIntoHub(base, []);
    expect(merged.recommendations).toEqual(base.recommendations);
    expect(buildUnifiedTabs(merged).some(t => t.id === 'tidal')).toBe(false);
  });

  it('does not mutate the input hub object', () => {
    const base = hub();
    const snapshot = JSON.stringify(base);
    mergeTidalIntoHub(base, [tidalResultsToHubTracks([tidalRaw('1', 'X', 'Y')])[0]]);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe('unified feed Tidal HiFi tab', () => {
  it('exposes a Tidal HiFi tab only when tidal_hifi has content', () => {
    const withTidal = mergeTidalIntoHub(hub(), [tidalResultsToHubTracks([tidalRaw('1', 'Deep', 'Blue')])[0]]);
    const tabs = buildUnifiedTabs(withTidal);
    const tidalTab = tabs.find(t => t.id === 'tidal');
    expect(tidalTab).toBeDefined();
    expect(tidalTab!.label).toBe('Tidal HiFi');
    expect(tidalTab!.count).toBe(1);

    expect(getUnifiedTabTracks(withTidal, 'tidal')).toHaveLength(1);
  });

  it('includes tidal picks in the All For You merged feed without duplicates', () => {
    const withTidal = mergeTidalIntoHub(hub(), [
      tidalResultsToHubTracks([tidalRaw('1', 'Deep', 'Blue')])[0],
      tidalResultsToHubTracks([tidalRaw('2', 'Shore', 'Sand')])[0],
    ]);
    const all = getUnifiedTabTracks(withTidal, 'all');
    const sigs = all.map(t => `${(t.artist || '').toLowerCase()}::${(t.title || '').toLowerCase()}`);
    expect(new Set(sigs).size).toBe(sigs.length);
    expect(all.some(t => isTidal(t))).toBe(true);
  });
});
