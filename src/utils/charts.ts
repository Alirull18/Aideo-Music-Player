import type { Track, YoutubeTrack } from '../store/types';

export type ChartSource = 'lastfm' | 'billboard' | 'listenbrainz';
export type ChartScope = 'global' | 'genre' | 'country';
export type ListenBrainzRange = 'week' | 'month' | 'quarter' | 'year' | 'all_time';

export interface ChartEntry {
  chart_id: string;
  rank: number;
  title: string;
  artist: string;
  artwork_url: string | null;
  previous_rank: number | null;
  weeks_on_chart: number | null;
  listen_count: number | null;
  recording_mbid: string | null;
  playback_track: YoutubeTrack | null;
}

export interface ChartFallback {
  requested_source: ChartSource;
  actual_source: ChartSource;
  message: string;
}

export interface ChartPage {
  source: ChartSource;
  source_label: string;
  scope_label: string;
  period_label: string;
  updated_at: string | null;
  entries: ChartEntry[];
  offset: number;
  limit: number;
  total: number | null;
  has_more: boolean;
  fallback: ChartFallback | null;
}

export interface ChartRequestState {
  source: ChartSource;
  scope: ChartScope;
  genre: string;
  country: string;
  range: ListenBrainzRange;
  offset: number;
  limit: number;
}

export interface ChartRequest extends Record<string, unknown> {
  genre: string;
  country: string | null;
  source: ChartSource;
  range: ListenBrainzRange | null;
  offset: number;
  limit: number;
}

export function buildChartRequest(state: ChartRequestState): ChartRequest {
  if (state.source === 'listenbrainz') {
    return {
      genre: '',
      country: null,
      source: state.source,
      range: state.range,
      offset: state.offset,
      limit: state.limit,
    };
  }

  if (state.source === 'billboard') {
    return {
      genre: '',
      country: null,
      source: state.source,
      range: null,
      offset: state.offset,
      limit: state.limit,
    };
  }

  return {
    genre: state.scope === 'genre' ? state.genre : '',
    country: state.scope === 'country' ? state.country : null,
    source: state.source,
    range: null,
    offset: state.offset,
    limit: state.limit,
  };
}

export function mergeChartEntries(
  current: ChartEntry[],
  incoming: ChartEntry[],
): ChartEntry[] {
  const entriesById = new Map(current.map((entry) => [entry.chart_id, entry]));

  for (const entry of incoming) {
    const existing = entriesById.get(entry.chart_id);
    entriesById.set(entry.chart_id, existing ? { ...existing, ...entry } : entry);
  }

  return [...entriesById.values()].sort((a, b) => a.rank - b.rank);
}

export function parseChartDuration(raw: string | null | undefined): number {
  if (!raw) return 180;
  const parts = raw.split(':').map(Number);
  if (parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return 180;
  }

  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? seconds : 180;
}

export function isArtworkValid(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes('2a96cbd8b46e442fc41c2b86b821562f') &&
    (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:'))
  );
}

export function resolveChartArtwork(entry: ChartEntry): string | null {
  if (isArtworkValid(entry.artwork_url)) {
    return entry.artwork_url;
  }
  if (isArtworkValid(entry.playback_track?.cover_url)) {
    return entry.playback_track!.cover_url;
  }
  return null;
}

export function chartEntryToTrack(entry: ChartEntry): Track | null {
  const playbackTrack = entry.playback_track;
  if (!playbackTrack) return null;

  return {
    id: entry.rank,
    path: playbackTrack.url,
    title: entry.title,
    artist: entry.artist,
    cover_url: resolveChartArtwork(entry) ?? playbackTrack.cover_url,
    duration: parseChartDuration(playbackTrack.duration_raw),
    duration_raw: playbackTrack.duration_raw,
    format: 'YouTube Web Stream',
    lyric_offset: 0,
  };
}

export function getPlayableChartEntries(entries: ChartEntry[]): ChartEntry[] {
  return entries
    .filter((entry) => entry.playback_track !== null)
    .sort((a, b) => a.rank - b.rank);
}

export function formatChartCount(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}
