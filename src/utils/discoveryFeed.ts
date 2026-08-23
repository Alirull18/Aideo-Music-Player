import { DiscoveryHubData, YoutubeTrack } from '../store/types';

export type UnifiedTabId = 'all' | 'recs' | 'recent' | 'rotation' | 'gems' | 'charts';

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
    data.global_charts || [],
  ]);
}

export function buildUnifiedTabs(data: DiscoveryHubData): UnifiedTabDef[] {
  const recs = data.recommendations || [];
  const recent = data.recently_played || [];
  const rotation = data.heavy_rotation || [];
  const gems = data.forgotten_gems || [];
  const charts = data.global_charts || [];

  return [
    { id: 'all', label: 'All For You', count: mergeShelves([recent, rotation, gems, recs, charts]).length },
    { id: 'recs', label: 'Recommended', count: recs.length },
    { id: 'recent', label: 'Jump Back In', count: recent.length },
    { id: 'rotation', label: 'Heavy Rotation', count: rotation.length },
    { id: 'gems', label: 'Forgotten Gems', count: gems.length },
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
    case 'charts':
      return data.global_charts || [];
    case 'all':
    default:
      return buildMergedFeed(data);
  }
}
