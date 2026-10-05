import { invoke } from '@tauri-apps/api/core';
import type { PlayerState, Track } from '../store/types';
import { isStreamTrack } from '../utils';
import { isSameRecording, normalizeText, sourceFor, sourceKey, cleanSourceContext } from './unifiedSources';

let preferenceRevision = 0;
export const recommendationPreferenceRevision = () => preferenceRevision;
export function invalidateRecommendationPreferences(): void {
  preferenceRevision++;
  window.dispatchEvent(new Event('recommendation-feedback-updated'));
}
export interface ExcludedRecording { recording_id: string; track: Track; version?: string; sources: string[] }
export interface ResetSelection { all: boolean; recording_ids: string[]; start: number | null; end: number | null }
export interface ResetPreview { count: number; token: string }
export function searchExcludedRecordings(recordings: ExcludedRecording[], query: string): ExcludedRecording[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  return recordings.filter(r => words.every(word => [r.track.title, r.track.artist, r.version, ...r.sources].join(' ').toLowerCase().includes(word)));
}

export function sameRecommendationRecording(a: Track, b: Track): boolean {
  const sa = a.active_source || sourceFor(a), sb = b.active_source || sourceFor(b);
  const title = (track: Track) => normalizeText(track.title).replace(/[\[(]\s*(?:official(?:\s+music)?\s+(?:video|audio)|lyrics?|lyric video|hd|hq|4k)\s*[\])]/g, '').trim();
  return Boolean(sa && sb && sourceKey(sa) === sourceKey(sb)) || (title(a) === title(b) && isSameRecording(a, b));
}

export function recommendationAllowed(track: Track, state: Pick<PlayerState, 'tracks' | 'appMode' | 'recommendationEngine'>): boolean {
  if (track.disliked === 1 || state.tracks.some(t => t.disliked === 1 && sameRecommendationRecording(t, track))) return false;
  const source = track.active_source || sourceFor(track);
  return Boolean(source && (source.provider === 'local' || (state.appMode !== 'local'
    && (state.recommendationEngine === 'our' || source.provider === state.recommendationEngine))));
}

export const radioAllowsLocal = (seed: Track | null): boolean => !seed
  || (seed.active_source ? seed.active_source.provider === 'local' : !isStreamTrack(seed.path, seed.format))
  || localStorage.getItem('aideo_autoplay_local_for_cloud') === 'true';

export function filterAutomaticQueue(state: PlayerState, resetRadio = false): Track[] {
  return state.queue.filter(track => !(track.is_autoplay || track.is_generated_mix)
    || (!(resetRadio && track.is_autoplay) && recommendationAllowed(track, state)
      && (!track.is_autoplay || state.appMode === 'local' || radioAllowsLocal(state.autoplaySeedTrack || state.currentTrack) || sourceFor(track)?.provider !== 'local')));
}

export const recommendationSourceKey = (track: Track) => {
  const source = sourceFor(track);
  return source?.provider === 'local' ? `local:${source.id.replace(/\//g, '\\').toLowerCase()}` : source ? sourceKey(source) : track.path;
};
const rankingKey = recommendationSourceKey;

