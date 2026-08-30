import { DiscoveryHubData, YoutubeTrack } from '../store/types';

export const TIDAL_SOURCE_LABEL = 'Tidal HiFi';
const DEFAULT_MAX_BLEND = 8;

/** Hybrid card shape: YoutubeTrack display fields + Tidal playback fields
 *  (format/path) consumed by renderTrackCarousel's play & download branches. */
export interface TidalHubTrack extends YoutubeTrack {
  path: string;
  format: 'Tidal FLAC';
  album?: string;
}

interface RawTidalResult {
  id: string | number;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  cover_url?: string;
  quality?: string;
}

const formatDuration = (secs?: number): string => {
  const s = Math.max(0, Math.floor(secs ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const signatureOf = (artist?: string | null, title?: string | null): string =>
  `${(artist || '').trim().toLowerCase()}::${(title || '').trim().toLowerCase()}`;

export function tidalResultsToHubTracks(results: RawTidalResult[]): TidalHubTrack[] {
  return (results || [])
    .filter(t => t.title && t.artist)
    .map(t => ({
      id: `tidal-${t.id}`,
      title: t.title!,
      artist: t.artist!,
      cover_url: t.cover_url || null,
      duration_raw: formatDuration(t.duration),
      url: String(t.id),
      path: String(t.id),
      format: 'Tidal FLAC',
      album: t.album,
      recommendation_source: TIDAL_SOURCE_LABEL,
    }));
}

function* hubShelves(data: DiscoveryHubData): Generator<YoutubeTrack[]> {
  yield data.recommendations || [];
  yield data.global_charts || [];
  yield data.recently_played || [];
  yield data.heavy_rotation || [];
  yield data.forgotten_gems || [];
}

/**
 * Merge deduped Tidal picks into the resolved hub:
 * - `tidal_hifi`: uncapped pool for its own shelf/tab
 * - `recommendations`: up to `maxBlend` picks interleaved evenly
 * Never mutates the input; never caches (caller decides persistence).
 */
export function mergeTidalIntoHub(
  hubData: DiscoveryHubData,
  tidalTracks: TidalHubTrack[],
  maxBlend: number = DEFAULT_MAX_BLEND,
): DiscoveryHubData & { tidal_hifi: TidalHubTrack[] } {
  const seen = new Set<string>();
  for (const shelf of hubShelves(hubData)) {
    for (const t of shelf) seen.add(signatureOf(t.artist, t.title));
  }

  const pool: TidalHubTrack[] = [];
  for (const t of tidalTracks || []) {
    const key = signatureOf(t.artist, t.title);
    if (!key.replace(/::/g, '')) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(t);
  }

  if (pool.length === 0) {
    return { ...hubData, tidal_hifi: [] };
  }

  const recs = [...(hubData.recommendations || [])];
  const blend = pool.slice(0, Math.max(0, maxBlend));
  const gap = Math.max(1, Math.ceil(recs.length / Math.max(1, blend.length)));

  const mergedRecs: YoutubeTrack[] = [];
  let b = 0;
  for (let i = 0; i < recs.length; i++) {
    mergedRecs.push(recs[i]);
    if (b < blend.length && (i + 1) % gap === 0) {
      mergedRecs.push(blend[b++]);
    }
  }
  while (b < blend.length) mergedRecs.push(blend[b++]);

  return { ...hubData, tidal_hifi: pool, recommendations: mergedRecs };
}
