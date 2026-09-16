import { invoke } from '@tauri-apps/api/core';
import type { PlaybackSource, RecordingSources, SourceMetadata, SourceQuality, SourceSelection, StreamingQuality, Track } from '../store/types';

export const streamCacheKey = (track: Pick<Track, 'format' | 'path'>, quality: StreamingQuality, id = track.path) => `${track.format === 'Qobuz FLAC' ? 'qobuz' : 'tidal'}:${id}:${quality}`;
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Source timed out. Try again.')), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

export const sourceKey = (source: PlaybackSource) => `${source.provider}:${source.id}`;
const normalize = (s?: string | null) => (s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const normalizeSourceTitle = (s?: string | null) => normalize(s).replace(/\s*(?:\((?:official (?:audio|video)|lyrics?(?: video)?|visuali[sz]er)\)|\[(?:official (?:audio|video)|lyrics?(?: video)?|visuali[sz]er)\])\s*$/i, '').trim();
const normalizeArtist = (s?: string | null) => normalize(s).replace(/\s+-\s+topic$/, '');
export const sourceSearchQuery = (track: Track) => `${normalizeArtist(track.artist)} ${normalizeSourceTitle(track.title)}`.trim();
export const sourceName = (source: PlaybackSource) => ({ local: 'Local file', tidal: 'Tidal', qobuz: 'Qobuz', youtube: 'YouTube' })[source.provider];

export const sourceMetadata = (track: SourceMetadata): SourceMetadata => ({
  title: track.title, artist: track.artist, album: track.album ?? null, duration: track.duration,
  duration_raw: track.duration_raw ?? null, cover_url: track.cover_url ?? null,
  track_number: track.track_number ?? null, disc_number: track.disc_number ?? null,
});

export function sourceFor(track: Track): PlaybackSource | null {
  if (track.format === 'Tidal FLAC') return /^\d+$/.test(track.path) ? { provider: 'tidal', id: track.path, catalog_quality: track.catalog_quality } : null;
  if (track.format === 'Qobuz FLAC') return /^\d+$/.test(track.path) ? { provider: 'qobuz', id: track.path, catalog_quality: track.catalog_quality } : null;
  try {
    const url = new URL(track.path);
    const id = ['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(url.hostname) ? url.searchParams.get('v') : url.hostname === 'youtu.be' ? url.pathname.slice(1) : null;
    if (id && /^[\w-]{11}$/.test(id)) return { provider: 'youtube', id, catalog_quality: { lossless: false } };
  } catch { /* Local paths are not URLs. */ }
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(track.path) ? { provider: 'local', id: track.path, catalog_quality: track.catalog_quality } : null;
}

function recordingKey(t: Track): string | null {
  const evidence = t.recording_evidence;
  const isrc = (evidence?.isrc || '').replace(/[\s-]/g, '').toUpperCase();
  const upc = (evidence?.upc || '').trim();
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) || !/^\d{12,14}$/.test(upc)
    || !t.duration || !Number.isFinite(t.duration) || !normalize(t.title) || !normalize(t.artist) || !normalize(t.album)) return null;
  return JSON.stringify([isrc, upc.replace(/^0+/, ''), normalize(t.title), normalize(t.artist), normalize(t.album), normalize(evidence?.version), Math.round(t.duration)]);
}

export function isLikelySameRecording(a: Track, b: Track): boolean {
  const title = normalizeSourceTitle(a.title);
  const artist = normalizeArtist(a.artist);
  if (['unknown artist', 'youtube audio', 'online stream', 'various artists'].includes(artist)) return false;
  if (!title || title !== normalizeSourceTitle(b.title) || !artist || artist !== normalizeArtist(b.artist)
    || !a.duration || !b.duration || !Number.isFinite(a.duration) || !Number.isFinite(b.duration) || Math.abs(a.duration - b.duration) > 3) return false;
  const albumA = normalize(a.album);
  const albumB = normalize(b.album);
  const versionA = normalize(a.recording_evidence?.version);
  const versionB = normalize(b.recording_evidence?.version);
  const isrc = (t: Track) => normalize(t.recording_evidence?.isrc).replace(/[\s-]/g, '');
  const upc = (t: Track) => normalize(t.recording_evidence?.upc).replace(/^0+/, '');
  if (isrc(a) && isrc(b) && isrc(a) !== isrc(b)) return false;
  if (upc(a) && upc(b) && upc(a) !== upc(b)) return false;
  // ponytail: strong metadata is not proof of the same master; acoustic fingerprints can strengthen this later.
  return (!albumA || !albumB || albumA === albumB) && (!versionA && !versionB || versionA === versionB);
}

