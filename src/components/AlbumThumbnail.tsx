import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { invoke } from '@tauri-apps/api/core';
import defaultCover from '../assets/default_cover.png';
import { SimpleLRU } from '../utils/lruCache';

type ArtSource = { cover_url?: string | null; path?: string | null; stream_url?: string | null };

// A miss is remembered briefly so a scrolling grid does not re-ask for every artless album,
// but a file that was locked or offline a moment ago gets another chance.
const MISS_TTL_MS = 60_000;
const MAX_FALLBACK_TRACKS = 8;
const coverArtCache = new SimpleLRU<string, { art: string | null; at: number }>(300);
const pendingArtRequests = new SimpleLRU<string, Promise<string | null>>(300);

const isImageUrl = (value: string) => /^(?:data:image\/|https?:\/\/)/.test(value);

/**
 * Where to look for one track's art, in order: its cover URL, then (for local files only) the
 * file itself. A track's own http(s) path or stream URL points at a page or an audio stream,
 * never at an image, so it is not a candidate.
 */
export function artCandidates(track: ArtSource | null | undefined): string[] {
  const out: string[] = [];
  if (track?.cover_url) out.push(track.cover_url);
  const file = track?.path;
  if (file && !/^(?:https?:|data:)/i.test(file)) out.push(file);
  return out;
}

export function albumArtCandidates(sampleTrack: ArtSource, tracks: readonly ArtSource[] = []): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const track of [sampleTrack, ...tracks.slice(0, MAX_FALLBACK_TRACKS)]) {
    for (const candidate of artCandidates(track)) {
      if (!seen.has(candidate)) { seen.add(candidate); ordered.push(candidate); }
    }
  }
  return ordered;
}

async function resolveArt(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (isImageUrl(candidate)) return candidate;
    try {
      const result = await invoke<unknown>('get_cover_art', { path: candidate });
      if (typeof result === 'string' && result) return result;
    } catch { /* try the next track's file */ }
  }
  return null;
}

function cachedArt(key: string): string | null | undefined {
  const entry = coverArtCache.get(key);
  if (!entry) return undefined;
  if (entry.art === null && Date.now() - entry.at > MISS_TTL_MS) return undefined;
  return entry.art;
}

export function AlbumThumbnail({ sampleTrack, tracks, title, style, ...imageProps }: {
  sampleTrack: ArtSource;
  /** Other tracks on the album; their art is used when the sample track has none. */
  tracks?: readonly ArtSource[];
  title: string;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'onError'>) {
  const candidates = albumArtCandidates(sampleTrack, tracks);
  const key = candidates.join('\n');
  const [art, setArt] = useState<string | null>(() => (key ? cachedArt(key) ?? null : null));

  useEffect(() => {
    let active = true;
    const cached = key ? cachedArt(key) : null;
    setArt(cached ?? null);
    if (!key || cached !== undefined) return;
    let request = pendingArtRequests.get(key);
    if (!request) {
      request = resolveArt(key.split('\n')).then(result => {
        coverArtCache.set(key, { art: result, at: Date.now() });
        return result;
      }).finally(() => pendingArtRequests.delete(key));
      pendingArtRequests.set(key, request);
    }
    void request.then(result => { if (active) setArt(result); });
    return () => { active = false; };
  }, [key]);

  return <img key={art || 'default'} {...imageProps} src={art || defaultCover} alt={title} referrerPolicy="no-referrer"
    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...style }}
    onError={event => {
      const image = event.currentTarget;
      if (image.dataset.fellBack) return;
      image.dataset.fellBack = '1';
      image.src = defaultCover;
    }} />;
}
