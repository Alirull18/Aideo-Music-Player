import { invoke } from '@tauri-apps/api/core';
import type { PlaybackSource, RecordingSources, SourceMetadata, SourceQuality, SourceSelection, StreamingQuality, Track } from '../store/types';

export const streamCacheKey = (track: Pick<Track, 'format' | 'path'>, quality: StreamingQuality, id = track.path) => `${track.format === 'Qobuz FLAC' ? 'qobuz' : 'tidal'}:${id}:${quality}`;

export async function bounded<T>(promise: Promise<T>, timeoutMs = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Source timed out. Try again.')), Math.max(0, timeoutMs));
    })]);
  } finally { clearTimeout(timer); }
}

export const sourceKey = (source: PlaybackSource) => `${source.provider}:${source.id}`;

export function normalizeText(s?: string | null): string {
  if (!s) return '';
  return s
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const normalizeArtist = (s?: string | null): string =>
  normalizeText(s).replace(/\s*-\s*topic\s*$/i, '').trim();

export function extractPrimaryArtist(artistStr?: string | null): string {
  const norm = normalizeArtist(artistStr);
  if (!norm) return '';
  const parts = norm.split(/\s*(?:\bfeat(?:\.|\b)|\bft(?:\.|\b)|\bfeaturing\b|,|\/|&|\+|\bwith\b|\bvs(?:\.|\b)|\bx(?=\s+\S))\s*/i);
  return parts[0]?.trim() || norm;
}

export const normalizeIsrc = (s?: string | null): string =>
  (s || '').replace(/[\s-]/g, '').toUpperCase();

export const validIsrc = (s: string): boolean =>
  /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(s);

const VERSION_INNER_PATTERNS = [
  /\b((?:[\w\s-]+\s+)?(?:remix|mix|vip|dub|club\s+mix|extended\s+mix|radio\s+mix|dance\s+mix|re-mix))\b/i,
  /\b(live(?:\s+at\s+[\w\s-]+|\s+in\s+[\w\s-]+|\s+from\s+[\w\s-]+|\s+\d{4}|\s+session|\s+version)?)\b/i,
  /\b(acoustic(?:\s+version)?|unplugged)\b/i,
  /\b(instrumental(?:\s+version)?|karaoke(?:\s+version)?|backing\s+track|piano\s+version|orchestral\s+version)\b/i,
  /\b(radio\s+edit|extended\s+edit|extended\s+version|single\s+version|album\s+version|original\s+mix|short\s+edit)\b/i,
  /\b(mono(?:\s+version)?|stereo(?:\s+version)?)\b/i,
  /\b(remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)\b/i,
  /\b(sped\s+up|speed\s+up|slowed(?:\s*\+\s*reverb)?)\b/i,
  /\b(clean(?:\s+version)?|explicit(?:\s+version)?)\b/i,
];

export function extractVersionQualifier(title?: string | null): string | null {
  const norm = normalizeText(title);
  if (!norm) return null;
  const bracketMatches = norm.match(/[\(\[](.*?)[\)\]]/g);
  if (bracketMatches) {
    for (const match of bracketMatches) {
      const inner = match.replace(/[\[\]\(\)]/g, '').trim();
      for (const pattern of VERSION_INNER_PATTERNS) {
        if (pattern.test(inner)) return inner;
      }
    }
  }
  return null;
}

export function getTrackVersion(track: Track): string | null {
  if (track.recording_evidence?.version) {
    return normalizeText(track.recording_evidence.version);
  }
  if (track.recording_evidence?.explicit === true) {
    return 'explicit';
  }
  if (track.recording_evidence?.explicit === false) {
    return 'clean';
  }
  return extractVersionQualifier(track.title);
}

export function getExplicitState(track: Track): 'clean' | 'explicit' | null {
  if (track.recording_evidence?.explicit === true) return 'explicit';
  if (track.recording_evidence?.explicit === false) return 'clean';
  const norm = `${normalizeText(track.title)} ${normalizeText(track.recording_evidence?.version)}`;
  if (/\bexplicit(?:\s+version)?\b/i.test(norm)) return 'explicit';
  if (/\bclean(?:\s+version)?\b/i.test(norm)) return 'clean';
  return null;
}

export interface ParsedVersionDescriptor {
  isLive: boolean;
  liveDetail: string | null;
  isRemix: boolean;
  remixDetail: string | null;
  isAcoustic: boolean;
  isInstrumental: boolean;
  isRadioEdit: boolean;
  isRemaster: boolean;
  remasterYear: string | null;
  isMono: boolean;
  isStereo: boolean;
  isSpedOrSlowed: boolean;
  explicitState: 'clean' | 'explicit' | null;
  rawVersion: string | null;
}

export function parseVersionDescriptor(track: Track): ParsedVersionDescriptor {
  const rawVersion = getTrackVersion(track);
  const combined = `${normalizeText(track.title)} ${normalizeText(track.recording_evidence?.version)}`;

  // Live
  const liveMatch = combined.match(/\blive(?:\s+(?:at|in|from)\s+([a-z0-9\s'-]+)|\s+(\d{4}))?\b/i);
  const isLive = Boolean(liveMatch || /\b(concert|tour)\b/i.test(combined));
  const liveDetail = liveMatch ? (liveMatch[1] || liveMatch[2] || '').trim() || null : null;

  // Remix
  const remixMatch = combined.match(/\b(?:([a-z0-9\s'-]+)\s+remix|club\s+mix|extended\s+(?:mix|version|edit)|vip(?:\s+mix)?|dub\s+mix)\b/i);
  const isRemix = Boolean(remixMatch || /\b(remix|rmx)\b/i.test(combined));
  const remixDetail = remixMatch ? (remixMatch[1] || '').trim() || null : null;

  // Acoustic
  const isAcoustic = /\b(acoustic|unplugged)\b/i.test(combined);

  // Instrumental / Karaoke
  const isInstrumental = /\b(instrumental|karaoke|backing\s+track|piano\s+version|orchestral\s+version)\b/i.test(combined);

  // Radio Edit
  const isRadioEdit = /\b(radio\s+(?:edit|mix|version)|single\s+version)\b/i.test(combined);

  // Remaster
  const remasterMatch = combined.match(/\b(?:remaster(?:ed)?(?:\s+(\d{4}))?|(\d{4})\s+remaster(?:ed)?)\b/i);
  const isRemaster = Boolean(remasterMatch || (rawVersion && rawVersion.includes('remaster')));
  const remasterYear = remasterMatch ? (remasterMatch[1] || remasterMatch[2] || null) : null;

  // Mono / Stereo
  const isMono = /\bmono(?:\s+version)?\b/i.test(combined);
  const isStereo = /\bstereo(?:\s+version)?\b/i.test(combined);

  // Sped / Slowed
  const isSpedOrSlowed = /\b(sped\s+up|speed\s+up|slowed(?:\s*\+\s*reverb)?)\b/i.test(combined);

  // Explicit
  const explicitState = getExplicitState(track);

  return {
    isLive,
    liveDetail,
    isRemix,
    remixDetail,
    isAcoustic,
    isInstrumental,
    isRadioEdit,
    isRemaster,
    remasterYear,
    isMono,
    isStereo,
    isSpedOrSlowed,
    explicitState,
    rawVersion,
  };
}

export function areVersionsCompatible(vA: ParsedVersionDescriptor, vB: ParsedVersionDescriptor): boolean {
  if (vA.isLive !== vB.isLive) return false;
  if (vA.isLive && vA.liveDetail && vB.liveDetail && vA.liveDetail !== vB.liveDetail) return false;

  if (vA.isRemix !== vB.isRemix) return false;
  if (vA.isRemix && vA.remixDetail && vB.remixDetail && vA.remixDetail !== vB.remixDetail) return false;

  if (vA.isAcoustic !== vB.isAcoustic) return false;
  if (vA.isInstrumental !== vB.isInstrumental) return false;
  if (vA.isRadioEdit !== vB.isRadioEdit) return false;
  if (vA.isMono !== vB.isMono) return false;
  if (vA.isStereo && vB.isMono) return false;
  if (vA.isMono && vB.isStereo) return false;
  if (vA.isSpedOrSlowed !== vB.isSpedOrSlowed) return false;

  if (vA.isRemaster && vB.isRemaster && vA.remasterYear && vB.remasterYear && vA.remasterYear !== vB.remasterYear) return false;
  if (vA.isRemaster !== vB.isRemaster && (vA.rawVersion || vB.rawVersion)) {
    return false;
  }

  // Explicit conflict check
  if (vA.explicitState && vB.explicitState && vA.explicitState !== vB.explicitState) return false;
  if (Boolean(vA.explicitState) !== Boolean(vB.explicitState)) return false;

  // Raw version check for different named versions
  if (vA.rawVersion && vB.rawVersion && vA.rawVersion !== vB.rawVersion) return false;

  return true;
}

export function coreTitle(track: Track): string {
  let title = normalizeText(track.title);
  if (!title) return '';

  const artist = normalizeArtist(track.artist);
  const prefix = `${artist} - `;
  if (sourceFor(track)?.provider === 'youtube' && title.startsWith(prefix)) {
    title = title.slice(prefix.length).trim();
  }

  // Strip recognized soundtrack/movie context wrappers: (From "Movie")
  title = title.replace(/\s*(?:\((?:from\s+[^)]*(?:motion\s+picture|soundtrack|film|movie|ost)[^)]*)\)|\[(?:from\s+[^\]]*(?:motion\s+picture|soundtrack|film|movie|ost)[^\]]*)\])\s*$/i, ' ').trim();

  // Strip trailing presentation wrappers: - official audio, | official music video, etc.
  title = title.replace(/\s*(?:[-–—|/]|\/\/)\s*(?:official\s+(?:audio|(?:music\s+)?video|lyric(?:s)?\s+video|visuali[sz]er)|(?:official\s+)?(?:music\s+)?video|lyrics?(?:\s+video)?|visuali[sz]er|official\s+audio|audio|full\s+audio)\s*$/i, ' ').trim();

  // Strip bracketed presentation wrappers: (Official Audio), [Official Music Video], (Lyric Video), [Visualizer], [4K], etc.
  title = title.replace(/\s*(?:\((?:(?:\s*[-–|/]\s*)?(?:official\s+(?:audio|(?:music\s+)?video)|(?:official\s+)?(?:music\s+)?video|lyric(?:s)?(?:\s+video)?|visuali[sz]er|official\s+audio|audio|full\s+audio|lyrics?|hd|4k|hq|1080p|720p|uhd|official)\s*)+\)|\[(?:(?:\s*[-–|/]\s*)?(?:official\s+(?:audio|(?:music\s+)?video)|(?:official\s+)?(?:music\s+)?video|lyric(?:s)?(?:\s+video)?|visuali[sz]er|official\s+audio|audio|full\s+audio|lyrics?|hd|4k|hq|1080p|720p|uhd|official)\s*)+\])\s*/gi, ' ').trim();

  // Strip featured credits in parentheses/brackets
  title = title.replace(/\s*(?:\((?:feat\.?|ft\.?|featuring)\s+[^\)]+\)|\[(?:feat\.?|ft\.?|featuring)\s+[^\]]+\])\s*/gi, ' ').trim();

  // Strip version qualifier brackets
  title = title.replace(/\s*(?:\((?:live(?:\s+(?:at|in|from)\s+[^\)]+|\s+\d{4}|\s+session|\s+version)?)\)|\[(?:live(?:\s+(?:at|in|from)\s+[^\]]+|\s+\d{4}|\s+session|\s+version)?\]))\s*/gi, ' ').trim();
  title = title.replace(/\s*(?:\((?:[^\)]*\s+)?(?:remix|rmx|vip(?:\s+mix)?|dub\s+mix|club\s+mix|extended\s+(?:mix|version|edit)|radio\s+(?:mix|edit)|dance\s+mix|re-mix)\)|\[(?:[^\]]*\s+)?(?:remix|rmx|vip(?:\s+mix)?|dub\s+mix|club\s+mix|extended\s+(?:mix|version|edit)|radio\s+(?:mix|edit)|dance\s+mix|re-mix)\])\s*/gi, ' ').trim();
  title = title.replace(/\s*(?:\((?:acoustic(?:\s+version)?|unplugged)\)|\[(?:acoustic(?:\s+version)?|unplugged)\])\s*/gi, ' ').trim();
  title = title.replace(/\s*(?:\((?:instrumental(?:\s+version)?|karaoke(?:\s+version)?|backing\s+track|piano\s+version|orchestral\s+version)\)|\[(?:instrumental(?:\s+version)?|karaoke(?:\s+version)?|backing\s+track|piano\s+version|orchestral\s+version)\])\s*/gi, ' ').trim();
  title = title.replace(/\s*(?:\((?:radio\s+edit|extended\s+edit|extended\s+version|single\s+version|album\s+version|original\s+mix|short\s+edit)\)|\[(?:radio\s+edit|extended\s+edit|extended\s+version|single\s+version|album\s+version|original\s+mix|short\s+edit)\])\s*/gi, ' ').trim();
  title = title.replace(/\s*(?:\((?:mono(?:\s+version)?|stereo(?:\s+version)?)\)|\[(?:mono(?:\s+version)?|stereo(?:\s+version)?\]))\s*/gi, ' ').trim();
  title = title.replace(/\s*(?:\((?:remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)\)|\[(?:remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?\]))\s*/gi, ' ').trim();
  title = title.replace(/\s*(?:\((?:sped\s+up|speed\s+up|slowed(?:\s*\+\s*reverb)?)\)|\[(?:sped\s+up|speed\s+up|slowed(?:\s*\+\s*reverb)?\]))\s*/gi, ' ').trim();
  title = title.replace(/\s*(?:\((?:clean(?:\s+version)?|explicit(?:\s+version)?)\)|\[(?:clean(?:\s+version)?|explicit(?:\s+version)?\]))\s*/gi, ' ').trim();

  const cleaned = title.replace(/\s+/g, ' ').trim();
  return cleaned || normalizeText(track.title);
}