export function matchingSources(track: Track, results: Track[]): PlaybackSource[] {
  const anchor = sourceFor(track);
  const exact = results.find(t => t.source_context?.sources.some(s => anchor && sourceKey(s) === sourceKey(anchor)));
  let matches = results.filter(t => t === exact || isLikelySameRecording(track, t));
  if (!matches.every(a => matches.every(b => a === b || isLikelySameRecording(a, b)))) matches = exact ? [exact] : [];
  return [...new Map([...(track.source_context?.sources || (anchor ? [anchor] : [])),
    ...matches.flatMap(t => t.source_context?.sources || [])].map(s => [sourceKey(s), s])).values()].slice(0, 32);
}

export function rankSources(sources: PlaybackSource[], preference: StreamingQuality, preferred: PlaybackSource['provider'] | 'auto' = 'auto'): PlaybackSource[] {
  const resolution = (s: PlaybackSource) => (s.catalog_quality?.sample_rate || 0) * (s.catalog_quality?.bit_depth || 0);
  const maxResolution = Math.max(0, ...sources.filter(s => s.catalog_quality?.lossless === true).map(resolution));
  const score = (s: PlaybackSource) => {
    const q = s.catalog_quality;
    if (preference === 'data_saver') return s.provider === 'local' ? 1e12 : q?.lossless === false ? 1e9 : 0;
    const meets = q?.lossless === true && (preference === 'best_available'
      ? resolution(s) >= maxResolution : (q.sample_rate || 0) >= 44100 && (q.bit_depth || 0) >= 16);
    return (meets && s.provider === 'local' ? 1e12 : 0) + (q?.lossless === true ? 1e10 : q?.lossless === false ? 0 : 1e9) + resolution(s);
  };
  return [...sources].sort((a, b) => score(b) - score(a)
    || Number(b.provider === preferred) - Number(a.provider === preferred)
    || sourceKey(a).localeCompare(sourceKey(b)));
}

export function groupRecordings(tracks: Track[], query: string): Track[] {
  const groups: { members: Track[]; track: Track }[] = [];
  const seen = new Set<string>();
  // Match well-described releases first, so a metadata-only upload cannot bridge conflicting releases.
  const sorted = [...tracks].sort((a, b) => Number(Boolean(recordingKey(b))) - Number(Boolean(recordingKey(a)))
    || `${a.format}:${a.path}`.localeCompare(`${b.format}:${b.path}`));
  for (const t of sorted) {
    const source = sourceFor(t);
    if (!source || seen.has(sourceKey(source))) continue;
    source.metadata = sourceMetadata(t);
    seen.add(sourceKey(source));
    const evidenceKey = recordingKey(t);
    const matches = groups.filter(g => g.members.every(member => isLikelySameRecording(member, t)));
    const group = matches.length === 1 ? matches[0] : undefined;
    if (group) {
      group.track.source_context!.sources.push(source);
      group.members.push(t);
    } else {
      const id = evidenceKey || sourceKey(source);
      const context: RecordingSources = { recording_id: id, sources: [source], selection: { mode: 'auto' } };
      groups.push({ members: [t], track: { ...t, source_context: context } });
    }
  }
  const normQuery = normalize(query);
  const words = normQuery.split(' ').filter(Boolean);
  const relevance = (t: Track) => {
    const normTitle = normalize(t.title);
    const normArtist = normalize(t.artist);
    const normAlbum = normalize(t.album);

    let score = 0;
    if (normTitle === normQuery) score += 100;
    if (normArtist === normQuery) score += 100;
    else if (normArtist && normQuery && (normArtist.startsWith(normQuery) || normQuery.startsWith(normArtist))) score += 50;

    if (words.length > 0 && words.every(w => normArtist.includes(w))) score += 40;
    if (words.length > 0 && words.every(w => normTitle.includes(w))) score += 30;

    score += words.reduce((n, w) => n + (normArtist.includes(w) ? 6 : 0) + (normTitle.includes(w) ? 4 : 0) + (normAlbum.includes(w) ? 1 : 0), 0);
    return score;
  };
  return groups.map(g => applySourcePreference(g.track)).sort((a, b) => relevance(b) - relevance(a));
}

