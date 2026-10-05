import { manageSourceQueue } from '../store/sourcePlayback';
import { SourceMenu } from './SourceMenu';
import { LibraryHealthPanel } from './LibraryHealthPanel';
import { useDownloadStore } from '../store/downloadStore';
import { useState, useEffect, memo, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { chainQueueOperation } from '../store/playbackSlice';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { 
  MoreVertical, RefreshCw, Activity, Loader2, Heart, ThumbsDown, DownloadCloud, Check, Trash2, 
  ListMusic, Disc, ArrowUpDown, Search, X, Sparkles, HardDrive, Globe, GripVertical, ArrowUp, ArrowDown, 
  Play, Tag, ListPlus, Plus, FolderPlus, Image, FileText, MinusCircle, Sliders, Layers, Terminal, BookOpen, Waves, LayoutGrid, ChevronDown 
} from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { Track, CloudTrack as ProviderCloudTrack, Playlist, LibraryDesign } from '../store/types';
import { useVirtualList } from '../utils/useVirtualList';
import { safeGetStorage, safeSetStorage } from '../utils/storage';
import { matchesSearchQuery } from '../utils/searchParser';
import { useRef } from 'react';
import { AlbumsView } from './AlbumsView';
import { SimpleLRU } from '../utils/lruCache';
import { fmt, baseName, isStreamTrack, isLosslessTrack, cloudTrackToVirtualTrack, getMenuPosition, startSonicMix } from '../utils';
import { shuffleArray } from '../utils/shuffle';
import './LibraryDesigns.css';

export const LIBRARY_DESIGNS: { id: LibraryDesign; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'classic', label: 'Classic', icon: <LayoutGrid size={14} />, desc: 'Track table and album grid' },
  { id: 'studio', label: 'Compact', icon: <Sliders size={14} />, desc: 'Compact rows with audio format labels' },
  { id: 'editorial', label: 'Large rows', icon: <BookOpen size={14} />, desc: 'Larger artwork and serif text' },
  { id: 'crate', label: 'Split view', icon: <Layers size={14} />, desc: 'Artist sidebar beside the track list' },
  { id: 'ambient', label: 'Rounded', icon: <Waves size={14} />, desc: 'Rounded rows with translucent backgrounds' },
  { id: 'brutalist', label: 'Grid', icon: <Terminal size={14} />, desc: 'Square rows with visible grid lines' },
];

const entryKey = (track: Track) => track.playlist_entry_id !== undefined ? `entry:${track.playlist_entry_id}` : track.source_context ? `recording:${track.source_context.recording_id}` : track.path;

const persistQueueState = (newQueue: any[], otherState?: Record<string, any>) => {
  useStore.setState({ queue: newQueue, ...otherState });
  if (newQueue.some(t => t.source_context)) void manageSourceQueue(useStore.setState);
  try {
    localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
  } catch (_) {}
};



type QuickFilterType = 'all' | 'loved' | 'lossless' | 'local' | 'streams';
type CloudTrack = ProviderCloudTrack & { path_hash?: string | null };




interface CloudCacheButtonProps {
  streamUrl: string;
  cacheCloudTrack: (track: any) => Promise<void> | void;
  deleteCachedTrack: (streamUrl: string) => Promise<void> | void;
  cachedCloudHashes: string[];
  precomputedHash?: string | null;
}

function CloudCacheButton({ streamUrl, cacheCloudTrack, deleteCachedTrack, cachedCloudHashes, precomputedHash }: CloudCacheButtonProps) {
  const [hash, setHash] = useState<string | null>(precomputedHash || null);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!precomputedHash) {
      invoke<string>('get_url_hash', { url: streamUrl }).then(setHash);
    } else {
      setHash(precomputedHash);
    }
  }, [streamUrl, precomputedHash]);

  const isCached = hash ? cachedCloudHashes.includes(hash) : false;

  if (!hash) return <div style={{ width: 28, height: 28 }} />;

  if (isCached) {
    return (
      <button
        onClick={async (e) => {
          e.stopPropagation();
          if (window.confirm("Are you sure you want to remove this track from offline cache?")) {
            setLoading(true);
            try {
              await deleteCachedTrack(streamUrl);
              window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Removed from offline cache', type: 'info' } }));
            } catch (err) {
              console.error(err);
            } finally {
              setLoading(false);
            }
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: 'transparent',
          border: 'none',
          color: hovered ? '#ef4444' : '#10b981',
          cursor: 'pointer',
          padding: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.2s',
          borderRadius: 6,
          width: 28,
          height: 28
        }}
        title={hovered ? "Remove from Cache" : "Cached Offline"}
      >
        {hovered ? <Trash2 size={14} /> : <Check size={14} />}
      </button>
    );
  }

  if (loading) {
    return (
      <div style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}>
        <Loader2 size={14} className="spin" />
      </div>
    );
  }

  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        setLoading(true);
        try {
          await cacheCloudTrack({ stream_url: streamUrl });
          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Cloud track cached successfully for offline playback!', type: 'success' } }));
        } catch (err) {
          console.error(err);
        } finally {
          setLoading(false);
        }
      }}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--text-dim)',
        cursor: 'pointer',
        padding: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'color 0.2s',
        borderRadius: 6,
      }}
      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text)'}
      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
      title="Cache Offline"
    >
      <DownloadCloud size={14} />
    </button>
  );
}

const coverArtCache = new SimpleLRU<string, string | null>(300);
const pendingArtRequests = new SimpleLRU<string, Promise<any>>(300);

function TrackThumbnail({ path, coverUrl }: { path: string, coverUrl?: string | null }) {
  const targetPath = coverUrl || path;
  const isDirectWebUrl = !!targetPath && (targetPath.startsWith('http://') || targetPath.startsWith('https://') || targetPath.startsWith('data:'));
  const [art, setArt] = useState<string | null>(() => {
    if (isDirectWebUrl) return targetPath;
    return coverArtCache.get(targetPath) || null;
  });

  useEffect(() => {
    if (!targetPath) {
      setArt(null);
      return;
    }

    if (isDirectWebUrl) {
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
      const req = invoke('get_cover_art', { path: targetPath }).then((res: any) => {
        const artUrl = (res && typeof res === 'string') ? res : null;
        coverArtCache.set(targetPath, artUrl);
        return artUrl;
      }).catch(() => {
        coverArtCache.set(targetPath, null);
        return null;
      }).finally(() => {
        pendingArtRequests.delete(targetPath);
      });
      pendingArtRequests.set(targetPath, req);
    }
    
    pendingArtRequests.get(targetPath)?.then(resolvedArt => {
      if (active) {
        setArt(resolvedArt || null);
      }
    });

    return () => {
      active = false;
    };
  }, [targetPath, isDirectWebUrl]);

  return (
    <div className="lib-thumb-mini">
      <img src={art || defaultCover} alt="" loading="lazy" decoding="async" />
    </div>
  );
}


interface TrackActionMenuProps {
  track: any;
  index: number;
  anchor: DOMRect | { x: number; y: number };
  isCloud?: boolean;
  onClose: () => void;
  playNextInQueue: (track: any) => Promise<boolean | void> | void;
  addToQueue: (track: any) => Promise<boolean | void> | void;
  setCoverArtModalTrack: (track: Track | null) => void;
  setEditModalFor: (track: Track | null) => void;
  setPlaylistModalFor: (track: Track | null) => void;
  setSourceModalTrack: (track: Track | null) => void;
  matchMetadata: (track: Track) => Promise<any>;
  setMatchData: (data: { track: Track; match: any } | null) => void;
  setIsMatching: (id: number | null) => void;
  isMatching: number | null;
  currentPlaylist: Playlist | null;
  reorderPlaylistTracks: (playlistId: number, fromIndex: number, toIndex: number) => Promise<void> | void;
  removeFromPlaylist: (playlistId: number, track: string | Track) => Promise<void> | void;
}

