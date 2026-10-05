import type { DiscoveryHubData, PlayerState, Track, YoutubeTrack } from '../store/types';
import { discoveryTrack, dedupeTracks } from './discoveryFeed';
import { fmt } from '../utils';
import { rankRecommendations, recommendationAllowed, sameRecommendationRecording, recommendationSourceKey, recommendationPreferenceRevision } from './recommendations';
import { bounded, groupRecordings, sourceKey } from './unifiedSources';

export class LatestHubRequest {
  private generation = 0;
  private context = '';
  begin(context: string): { generation: number; context: string } {
    this.context = context;
    return { generation: ++this.generation, context };
  }
  current(request: { generation: number; context: string }, context: string): boolean {
    return request.generation === this.generation && request.context === this.context && context === this.context;
  }
}

const identities = new WeakMap<object, number>();
let identity = 0;
function reference(value: object): number {
  if (!identities.has(value)) identities.set(value, ++identity);
  return identities.get(value)!;
}
export function hubContext(state: PlayerState, revision: number): string {
  return ['rank-v1', state.appMode, state.recommendationEngine, state.autoplayDiscoveryLevel,
    reference(state.tracks), revision, recommendationPreferenceRevision()].join(':');
}

export function hubTrack(track: Track, originals: YoutubeTrack[] = []): YoutubeTrack {
  const original = originals.find(candidate => sameRecommendationRecording(discoveryTrack(candidate), track));
  return { ...original, id: original?.id || recommendationSourceKey(track), title: track.title || '', artist: track.artist || '',
    album: track.album, cover_url: track.cover_url || original?.cover_url || null, duration: track.duration || undefined,
    duration_raw: track.duration ? fmt(track.duration) : original?.duration_raw || '0:00', url: track.path, path: track.path, format: track.format || undefined,
    source_context: track.source_context || original?.source_context,
    recording_evidence: track.recording_evidence || original?.recording_evidence,
    recommendation_source: (track as Track & { recommendation_reason?: string }).recommendation_reason || original?.recommendation_source };
}

export function filterRecommendationHub(data: DiscoveryHubData, state: PlayerState): DiscoveryHubData {
  const allowed = (tracks: YoutubeTrack[] = []) => dedupeTracks(tracks.filter(track => recommendationAllowed(discoveryTrack(track), state)));
  const manualAllowed = (tracks: YoutubeTrack[]) => tracks.filter(track => recommendationAllowed({ ...discoveryTrack(track), disliked: 0 }, { ...state, tracks: [] }));
  return { ...data, recommendations: allowed(data.recommendations), recently_played: allowed(data.recently_played),
    heavy_rotation: allowed(data.heavy_rotation), forgotten_gems: allowed(data.forgotten_gems), global_charts: allowed(data.global_charts),
    tidal_hifi: allowed(data.tidal_hifi), mixed_for_you: (data.mixed_for_you || []).map(mix => ({ ...mix, tracks: allowed(mix.tracks) })),
    playlist_mixes: data.playlist_mixes?.map(mix => ({ ...mix, tracks: manualAllowed(mix.tracks) })) };
}

export async function rankRecommendationHub(data: DiscoveryHubData, state: PlayerState, generation: number): Promise<DiscoveryHubData> {
  const preferenceRevision = recommendationPreferenceRevision();
  const safe = filterRecommendationHub(data, state);
  const originals = [...safe.recommendations, ...safe.global_charts, ...(safe.recently_played || []), ...(safe.heavy_rotation || []),
    ...(safe.forgotten_gems || []), ...(safe.tidal_hifi || []), ...safe.mixed_for_you.flatMap(mix => mix.tracks)];
  const bySource = new Map(state.tracks.map(track => [recommendationSourceKey(track), track]));
  const converted = (track: YoutubeTrack) => {
    const candidate = discoveryTrack(track);
    return bySource.get(recommendationSourceKey(candidate)) || candidate;
  };
  const pool = [...originals.map(track => ({ ...converted(track), recommendation_reason: track.recommendation_source || undefined })), ...state.tracks]
    .filter(track => recommendationAllowed(track, state));
  const unique = [...new Map(pool.map(track => [recommendationSourceKey(track), track])).values()].slice(0, 240);
  const candidates = unique.map(track => {
    const equivalent = [track];
    for (const other of unique) {
      if (other !== track && equivalent.every(member => sameRecommendationRecording(member, other))) equivalent.push(other);
    }
    const grouped = groupRecordings(equivalent, '')[0];
    if (!grouped?.source_context) return track;
    const sources = [...new Map([...(track.source_context?.sources || []), ...grouped.source_context.sources].map(source => [sourceKey(source), source])).values()].slice(0, 32);
    return { ...track, source_context: { ...grouped.source_context, ...track.source_context, sources } };
  });
  const rank = async (surface: string, limit = 25, seed?: Track): Promise<YoutubeTrack[]> => {
    try { return (await bounded(rankRecommendations(state, candidates, surface, { generation, limit, seed }), 8000)).map(track => hubTrack(track, originals)); }
    catch {
      if (!['home', 'recent', 'heavy_rotation', 'forgotten_gems'].includes(surface)) return [];
      const fallback = surface === 'recent' ? safe.recently_played || [] : surface === 'heavy_rotation'
        ? safe.heavy_rotation || [] : surface.startsWith('forgotten') ? safe.forgotten_gems || [] : state.tracks.map(track => hubTrack(track));
      return fallback.filter(track => /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(track.path || track.url)
        && recommendationAllowed(converted(track), state)).slice(0, limit);
    }
  };
  const spotlightSeed = candidates.find(track => track.loved === 1) || candidates[0];
  const mixes = safe.mixed_for_you.length ? safe.mixed_for_you : [
    { id: 'supermix', title: 'Supermix', description: 'Favorites and related discoveries' },
    { id: 'on_repeat', title: 'On repeat', description: 'Repeated listens from the past week' },
    { id: 'forgotten', title: 'Forgotten favorites', description: 'Favorites you have not heard recently' },
    { id: 'spotlight', title: 'Artist spotlight', description: 'One artist and related music' },
  ].map(mix => ({ ...mix, cover_url: spotlightSeed?.cover_url || null, tracks: [] as YoutubeTrack[] }));
  const [recommendations, recently_played, heavy_rotation, forgotten_gems, mixed_for_you] = await Promise.all([
    rank('home'), rank('recent'), rank('heavy_rotation'), rank('forgotten_gems'),
    Promise.all(mixes.map(async mix => {
      const label = `${mix.id} ${mix.title}`.toLowerCase().replace(/[ _-]/g, '');
      const surface = label.includes('onrepeat') ? 'on_repeat' : label.includes('forgotten') ? 'forgotten_favorites'
        : label.includes('spotlight') ? 'spotlight' : label.includes('supermix') ? 'supermix' : 'home';
      const seed = surface === 'spotlight' ? (mix.tracks[0] ? discoveryTrack(mix.tracks[0]) : spotlightSeed) : undefined;
      return { ...mix, tracks: await rank(surface, Math.min(mix.tracks.length || 25, 100), seed) };
    })),
  ]);
  if (preferenceRevision !== recommendationPreferenceRevision()) throw new Error('Recommendation preferences changed; refresh Home');
  return { ...safe, recommendations, recently_played, heavy_rotation, forgotten_gems, mixed_for_you, tidal_hifi: [] };
}