export function catalogTrack(raw: any, provider: 'tidal' | 'qobuz' | 'youtube'): Track {
  const label = String(raw.quality || '');
  const quality: SourceQuality = { ...raw.catalog_quality };
  if (provider !== 'youtube' && quality.lossless == null && /^(LOSSLESS|HI_RES_LOSSLESS|HI_RES_192)$/.test(label)) quality.lossless = true;
  if (provider === 'youtube') quality.lossless = false;
  const durationText = typeof raw.duration_raw === 'string' ? raw.duration_raw.trim() : '';
  const parsedDuration = /^(?:\d+:)?\d+:[0-5]\d$/.test(durationText)
    && (durationText.split(':').length === 2 || Number(durationText.split(':')[1]) < 60)
    ? durationText.split(':').reduce((seconds: number, part: string) => seconds * 60 + Number(part), 0) : 0;
  const duration = typeof raw.duration === 'number' ? raw.duration : parsedDuration;
  return {
    id: provider === 'tidal' ? -30000 - Number(raw.id || 0) : provider === 'qobuz' ? -60000 - Number(raw.id || 0) : -1,
    path: provider === 'youtube' ? raw.url || `https://www.youtube.com/watch?v=${raw.id}` : String(raw.id),
    title: raw.title ?? null, artist: raw.artist ?? null, album: raw.album ?? null,
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    duration_raw: raw.duration_raw, format: provider === 'tidal' ? 'Tidal FLAC' : provider === 'qobuz' ? 'Qobuz FLAC' : 'YouTube Direct',
    lyric_offset: 0, cover_url: raw.cover_url || null,
    track_number: raw.track_number ?? null, disc_number: raw.disc_number ?? null,
    recording_evidence: raw.recording_evidence, catalog_quality: quality,
  };
}

export interface SourceSearch {
  tracks: Track[];
  pending: string[];
  errors: Record<string, string>;
}

export async function searchSources(query: string, enabled: { tidal: boolean; qobuz: boolean; youtube?: boolean }, update: (result: SourceSearch) => void): Promise<SourceSearch> {
  const providers = ['local', ...(enabled.youtube !== false ? ['youtube'] : []), ...(enabled.tidal ? ['tidal'] : []), ...(enabled.qobuz ? ['qobuz'] : [])];
  const found: Track[] = [];
  const pending = new Set(providers);
  const errors: Record<string, string> = {};
  const snapshot = (): SourceSearch => ({ tracks: groupRecordings(found, query), pending: [...pending], errors: { ...errors } });
  update(snapshot());
  await Promise.all(providers.map(async provider => {
    try {
      const command = provider === 'local' ? 'search_local_sources' : provider === 'youtube' ? 'search_youtube' : `${provider}_search`;
      const raw = await bounded(invoke<any[]>(command, { query }));
      if (!Array.isArray(raw)) throw new Error('Invalid search response');
      found.push(...(provider === 'local' ? raw : raw.map(t => catalogTrack(t, provider as 'tidal' | 'qobuz' | 'youtube'))));
    } catch (error) { errors[provider] = String(error); }
    finally { pending.delete(provider); update(snapshot()); }
  }));
  return snapshot();
}