function TrackActionMenu({
  track,
  index,
  anchor,
  isCloud,
  onClose,
  playNextInQueue,
  addToQueue,
  setCoverArtModalTrack,
  setEditModalFor,
  setPlaylistModalFor,
  setSourceModalTrack,
  matchMetadata,
  setMatchData,
  setIsMatching,
  isMatching,
  currentPlaylist,
  reorderPlaylistTracks,
  removeFromPlaylist,
}: TrackActionMenuProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScrollOrResize = () => onClose();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [onClose]);

  const menuStyle = getMenuPosition(anchor);

  if (isCloud) {
    const vt = track.provider ? cloudTrackToVirtualTrack(track as CloudTrack) : track;
    return createPortal(
      <>
        <div
          className="track-action-menu-backdrop"
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
        />
        <div className="track-action-menu" style={menuStyle} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="track-action-menu-item" onClick={() => { onClose(); useDownloadStore.getState().open(vt); }}>
            <span className="menu-item-icon"><DownloadCloud size={15} /></span><span>Download Song</span>
          </button>
          <button
            type="button"
            className="track-action-menu-item"
            onClick={() => {
              onClose();
              playNextInQueue(vt);
            }}
          >
            <span className="menu-item-icon"><ListPlus size={15} /></span>
            <span>Play Next</span>
          </button>
          <button
            type="button"
            className="track-action-menu-item"
            onClick={() => {
              onClose();
              addToQueue(vt);
            }}
          >
            <span className="menu-item-icon"><Plus size={15} /></span>
            <span>Add to Queue</span>
          </button>
        </div>
      </>,
      document.body
    );
  }

  const currentPlaylistTracks = currentPlaylist ? useStore.getState().tracks : [];
  const realIdx = currentPlaylist
    ? currentPlaylistTracks.findIndex((item: any) =>
        track.playlist_entry_id !== undefined
          ? item.playlist_entry_id === track.playlist_entry_id
          : item.path === track.path
      )
    : -1;
  const effectiveIdx = realIdx !== -1 ? realIdx : index;
  const maxIdx = currentPlaylistTracks.length - 1;

  return createPortal(
    <>
      <div
        className="track-action-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="track-action-menu" style={menuStyle} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="track-action-menu-item" onClick={() => { onClose(); useDownloadStore.getState().open(track); }}>
          <span className="menu-item-icon"><DownloadCloud size={15} /></span><span>Download Song</span>
        </button>
        <button
          type="button"
          className="track-action-menu-item"
          onClick={() => {
            onClose();
            playNextInQueue(track);
          }}
        >
          <span className="menu-item-icon"><ListPlus size={15} /></span>
          <span>Play Next</span>
        </button>

        <button
          type="button"
          className="track-action-menu-item"
          onClick={() => {
            onClose();
            addToQueue(track);
          }}
        >
          <span className="menu-item-icon"><Plus size={15} /></span>
          <span>Add to Queue</span>
        </button>

        <button
          type="button"
          className="track-action-menu-item"
          onClick={() => {
            onClose();
            setCoverArtModalTrack(track);
          }}
        >
          <span className="menu-item-icon"><Image size={15} /></span>
          <span>Manage Cover Art</span>
        </button>

        <div className="track-action-menu-divider" />

        <button
          type="button"
          className="track-action-menu-item accent"
          onClick={async () => {
            onClose();
            setIsMatching(track.id);
            try {
              const match = await matchMetadata(track);
              if (match) {
                setMatchData({ track, match });
              } else {
                window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'No match found for this track.', type: 'warning' } }));
              }
            } catch (err) {
              window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Metadata lookup failed: ${err}`, type: 'error' } }));
            } finally {
              setIsMatching(null);
            }
          }}
        >
          <span className="menu-item-icon">
            {isMatching === track.id ? <RefreshCw size={15} className="spin" /> : <Activity size={15} />}
          </span>
          <span>{isMatching === track.id ? 'Searching...' : 'Match metadata'}</span>
        </button>

        <button
          type="button"
          className="track-action-menu-item emerald"
          onClick={async () => {
            onClose();
            await startSonicMix(track.path, useStore.getState());
          }}
        >
          <span className="menu-item-icon"><Sparkles size={15} /></span>
          <span>Play similar tracks</span>
        </button>

        <div className="track-action-menu-divider" />

        <button
          type="button"
          className="track-action-menu-item accent"
          onClick={() => {
            onClose();
            useStore.getState().setTagEditorTrack(track);
          }}
        >
          <span className="menu-item-icon"><Tag size={15} /></span>
          <span>Edit Audio Tags</span>
        </button>

        <button
          type="button"
          className="track-action-menu-item"
          onClick={() => {
            onClose();
            setEditModalFor(track);
          }}
        >
          <span className="menu-item-icon"><FileText size={15} /></span>
          <span>Edit Song Data</span>
        </button>

        <div className="track-action-menu-divider" />

        <button
          type="button"
          className="track-action-menu-item"
          onClick={() => {
            onClose();
            setSourceModalTrack(track);
          }}
        >
          <span className="menu-item-icon"><Globe size={15} /></span>
          <span>Other Audio Sources</span>
        </button>

        {currentPlaylist ? (
          <>
            {effectiveIdx > 0 && (
              <button
                type="button"
                className="track-action-menu-item"
                onClick={() => {
                  onClose();
                  reorderPlaylistTracks(currentPlaylist.id, effectiveIdx, effectiveIdx - 1);
                }}
              >
                <span className="menu-item-icon"><ArrowUp size={15} /></span>
                <span>Move Up</span>
              </button>
            )}
            {effectiveIdx < maxIdx && (
              <button
                type="button"
                className="track-action-menu-item"
                onClick={() => {
                  onClose();
                  reorderPlaylistTracks(currentPlaylist.id, effectiveIdx, effectiveIdx + 1);
                }}
              >
                <span className="menu-item-icon"><ArrowDown size={15} /></span>
                <span>Move Down</span>
              </button>
            )}
            <button
              type="button"
              className="track-action-menu-item danger"
              onClick={() => {
                onClose();
                removeFromPlaylist(currentPlaylist.id, track);
              }}
            >
              <span className="menu-item-icon"><MinusCircle size={15} /></span>
              <span>Remove from Playlist</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="track-action-menu-item"
            onClick={() => {
              onClose();
              setPlaylistModalFor(track);
            }}
          >
            <span className="menu-item-icon"><FolderPlus size={15} /></span>
            <span>Add to Playlist...</span>
          </button>
        )}

        <div className="track-action-menu-divider" />

        <button
          type="button"
          className="track-action-menu-item danger"
          onClick={() => {
            onClose();
            if (window.confirm(`Are you sure you want to delete "${track.title || track.path}"? This will remove it from your library and delete the file.`)) {
              useStore.getState().deleteTrack(track.path);
            }
          }}
        >
          <span className="menu-item-icon"><Trash2 size={15} /></span>
          <span>Delete Song</span>
        </button>
      </div>
    </>,
    document.body
  );
}

interface TrackRowProps {
  t: Track;
  i: number;
  totalTracks: number;
  active: boolean;
  isHighRes: boolean;
  currentPlaylist: Playlist | null;
  playTrack: (track: Track) => Promise<void> | void;
  setView: (view: any) => void;
  onOpenMenu: (track: Track, index: number, anchor: DOMRect | { x: number; y: number }) => void;
  toggleLoveTrack: (path: string, metadata?: Partial<Track>) => Promise<boolean | void> | void;
  toggleDislikeTrack: (path: string, metadata?: Partial<Track>) => Promise<void> | void;
  cacheCloudTrack: (track: Track) => Promise<void> | void;
  deleteCachedTrack: (streamUrl: string) => Promise<void> | void;
  cachedCloudHashes: string[];
  isDraggable?: boolean;
  isDragged?: boolean;
  isDragOver?: boolean;
  onPointerDragStart?: (i: number, e: React.PointerEvent) => void;
  isSelected?: boolean;
  onRowClick?: (t: any, i: number, e: React.MouseEvent) => void;
  onSelectArtist?: (artist: string) => void;
  design?: LibraryDesign;
}

const TrackRow = memo(({ 
  t, i, totalTracks: _totalTracks, active, isHighRes, currentPlaylist: _currentPlaylist, 
  playTrack, setView, onOpenMenu,
  toggleLoveTrack, toggleDislikeTrack, cacheCloudTrack, deleteCachedTrack, cachedCloudHashes,
  isDraggable, isDragged, isDragOver, onPointerDragStart, isSelected, onRowClick, onSelectArtist,
  design
}: TrackRowProps) => {
  const isDolbyAtmos = t.format?.toLowerCase() === 'dolby' || t.format?.toLowerCase() === 'atmos' || t.format?.toLowerCase() === 'dolby atmos';
  return (
    <tr 
      className={`track-row${active ? ' playing' : ''}${isSelected ? ' selected' : ''}`}
      data-playlist-track-index={i}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenMenu(t, i, { x: e.clientX, y: e.clientY });
      }}
      style={{ 
        position: 'relative', 
        zIndex: 1,
        opacity: isDragged ? 0.35 : 1,
        background: isSelected 
          ? 'rgba(var(--accent-rgb, 139, 92, 246), 0.16)' 
          : (isDragOver ? 'rgba(var(--accent-rgb, 139, 92, 246), 0.16)' : undefined),
        borderTop: isDragOver && !isDragged ? '2px solid var(--accent, #8b5cf6)' : undefined,
        transition: 'background 0.15s, opacity 0.15s',
        userSelect: isDraggable ? 'none' : 'auto'
      }}
      onClick={(e) => {
        if (onRowClick) {
          onRowClick(t, i, e);
        } else {
          playTrack(t);
          setView('nowplaying');
        }
      }}
    >
      <td 
        style={{ 
          textAlign: 'center', 
          color: isSelected ? 'var(--accent)' : (active ? 'var(--accent)' : 'var(--text-dim)'), 
          fontSize: 12,
          fontWeight: isSelected ? 800 : 'normal',
          cursor: isDraggable ? 'grab' : 'inherit',
          userSelect: 'none'
        }}
        title={isDraggable ? 'Drag to reorder' : undefined}
      >
        {isDraggable ? (
          <div 
            onPointerDown={(e) => onPointerDragStart?.(i, e)}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              cursor: 'grab',
              padding: '4px 0'
            }}
          >
            <GripVertical size={14} style={{ opacity: isDragged ? 0.3 : 0.6 }} />
          </div>
        ) : (
          design === 'brutalist' ? (
            active ? '[▶]' : `[${String(i + 1).padStart(2, '0')}]`
          ) : design === 'studio' ? (
            <span className="studio-mono">{active ? '▶' : String(i + 1).padStart(2, '0')}</span>
          ) : (
            active ? '▶' : i + 1
          )
        )}
      </td>
      <td style={{ textAlign: 'center', padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleLoveTrack(t.path, t);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: t.loved === 1 ? '#ef4444' : 'var(--text-dim)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease',
            }}
            title={t.loved === 1 ? "Unlove track" : "Love track"}
          >
            <Heart size={14} fill={t.loved === 1 ? '#ef4444' : 'transparent'} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleDislikeTrack(t.path, t);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: t.disliked === 1 ? '#f43f5e' : 'var(--text-dim)',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease',
            }}
            title={t.disliked === 1 ? "Undislike track" : "Dislike track"}
          >
            <ThumbsDown size={14} fill={t.disliked === 1 ? '#f43f5e' : 'transparent'} />
          </button>
        </div>
      </td>
      <td>
        {design === 'editorial' ? (
          <div className="editorial-sleeve-thumb">
            <TrackThumbnail path={t.path} coverUrl={t.cover_url} />
          </div>
        ) : (
          <TrackThumbnail path={t.path} coverUrl={t.cover_url} />
        )}
      </td>
      <td className="cell-truncate">
        <div className="track-name">{t.title || baseName(t.path)}</div>
      </td>
      <td className="cell-truncate">
        <div 
          className="track-sub"
          style={{ cursor: t.artist ? 'pointer' : 'default' }}
          title={t.artist ? `Filter by artist: ${t.artist}` : undefined}
          onClick={(e) => {
            if (t.artist && onSelectArtist) {
              e.stopPropagation();
              onSelectArtist(t.artist);
            }
          }}
        >{t.artist || '—'}</div>
      </td>
      <td style={{ textAlign: 'center' }}>
        {t.format && (
          design === 'studio' ? (
            <span className={`studio-codec-badge ${
              t.format.toLowerCase().includes('dsf') || t.format.toLowerCase().includes('dff') || t.format.toLowerCase().includes('dsd') ? 'dsd' :
              isHighRes ? 'flac' : ''
            }`}>
              {t.format.toUpperCase() === 'YOUTUBE DIRECT' ? 'STREAM' : t.format.toUpperCase()}
            </span>
          ) : design === 'brutalist' ? (
            <span className="brutalist-tag">{t.format.toUpperCase()}</span>
          ) : design === 'ambient' ? (
            <span className="ambient-capsule-badge">{t.format.toUpperCase()}</span>
          ) : (
            <span 
              className={`quality-tag ${isHighRes ? 'high-res' : ''} ${
                isStreamTrack(t.path, t.format) || t.format.toUpperCase() === 'YOUTUBE DIRECT' ? 'web-stream' : ''
              } ${
                t.format.toLowerCase().includes('dsf') || t.format.toLowerCase().includes('dff') || t.format.toLowerCase().includes('dsd') ? 'dsd-gold' : ''
              } ${isDolbyAtmos ? 'dolby-atmos' : ''}`}
              style={{
                background: (t.format.toLowerCase().includes('dsf') || t.format.toLowerCase().includes('dff') || t.format.toLowerCase().includes('dsd'))
                  ? 'linear-gradient(135deg, #FFE082, #FFB300, #FF8F00)'
                  : undefined,
                boxShadow: (t.format.toLowerCase().includes('dsf') || t.format.toLowerCase().includes('dff') || t.format.toLowerCase().includes('dsd'))
                  ? '0 0 10px rgba(255, 179, 0, 0.45)'
                  : undefined,
                border: (t.format.toLowerCase().includes('dsf') || t.format.toLowerCase().includes('dff') || t.format.toLowerCase().includes('dsd'))
                  ? '1px solid rgba(255, 224, 130, 0.4)'
                  : undefined,
                color: (t.format.toLowerCase().includes('dsf') || t.format.toLowerCase().includes('dff') || t.format.toLowerCase().includes('dsd'))
                  ? '#0a0a0f'
                  : undefined,
                fontWeight: (t.format.toLowerCase().includes('dsf') || t.format.toLowerCase().includes('dff') || t.format.toLowerCase().includes('dsd'))
                  ? 800
                  : undefined
              }}
            >
              {t.format.toUpperCase() === 'YOUTUBE DIRECT' ? 'WEB STREAM' : t.format.toUpperCase()}
            </span>
          )
        )}
      </td>
      <td style={{ textAlign: 'right', overflow: 'visible' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <span style={{ 
            fontVariantNumeric: 'tabular-nums', 
            fontSize: 12, 
            color: 'var(--text-dim)', 
            minWidth: 38, 
            textAlign: 'right' 
          }}>
            {fmt(t.duration)}
          </span>
          <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isStreamTrack(t.path, t.format) && (
              <CloudCacheButton 
                streamUrl={t.path} 
                cacheCloudTrack={() => cacheCloudTrack(t)} 
                deleteCachedTrack={deleteCachedTrack} 
                cachedCloudHashes={cachedCloudHashes} 
                precomputedHash={t.path_hash}
              />
            )}
          </div>
          <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <button
              className="icon-btn"
              type="button"
              title="More options"
              onClick={(e) => { 
                e.stopPropagation(); 
                onOpenMenu(t, i, e.currentTarget.getBoundingClientRect()); 
              }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
});

const CloudTrackRow = memo(({ 
  t, i, active, onOpenMenu, playCloudTrack,
  cacheCloudTrack, deleteCachedTrack, cachedCloudHashes, onSelectArtist
}: {
  t: CloudTrack,
  i: number,
  active: boolean,
  onOpenMenu: (track: any, index: number, anchor: DOMRect | { x: number; y: number }, isCloud?: boolean) => void,
  playCloudTrack: (track: CloudTrack) => void,
  cacheCloudTrack: (track: any) => Promise<void>,
  deleteCachedTrack: (streamUrl: string) => Promise<void>,
  cachedCloudHashes: string[],
  onSelectArtist?: (artist: string) => void
}) => {
  const vt = cloudTrackToVirtualTrack(t);
  
  return (
    <tr className={`track-row${active ? ' playing' : ''}`}
      style={{ position: 'relative', zIndex: 1 }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenMenu(vt, i, { x: e.clientX, y: e.clientY }, true);
      }}
      onClick={() => playCloudTrack(t)}>
      <td style={{ textAlign: 'center', color: active ? 'var(--accent)' : 'var(--text-dim)', fontSize: 12 }}>
        {active ? '▶' : i + 1}
      </td>
      <td>
        <TrackThumbnail path={t.stream_url} coverUrl={t.cover_url} />
      </td>
      <td className="cell-truncate">
        <div className="track-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{t.title}</span>
          <span style={{ 
            fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 4, 
            background: t.provider === 'subsonic' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(168, 85, 247, 0.1)', 
            color: t.provider === 'subsonic' ? '#6366f1' : '#a855f7',
            border: t.provider === 'subsonic' ? '1px solid rgba(99, 102, 241, 0.2)' : '1px solid rgba(168, 85, 247, 0.2)'
          }}>
            {t.provider.toUpperCase()}
          </span>
        </div>
      </td>
      <td className="cell-truncate">
        <div 
          className="track-sub"
          style={{ cursor: t.artist ? 'pointer' : 'default' }}
          title={t.artist ? `Filter by artist: ${t.artist}` : undefined}
          onClick={(e) => {
            if (t.artist && onSelectArtist) {
              e.stopPropagation();
              onSelectArtist(t.artist);
            }
          }}
        >{t.artist || '—'}</div>
      </td>
      <td style={{ textAlign: 'center' }}>
        <span className="quality-tag high-res">LOSSLESS</span>
      </td>
      <td style={{ textAlign: 'right', overflow: 'visible' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <span style={{ 
            fontVariantNumeric: 'tabular-nums', 
            fontSize: 12, 
            color: 'var(--text-dim)', 
            minWidth: 38, 
            textAlign: 'right' 
          }}>
            {fmt(t.duration)}
          </span>
          <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CloudCacheButton 
              streamUrl={t.stream_url} 
              cacheCloudTrack={() => cacheCloudTrack(t)} 
              deleteCachedTrack={deleteCachedTrack} 
              cachedCloudHashes={cachedCloudHashes} 
              precomputedHash={t.path_hash}
            />
          </div>
          <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <button
              className="icon-btn"
              type="button"
              title="More options"
              onClick={(e) => { 
                e.stopPropagation(); 
                onOpenMenu(vt, i, e.currentTarget.getBoundingClientRect(), true); 
              }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
});

export function LibraryView() {
  const healthDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const show = () => { if (healthDetails.current) { healthDetails.current.open = true; healthDetails.current.querySelector('summary')?.focus(); } };
    if (useStore.getState().playbackRecovery?.action === 'library') show();
    window.addEventListener('open-library-health', show);
    return () => window.removeEventListener('open-library-health', show);
  }, []);
  const { 
    view, tracks, currentTrackPath, loadLibrary, playTrack, setView, currentPlaylist, removeFromPlaylist,
    reorderPlaylistTracks,
    matchMetadata, addToQueue, playNextInQueue, playlists, addToPlaylist,
    subsonicUrl, subsonicUser, subsonicConnected, subsonicPass,
    jellyfinUrl, jellyfinConnected, toggleLoveTrack, toggleDislikeTrack, cacheCloudTrack, deleteCachedTrack, cachedCloudHashes, fetchCachedCloudHashes,
    setCoverArtModalTrack, librarySearchQuery, setLibrarySearchQuery,
    libraryDesign, setLibraryDesign,
    albumViewMode
  } = useStore(useShallow(s => ({
    view: s.view,
    tracks: s.tracks,
    currentTrackPath: s.playback.current_track,
    loadLibrary: s.loadLibrary,
    playTrack: s.playTrack,
    setView: s.setView,
    currentPlaylist: s.currentPlaylist,
    removeFromPlaylist: s.removeFromPlaylist,
    reorderPlaylistTracks: s.reorderPlaylistTracks,
    matchMetadata: s.matchMetadata,
    addToQueue: s.addToQueue,
    playNextInQueue: s.playNextInQueue,
    playlists: s.playlists,
    addToPlaylist: s.addToPlaylist,
    subsonicUrl: s.subsonicUrl,
    subsonicUser: s.subsonicUser,
    subsonicConnected: s.subsonicConnected,
    subsonicPass: s.subsonicPass,
    jellyfinUrl: s.jellyfinUrl,
    jellyfinConnected: s.jellyfinConnected,
    toggleLoveTrack: s.toggleLoveTrack,
    toggleDislikeTrack: s.toggleDislikeTrack,
    cacheCloudTrack: s.cacheCloudTrack,
    deleteCachedTrack: s.deleteCachedTrack,
    cachedCloudHashes: s.cachedCloudHashes,
    fetchCachedCloudHashes: s.fetchCachedCloudHashes,
    setCoverArtModalTrack: s.setCoverArtModalTrack,
    librarySearchQuery: s.librarySearchQuery,
    setLibrarySearchQuery: s.setLibrarySearchQuery,
    libraryDesign: s.libraryDesign,
    setLibraryDesign: s.setLibraryDesign,
    albumViewMode: s.albumViewMode,
  })));

  useEffect(() => {
    fetchCachedCloudHashes();
    if (view === 'loved_streams' || currentPlaylist) {
      setViewMode('tracks');
    }
  }, [view, currentPlaylist]);

  const [activeSector, setActiveSector] = useState<'local' | 'subsonic' | 'jellyfin'>('local');
  const [activeFilter, setActiveFilter] = useState<QuickFilterType>('all');
  const [viewMode, setViewModeState] = useState<'tracks' | 'albums'>(() => {
    return (safeGetStorage('aideo-library-view-mode') as 'tracks' | 'albums') || 'tracks';
  });
  const setViewMode = (mode: 'tracks' | 'albums') => {
    safeSetStorage('aideo-library-view-mode', mode);
    setViewModeState(mode);
  };

  const [albumSortBy, setAlbumSortByState] = useState<'title' | 'artist' | 'count' | 'recent'>(() => {
    return (safeGetStorage('aideo-album-sort-by') as 'title' | 'artist' | 'count' | 'recent') || 'title';
  });
  const setAlbumSortBy = (sort: 'title' | 'artist' | 'count' | 'recent') => {
    safeSetStorage('aideo-album-sort-by', sort);
    setAlbumSortByState(sort);
  };
  const [albumCount, setAlbumCount] = useState<number>(0);
  const [activeMenu, setActiveMenu] = useState<{
    track: any;
    index: number;
    anchor: DOMRect | { x: number; y: number };
    isCloud?: boolean;
  } | null>(null);

  const handleOpenMenu = useCallback((track: any, index: number, anchor: DOMRect | { x: number; y: number }, isCloud?: boolean) => {
    setActiveMenu({ track, index, anchor, isCloud });
  }, []);

  const handleCloseMenu = useCallback(() => {
    setActiveMenu(null);
  }, []);

  useEffect(() => {
    setActiveFilter('all');
  }, [view, currentPlaylist, activeSector]);
  const [matchData, setMatchData] = useState<{ track: any, match: any } | null>(null);
  const [isMatching, setIsMatching] = useState<number | null>(null);
  const [playlistModalFor, setPlaylistModalFor] = useState<any | null>(null);
  const [editModalFor, setEditModalFor] = useState<any | null>(null);
  const [sourceModalTrack, setSourceModalTrack] = useState<Track | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editAlbum, setEditAlbum] = useState('');
  const handleSelectArtist = useCallback((artist: string) => {
    if (!artist || artist === '—' || artist === 'Unknown Artist') return;
    setSearchQuery(artist);
    setDebouncedSearchQuery(artist);
    setLibrarySearchQuery(artist);
  }, [setLibrarySearchQuery]);

  const [searchQuery, setSearchQuery] = useState(librarySearchQuery || '');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(librarySearchQuery || '');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [designMenuOpen, setDesignMenuOpen] = useState(false);
  const designMenuRef = useRef<HTMLDivElement | null>(null);
  const [crateArtistSearch, setCrateArtistSearch] = useState('');
  const [selectedCrateArtist, setSelectedCrateArtist] = useState<string | null>(null);
  const crateSidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (designMenuRef.current && !designMenuRef.current.contains(e.target as Node)) {
        setDesignMenuOpen(false);
      }
    };
    if (designMenuOpen) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [designMenuOpen]);

  // Sync with store-level librarySearchQuery navigation
  useEffect(() => {
    if (librarySearchQuery !== undefined && librarySearchQuery !== searchQuery) {
      setSearchQuery(librarySearchQuery);
      setDebouncedSearchQuery(librarySearchQuery);
    }
  }, [librarySearchQuery]);

  // Multi-Select state & bulk actions
  const [selectedTrackPaths, setSelectedTrackPaths] = useState<string[]>([]);
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const [bulkPlaylistModal, setBulkPlaylistModal] = useState(false);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearchQuery(searchQuery), 120);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Clear multi-select when switching view, sector, or filter
  useEffect(() => {
    setSelectedTrackPaths([]);
    setLastSelectedIdx(null);
  }, [view, currentPlaylist, activeSector, activeFilter]);
  
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const startPlaylistPointerDrag = useCallback((startIdx: number, e: React.PointerEvent) => {
    if (e.button !== 0 || !currentPlaylist) return;
    e.preventDefault();
    e.stopPropagation();

    let currentOverIdx = startIdx;
    setDraggedIdx(startIdx);
    setDragOverIdx(startIdx);

    const onPointerMove = (moveEvt: PointerEvent) => {
      const el = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
      const target = el?.closest('[data-playlist-track-index]');
      if (target) {
        const idxStr = target.getAttribute('data-playlist-track-index');
        if (idxStr !== null) {
          const idx = parseInt(idxStr, 10);
          if (!isNaN(idx)) {
            currentOverIdx = idx;
            setDragOverIdx(idx);
          }
        }
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (currentPlaylist && startIdx !== currentOverIdx) {
        reorderPlaylistTracks(currentPlaylist.id, startIdx, currentOverIdx);
      }
      setDraggedIdx(null);
      setDragOverIdx(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, [currentPlaylist, reorderPlaylistTracks]);
  
  // Deferred rendering for large libraries to prevent initial load jank
  const [libraryReady, setLibraryReady] = useState(tracks.length < 200);

  useEffect(() => {
    if (!libraryReady) {
      const timer = setTimeout(() => setLibraryReady(true), 100);
      return () => clearTimeout(timer);
    }
  }, []);
  
  // Cloud collections and pagination
  const [subsonicTracks, setSubsonicTracks] = useState<CloudTrack[]>([]);
  const [subsonicLoading, setSubsonicLoading] = useState(false);
  const [subsonicHasMore, setSubsonicHasMore] = useState(true);
  
  const [jellyfinTracks, setJellyfinTracks] = useState<CloudTrack[]>([]);
  const [jellyfinLoading, setJellyfinLoading] = useState(false);
  const [jellyfinHasMore, setJellyfinHasMore] = useState(true);
  
  const [cloudSearchQuery, setCloudSearchQuery] = useState('');

  useEffect(() => {
    if (activeSector === 'subsonic' && !subsonicConnected) {
      setActiveSector('local');
    }
    if (activeSector === 'jellyfin' && !jellyfinConnected) {
      setActiveSector('local');
    }
  }, [subsonicConnected, jellyfinConnected, activeSector]);

  useEffect(() => {
    if (activeSector === 'subsonic' && subsonicTracks.length === 0) {
      fetchSubsonicTracks(0, true);
    } else if (activeSector === 'jellyfin' && jellyfinTracks.length === 0) {
      fetchJellyfinTracks(0, true);
    }
  }, [activeSector]);

  const fetchSubsonicTracks = async (offset: number, isInitial: boolean) => {
    if (subsonicLoading) return;
    setSubsonicLoading(true);
    try {
      const pass = subsonicPass || '';
      const limit = isInitial ? 100 : 50;
      const results = await invoke<CloudTrack[]>('subsonic_get_library', {
        url: subsonicUrl,
        user: subsonicUser,
        pass,
        query: cloudSearchQuery.trim(),
        offset,
        limit
      });
      if (isInitial) {
        setSubsonicTracks(results);
        setSubsonicHasMore(results.length >= 100);
      } else {
        setSubsonicTracks(prev => [...prev, ...results]);
        setSubsonicHasMore(results.length >= 50);
      }
    } catch (err) {
      console.error('Failed to fetch Subsonic tracks:', err);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Subsonic fetch failed: ${err}`, type: 'error' } 
      }));
    } finally {
      setSubsonicLoading(false);
    }
  };

  const fetchJellyfinTracks = async (offset: number, isInitial: boolean) => {
    if (jellyfinLoading) return;
    setJellyfinLoading(true);
    try {
      const apiKey = localStorage.getItem('aideo_jellyfin_api_key') || '';
      const limit = isInitial ? 100 : 50;
      const results = await invoke<CloudTrack[]>('jellyfin_get_library', {
        url: jellyfinUrl,
        apiKey,
        query: cloudSearchQuery.trim(),
        offset,
        limit
      });
      if (isInitial) {
        setJellyfinTracks(results);
        setJellyfinHasMore(results.length >= 100);
      } else {
        setJellyfinTracks(prev => [...prev, ...results]);
        setJellyfinHasMore(results.length >= 50);
      }
    } catch (err) {
      console.error('Failed to fetch Jellyfin tracks:', err);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Jellyfin fetch failed: ${err}`, type: 'error' } 
      }));
    } finally {
      setJellyfinLoading(false);
    }
  };

  const loadMoreSubsonic = () => {
    if (subsonicLoading || !subsonicHasMore) return;
    fetchSubsonicTracks(subsonicTracks.length, false);
  };

  const loadMoreJellyfin = () => {
    if (jellyfinLoading || !jellyfinHasMore) return;
    fetchJellyfinTracks(jellyfinTracks.length, false);
  };

  const handleCloudSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeSector === 'subsonic') {
      fetchSubsonicTracks(0, true);
    } else if (activeSector === 'jellyfin') {
      fetchJellyfinTracks(0, true);
    }
  };

  const playCloudTrack = async (ct: CloudTrack) => {
    const vt = cloudTrackToVirtualTrack(ct);
    await playTrack(vt);
    
    if (ct.cover_url) {
      useStore.setState({ coverArt: ct.cover_url });
      invoke('update_media_metadata', {
        title: ct.title,
        artist: ct.artist,
        coverUrl: ct.cover_url,
        duration: ct.duration,
      }).catch(() => {});
    }
  };

  const handlePlayAllCloud = async (shuffle = false) => {
    const currentList = activeSector === 'subsonic' ? subsonicTracks : jellyfinTracks;
    if (currentList.length === 0) return;
    
    const virtualTracks = currentList.map(cloudTrackToVirtualTrack);
    let tracksToQueue: any[] = [];
    let firstTrack: any = null;
    
    if (shuffle) {
      const shuffled = shuffleArray(virtualTracks);
      firstTrack = shuffled[0];
      tracksToQueue = shuffled.slice(1);
      persistQueueState(tracksToQueue, { shuffle: true });
    } else {
      firstTrack = virtualTracks[0];
      tracksToQueue = virtualTracks.slice(1);
      persistQueueState(tracksToQueue, { shuffle: false });
    }
    
    // Sync the queue to the backend immediately to prevent duplicates/desyncs
    try {
      await invoke('clear_queue');
      if (tracksToQueue.length > 0) {
        const paths = tracksToQueue.map(t => t.path);
        await invoke('add_to_queue_bulk', { paths });
      }
    } catch (e) {
      console.error('Failed to sync cloud queue to backend:', e);
    }

    await playTrack(firstTrack, false, false);
    setView('nowplaying');
  };

  useEffect(() => {
    if (editModalFor) {
      setEditTitle(editModalFor.title || '');
      setEditArtist(editModalFor.artist || '');
      setEditAlbum(editModalFor.album || '');
    } else {
      setEditTitle('');
      setEditArtist('');
      setEditAlbum('');
    }
  }, [editModalFor]);

  const isLovedStreamsView = view === 'loved_streams';

  const sourceTracks = isLovedStreamsView
    ? tracks.filter((t: any) => isStreamTrack(t.path, t.format) && t.loved === 1)
    : (currentPlaylist 
        ? tracks 
        : tracks.filter((t: any) => !isStreamTrack(t.path, t.format))
      );

  const { countLoved, countLossless, countLocal, countStreams } = useMemo(() => {
    let loved = 0;
    let lossless = 0;
    let local = 0;
    let streams = 0;
    for (let idx = 0; idx < sourceTracks.length; idx++) {
      const t = sourceTracks[idx];
      if (t.loved === 1) loved++;
      if (isLosslessTrack(t)) lossless++;
      if (isStreamTrack(t.path, t.format)) streams++;
      else local++;
    }
    return { countLoved: loved, countLossless: lossless, countLocal: local, countStreams: streams };
  }, [sourceTracks]);

  const countAll = sourceTracks.length;

  const crateArtists = useMemo(() => {
    if (libraryDesign !== 'crate') return [];
    const counts = new Map<string, number>();
    for (const t of sourceTracks) {
      const art = t.artist || 'Unknown Artist';
      counts.set(art, (counts.get(art) || 0) + 1);
    }
    const list = Array.from(counts.entries()).map(([artist, count]) => ({ artist, count }));
    list.sort((a, b) => a.artist.localeCompare(b.artist));
    return list;
  }, [sourceTracks, libraryDesign]);

  const filteredCrateArtists = useMemo(() => {
    if (!crateArtistSearch.trim()) return crateArtists;
    const q = crateArtistSearch.toLowerCase();
    return crateArtists.filter(a => a.artist.toLowerCase().includes(q));
  }, [crateArtists, crateArtistSearch]);

  const filteredTracks = useMemo(() => {
    return sourceTracks.filter((t: any) => {
      // 1. Quick Filter Chip
      if (activeFilter === 'loved' && t.loved !== 1) return false;
      if (activeFilter === 'lossless' && !isLosslessTrack(t)) return false;
      if (activeFilter === 'local' && isStreamTrack(t.path, t.format)) return false;
      if (activeFilter === 'streams' && !isStreamTrack(t.path, t.format)) return false;

      // 2. Crate Digger artist filter
      if (libraryDesign === 'crate' && selectedCrateArtist && (t.artist || 'Unknown Artist') !== selectedCrateArtist) {
        return false;
      }

      // 3. Scoped Search Query matching
      if (!debouncedSearchQuery) return true;
      return matchesSearchQuery(t, debouncedSearchQuery);
    });
  }, [sourceTracks, activeFilter, libraryDesign, selectedCrateArtist, debouncedSearchQuery]);

  // Multi-Select keyboard shortcuts (Ctrl+A / Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (view !== 'library') return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedTrackPaths(filteredTracks.map(entryKey));
      } else if (e.key === 'Escape') {
        setSelectedTrackPaths([]);
        setLastSelectedIdx(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, filteredTracks]);

  const lastSelectedIdxRef = useRef(lastSelectedIdx);
  lastSelectedIdxRef.current = lastSelectedIdx;

  const filteredTracksRef = useRef(filteredTracks);
  filteredTracksRef.current = filteredTracks;

  const handleTrackRowClick = useCallback((t: any, index: number, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectedTrackPaths(prev => 
        prev.includes(entryKey(t)) ? prev.filter(p => p !== entryKey(t)) : [...prev, entryKey(t)]
      );
      setLastSelectedIdx(index);
      return;
    }

    const lastIdx = lastSelectedIdxRef.current;
    if (e.shiftKey && lastIdx !== null) {
      e.preventDefault();
      const start = Math.min(lastIdx, index);
      const end = Math.max(lastIdx, index);
      const range = filteredTracksRef.current.slice(start, end + 1).map(entryKey);
      setSelectedTrackPaths(prev => Array.from(new Set([...prev, ...range])));
      return;
    }

    setSelectedTrackPaths(prev => (prev.length > 0 ? [] : prev));
    setLastSelectedIdx(null);
    playTrack(t);
    setView('nowplaying');
  }, [playTrack, setView]);

  const selectedSet = useMemo(() => new Set(selectedTrackPaths), [selectedTrackPaths]);

  const handlePlaySelected = async () => {
    const selected = filteredTracks.filter((t: any) => selectedSet.has(entryKey(t)));
    if (selected.length === 0) return;
    const first = selected[0];
    const rest = selected.slice(1);
    persistQueueState(rest, { shuffle: false });
    try {
      await invoke('clear_queue');
      if (rest.length > 0) {
        const paths = rest.map((t: any) => t.path);
        await invoke('add_to_queue_bulk', { paths });
      }
    } catch (e) { console.error(e); }
    await playTrack(first, false, false);
    setView('nowplaying');
  };

  const handleBulkAddToQueue = async () => {
    const selected = filteredTracks.filter((t: any) => selectedSet.has(entryKey(t)));
    if (selected.length === 0) return;
    const currentQ = useStore.getState().queue;
    persistQueueState([...currentQ, ...selected]);
    try {
      const paths = selected.map((t: any) => t.path);
      await invoke('add_to_queue_bulk', { paths });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added ${selected.length} songs to queue`, type: 'success' } }));
    } catch (e) { console.error(e); }
  };

  const handleBulkFavorite = async () => {
    const selected = filteredTracks.filter((t: any) => selectedSet.has(entryKey(t)));
    for (const t of selected) {
      if (t.loved !== 1) {
        toggleLoveTrack(t.path, t);
      }
    }
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Loved ${selected.length} songs`, type: 'success' } }));
  };

  const itemHeight = 
    libraryDesign === 'studio' ? 38 :
    libraryDesign === 'editorial' ? 68 :
    libraryDesign === 'crate' ? 42 :
    libraryDesign === 'ambient' ? 56 :
    libraryDesign === 'brutalist' ? 40 : 52;

  const {
    visibleItems: virtualLocalTracks,
    topSpacerHeight: topLocalSpacer,
    bottomSpacerHeight: bottomLocalSpacer,
    startIndex: localStartIndex,
  } = useVirtualList(filteredTracks, {
    itemHeight,
    overscan: 12,
    scrollContainer: scrollRef,
  });

  const {
    visibleItems: virtualCrateArtists,
    topSpacerHeight: topCrateSpacer,
    bottomSpacerHeight: bottomCrateSpacer,
  } = useVirtualList(filteredCrateArtists, {
    itemHeight: 34,
    overscan: 8,
    scrollContainer: crateSidebarRef,
  });

  const {
    visibleItems: virtualSubsonicTracks,
    topSpacerHeight: topSubsonicSpacer,
    bottomSpacerHeight: bottomSubsonicSpacer,
    startIndex: subsonicStartIndex,
  } = useVirtualList(subsonicTracks, {
    itemHeight,
    overscan: 12,
    scrollContainer: scrollRef,
  });

  const {
    visibleItems: virtualJellyfinTracks,
    topSpacerHeight: topJellyfinSpacer,
    bottomSpacerHeight: bottomJellyfinSpacer,
    startIndex: jellyfinStartIndex,
  } = useVirtualList(jellyfinTracks, {
    itemHeight,
    overscan: 12,
    scrollContainer: scrollRef,
  });

  const applyMatch = async () => {
    if (!matchData) return;
    const { track, match } = matchData;
    await invoke('update_track_metadata', { 
      path: track.path, 
      title: match.title, 
      artist: match.artist, 
      album: match.album 
    });
    setMatchData(null);
    loadLibrary();
  };

  const handleSaveMetadata = async () => {
    if (!editModalFor) return;
    try {
      await invoke('update_track_metadata', {
        path: editModalFor.path,
        title: editTitle.trim(),
        artist: editArtist.trim(),
        album: editAlbum.trim()
      });
      setEditModalFor(null);
      loadLibrary();
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Metadata updated successfully', type: 'success' } }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to update metadata: ${err}`, type: 'error' } }));
    }
  };

  const isCloudTab = activeSector !== 'local';
  const showPlayControls = isCloudTab 
    ? (activeSector === 'subsonic' ? subsonicTracks.length > 0 : jellyfinTracks.length > 0)
    : tracks.length > 0;

  const currentDesignConfig = LIBRARY_DESIGNS.find(d => d.id === libraryDesign) || LIBRARY_DESIGNS[0];

  return (
    <div 
      ref={scrollRef}
      className={`library-wrap design-${libraryDesign} album-view-${albumViewMode}`} 
      data-scroll-container="true"
      onClick={() => {
        setActiveMenu(null);
        setDesignMenuOpen(false);
      }}
      onScroll={(e) => {
        const target = e.currentTarget;
        if (activeSector !== 'local' && target.scrollHeight - target.scrollTop - target.clientHeight < 120) {
          if (activeSector === 'subsonic') {
            loadMoreSubsonic();
          } else if (activeSector === 'jellyfin') {
            loadMoreJellyfin();
          }
        }
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <h1 className="library-title" style={{ marginBottom: 4 }}>
            {currentPlaylist ? currentPlaylist.name : (isLovedStreamsView ? 'Loved Streams' : (viewMode === 'albums' ? 'Albums' : 'Music Library'))}
          </h1>
          {!currentPlaylist && !isCloudTab && !isLovedStreamsView && (
            <details ref={healthDetails} style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', padding: '8px 0', color: 'var(--text)' }}>Library health</summary>
              <LibraryHealthPanel />
            </details>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              {viewMode === 'albums' ? (
                `${albumCount} ${albumCount === 1 ? 'album' : 'albums'}`
              ) : isCloudTab ? (
                activeSector === 'subsonic' 
                  ? `${subsonicTracks.length} cloud tracks loaded`
                  : `${jellyfinTracks.length} cloud tracks loaded`
              ) : (
                searchQuery || activeFilter !== 'all' ? `${filteredTracks.length} / ${sourceTracks.length}` : sourceTracks.length
              )} {viewMode !== 'albums' && !isCloudTab && (sourceTracks.length === 1 && !searchQuery && activeFilter === 'all' ? 'track' : 'tracks')}
            </div>

            {!isLovedStreamsView && !currentPlaylist && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', background: 'rgba(0, 0, 0, 0.4)', padding: 3, borderRadius: 20, border: '1px solid var(--glass-border)' }}>
                  <button
                    onClick={() => setViewMode('tracks')}
                    style={{
                      padding: '5px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 16,
                      border: 'none',
                      background: viewMode === 'tracks' ? 'var(--accent)' : 'transparent',
                      color: viewMode === 'tracks' ? 'white' : 'var(--text-dim)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.2s'
                    }}
                  >
                    <ListMusic size={14} /> Tracks
                  </button>
                  <button
                    onClick={() => setViewMode('albums')}
                    style={{
                      padding: '5px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 16,
                      border: 'none',
                      background: viewMode === 'albums' ? 'var(--accent)' : 'transparent',
                      color: viewMode === 'albums' ? 'white' : 'var(--text-dim)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.2s'
                    }}
                  >
                    <Disc size={14} /> Albums
                  </button>
                </div>

                {/* Track Design Switcher Pill */}
                {viewMode === 'tracks' && (
                  <div style={{ position: 'relative' }} ref={designMenuRef}>
                    <button
                      type="button"
                      className="library-design-switcher-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDesignMenuOpen(!designMenuOpen);
                      }}
                      title="Switch Track Design Style"
                    >
                      {currentDesignConfig.icon}
                      <span>{currentDesignConfig.label}</span>
                      <ChevronDown size={12} style={{ opacity: 0.7 }} />
                    </button>
                    <AnimatePresence>
                      {designMenuOpen && (
                        <motion.div
                          className="library-design-menu-popover"
                          initial={{ opacity: 0, y: 6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 6, scale: 0.96 }}
                          transition={{ duration: 0.15 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div style={{ padding: '4px 8px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-dim)' }}>
                            Track Design
                          </div>
                          {LIBRARY_DESIGNS.map(d => (
                            <button
                              key={d.id}
                              type="button"
                              className={`library-design-option ${libraryDesign === d.id ? 'active' : ''}`}
                              onClick={() => {
                                setLibraryDesign(d.id as any);
                                setDesignMenuOpen(false);
                              }}
                            >
                              <span className="library-design-option-icon">{d.icon}</span>
                              <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{d.label}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.desc}</span>
                              </div>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {showPlayControls && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {isCloudTab ? (
              <form onSubmit={handleCloudSearch} style={{ display: 'flex', gap: 8 }}>
                <input 
                  type="text" 
                  placeholder={activeSector === 'subsonic' ? "Search Subsonic..." : "Search Jellyfin..."} 
                  value={cloudSearchQuery}
                  onChange={(e) => setCloudSearchQuery(e.target.value)}
                  style={{
                    background: 'var(--glass)', border: '1px solid var(--glass-border)',
                    borderRadius: 10, padding: '9px 14px', color: 'var(--text)', outline: 'none',
                    width: 220, fontSize: 13, transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = activeSector === 'subsonic' ? '#6366f1' : '#a855f7'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--glass-border)'}
                />
                <button 
                  type="submit" 
                  className="btn btn-secondary" 
                  style={{ fontSize: 12, padding: '9px 14px' }}
                >
                  Search
                </button>
              </form>
            ) : (
              <div style={{ position: 'relative', width: 240 }}>
                <Search 
                  size={15} 
                  style={{ 
                    position: 'absolute', 
                    left: 14, 
                    top: '50%', 
                    transform: 'translateY(-50%)', 
                    color: 'var(--text-dim)', 
                    pointerEvents: 'none' 
                  }} 
                />
                <input 
                  type="text" 
                  placeholder={viewMode === 'albums' ? "Search albums or artists..." : "Search tracks, artists (or artist:name)..."} 
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setLibrarySearchQuery(e.target.value);
                  }}
                  className="library-search-input"
                />
                {searchQuery && (
                  <button 
                    onClick={() => {
                      setSearchQuery('');
                      setLibrarySearchQuery('');
                    }}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            {viewMode === 'albums' && (
              <div 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8, 
                  background: 'var(--glass)', 
                  border: '1px solid var(--glass-border)', 
                  backdropFilter: 'blur(12px)',
                  borderRadius: 20, 
                  padding: '5px 12px 5px 14px',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb), 0.45)';
                  e.currentTarget.style.background = 'var(--glass-h)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--glass-border)';
                  e.currentTarget.style.background = 'var(--glass)';
                }}
              >
                <ArrowUpDown size={14} color="var(--accent)" />
                <select
                  value={albumSortBy}
                  onChange={(e: any) => setAlbumSortBy(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'white',
                    fontSize: 13,
                    fontWeight: 600,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="title" style={{ background: '#141420', color: 'white' }}>Title</option>
                  <option value="artist" style={{ background: '#141420', color: 'white' }}>Artist</option>
                  <option value="count" style={{ background: '#141420', color: 'white' }}>Track Count</option>
                  <option value="recent" style={{ background: '#141420', color: 'white' }}>Recently Added</option>
                </select>
              </div>
            )}

            <button 
              className="btn btn-secondary"
              onClick={() => {
                if (isLovedStreamsView) {
                  if (sourceTracks.length === 0) return;
                  const shuffled = shuffleArray(sourceTracks);
                  const firstTrack = shuffled[0];
                  const restTracks = shuffled.slice(1);
                  persistQueueState(restTracks, { shuffle: true });

                  chainQueueOperation(async () => {
                    await invoke('clear_queue');
                    if (restTracks.length > 0) {
                      await invoke('add_to_queue_bulk', { paths: restTracks.map(t => t.path) });
                    }
                  });

                  playTrack(firstTrack, false, false);
                  setView('nowplaying');
                } else if (isCloudTab) {
                  handlePlayAllCloud(true);
                } else {
                  persistQueueState([], { shuffle: true });
                  const randomIdx = Math.floor(Math.random() * sourceTracks.length);
                  playTrack(sourceTracks[randomIdx]);
                  setView('nowplaying');
                }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px' }}
            >
              <RefreshCw size={16} /> Shuffle
            </button>
            <button 
              className="btn btn-primary"
              onClick={() => {
                if (isLovedStreamsView) {
                  if (sourceTracks.length === 0) return;
                  const firstTrack = sourceTracks[0];
                  const restTracks = sourceTracks.slice(1);
                  useStore.setState({ shuffle: false, queue: restTracks });

                  chainQueueOperation(async () => {
                    await invoke('clear_queue');
                    if (restTracks.length > 0) {
                      await invoke('add_to_queue_bulk', { paths: restTracks.map(t => t.path) });
                    }
                  });

                  playTrack(firstTrack, false, false);
                  setView('nowplaying');
                } else if (isCloudTab) {
                  handlePlayAllCloud(false);
                } else {
                  useStore.setState({ shuffle: false, queue: [] });
                  playTrack(sourceTracks[0]);
                  setView('nowplaying');
                }
              }}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                padding: '10px 24px',
                background: isCloudTab 
                  ? (activeSector === 'subsonic' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'linear-gradient(135deg, #a855f7, #7c3aed)') 
                  : 'var(--dynamic-accent, #8b5cf6)'
              }}
            >
              <Play size={14} fill="currentColor" />
              Play All
            </button>
          </div>
        )}
      </div>

      {/* Multi-Sector Tab Selector */}
      {!currentPlaylist && !isLovedStreamsView && (subsonicConnected || jellyfinConnected) && (
        <div style={{ 
          display: 'flex', 
          gap: 8, 
          background: 'rgba(0, 0, 0, 0.2)', 
          padding: 4, 
          borderRadius: 12, 
          border: '1px solid var(--glass-border)',
          width: 'fit-content',
          marginBottom: 24
        }}>
          <button
            onClick={() => setActiveSector('local')}
            className={`btn ${activeSector === 'local' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ 
              fontSize: 12, 
              padding: '6px 14px', 
              borderRadius: 8,
              background: activeSector === 'local' ? 'var(--dynamic-accent, #8b5cf6)' : 'transparent',
              border: 'none',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            💿 Local Music
          </button>
          
          {subsonicConnected && (
            <button
              onClick={() => setActiveSector('subsonic')}
              className={`btn ${activeSector === 'subsonic' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ 
                fontSize: 12, 
                padding: '6px 14px', 
                borderRadius: 8,
                background: activeSector === 'subsonic' ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'transparent',
                border: 'none',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              ☁️ Subsonic Cloud
            </button>
          )}

          {jellyfinConnected && (
            <button
              onClick={() => setActiveSector('jellyfin')}
              className={`btn ${activeSector === 'jellyfin' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ 
                fontSize: 12, 
                padding: '6px 14px', 
                borderRadius: 8,
                background: activeSector === 'jellyfin' ? 'linear-gradient(135deg, #a855f7, #7c3aed)' : 'transparent',
                border: 'none',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              🍇 Jellyfin Cloud
            </button>
          )}
        </div>
      )}

      {viewMode === 'albums' ? (
        <AlbumsView 
          tracks={isCloudTab ? (activeSector === 'subsonic' ? subsonicTracks : jellyfinTracks) : (activeFilter === 'all' ? sourceTracks : filteredTracks)} 
          searchQuery={debouncedSearchQuery} 
          sortBy={albumSortBy} 
          onAlbumCountChange={setAlbumCount} 
        />
      ) : (
        <>
          {/* Quick Filter Chips Bar */}
          {sourceTracks.length > 0 && activeSector === 'local' && viewMode === 'tracks' && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              flexWrap: 'wrap', 
              marginBottom: 18 
            }}>
              {[
                { id: 'all' as QuickFilterType, label: 'All', count: countAll, icon: <ListMusic size={13} /> },
                { id: 'loved' as QuickFilterType, label: 'Loved', count: countLoved, icon: <Heart size={13} fill={activeFilter === 'loved' ? '#10b981' : 'transparent'} color={activeFilter === 'loved' ? '#10b981' : 'var(--text-dim)'} /> },
                { id: 'lossless' as QuickFilterType, label: 'Hi-Res Lossless', count: countLossless, icon: <Sparkles size={13} color={activeFilter === 'lossless' ? '#fbbf24' : 'var(--text-dim)'} /> },
                ...(countStreams > 0 ? [{ id: 'local' as QuickFilterType, label: 'Local Files', count: countLocal, icon: <HardDrive size={13} /> }] : []),
                ...(countStreams > 0 ? [{ id: 'streams' as QuickFilterType, label: 'Web Streams', count: countStreams, icon: <Globe size={13} color={activeFilter === 'streams' ? '#06b6d4' : 'var(--text-dim)'} /> }] : []),
              ].map((chip) => {
                const isActive = activeFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setActiveFilter(chip.id)}
                    className={`library-filter-chip${isActive ? ' active' : ''}`}
                  >
                    {chip.icon}
                    <span>{chip.label}</span>
                    <span className="chip-count">
                      {chip.count}
                    </span>
                  </button>
                );
              })}

              {activeFilter !== 'all' && (
                <button
                  onClick={() => setActiveFilter('all')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 10px',
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                  title="Reset quick filter"
                >
                  <X size={12} /> Clear Filter
                </button>
              )}
            </div>
          )}

          {/* Local Table rendering */}
          {activeSector === 'local' && (
            <>
              {sourceTracks.length === 0 && (
                <p style={{ color: 'var(--text-dim)' }}>
                  {currentPlaylist 
                    ? "This playlist is empty." 
                    : (isLovedStreamsView 
                        ? "No loved streams yet. Click the Heart icon on online streams to add them here." 
                        : "No tracks yet. Select a folder and press \"Scan Library\"."
                      )}
                </p>
              )}
              {sourceTracks.length > 0 && filteredTracks.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, gap: 12, color: 'var(--text-dim)' }}>
                  <p style={{ margin: 0, fontSize: 14 }}>No tracks match your current filter or search.</p>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => { setActiveFilter('all'); setSearchQuery(''); }}
                    style={{ fontSize: 12, padding: '7px 18px', borderRadius: 16 }}
                  >
                    Reset Filter &amp; Search
                  </button>
                </div>
              )}
              {sourceTracks.length > 0 && !libraryReady && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16, color: 'var(--text-dim)' }}>
                  <Loader2 className="spin" size={32} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Loading your library...</span>
                </div>
              )}
              {sourceTracks.length > 0 && libraryReady && (
                <>
                  {libraryDesign === 'crate' ? (
                    <div className="crate-container">
                      <div className="crate-sidebar">
                        <div className="crate-sidebar-header">
                          <span>Artists</span>
                          <span className="crate-artist-count">{crateArtists.length}</span>
                        </div>
                        <div style={{ padding: '8px 10px' }}>
                          <input
                            type="text"
                            placeholder="Filter artists..."
                            value={crateArtistSearch}
                            onChange={(e) => setCrateArtistSearch(e.target.value)}
                            style={{
                              width: '100%',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid var(--glass-border)',
                              borderRadius: 6,
                              padding: '6px 10px',
                              fontSize: 12,
                              color: 'var(--text)',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                        <div className="crate-sidebar-list" ref={crateSidebarRef}>
                          <div
                            className={`crate-artist-item ${selectedCrateArtist === null ? 'active' : ''}`}
                            onClick={() => {
                              setSelectedCrateArtist(null);
                              scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
                            }}
                          >
                            <span>All Artists</span>
                            <span className="crate-artist-count">{sourceTracks.length}</span>
                          </div>
                          {topCrateSpacer > 0 && <div style={{ height: topCrateSpacer }} />}
                          {virtualCrateArtists.map(item => (
                            <div
                              key={item.artist}
                              className={`crate-artist-item ${selectedCrateArtist === item.artist ? 'active' : ''}`}
                              onClick={() => {
                                setSelectedCrateArtist(item.artist);
                                scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.artist}</span>
                              <span className="crate-artist-count">{item.count}</span>
                            </div>
                          ))}
                          {bottomCrateSpacer > 0 && <div style={{ height: bottomCrateSpacer }} />}
                        </div>
                      </div>
                      <div className="crate-main-pane">
                        <table className="track-table">
                          <thead>
                            <tr>
                              <th style={{ width: 50, textAlign: 'center' }}>#</th>
                              <th style={{ width: 68, textAlign: 'center' }}></th>
                              <th style={{ width: 52 }}></th>
                              <th style={{ width: '38%' }}>Title</th>
                              <th style={{ width: '28%' }}>Artist</th>
                              <th style={{ width: 100, textAlign: 'center' }}>Quality</th>
                              <th style={{ width: 140, textAlign: 'right' }}>Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {topLocalSpacer > 0 && <tr style={{ height: topLocalSpacer }}><td colSpan={7} style={{ padding: 0, border: 'none' }} /></tr>}
                            {virtualLocalTracks.map((t: any, idx: number) => {
                              const i = localStartIndex + idx;
                              const active = currentTrackPath === t.path;
                              const isHighRes = t.format?.toLowerCase() === 'flac' || t.format?.toLowerCase() === 'wav';
                              const isDraggable = !!currentPlaylist && !debouncedSearchQuery && activeFilter === 'all';

                              return (
                                <TrackRow
                                  key={entryKey(t)}
                                  t={t}
                                  i={i}
                                  totalTracks={filteredTracks.length}
                                  active={active}
                                  isHighRes={isHighRes}
                                  currentPlaylist={currentPlaylist}
                                  playTrack={playTrack}
                                  setView={setView}
                                  onOpenMenu={handleOpenMenu}
                                  toggleLoveTrack={toggleLoveTrack}
                                  toggleDislikeTrack={toggleDislikeTrack}
                                  cacheCloudTrack={cacheCloudTrack}
                                  deleteCachedTrack={deleteCachedTrack}
                                  cachedCloudHashes={cachedCloudHashes}
                                  isDraggable={isDraggable}
                                  isDragged={draggedIdx === i}
                                  isDragOver={dragOverIdx === i}
                                  onPointerDragStart={startPlaylistPointerDrag}
                                  isSelected={selectedSet.has(entryKey(t))}
                                  onRowClick={handleTrackRowClick}
                                  onSelectArtist={handleSelectArtist}
                                  design={libraryDesign}
                                />
                              );
                            })}
                            {bottomLocalSpacer > 0 && <tr style={{ height: bottomLocalSpacer }}><td colSpan={7} style={{ padding: 0, border: 'none' }} /></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <table className="track-table">
                      <thead>
                        <tr>
                          <th style={{ width: 50, textAlign: 'center' }}>#</th>
                          <th style={{ width: 68, textAlign: 'center' }}></th>
                          <th style={{ width: 52 }}></th>
                          <th style={{ width: '38%' }}>Title</th>
                          <th style={{ width: '28%' }}>Artist</th>
                          <th style={{ width: 100, textAlign: 'center' }}>Quality</th>
                          <th style={{ width: 140, textAlign: 'right' }}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topLocalSpacer > 0 && <tr style={{ height: topLocalSpacer }}><td colSpan={7} style={{ padding: 0, border: 'none' }} /></tr>}
                        {virtualLocalTracks.map((t: any, idx: number) => {
                          const i = localStartIndex + idx;
                          const active = currentTrackPath === t.path;
                          const isHighRes = t.format?.toLowerCase() === 'flac' || t.format?.toLowerCase() === 'wav';
                          const isDraggable = !!currentPlaylist && !debouncedSearchQuery && activeFilter === 'all';

                          return (
                            <TrackRow
                              key={entryKey(t)}
                              t={t}
                              i={i}
                              totalTracks={filteredTracks.length}
                              active={active}
                              isHighRes={isHighRes}
                              currentPlaylist={currentPlaylist}
                              playTrack={playTrack}
                              setView={setView}
                              onOpenMenu={handleOpenMenu}
                              toggleLoveTrack={toggleLoveTrack}
                              toggleDislikeTrack={toggleDislikeTrack}
                              cacheCloudTrack={cacheCloudTrack}
                              deleteCachedTrack={deleteCachedTrack}
                              cachedCloudHashes={cachedCloudHashes}
                              isDraggable={isDraggable}
                              isDragged={draggedIdx === i}
                              isDragOver={dragOverIdx === i}
                              onPointerDragStart={startPlaylistPointerDrag}
                              isSelected={selectedSet.has(entryKey(t))}
                              onRowClick={handleTrackRowClick}
                              onSelectArtist={handleSelectArtist}
                              design={libraryDesign}
                            />
                          );
                        })}
                        {bottomLocalSpacer > 0 && <tr style={{ height: bottomLocalSpacer }}><td colSpan={7} style={{ padding: 0, border: 'none' }} /></tr>}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </>
          )}

          {/* Subsonic Table rendering */}
          {activeSector === 'subsonic' && (
            <>
              {subsonicTracks.length === 0 && !subsonicLoading && (
                <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '40px 0' }}>
                  No tracks found on your Subsonic server.
                </p>
              )}
              {subsonicTracks.length > 0 && (
                <table className="track-table">
                  <thead>
                    <tr>
                      <th style={{ width: 50, textAlign: 'center' }}>#</th>
                      <th style={{ width: 52 }}></th>
                      <th style={{ width: '42%' }}>Title</th>
                      <th style={{ width: '32%' }}>Artist</th>
                      <th style={{ width: 100, textAlign: 'center' }}>Quality</th>
                      <th style={{ width: 140, textAlign: 'right' }}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSubsonicSpacer > 0 && <tr style={{ height: topSubsonicSpacer }}><td colSpan={6} style={{ padding: 0, border: 'none' }} /></tr>}
                    {virtualSubsonicTracks.map((t: CloudTrack, idx: number) => {
                      const i = subsonicStartIndex + idx;
                      const active = currentTrackPath === t.stream_url;
                      return (
                        <CloudTrackRow
                          key={t.stream_url || t.id}
                          t={t}
                          i={i}
                          active={active}
                          onOpenMenu={handleOpenMenu}
                          playCloudTrack={playCloudTrack}
                          cacheCloudTrack={cacheCloudTrack}
                          deleteCachedTrack={deleteCachedTrack}
                          cachedCloudHashes={cachedCloudHashes}
                          onSelectArtist={handleSelectArtist}
                        />
                      );
                    })}
                    {bottomSubsonicSpacer > 0 && <tr style={{ height: bottomSubsonicSpacer }}><td colSpan={6} style={{ padding: 0, border: 'none' }} /></tr>}
                  </tbody>
                </table>
              )}
              {subsonicLoading && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 24, gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
                  <Loader2 className="pulse" size={16} color="#6366f1" />
                  <span>Fetching Subsonic library...</span>
                </div>
              )}
            </>
          )}

          {/* Jellyfin Table rendering */}
          {activeSector === 'jellyfin' && (
            <>
              {jellyfinTracks.length === 0 && !jellyfinLoading && (
                <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '40px 0' }}>
                  No tracks found on your Jellyfin server.
                </p>
              )}
              {jellyfinTracks.length > 0 && (
                <table className="track-table">
                  <thead>
                    <tr>
                      <th style={{ width: 50, textAlign: 'center' }}>#</th>
                      <th style={{ width: 52 }}></th>
                      <th style={{ width: '42%' }}>Title</th>
                      <th style={{ width: '32%' }}>Artist</th>
                      <th style={{ width: 100, textAlign: 'center' }}>Quality</th>
                      <th style={{ width: 140, textAlign: 'right' }}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topJellyfinSpacer > 0 && <tr style={{ height: topJellyfinSpacer }}><td colSpan={6} style={{ padding: 0, border: 'none' }} /></tr>}
                    {virtualJellyfinTracks.map((t: CloudTrack, idx: number) => {
                      const i = jellyfinStartIndex + idx;
                      const active = currentTrackPath === t.stream_url;
                      return (
                        <CloudTrackRow
                          key={t.stream_url || t.id}
                          t={t}
                          i={i}
                          active={active}
                          onOpenMenu={handleOpenMenu}
                          playCloudTrack={playCloudTrack}
                          cacheCloudTrack={cacheCloudTrack}
                          deleteCachedTrack={deleteCachedTrack}
                          cachedCloudHashes={cachedCloudHashes}
                          onSelectArtist={handleSelectArtist}
                        />
                      );
                    })}
                    {bottomJellyfinSpacer > 0 && <tr style={{ height: bottomJellyfinSpacer }}><td colSpan={6} style={{ padding: 0, border: 'none' }} /></tr>}
                  </tbody>
                </table>
              )}
              {jellyfinLoading && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 24, gap: 8, color: 'var(--text-dim)', fontSize: 13 }}>
                  <Loader2 className="pulse" size={16} color="#a855f7" />
                  <span>Fetching Jellyfin library...</span>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Custom Magic Match Modal */}
      <AnimatePresence>
        {matchData && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setMatchData(null)}
          >
            <motion.div 
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 450 }}
            >
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div className="pulse-container" style={{ width: 64, height: 64, background: 'rgba(var(--accent-rgb), 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <Activity size={32} color="var(--accent)" />
                </div>
                <h2 style={{ margin: 0 }}>Metadata match</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Review the matching track details before applying them.</p>
              </div>

              <div className="match-comparison" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Title</label>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{matchData.match.title}</div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Artist</label>
                  <div style={{ fontSize: 14 }}>{matchData.match.artist}</div>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Album</label>
                  <div style={{ fontSize: 14, color: 'var(--text-dim)' }}>{matchData.match.album || '—'}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setMatchData(null)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={applyMatch}>Apply Changes</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add to Playlist Modal */}
      <AnimatePresence>
        {playlistModalFor && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPlaylistModalFor(null)}
          >
            <motion.div 
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 400, width: '100%', padding: 24 }}
            >
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>Add to Playlist</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '4px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {playlistModalFor.title || baseName(playlistModalFor.path)}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', marginBottom: 24, paddingRight: 4 }}>
                {playlists.length > 0 ? (
                  playlists.map((p: any) => (
                    <div
                      key={p.id}
                      onClick={() => { 
                        addToPlaylist(p.id, playlistModalFor);
                        setPlaylistModalFor(null); 
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added to ${p.name}`, type: 'success' } })); 
                      }}
                      style={{ padding: '12px 16px', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 8, cursor: 'pointer', transition: 'background 0.2s', fontSize: 14, fontWeight: 500 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--glass)'}
                    >
                      {p.name}
                    </div>
                  ))
                ) : (
                  <div style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', padding: '32px 0', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                    You don't have any playlists yet.
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setPlaylistModalFor(null)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => {
                  setPlaylistModalFor(null);
                  useStore.getState().setCustomPrompt({
                    open: true,
                    title: 'Create New Playlist',
                    placeholder: 'Enter playlist name...',
                    initialValue: '',
                    actionLabel: 'Create',
                    onSubmit: async (val: string) => {
                      if (val.trim()) {
                        await useStore.getState().createPlaylist(val.trim());
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Playlist "${val}" created! You can now add tracks to it.`, type: 'success' } }));
                      }
                    }
                  });
                }}>Create Playlist</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Song Data Modal */}
      <AnimatePresence>
        {editModalFor && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setEditModalFor(null)}
          >
            <motion.div 
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 450, width: '100%', padding: 24 }}
            >
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>Edit Song Data</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '4px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {editModalFor.title || baseName(editModalFor.path)}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6, fontWeight: 600 }}>Title</label>
                  <input 
                    type="text" 
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={{
                      background: 'var(--glass)', border: '1px solid var(--glass-border)',
                      borderRadius: 10, padding: '10px 14px', color: 'var(--text)', outline: 'none',
                      width: '100%', fontSize: 14, transition: 'border-color 0.2s', boxSizing: 'border-box'
                    }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--glass-border)'}
                    placeholder="Enter track title"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6, fontWeight: 600 }}>Artist</label>
                  <input 
                    type="text" 
                    value={editArtist}
                    onChange={(e) => setEditArtist(e.target.value)}
                    style={{
                      background: 'var(--glass)', border: '1px solid var(--glass-border)',
                      borderRadius: 10, padding: '10px 14px', color: 'var(--text)', outline: 'none',
                      width: '100%', fontSize: 14, transition: 'border-color 0.2s', boxSizing: 'border-box'
                    }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--glass-border)'}
                    placeholder="Enter artist name"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6, fontWeight: 600 }}>Album</label>
                  <input 
                    type="text" 
                    value={editAlbum}
                    onChange={(e) => setEditAlbum(e.target.value)}
                    style={{
                      background: 'var(--glass)', border: '1px solid var(--glass-border)',
                      borderRadius: 10, padding: '10px 14px', color: 'var(--text)', outline: 'none',
                      width: '100%', fontSize: 14, transition: 'border-color 0.2s', boxSizing: 'border-box'
                    }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--glass-border)'}
                    placeholder="Enter album name"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditModalFor(null)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveMetadata}>Save Changes</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Add to Playlist Modal */}
      <AnimatePresence>
        {bulkPlaylistModal && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setBulkPlaylistModal(false)}
          >
            <motion.div 
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 400, width: '100%', padding: 24 }}
            >
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>Add {selectedTrackPaths.length} Songs to Playlist</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '4px 0 0' }}>
                  Select a destination playlist:
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', marginBottom: 24, paddingRight: 4 }}>
                {playlists.length > 0 ? (
                  playlists.map((p: any) => (
                    <div
                      key={p.id}
                      onClick={() => { 
                        for (const track of filteredTracks.filter(t => selectedSet.has(entryKey(t)))) {
                          addToPlaylist(p.id, track);
                        }
                        setBulkPlaylistModal(false);
                        setSelectedTrackPaths([]);
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added ${selectedTrackPaths.length} songs to ${p.name}`, type: 'success' } })); 
                      }}
                      style={{ padding: '12px 16px', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 8, cursor: 'pointer', transition: 'background 0.2s', fontSize: 14, fontWeight: 500 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--glass)'}
                    >
                      {p.name}
                    </div>
                  ))
                ) : (
                  <div style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', padding: '32px 0', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                    You don't have any playlists yet.
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setBulkPlaylistModal(false)}>Cancel</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Bulk Action Bar */}
      <AnimatePresence>
        {selectedTrackPaths.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.92 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            style={{
              position: 'fixed',
              bottom: 84,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 2500,
              background: 'rgba(16, 16, 24, 0.92)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(var(--accent-rgb, 139, 92, 246), 0.35)',
              boxShadow: '0 16px 45px rgba(0, 0, 0, 0.7), 0 0 25px rgba(var(--accent-rgb, 139, 92, 246), 0.25)',
              borderRadius: 24,
              padding: '8px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              padding: '5px 12px', 
              background: 'rgba(var(--accent-rgb, 139, 92, 246), 0.2)', 
              borderRadius: 14, 
              color: 'white', 
              fontSize: 12, 
              fontWeight: 700 
            }}>
              <Check size={14} style={{ color: 'var(--accent)' }} />
              <span>{selectedTrackPaths.length} selected</span>
            </div>

            <div style={{ height: 22, width: 1, background: 'var(--glass-border)' }} />

            <button
              className="btn btn-primary"
              onClick={handlePlaySelected}
              style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10, cursor: 'pointer' }}
            >
              <Play size={13} fill="white" />
              Play
            </button>

            <button
              className="btn btn-secondary"
              onClick={handleBulkAddToQueue}
              style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10, cursor: 'pointer' }}
            >
              <ListMusic size={13} />
              Add to Queue
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => setBulkPlaylistModal(true)}
              style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10, cursor: 'pointer' }}
            >
              <Disc size={13} />
              Add to Playlist
            </button>

            <button
              className="btn btn-secondary"
              onClick={handleBulkFavorite}
              style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10, cursor: 'pointer' }}
            >
              <Heart size={13} color="#ef4444" />
              Favorite All
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => {
                const selected = filteredTracks.filter((t: any) => selectedSet.has(entryKey(t)));
                if (selected.length > 0) {
                  useStore.getState().setTagEditorBatchTracks(selected);
                }
              }}
              style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10, cursor: 'pointer' }}
            >
              <Tag size={13} />
              Edit Tags
            </button>

            <button
              onClick={() => { setSelectedTrackPaths([]); setLastSelectedIdx(null); }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                padding: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                transition: 'color 0.2s'
              }}
              title="Deselect All (Esc)"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {activeMenu && (
        <TrackActionMenu
          track={activeMenu.track}
          index={activeMenu.index}
          anchor={activeMenu.anchor}
          isCloud={activeMenu.isCloud}
          onClose={handleCloseMenu}
          playNextInQueue={playNextInQueue}
          addToQueue={addToQueue}
          setCoverArtModalTrack={setCoverArtModalTrack}
          setEditModalFor={setEditModalFor}
          setPlaylistModalFor={setPlaylistModalFor}
          setSourceModalTrack={setSourceModalTrack}
          matchMetadata={matchMetadata}
          setMatchData={setMatchData}
          setIsMatching={setIsMatching}
          isMatching={isMatching}
          currentPlaylist={currentPlaylist}
          reorderPlaylistTracks={reorderPlaylistTracks}
          removeFromPlaylist={removeFromPlaylist}
        />
      )}

      {sourceModalTrack && (
        <SourceMenu
          track={sourceModalTrack}
          initialOpen
          onClose={() => setSourceModalTrack(null)}
        />
      )}
    </div>
  );
}
