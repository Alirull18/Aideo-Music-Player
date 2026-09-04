import { useEffect, useRef, useState, memo } from 'react';
import { Search, X, History, Music, Play, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../../store';
import { pathsEqual } from '../../utils';
import { DiscoveryHubData, YoutubeTrack, LEGACY_AIDEO_PAGE_DESIGNS } from '../../store/types';
import { SimpleLRU } from '../../utils/lruCache';

// ── Shelf model ─────────────────────────────────────────────

export type ShelfId = 'recent' | 'rotation' | 'gems' | 'recs' | 'tidal' | 'charts';

export interface ShelfMeta {
  label: string;
  reason: string;
  color: string;
}

export const SHELVES: Record<ShelfId, ShelfMeta> = {
  recent: { label: 'Jump Back In', reason: 'Recently played', color: '#34d399' },
  rotation: { label: 'Heavy Rotation', reason: 'Your most repeated tracks', color: '#f59e0b' },
  gems: { label: 'Forgotten Gems', reason: 'Old favorites you have not played lately', color: '#a855f7' },
  recs: { label: 'Made for Your Taste', reason: 'Seeded from your favorites and listening history', color: '#c084fc' },
  tidal: { label: 'Lossless Picks', reason: 'Hi-res FLAC matches from Tidal', color: '#22d3ee' },
  charts: { label: 'Global Trends', reason: 'Trending on Last.fm right now', color: '#f87171' },
};

const SHELF_ORDER: ShelfId[] = ['recent', 'rotation', 'gems', 'recs', 'tidal', 'charts'];

export interface TaggedTrack {
  track: YoutubeTrack;
  shelf: ShelfId;
}

const trackKey = (t: YoutubeTrack) =>
  `${(t.artist || '').trim().toLowerCase()}::${(t.title || '').trim().toLowerCase()}`;

const SHELF_DATA_FIELD: Record<ShelfId, string> = {
  recent: 'recently_played',
  rotation: 'heavy_rotation',
  gems: 'forgotten_gems',
  recs: 'recommendations',
  tidal: 'tidal_hifi',
  charts: 'global_charts',
};

// Merge all discovery shelves into one deduped feed, tagging each track with
// the shelf it came from (first shelf wins, matching buildMergedFeed order).
export function buildTaggedFeed(data: DiscoveryHubData | null): TaggedTrack[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: TaggedTrack[] = [];
  for (const shelf of SHELF_ORDER) {
    const tracks = (data as any)[SHELF_DATA_FIELD[shelf]] as YoutubeTrack[] | undefined;
    for (const track of tracks || []) {
      const key = trackKey(track);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ track, shelf });
    }
  }
  return out;
}

export function tracksForShelf(data: DiscoveryHubData | null, shelf: ShelfId): YoutubeTrack[] {
  return buildTaggedFeed(data).filter(t => t.shelf === shelf).map(t => t.track);
}

// ── Source / format color coding ────────────────────────────
// One color per source/quality tier; communicated solely by the artwork
// outline (no text tags, no legend, per design decision).

export function sourceTypeColor(track: any): string {
  const allTracks = useStore.getState().tracks || [];
  const localMatch = allTracks.find(t =>
    (track?.path && pathsEqual(t.path, track.path)) ||
    (track?.url && pathsEqual(t.path, track.url)) ||
    (Boolean(track?.title && track?.artist) &&
     Boolean(t.title && t.artist) &&
     (t.title ?? '').trim().toLowerCase() === String(track.title).trim().toLowerCase() &&
     (t.artist ?? '').trim().toLowerCase() === String(track.artist).trim().toLowerCase())
  );
  const p = String(localMatch?.path || track?.path || track?.url || '').toLowerCase();
  const fmt = String(localMatch?.format || track?.format || '').toLowerCase();
  if (fmt === 'tidal flac') return '#22d3ee';
  if (fmt === 'qobuz flac') {
    const q = String(track?.quality || '').toUpperCase();
    if (q === 'HI_RES_192' || q === 'HI_RES') return '#a78bfa';
    return '#7fb8e6';
  }
  if (!localMatch && (p.startsWith('http://') || p.startsWith('https://'))) return '#f87171';
  if (fmt === 'flac' || fmt === 'wav' || /\.(flac|wav|alac|aiff|dsd)$/.test(p)) return '#c084fc';
  return '#34d399';
}

// ── Cover art with graceful fallback ────────────────────────
// Mirrors AideoView's TrackCardThumbnail: direct web covers render as-is;
// local files resolve their embedded artwork via the get_cover_art command,
// cached in an LRU so each file is extracted at most once.

const coverArtCache = new SimpleLRU<string, string | null>(300);
const pendingArtRequests = new SimpleLRU<string, Promise<string | null>>(300);

