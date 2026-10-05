import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PlaybackSource, SourceQuality, Track } from './types';
import { isSameRecording, isSameSong, sourceFor, sourceKey, sourceMetadata } from '../utils/unifiedSources';

export interface DownloadOption { id: string; label: string; extension: string; quality: SourceQuality }
export interface DownloadJob {
  id: string;
  revision: number;
  source: PlaybackSource;
  option: DownloadOption;
  path: string;
  status: 'preparing' | 'downloading' | 'cancelling' | 'finalizing' | 'completed' | 'cancelled' | 'failed' | 'recoverable';
  downloaded: number;
  total: number | null;
  percent: number | null;
  error: string | null;
  saved: boolean;
}

export const canCancelDownload = (job: DownloadJob) => job.status === 'preparing' || job.status === 'downloading';
export const activeDownload = (job: DownloadJob) => canCancelDownload(job) || job.status === 'cancelling' || job.status === 'finalizing';

export function trackFromDownloadSource(source: PlaybackSource): Track {
  return {
    id: -1, path: source.provider === 'youtube' ? `https://www.youtube.com/watch?v=${source.id}` : source.id,
    title: source.metadata?.title ?? null, artist: source.metadata?.artist ?? null,
    album: source.metadata?.album, duration: source.metadata?.duration ?? null,
    format: source.provider === 'tidal' ? 'Tidal FLAC' : source.provider === 'qobuz' ? 'Qobuz FLAC' : source.provider === 'youtube' ? 'YouTube Direct' : null,
    lyric_offset: 0, catalog_quality: source.catalog_quality ?? undefined, recording_evidence: source.recording_evidence ?? undefined,
    cover_url: source.metadata?.cover_url,
  };
}

export function collectDownloadSources(track: Track, results: Track[] = []): PlaybackSource[] {
  const anchor = sourceFor(track);
  const own = anchor ? { ...anchor, metadata: sourceMetadata(track) } : null;
  const known = [...(own ? [own] : []), ...(track.source_context?.sources || []), ...(track.source_context?.display_candidates || [])];
  const found = results.filter(result => isSameSong(track, result)
    || result.source_context?.sources.some(s => anchor && sourceKey(s) === sourceKey(anchor)))
    .flatMap(result => [...(result.source_context?.sources || []), ...(result.source_context?.display_candidates || [])]);
  const copies = new Map<string, PlaybackSource>();
  for (const source of [...known, ...found]) {
    const previous = copies.get(sourceKey(source));
    copies.set(sourceKey(source), { ...previous, ...source, metadata: source.metadata ?? previous?.metadata });
  }
  return [...copies.values()].map(source => ({
    ...source,
    match_assessment: (anchor && sourceKey(source) === sourceKey(anchor)) || isSameRecording(track, trackFromDownloadSource(source)) ? 'equivalent' as const : 'candidate' as const,
  })).sort((a, b) => Number(b.match_assessment === 'equivalent') - Number(a.match_assessment === 'equivalent'));
}

interface DownloadState {
  track: Track | null;
  jobs: DownloadJob[];
  hidden: string[];
  paths: string[];
  open: (track: Track) => void;
  close: () => void;
  upsert: (job: DownloadJob) => void;
  dismiss: (id: string) => void;
  refreshPaths: () => Promise<void>;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  track: null, jobs: [], hidden: [], paths: [],
  open: track => set({ track }),
  close: () => set({ track: null }),
  upsert: job => set(state => {
    const previous = state.jobs.find(j => j.id === job.id);
    if (previous && previous.revision > job.revision) return state;
    // A fast job can emit completion before the start command returns its initial snapshot.
    if (previous && previous.revision >= job.revision && !activeDownload(previous) && activeDownload(job)) return state;
    return { jobs: [job, ...state.jobs.filter(j => j.id !== job.id)] };
  }),
  dismiss: id => set(state => ({ hidden: [...state.hidden, id] })),
  refreshPaths: async () => {
    const paths = await invoke<string[]>('get_downloaded_file_paths');
    set({ paths: paths || [] });
  },
}));
