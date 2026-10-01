import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { invoke } from '@tauri-apps/api/core';
import defaultCover from '../assets/default_cover.png';
import { SimpleLRU } from '../utils/lruCache';

const coverArtCache = new SimpleLRU<string, string | null>(300);
const pendingArtRequests = new SimpleLRU<string, Promise<string | null>>(300);

export function AlbumThumbnail({ sampleTrack, title, style, ...imageProps }: {
  sampleTrack: { cover_url?: string | null; path?: string | null; stream_url?: string | null };
  title: string;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'onError'>) {
  const targetPath = sampleTrack?.cover_url || sampleTrack?.path || sampleTrack?.stream_url;
  const [art, setArt] = useState<string | null>(targetPath ? coverArtCache.get(targetPath) || null : null);

  useEffect(() => {
    let active = true;
    const cached = targetPath ? coverArtCache.get(targetPath) || null : null;
    setArt(cached);
    if (!targetPath) return;
    if (/^(?:data:|https?:\/\/)/.test(targetPath)) {
      setArt(targetPath);
      return;
    }
    if (!cached && !coverArtCache.has(targetPath)) {
      if (!pendingArtRequests.has(targetPath)) {
        const request = invoke<unknown>('get_cover_art', { path: targetPath })
          .then(result => {
            const artUrl = typeof result === 'string' && result ? result : null;
            coverArtCache.set(targetPath, artUrl);
            return artUrl;
          })
          .catch(() => {
            coverArtCache.set(targetPath, null);
            return null;
          })
          .finally(() => pendingArtRequests.delete(targetPath));
        pendingArtRequests.set(targetPath, request);
      }
      pendingArtRequests.get(targetPath)?.then(result => {
        if (active) setArt(result || null);
      });
    }
    return () => { active = false; };
  }, [targetPath]);

  return <img {...imageProps} src={art || defaultCover} alt={title}
    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...style }}
    onError={event => { event.currentTarget.src = defaultCover; }} />;
}