export const TrackCover = memo(({
  src,
  path,
  title,
  artist,
  size,
  radius = 8,
  outline
}: {
  src?: string | null;
  path?: string | null;
  title?: string;
  artist?: string;
  size: number;
  radius?: number;
  outline?: string;
}) => {
  const isDirectWebUrl = Boolean(src && (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')));
  let targetPath = isDirectWebUrl ? src! : (src || path || '');
  let isOnlinePath = targetPath.startsWith('http://') || targetPath.startsWith('https://') || targetPath.startsWith('data:');

  if (!isDirectWebUrl && (!targetPath || isOnlinePath)) {
    const allTracks = useStore.getState().tracks || [];
    const localMatch = allTracks.find(t =>
      (path && pathsEqual(t.path, path)) ||
      (Boolean(title && artist) &&
       Boolean(t.title && t.artist) &&
       (t.title ?? '').trim().toLowerCase() === String(title).trim().toLowerCase() &&
       (t.artist ?? '').trim().toLowerCase() === String(artist).trim().toLowerCase())
    );
    if (localMatch) {
      targetPath = localMatch.cover_url || localMatch.path;
      isOnlinePath = targetPath.startsWith('http://') || targetPath.startsWith('https://') || targetPath.startsWith('data:');
    }
  }

  const [art, setArt] = useState<string | null>(() => {
    if (!targetPath) return null;
    if (isOnlinePath) return targetPath;
    return coverArtCache.get(targetPath) || null;
  });

  useEffect(() => {
    if (!targetPath) {
      setArt(null);
      return;
    }
    if (isOnlinePath) {
      setArt(targetPath);
      return;
    }

    let active = true;
    const cached = coverArtCache.get(targetPath);
    if (cached !== undefined) {
      setArt(cached);
      return;
    }

    if (!pendingArtRequests.has(targetPath)) {
      const req = Promise.resolve()
        .then(() => invoke<string | null>('get_cover_art', { path: targetPath }))
        .then((res) => {
          const artUrl = (res && typeof res === 'string') ? res : null;
          coverArtCache.set(targetPath, artUrl);
          return artUrl;
        })
        .catch(() => {
          coverArtCache.set(targetPath, null);
          return null;
        })
        .finally(() => {
          pendingArtRequests.delete(targetPath);
        });
      pendingArtRequests.set(targetPath, req);
    }

    pendingArtRequests.get(targetPath)?.then(resolved => {
      if (active) setArt(resolved || null);
    });

    return () => { active = false; };
  }, [targetPath, isOnlinePath]);

  return (
    <div style={{
      width: size, height: size, borderRadius: radius, overflow: 'hidden',
      flexShrink: 0, background: 'var(--ah-cover-bg)', position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: outline ? `0 0 0 2px ${outline}` : undefined,
    }}>
      {art ? (
        <img src={art} alt="" referrerPolicy="no-referrer" loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => {
            if (targetPath && !isOnlinePath) coverArtCache.set(targetPath, null);
            setArt(null);
          }} />
      ) : (
        <Music size={Math.max(13, size * 0.34)} color="var(--ah-dim)" />
      )}
    </div>
  );
});

// ── Shared props ────────────────────────────────────────────

export interface HomeResumeInfo {
  title: string;
  artist: string;
  positionLabel: string;
  coverUrl: string | null;
  coverPath?: string | null;
  accent?: string;
  onResume: () => void;
  onDismiss: () => void;
}

export interface AideoHomeProps {
  greeting: string;
  trackCount: number;
  totalPlays: number;
  discoveryData: DiscoveryHubData | null;
  isLoadingRecs: boolean;
  isRefreshingRecs: boolean;
  onRefreshRecs: () => void;
  onPlayTrack: (track: any) => void;
  renderDownloadAction: (track: any) => React.ReactNode;
  resume: HomeResumeInfo | null;
  search: SearchBarProps;
}

export interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  focused: boolean;
  onFocusChange: (f: boolean) => void;
  suggestions: string[];
  quickResults: any[];
  history: string[];
  source: 'youtube' | 'tidal' | 'qobuz';
  onSourceChange: (s: 'youtube' | 'tidal' | 'qobuz') => void;
  tidalConnected: boolean;
  qobuzEnabled: boolean;
  qobuzConnected: boolean;
  onSubmit: () => void;
  onPickQuery: (q: string) => void;
  onDeleteHistory: (e: React.MouseEvent, q: string) => void;
  onPlayQuickTrack: (track: any) => void;
  isSearching: boolean;
}

// ── Search bar (new design language; classic keeps its own markup) ──