export async function rankRecommendations(state: PlayerState, candidates: Track[], surface: string, options: { seed?: Track; mood?: string; limit?: number; generation?: number; excluded?: string[]; relatedness?: Record<string, number> } = {}): Promise<Track[]> {
  const revision = preferenceRevision;
  const allowLocal = surface !== 'radio' || state.appMode === 'local' || radioAllowsLocal(options.seed || state.autoplaySeedTrack || state.currentTrack);
  const eligible = candidates.filter(track => allowLocal || sourceFor(track)?.provider !== 'local');
  const response = await invoke<{ tracks: Track[]; generation: number; reasons: Record<string, string> }>('get_recommendations', {
    request: {
      surface, seed: options.seed || null, candidates: eligible.slice(0, 240), allow_local: allowLocal,
      recording_evidence: Object.fromEntries([...candidates, ...(options.seed ? [options.seed] : [])].filter(t => t.recording_evidence).map(t => [rankingKey(t), t.recording_evidence])),
      relatedness: options.relatedness ? Object.fromEntries(candidates.filter(t => options.relatedness?.[t.path] !== undefined).map(t => [rankingKey(t), options.relatedness![t.path]]))
        : Object.fromEntries(candidates.filter(t => /similar|related|collaborative/i.test(t.recommendation_reason || '')).map(t => [rankingKey(t), 0.7])),
      provenance: Object.fromEntries(candidates.filter(t => t.recommendation_reason).map(t => [rankingKey(t), t.recommendation_reason])),
      mode: state.appMode, provider: state.recommendationEngine,
      discovery_level: state.autoplayDiscoveryLevel === 'familiarity' ? 0 : state.autoplayDiscoveryLevel === 'discovery' ? 1 : 0.5,
      excluded_paths: options.excluded || [], limit: options.limit || 25,
      generation: options.generation || 0, period_days: 30, mood: options.mood?.trim().toLowerCase() === 'melancholic' ? 'sad' : options.mood?.trim().toLowerCase() || null,
    },
  });
  if (!response || revision !== preferenceRevision || response.generation !== (options.generation || 0)) throw new Error('Recommendation response was superseded');
  return response.tracks.filter(t => recommendationAllowed(t, state) && (allowLocal || sourceFor(t)?.provider !== 'local')).map(track => {
    const original = candidates.find(t => t.path === track.path && t.format === track.format)
      || candidates.find(t => sameRecommendationRecording(t, track));
    return { ...track, recommendation_reason: response.reasons[rankingKey(track)] || response.reasons[track.path], ...(original ? { source_context: original.source_context, recording_evidence: original.recording_evidence } : {}) };
  });
}

export class ListeningObservation {
  seconds = 0;
  private previous?: { time: number; position: number; playing: boolean };
  sample(time: number, position: number, playing: boolean): void {
    if (!Number.isFinite(time) || !Number.isFinite(position) || position < 0) { this.previous = undefined; return; }
    const previous = this.previous;
    if (previous && previous.playing && playing) {
      const elapsed = (time - previous.time) / 1000, progress = position - previous.position;
      if (elapsed > 0 && elapsed <= 5 && progress > 0 && progress <= elapsed + 1.5) this.seconds += Math.min(elapsed, progress);
    }
    this.previous = { time, position, playing };
  }
  reset(): void { this.previous = undefined; }
}

let listening: { id: number; track: Track; observation: ListeningObservation; checkpoint: number; counted: boolean; reason?: string } | undefined;
export function startListening(id: number, track: Track): void {
  listening = { id, track, observation: new ListeningObservation(), checkpoint: 0, counted: false };
}
export function resetListeningBaseline(): void { listening?.observation.reset(); }
export function markListeningEnd(reason: 'skipped' | 'completed' | 'stopped' | 'error'): void {
  if (listening && listening.reason !== 'completed' && listening.reason !== 'error') { listening.reason = reason; listening.observation.reset(); }
}
export function sampleListening(id: number | null, position: number, playing: boolean): Track | undefined {
  if (!listening || listening.id !== id) return;
  listening.observation.sample(performance.now(), position, playing);
  const seconds = listening.observation.seconds;
  if (seconds - listening.checkpoint >= 10) {
    listening.checkpoint = seconds;
    void invoke('checkpoint_listening', { historyId: id, listenedSeconds: seconds }).catch(e => console.error('Listening checkpoint:', e));
  }
  const threshold = listening.track.duration && listening.track.duration > 0 ? Math.min(120, listening.track.duration / 2) : 120;
  if (!listening.counted && seconds >= threshold) { listening.counted = true; return listening.track; }
}
export function finishListening(id: number): { seconds: number; reason: string } {
  if (!listening || listening.id !== id) return { seconds: 0, reason: 'stopped' };
  const result = { seconds: listening.observation.seconds, reason: listening.reason || 'stopped' };
  listening = undefined;
  return result;
}

export const feedbackContext = (track: Track) => track.source_context ? cleanSourceContext(track.source_context) : null;
