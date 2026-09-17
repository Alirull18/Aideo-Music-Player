import { DiscoveryHubData, Track, YoutubeTrack } from '../store/types';
import { catalogTrack, groupRecordings, isMusicTrack, sourceFor, sourceKey, sourceSearchQuery } from './unifiedSources';

export function discoveryTrack(track: YoutubeTrack): Track {
  const path = track.path || track.url;
  const local = /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path);
  const provider = track.format === 'Tidal FLAC' ? 'tidal' : track.format === 'Qobuz FLAC' ? 'qobuz' : 'youtube';
  const converted = catalogTrack({ ...track, id: provider === 'youtube' ? track.id : path }, provider);
  return { ...converted, path, format: track.format || (local ? 'Local File' : converted.format), catalog_quality: local ? undefined : converted.catalog_quality, source_context: track.source_context };
}

export function unifyDiscoveryHub(data: DiscoveryHubData | null, library: Track[]): DiscoveryHubData | null {
  if (!data) return null;
  const shelves = ['recently_played', 'heavy_rotation', 'forgotten_gems', 'recommendations', 'global_charts'] as const;
  const mixed = { ...data, recommendations: [...data.recommendations, ...(data.tidal_hifi || [])] };
  const mixes = [...data.mixed_for_you, ...(data.playlist_mixes || [])];
  const libraryByPath = new Map(library.map(track => [track.path, track]));
  const candidates = [...shelves.flatMap(key => mixed[key] || []), ...mixes.flatMap(mix => mix.tracks)]
    .map(track => libraryByPath.get(track.path || track.url) || discoveryTrack(track)).filter(isMusicTrack);
  const queries = new Set(candidates.map(sourceSearchQuery));
  const songs = groupRecordings([...candidates, ...library.filter(track => queries.has(sourceSearchQuery(track)))], '');
  const bySource = new Map(songs.flatMap(song => song.source_context!.sources.map(source => [sourceKey(source), song] as const)));
  const collect = (tracks: YoutubeTrack[], seen = new Set<string>()): YoutubeTrack[] => tracks.flatMap(track => {
    const playable = discoveryTrack(track);
    if (!isMusicTrack(playable)) return [];
    const source = sourceFor(playable);
    const song = source && bySource.get(sourceKey(source));
    const key = song?.source_context?.recording_id || track.url;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...track, source_context: song?.source_context || undefined }];
  });
  const result = { ...data, tidal_hifi: [] };
  const seen = new Set<string>();
  for (const shelf of shelves) result[shelf] = collect(mixed[shelf] || [], seen);
  result.mixed_for_you = data.mixed_for_you.map(mix => ({ ...mix, tracks: collect(mix.tracks) }));
  result.playlist_mixes = data.playlist_mixes?.map(mix => ({ ...mix, tracks: collect(mix.tracks) }));
  return result;
}

export type UnifiedTabId = 'all' | 'recs' | 'recent' | 'rotation' | 'gems' | 'tidal' | 'charts';

export interface UnifiedTabDef {
  id: UnifiedTabId;
  label: string;
  count: number;
}

const trackKey = (artist: string, title: string): string =>
  `${(artist || '').trim().toLowerCase()}::${(title || '').trim().toLowerCase()}`;

export const trackSignature = (t: YoutubeTrack): string =>
  trackKey(t.artist, t.title);

export function dedupeTracks(tracks: YoutubeTrack[]): YoutubeTrack[] {
  const seen = new Set<string>();
  return tracks.filter(t => {
    const key = trackSignature(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeShelves(shelves: YoutubeTrack[][]): YoutubeTrack[] {
  const merged: YoutubeTrack[] = [];
  const seen = new Set<string>();
  const cursors = shelves.map(() => 0);

  let remaining = shelves.reduce((sum, s) => sum + s.length, 0);
  while (remaining > 0) {
    let advanced = false;
    for (let i = 0; i < shelves.length; i++) {
      const shelf = shelves[i];
      while (cursors[i] < shelf.length) {
        const track = shelf[cursors[i]++];
        const key = trackSignature(track);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(track);
          remaining--;
          advanced = true;
          break;
        }
        remaining--;
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return merged;
}

export function buildMergedFeed(data: DiscoveryHubData): YoutubeTrack[] {
  return mergeShelves([
    data.recently_played || [],
    data.heavy_rotation || [],
    data.forgotten_gems || [],
    data.recommendations || [],
    data.tidal_hifi || [],
    data.global_charts || [],
  ]);
}

export function buildUnifiedTabs(data: DiscoveryHubData): UnifiedTabDef[] {
  const recs = data.recommendations || [];
  const recent = data.recently_played || [];
  const rotation = data.heavy_rotation || [];
  const gems = data.forgotten_gems || [];
  const tidal = data.tidal_hifi || [];
  const charts = data.global_charts || [];

  return [
    { id: 'all', label: 'All For You', count: mergeShelves([recent, rotation, gems, recs, tidal, charts]).length },
    { id: 'recs', label: 'Recommended', count: recs.length },
    { id: 'recent', label: 'Jump Back In', count: recent.length },
    { id: 'rotation', label: 'Heavy Rotation', count: rotation.length },
    { id: 'gems', label: 'Forgotten Gems', count: gems.length },
    ...(tidal.length > 0 ? [{ id: 'tidal' as UnifiedTabId, label: 'Tidal HiFi', count: tidal.length }] : []),
    { id: 'charts', label: 'Global Charts', count: charts.length },
  ];
}

export function getUnifiedTabTracks(
  data: DiscoveryHubData,
  tabId: UnifiedTabId,
): YoutubeTrack[] {
  switch (tabId) {
    case 'recs':
      return data.recommendations || [];
    case 'recent':
      return data.recently_played || [];
    case 'rotation':
      return data.heavy_rotation || [];
    case 'gems':
      return data.forgotten_gems || [];
    case 'tidal':
      return data.tidal_hifi || [];
    case 'charts':
      return data.global_charts || [];
    case 'all':
    default:
      return buildMergedFeed(data);
  }
}