export function matchingTitle(track: Track): string {
  return coreTitle(track);
}

export const sourceSearchQuery = (track: Track) => `${normalizeArtist(track.artist)} ${matchingTitle(track)}`.trim();
export const sourceName = (source: PlaybackSource) => ({ local: 'Local file', tidal: 'Tidal', qobuz: 'Qobuz', youtube: 'YouTube' })[source.provider];

export const sourceMetadata = (track: SourceMetadata): SourceMetadata => ({
  title: track.title, artist: track.artist, album: track.album ?? null, duration: track.duration,
  duration_raw: track.duration_raw ?? null, cover_url: track.cover_url ?? null,
  track_number: track.track_number ?? null, disc_number: track.disc_number ?? null,
});

export function sourceFor(track: Track): PlaybackSource | null {
  if (track.format === 'Tidal FLAC') return /^\d+$/.test(track.path) ? { provider: 'tidal', id: track.path, catalog_quality: track.catalog_quality, recording_evidence: track.recording_evidence } : null;
  if (track.format === 'Qobuz FLAC') return /^\d+$/.test(track.path) ? { provider: 'qobuz', id: track.path, catalog_quality: track.catalog_quality, recording_evidence: track.recording_evidence } : null;
  try {
    const url = new URL(track.path);
    const id = ['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(url.hostname) ? url.searchParams.get('v') : url.hostname === 'youtu.be' ? url.pathname.slice(1) : null;
    if (id && /^[\w-]{11}$/.test(id)) return { provider: 'youtube', id, catalog_quality: { lossless: false }, recording_evidence: track.recording_evidence };
  } catch { /* Local paths are not URLs. */ }
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(track.path) ? { provider: 'local', id: track.path, catalog_quality: track.catalog_quality, recording_evidence: track.recording_evidence } : null;
}

export const isMusicTrack = (track: Track) => sourceFor(track)?.provider !== 'youtube' || ((track.duration || 0) <= 20 * 60
  && !/\b(podcast|interview|vlog|reaction|tutorial|unboxing|full episode)\b/i.test(track.title || ''));

function recordingKey(t: Track): string | null {
  const evidence = t.recording_evidence;
  const isrc = normalizeIsrc(evidence?.isrc);
  const upc = (evidence?.upc || '').trim();
  if (!validIsrc(isrc) || !/^\d{12,14}$/.test(upc)
    || !t.duration || !Number.isFinite(t.duration) || !normalizeText(t.title) || !normalizeText(t.artist) || !normalizeText(t.album)) return null;
  return JSON.stringify([isrc, upc.replace(/^0+/, ''), normalizeText(t.title), normalizeText(t.artist), normalizeText(t.album), normalizeText(evidence?.version), Math.round(t.duration)]);
}

export function isSameSong(a: Track, b: Track): boolean {
  const titleA = coreTitle(a);
  const titleB = coreTitle(b);
  if (!titleA || !titleB || titleA !== titleB) return false;

  const artistA = normalizeArtist(a.artist);
  const artistB = normalizeArtist(b.artist);
  if (!artistA || !artistB) return false;

  const BANNED_ARTISTS = new Set(['unknown artist', 'youtube audio', 'online stream', 'various artists', '']);
  if (BANNED_ARTISTS.has(artistA) || BANNED_ARTISTS.has(artistB)) return false;

  const primaryA = extractPrimaryArtist(a.artist);
  const primaryB = extractPrimaryArtist(b.artist);
  if (!primaryA || !primaryB || BANNED_ARTISTS.has(primaryA) || BANNED_ARTISTS.has(primaryB)) return false;
  if (primaryA !== primaryB && artistA !== artistB) return false;

  const vA = parseVersionDescriptor(a);
  const vB = parseVersionDescriptor(b);
  if (!areVersionsCompatible(vA, vB)) return false;

  return true;
}

export function isSameRecording(a: Track, b: Track): boolean {
  // 1. Must pass song-level compatibility and version compatibility
  if (!isSameSong(a, b)) return false;

  // 2. Real positive finite durations within 3.0 seconds
  if (
    typeof a.duration !== 'number' || typeof b.duration !== 'number'
    || !Number.isFinite(a.duration) || !Number.isFinite(b.duration)
    || a.duration <= 0 || b.duration <= 0
  ) {
    return false;
  }
  if (Math.abs(a.duration - b.duration) > 3.0) return false;

  // 3. ISRC conflict check
  const isrcA = normalizeIsrc(a.recording_evidence?.isrc);
  const isrcB = normalizeIsrc(b.recording_evidence?.isrc);
  if (validIsrc(isrcA) && validIsrc(isrcB) && isrcA !== isrcB) {
    return false;
  }

  // 4. Explicit conflict check
  const expA = getExplicitState(a);
  const expB = getExplicitState(b);
  if (expA && expB && expA !== expB) return false;

  return true;
}

export const isLikelySameRecording = isSameRecording;

export function matchingSources(track: Track, results: Track[]): PlaybackSource[] {
  const anchor = sourceFor(track);
  const exact = results.find(t => t.source_context?.sources.some(s => anchor && sourceKey(s) === sourceKey(anchor)));
  let matches = results.filter(t => t === exact || isSameRecording(track, t));
  if (!matches.every(a => matches.every(b => a === b || isSameRecording(a, b)))) matches = exact ? [exact] : [];
  return [...new Map([
    ...(track.source_context?.sources || (anchor ? [anchor] : [])),
    ...matches.flatMap(t => t.source_context?.sources || []),
  ].map(s => [sourceKey(s), s])).values()].slice(0, 32);
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

export function groupRecordings(tracks: Track[], query: string, existingGroups?: Track[]): Track[] {
  interface GroupEntry {
    row: Track;
    anchor: Track;
    cohortTracks: Track[];
  }

  const groups: GroupEntry[] = [];
  const seenSources = new Set<string>();

  const findMatchingExisting = (t: Track, source: PlaybackSource): Track | undefined => {
    if (!existingGroups || existingGroups.length === 0) return undefined;
    return existingGroups.find(eg => {
      if (eg.source_context?.recording_id && t.source_context?.recording_id === eg.source_context.recording_id) return true;
      if (eg.source_context?.sources.some(s => sourceKey(s) === sourceKey(source))) return true;
      return isSameSong(eg, t);
    });
  };

  // Prioritize catalog metadata for row representative
  const sorted = [...tracks].sort((a, b) =>
    Number(Boolean(recordingKey(b))) - Number(Boolean(recordingKey(a)))
    || `${a.format}:${a.path}`.localeCompare(`${b.format}:${b.path}`)
  );

  for (const t of sorted) {
    const source = sourceFor(t);
    if (!source || !isMusicTrack(t) || seenSources.has(sourceKey(source))) continue;
    source.metadata = sourceMetadata(t);
    if (t.recording_evidence) {
      source.recording_evidence = t.recording_evidence;
    }
    seenSources.add(sourceKey(source));

    const existingGroup = groups.find(g => isSameSong(g.anchor, t));

    if (!existingGroup) {
      source.match_assessment = 'equivalent';
      const matchingEg = findMatchingExisting(t, source);
      const evidenceKey = recordingKey(t);
      const establishedId = matchingEg?.source_context?.recording_id || t.source_context?.recording_id;
      const id = establishedId || evidenceKey || sourceKey(source);
      const selection = matchingEg?.source_context?.selection || t.source_context?.selection || { mode: 'auto' };
      const context: RecordingSources = {
        recording_id: id,
        sources: [source],
        display_candidates: [],
        selection,
      };
      groups.push({
        row: { ...t, source_context: context },
        anchor: matchingEg || t,
        cohortTracks: [t],
      });
    } else {
      const context = existingGroup.row.source_context!;
      const isEquivalent = isSameRecording(existingGroup.anchor, t)
        && existingGroup.cohortTracks.every(member => isSameRecording(member, t));

      if (isEquivalent) {
        source.match_assessment = 'equivalent';
        if (context.sources.length < 32) {
          context.sources.push(source);
          existingGroup.cohortTracks.push(t);
        } else if (!context.sources.some(s => s.provider === source.provider)) {
          const duplicate = context.sources.findIndex((s, i) =>
            context.sources.findIndex(other => other.provider === s.provider) !== i
          );
          if (duplicate !== -1) {
            context.sources[duplicate] = source;
          }
        }
      } else {
        source.match_assessment = 'candidate';
        const isrcA = normalizeIsrc(existingGroup.anchor.recording_evidence?.isrc);
        const isrcB = normalizeIsrc(t.recording_evidence?.isrc);
        if (validIsrc(isrcA) && validIsrc(isrcB) && isrcA !== isrcB) {
          source.match_reason = 'conflicting_isrc';
        } else if (
          existingGroup.anchor.duration && t.duration
          && Math.abs(existingGroup.anchor.duration - t.duration) > 3
        ) {
          source.match_reason = 'duration_discrepancy';
        } else {
          source.match_reason = 'unverified_recording';
        }

        if (!context.display_candidates) {
          context.display_candidates = [];
        }
        if (!context.display_candidates.some(s => sourceKey(s) === sourceKey(source))) {
          if (context.display_candidates.length < 32) {
            context.display_candidates.push(source);
          }
        }
      }
    }
  }

  const normQuery = normalizeText(query);
  const words = normQuery.split(' ').filter(Boolean);
  const relevance = (t: Track) => {
    const normTitle = normalizeText(t.title);
    const normArtist = normalizeText(t.artist);
    const normAlbum = normalizeText(t.album);

    let score = 0;
    if (normTitle === normQuery) score += 100;
    if (normArtist === normQuery) score += 100;
    else if (normArtist && normQuery && (normArtist.startsWith(normQuery) || normQuery.startsWith(normArtist))) score += 50;

    if (words.length > 0 && words.every(w => normArtist.includes(w))) score += 40;
    if (words.length > 0 && words.every(w => normTitle.includes(w))) score += 30;

    score += words.reduce((n, w) => n + (normArtist.includes(w) ? 6 : 0) + (normTitle.includes(w) ? 4 : 0) + (normAlbum.includes(w) ? 1 : 0), 0);
    return score;
  };

  if (existingGroups && existingGroups.length > 0) {
    const existingOrder = new Map<string, number>();
    existingGroups.forEach((eg, i) => {
      if (eg.source_context?.recording_id) existingOrder.set(eg.source_context.recording_id, i);
    });

    const knownGroups: GroupEntry[] = [];
    const newGroups: GroupEntry[] = [];

    for (const g of groups) {
      const recId = g.row.source_context?.recording_id;
      if (recId && existingOrder.has(recId)) {
        knownGroups.push(g);
      } else {
        newGroups.push(g);
      }
    }

    knownGroups.sort((a, b) => {
      const orderA = existingOrder.get(a.row.source_context!.recording_id) ?? 0;
      const orderB = existingOrder.get(b.row.source_context!.recording_id) ?? 0;
      return orderA - orderB;
    });

    newGroups.sort((a, b) => relevance(b.row) - relevance(a.row));

    return [...knownGroups, ...newGroups].map(g => applySourcePreference(g.row));
  }

  return groups.map(g => applySourcePreference(g.row)).sort((a, b) => relevance(b) - relevance(a));
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
  let currentGrouped: Track[] = [];
  const snapshot = (): SourceSearch => {
    currentGrouped = groupRecordings(found, query, currentGrouped);
    return { tracks: currentGrouped, pending: [...pending], errors: { ...errors } };
  };
  const register = (provider: string, tracks: Track[]) => {
    found.push(...tracks);
    pending.delete(provider);
    update(snapshot());
  };
  const fail = (provider: string, error: unknown) => {
    errors[provider] = String(error);
    pending.delete(provider);
    update(snapshot());
  };
  update(snapshot());
  await Promise.allSettled(providers.map(async provider => {
    try {
      if (provider === 'local') {
        const local = await bounded(invoke<Track[]>('search_local_sources', { query }));
        register('local', local || []);
      } else if (provider === 'youtube') {
        const youtube = await bounded(invoke<any[]>('search_youtube', { query }));
        register('youtube', (youtube || []).map(t => catalogTrack(t, 'youtube')));
      } else {
        const catalog = await bounded(invoke<any[]>(`${provider}_search`, { query }));
        register(provider, (catalog || []).map(t => catalogTrack(t, provider as 'tidal' | 'qobuz')));
      }
    } catch (error) { fail(provider, error); }
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

function validCandidateSource(s: any): boolean {
  return s && typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 32768
    && !/[\x00-\x1f]/.test(s.id)
    && ['local', 'tidal', 'qobuz', 'youtube'].includes(s.provider);
}

function validContext(value: any): value is RecordingSources {
  return value && typeof value.recording_id === 'string' && value.recording_id.length > 0
    && value.recording_id.length <= 512 && Array.isArray(value.sources) && value.sources.length > 0 && value.sources.length <= 32
    && value.sources.every((s: any) => s && validMetadata(s.metadata) && typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 32768
      && !/[\x00-\x1f]/.test(s.id) && (s.provider === 'local' ? /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(s.id)
        : s.provider === 'youtube' ? /^[\w-]{11}$/.test(s.id) : ['tidal', 'qobuz'].includes(s.provider) && /^\d{1,32}$/.test(s.id)))
    && new Set(value.sources.map(sourceKey)).size === value.sources.length
    && (value.display_candidates == null || (Array.isArray(value.display_candidates) && value.display_candidates.every(validCandidateSource)))
    && (value.selection?.mode === 'auto' || (value.selection?.mode === 'explicit' && value.selection.source
      && (value.sources.some((s: PlaybackSource) => sourceKey(s) === sourceKey(value.selection.source))
          || (value.display_candidates?.some((s: PlaybackSource) => sourceKey(s) === sourceKey(value.selection.source))))));
}

function preferences(): Record<string, SourceSelection> {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

/**
 * Strips frontend-only evaluation fields (match_assessment, match_reason, recording_evidence)
 * and ensures nested objects strictly conform to Rust db::PlaybackSource schema
 * (which enforces #[serde(deny_unknown_fields)]).
 */
export function cleanPlaybackSource(source: PlaybackSource): PlaybackSource {
  const cleaned: PlaybackSource = {
    provider: source.provider,
    id: source.id,
  };

  if (source.catalog_quality != null) {
    cleaned.catalog_quality = {
      ...(source.catalog_quality.lossless !== undefined ? { lossless: source.catalog_quality.lossless } : {}),
      ...(source.catalog_quality.sample_rate !== undefined ? { sample_rate: source.catalog_quality.sample_rate } : {}),
      ...(source.catalog_quality.bit_depth !== undefined ? { bit_depth: source.catalog_quality.bit_depth } : {}),
      ...(source.catalog_quality.codec !== undefined ? { codec: source.catalog_quality.codec } : {}),
    };
  }

  if (source.metadata != null) {
    cleaned.metadata = sourceMetadata(source.metadata);
  }

  return cleaned;
}

/**
 * Strips frontend-only display fields (display_candidates, match_version) and sanitizes
 * nested PlaybackSource items in `sources` and `selection.source` before sending over
 * Tauri IPC to the Rust backend (which enforces #[serde(deny_unknown_fields)]).
 */
export function cleanSourceContext(context: RecordingSources): RecordingSources {
  const cleanedSources = (context.sources || []).map(cleanPlaybackSource);

  let selection: SourceSelection = { mode: 'auto' };
  if (context.selection?.mode === 'explicit' && context.selection.source) {
    const cleanExplicit = cleanPlaybackSource(context.selection.source);
    // Ensure explicit source is in cleanedSources (required by Rust db::RecordingSources::to_json validation)
    const exists = cleanedSources.some(s => s.provider === cleanExplicit.provider && s.id === cleanExplicit.id);
    if (!exists) {
      if (cleanedSources.length < 32) {
        cleanedSources.push(cleanExplicit);
      } else {
        cleanedSources[31] = cleanExplicit;
      }
    }
    if (cleanedSources.some(s => s.provider === cleanExplicit.provider && s.id === cleanExplicit.id)) {
      selection = { mode: 'explicit', source: cleanExplicit };
    }
  }

  return {
    recording_id: context.recording_id,
    sources: cleanedSources,
    selection,
  };
}

export function applySourcePreference(track: Track): Track {
  if (track.playlist_entry_id === undefined) {
    try {
      const saved = JSON.parse(localStorage.getItem('aideo_library_source_choices') || '{}');
      const source = sourceFor(track);
      const context = saved?.[`${track.format}:${track.path}`]
        || (track.source_context && source && saved?.[`source:${sourceKey(source)}`]);
      if (validContext(context)) {
        const sources = [...new Map([...context.sources, ...(track.source_context?.sources || [])].map(s => [sourceKey(s), s])).values()].slice(0, 32);
        const candidates = [...new Map([...(context.display_candidates || []), ...(track.source_context?.display_candidates || [])].map(s => [sourceKey(s), s])).values()].slice(0, 32);
        track = { ...track, source_context: { ...context, sources, display_candidates: candidates } };
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
  if (track.playlist_entry_id !== undefined) {
    await invoke('update_playlist_source', { entryId: track.playlist_entry_id, sourceContext: cleanSourceContext(context), metadata: track });
    return { ...track, source_context: context };
  }
  const next = { ...preferences(), [context.recording_id]: context.selection };
  for (const source of context.sources) next[`source:${sourceKey(source)}`] = context.selection;
  if (context.display_candidates) {
    for (const source of context.display_candidates) next[`source:${sourceKey(source)}`] = context.selection;
  }
  localStorage.setItem(preferenceKey, JSON.stringify(next));
  {
    let saved: Record<string, RecordingSources> = {};
    try { saved = JSON.parse(localStorage.getItem('aideo_library_source_choices') || '{}') || {}; } catch { /* Replace corrupt data. */ }
    if (track.source_context) {
      for (const source of context.sources) saved[`source:${sourceKey(source)}`] = context;
      if (context.display_candidates) {
        for (const source of context.display_candidates) saved[`source:${sourceKey(source)}`] = context;
      }
    } else {
      saved[`${track.format}:${track.path}`] = context;
    }
    localStorage.setItem('aideo_library_source_choices', JSON.stringify(saved));
  }
  return { ...track, source_context: context };
}

export interface ResolvedSource { url: string; quality: SourceQuality }
const cache = new Map<string, { at: number; result: ResolvedSource }>();
export const inFlightResolutions = new Map<string, Promise<ResolvedSource>>();

export const clearSourceCache = () => {
  cache.clear();
  inFlightResolutions.clear();
};

export async function resolveSource(source: PlaybackSource, quality: StreamingQuality, fresh = false, timeoutMs = 15000): Promise<ResolvedSource> {
  const key = `${sourceKey(source)}:${quality}`;
  const cached = cache.get(key);
  if (!fresh && cached && Date.now() - cached.at < 30000) return cached.result;

  if (!fresh) {
    const inFlight = inFlightResolutions.get(key);
    if (inFlight) return inFlight;
  }

  const run = async (): Promise<ResolvedSource> => {
    try {
      if (source.provider === 'local') {
        const exists = await bounded(invoke<boolean[]>('check_files_exist', { paths: [source.id] }), timeoutMs);
        if (!exists?.[0]) throw new Error('Local file is unavailable');
        const tags = await bounded(invoke<any>('read_audio_tags', { path: source.id }), timeoutMs);
        return { url: source.id, quality: { lossless: tags?.lossless, sample_rate: tags?.sample_rate, bit_depth: tags?.bit_depth, codec: tags?.format } };
      }
      if (source.provider === 'youtube') return { url: `https://www.youtube.com/watch?v=${source.id}`, quality: { lossless: false } };
      const result = await bounded(invoke<ResolvedSource>(`${source.provider}_resolve_source`, { trackId: source.id, requestedQuality: quality }), timeoutMs);
      if (!result || typeof result.url !== 'string' || !/^https?:\/\//.test(result.url) || !result.quality) throw new Error('Invalid stream response');
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), result });
      return result;
    } finally {
      inFlightResolutions.delete(key);
    }
  };

  const promise = run();
  inFlightResolutions.set(key, promise);
  return promise;
}

export function createQueueOccurrenceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `qocc_${crypto.randomUUID()}`;
  }
  return `qocc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function isLocalUnifiedTrack(track: Track): boolean {
  if (track.source_context) {
    const selection = track.source_context.selection;
    const active = track.active_source || (selection.mode === 'explicit' ? selection.source : track.source_context.sources[0]);
    if (active) {
      return active.provider === 'local';
    }
  }
  return track.format !== 'Tidal FLAC' && track.format !== 'Qobuz FLAC' && !track.path.startsWith('http://') && !track.path.startsWith('https://');
}