const preferenceKey = 'aideo_recording_source_preferences';
function validMetadata(value: any): boolean {
  return value == null || (typeof value === 'object' && !Array.isArray(value)
    && ['title', 'artist', 'album', 'duration_raw', 'cover_url'].every(key => value[key] == null || typeof value[key] === 'string')
    && ['duration', 'track_number', 'disc_number'].every(key => value[key] == null
      || (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0)));
}
function validContext(value: any): value is RecordingSources {
  return value && typeof value.recording_id === 'string' && value.recording_id.length > 0
    && value.recording_id.length <= 512 && Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 32
    && value.sources.every((s: any) => s && validMetadata(s.metadata) && typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 32768
      && !/[\x00-\x1f]/.test(s.id) && (s.provider === 'local' ? /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(s.id)
        : s.provider === 'youtube' ? /^[\w-]{11}$/.test(s.id) : ['tidal', 'qobuz'].includes(s.provider) && /^\d{1,32}$/.test(s.id)))
    && new Set(value.sources.map(sourceKey)).size === value.sources.length
    && (value.selection?.mode === 'auto' || (value.selection?.mode === 'explicit' && value.selection.source
      && value.sources.some((s: PlaybackSource) => sourceKey(s) === sourceKey(value.selection.source))));
}
function preferences(): Record<string, SourceSelection> {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
export function applySourcePreference(track: Track): Track {
  if (track.playlist_entry_id === undefined) {
    try {
      const saved = JSON.parse(localStorage.getItem('aideo_library_source_choices') || '{}');
      const source = sourceFor(track);
      const context = saved?.[`${track.format}:${track.path}`]
        || (track.source_context && source && saved?.[`source:${sourceKey(source)}`]);
      if (validContext(context)) {
        const sources = [...new Map([...context.sources, ...(track.source_context?.sources || [])].map(s => [sourceKey(s), s])).values()];
        track = { ...track, source_context: { ...context, sources } };
      }
    } catch { /* Ignore invalid persisted choices. */ }
  }
  const context = track.source_context;
  if (!context) return track;
  if (!validContext(context)) return { ...track, source_context: undefined };
  if (track.playlist_entry_id !== undefined) return track;
  const saved = preferences();
  const choice = saved[context.recording_id] || context.sources.map(s => saved[`source:${sourceKey(s)}`]).find(Boolean);
  if (!choice || (choice.mode !== 'auto' && (choice.mode !== 'explicit' || !choice.source || !context.sources.some(s => sourceKey(s) === sourceKey(choice.source))))) return track;
  return { ...track, source_context: { ...context, selection: choice } };
}

export async function saveSourceChoice(track: Track, context: RecordingSources): Promise<Track> {
  if (!validContext(context)) throw new Error('Invalid recording source choice');
  if (track.playlist_entry_id !== undefined) await invoke('update_playlist_source', { entryId: track.playlist_entry_id, sourceContext: context, metadata: track });
  if (track.playlist_entry_id !== undefined) return { ...track, source_context: context };
  const next = { ...preferences(), [context.recording_id]: context.selection };
  for (const source of context.sources) next[`source:${sourceKey(source)}`] = context.selection;
  localStorage.setItem(preferenceKey, JSON.stringify(next));
  {
    let saved: Record<string, RecordingSources> = {};
    try { saved = JSON.parse(localStorage.getItem('aideo_library_source_choices') || '{}') || {}; } catch { /* Replace corrupt data. */ }
    if (track.source_context) for (const source of context.sources) saved[`source:${sourceKey(source)}`] = context;
    else saved[`${track.format}:${track.path}`] = context;
    localStorage.setItem('aideo_library_source_choices', JSON.stringify(saved));
  }
  return { ...track, source_context: context };
}

export interface ResolvedSource { url: string; quality: SourceQuality }
const cache = new Map<string, { at: number; result: ResolvedSource }>();
export const clearSourceCache = () => cache.clear();
export async function resolveSource(source: PlaybackSource, quality: StreamingQuality, fresh = false): Promise<ResolvedSource> {
  const key = `${sourceKey(source)}:${quality}`;
  const cached = cache.get(key);
  if (!fresh && cached && Date.now() - cached.at < 30000) return cached.result;
  if (source.provider === 'local') {
    const exists = await bounded(invoke<boolean[]>('check_files_exist', { paths: [source.id] }));
    if (!exists?.[0]) throw new Error('Local file is unavailable');
    const tags = await bounded(invoke<any>('read_audio_tags', { path: source.id }));
    return { url: source.id, quality: { lossless: tags?.lossless, sample_rate: tags?.sample_rate, bit_depth: tags?.bit_depth, codec: tags?.format } };
  }
  if (source.provider === 'youtube') return { url: `https://www.youtube.com/watch?v=${source.id}`, quality: { lossless: false } };
  const result = await bounded(invoke<ResolvedSource>(`${source.provider}_resolve_source`, { trackId: source.id, requestedQuality: quality }));
  if (!result || typeof result.url !== 'string' || !/^https?:\/\//.test(result.url) || !result.quality) throw new Error('Invalid stream response');
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), result });
  return result;
}