export function AideoSearchBar({ variant, props }: { variant: 'column' | 'rail' | 'pill'; props: SearchBarProps }) {
  const {
    query, onQueryChange, focused, onFocusChange, suggestions, quickResults, history,
    source, onSourceChange, tidalConnected, qobuzEnabled, qobuzConnected,
    onSubmit, onPickQuery, onDeleteHistory, onPlayQuickTrack, isSearching,
  } = props;
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onFocusChange(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onFocusChange]);

  const sources: Array<{ id: 'youtube' | 'tidal' | 'qobuz'; label: string; dot?: string }> = [
    { id: 'youtube', label: variant === 'pill' ? 'YT' : 'YouTube' },
    { id: 'tidal', label: 'Tidal', dot: tidalConnected ? '#10b981' : 'rgba(239, 68, 68, 0.55)' },
    ...(qobuzEnabled ? [{ id: 'qobuz' as const, label: variant === 'pill' ? 'Qobuz' : 'Qobuz β', dot: qobuzConnected ? '#10b981' : 'rgba(239, 68, 68, 0.55)' }] : []),
  ];

  const pickSource = (id: 'youtube' | 'tidal' | 'qobuz') => {
    onSourceChange(id);
    if (id === 'tidal' && !tidalConnected) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Connect to Tidal first in Settings > Library > Tidal.', type: 'warning' } }));
    }
    if (id === 'qobuz' && !qobuzConnected) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Connect to Qobuz first in Settings > Library > Qobuz (Experimental).', type: 'warning' } }));
    }
  };

  const showDropdown = focused && (history.length > 0 || suggestions.length > 0 || quickResults.length > 0);

  return (
    <div className={`ah-search ah-search-${variant}`} ref={wrapRef}>
      {variant !== 'rail' && (
        <div className="ah-search-sources">
          {sources.map(s => (
            <button key={s.id} type="button"
              className={`ah-chip ${source === s.id ? 'active' : ''}`}
              onClick={() => pickSource(s.id)}>
              {s.dot && <span className="ah-chip-dot" style={{ background: s.dot }} />}
              {s.label}
            </button>
          ))}
        </div>
      )}
      <form className="ah-search-form" onSubmit={e => { e.preventDefault(); onSubmit(); }}>
        <div className="ah-search-field">
          <Search size={variant === 'rail' ? 15 : 18} />
          <input
            type="text"
            placeholder={variant === 'rail' ? 'Search the web…' : variant === 'pill' ? 'Search songs, artists, or links…' : 'Search songs, artists, or paste a link…'}
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onFocus={() => onFocusChange(true)}
            onKeyDown={e => { if (e.key === 'Escape') onFocusChange(false); }}
          />
          {query && (
            <button type="button" className="ah-search-clear" onClick={() => onQueryChange('')}>
              <X size={15} />
            </button>
          )}
          {isSearching && <Loader2 className="spin ah-search-spin" size={14} />}
        </div>
        {variant === 'rail' && (
          <div className="ah-search-rail-sources">
            {sources.map(s => (
              <button key={s.id} type="button"
                className={`ah-chip ah-chip-sm ${source === s.id ? 'active' : ''}`}
                title={s.label}
                onClick={() => pickSource(s.id)}>
                {s.dot && <span className="ah-chip-dot" style={{ background: s.dot }} />}
                {s.label.slice(0, 2)}
              </button>
            ))}
          </div>
        )}
      </form>

      {showDropdown && (
        <div className="ah-search-dropdown">
          {history.slice(0, 5).map(q => (
            <div key={`hist-${q}`} className="ah-dd-item" onClick={() => onPickQuery(q)}>
              <History size={14} />
              <span className="ah-dd-label">{q}</span>
              <button className="ah-dd-x" onClick={e => onDeleteHistory(e, q)}><X size={12} /></button>
            </div>
          ))}
          {suggestions.map(q => (
            <div key={`sugg-${q}`} className="ah-dd-item" onClick={() => onPickQuery(q)}>
              <Search size={14} />
              <span className="ah-dd-label">{q}</span>
            </div>
          ))}
          {quickResults.length > 0 && (
            <>
              <div className="ah-dd-section">Songs</div>
              {quickResults.map(track => (
                <div key={`quick-${track.id}`} className="ah-dd-item" onClick={() => onPlayQuickTrack(track)}>
                  <TrackCover src={track.cover_url} path={track.url} size={30} radius={6} outline={sourceTypeColor(track)} />
                  <span className="ah-dd-label" style={{ flex: 1 }}>
                    <span className="ah-dd-title">{track.title}</span>
                    <span className="ah-dd-sub">{track.artist}</span>
                  </span>
                  <span className="ah-dd-dur">{track.duration_raw}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Play button (single primary action per row/card) ─────────

export function PlayButton({ onClick, size = 34, playing = false }: { onClick: () => void; size?: number; playing?: boolean }) {
  return (
    <button className={`ah-play-btn ${playing ? 'playing' : ''}`} style={{ width: size, height: size }} onClick={e => { e.stopPropagation(); onClick(); }} title="Play">
      <Play size={Math.round(size * 0.38)} fill="currentColor" />
    </button>
  );
}

// Re-export so components can share the legacy-design guard in one import.
export { LEGACY_AIDEO_PAGE_DESIGNS };
