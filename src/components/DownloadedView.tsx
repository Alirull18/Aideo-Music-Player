import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { 
  DownloadCloud, 
  FolderOpen, 
  Trash2, 
  Play, 
  RefreshCw, 
  HardDrive, 
  ListPlus, 
  Search,
  Music
} from 'lucide-react';
import { Track } from '../store/types';
import defaultCover from '../assets/default_cover.png';
import { fmt } from '../utils';

interface CacheSizeInfo {
  bytes?: number;
  total_bytes?: number;
  mb?: number;
  total_mb?: number;
  formatted?: string;
  count?: number;
  file_count?: number;
  limit_gb?: number;
}

export function DownloadedView() {
  const { 
    tracks, 
    playTrack, 
    addToQueue, 
    cachedCloudHashes, 
    fetchCachedCloudHashes,
    batchDownloadProgress,
    loadLibrary
  } = useStore(useShallow(s => ({
    tracks: s.tracks,
    playTrack: s.playTrack,
    addToQueue: s.addToQueue,
    cachedCloudHashes: s.cachedCloudHashes,
    fetchCachedCloudHashes: s.fetchCachedCloudHashes,
    batchDownloadProgress: s.batchDownloadProgress,
    loadLibrary: s.loadLibrary,
  })));

  const [cacheInfo, setCacheInfo] = useState<CacheSizeInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadCacheInfo = useCallback(async () => {
    try {
      setLoading(true);
      const info = await invoke<CacheSizeInfo>('get_cache_size_info');
      setCacheInfo(info);
      if (fetchCachedCloudHashes) {
        await fetchCachedCloudHashes();
      }
      if (loadLibrary) {
        await loadLibrary();
      }
    } catch (err) {
      console.error('Failed to load cache info:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchCachedCloudHashes, loadLibrary]);

  useEffect(() => {
    loadCacheInfo();
  }, [loadCacheInfo]);

  const handleOpenFolder = async () => {
    try {
      await invoke('open_cache_folder');
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Failed to open folder: ${err}`, type: 'error' }
      }));
    }
  };

  const handlePruneCache = async (maxMb: number) => {
    try {
      setPruning(true);
      await invoke('prune_cache_to_limit', { maxMb });
      await loadCacheInfo();
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Cache pruned to ${maxMb >= 1024 ? `${(maxMb / 1024).toFixed(1)} GB` : `${maxMb} MB`}`, type: 'success' }
      }));
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Prune failed: ${err}`, type: 'error' }
      }));
    } finally {
      setPruning(false);
    }
  };

  const handleClearCache = async () => {
    if (!window.confirm("Are you sure you want to delete all cached tracks? This will free disk space but require re-streaming.")) {
      return;
    }
    try {
      setLoading(true);
      await invoke('clear_application_cache');
      await loadCacheInfo();
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: 'All application cache cleared', type: 'success' }
      }));
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Clear failed: ${err}`, type: 'error' }
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCachedTrack = async (streamUrl: string) => {
    try {
      await invoke('delete_cached_track', { streamUrl });
      await loadCacheInfo();
      if (loadLibrary) {
        await loadLibrary();
      }
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: 'Removed track from offline cache', type: 'info' }
      }));
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Delete failed: ${err}`, type: 'error' }
      }));
    }
  };

  // Filter downloaded & cached tracks
  const cachedTracks = (tracks || []).filter((t: Track) => {
    if (!t || !t.path) return false;
    const isLocalDownloaded = /aideo[ _\\/]downloads/i.test(t.path);
    const isStream = t.path.startsWith('http://') || t.path.startsWith('https://') || t.path.startsWith('subsonic:') || t.path.startsWith('jellyfin:');
    const hashes = cachedCloudHashes || [];
    const isCachedStream = isStream && (t.path_hash ? hashes.includes(t.path_hash) : false);
    const isDirectlyCached = Boolean(t.path_hash && hashes.includes(t.path_hash));
    return isLocalDownloaded || isCachedStream || isDirectlyCached;
  });

  const filteredTracks = cachedTracks.filter((t: Track) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (t.title || '').toLowerCase().includes(q) ||
      (t.artist || '').toLowerCase().includes(q) ||
      (t.album || '').toLowerCase().includes(q)
    );
  });

  const maxQuotaMb = 5120; // 5 GB default visual reference
  const usedMb = cacheInfo 
    ? (cacheInfo.total_mb ?? cacheInfo.mb ?? (cacheInfo.bytes ? cacheInfo.bytes / (1024 * 1024) : (cacheInfo.total_bytes ? cacheInfo.total_bytes / (1024 * 1024) : 0))) 
    : 0;
  const fileCount = cacheInfo ? (cacheInfo.file_count ?? cacheInfo.count ?? 0) : 0;
  const percentUsed = Math.min(100, Math.max(0, (usedMb / maxQuotaMb) * 100));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="downloaded-view"
      style={{
        height: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        padding: '24px 32px calc(var(--player-h, 90px) + 40px) 32px',
        overflowY: 'auto',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 24
      }}
    >
      {/* Header Banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 16
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(16, 185, 129, 0.3)'
            }}>
              <DownloadCloud size={22} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>
                Downloaded & Offline Cache
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
                Offline audio tracks cached from Subsonic, YouTube, Tidal, and Qobuz
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button 
            className="btn btn-secondary" 
            onClick={loadCacheInfo} 
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 14px' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={handleOpenFolder}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 14px' }}
          >
            <FolderOpen size={14} />
            Open Folder
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={() => handlePruneCache(5000)}
            disabled={pruning}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 14px' }}
          >
            <HardDrive size={14} />
            Prune to 5GB
          </button>
          <button 
            className="btn" 
            onClick={handleClearCache}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 6, 
              fontSize: 12, 
              padding: '8px 14px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444'
            }}
          >
            <Trash2 size={14} />
            Clear Cache
          </button>
        </div>
      </div>

      {/* Active Batch Download Banner */}
      <AnimatePresence>
        {batchDownloadProgress && !batchDownloadProgress.is_done && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(6, 182, 212, 0.15) 100%)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              borderRadius: 16,
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <RefreshCw size={18} className="animate-spin" style={{ color: '#10b981' }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
                    Downloading Album / Playlist ({batchDownloadProgress.completed + 1}/{batchDownloadProgress.total})
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    Current: <strong style={{ color: 'var(--text-main)' }}>{batchDownloadProgress.current_title}</strong>
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>
                {Math.round(batchDownloadProgress.percent)}%
              </span>
            </div>

            <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(255, 255, 255, 0.1)', overflow: 'hidden' }}>
              <motion.div
                style={{
                  height: '100%',
                  borderRadius: 3,
                  background: 'linear-gradient(90deg, #10b981, #06b6d4)',
                  width: `${batchDownloadProgress.percent}%`
                }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Storage Gauge Card */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--glass-border)',
        borderRadius: 16,
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HardDrive size={18} style={{ color: '#10b981' }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Storage Utilization</span>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {cacheInfo ? `${fileCount} cached audio files (${(usedMb || 0).toFixed(1)} MB)` : 'Scanning cache...'}
          </span>
        </div>

        {/* Progress Bar */}
        <div style={{
          width: '100%',
          height: 8,
          borderRadius: 4,
          background: 'rgba(255, 255, 255, 0.06)',
          overflow: 'hidden'
        }}>
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${percentUsed}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            style={{
              height: '100%',
              borderRadius: 4,
              background: percentUsed > 80 ? '#ef4444' : 'linear-gradient(90deg, #10b981, #06b6d4)'
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)' }}>
          <span>Used: {usedMb > 1024 ? `${(usedMb / 1024).toFixed(2)} GB` : `${(usedMb || 0).toFixed(1)} MB`}</span>
          <span>Target Quota: 5.0 GB</span>
        </div>
      </div>

      {/* Track List Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Music size={18} style={{ color: 'var(--accent)' }} />
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
              Available Offline Tracks ({filteredTracks.length})
            </h2>
          </div>

          {/* Search Filter */}
          <div style={{
            position: 'relative',
            width: 260
          }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input 
              type="text"
              placeholder="Search downloaded tracks..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 12px 6px 32px',
                borderRadius: 8,
                border: '1px solid var(--glass-border)',
                background: 'rgba(0, 0, 0, 0.2)',
                color: '#fff',
                fontSize: 12,
                outline: 'none'
              }}
            />
          </div>
        </div>

        {filteredTracks.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 16,
            border: '1px dashed var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12
          }}>
            <DownloadCloud size={40} style={{ color: 'var(--text-dim)', opacity: 0.4 }} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>No downloaded tracks found</div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', maxWidth: 400, margin: 0 }}>
              Stream any song from Subsonic, YouTube, Tidal, or Qobuz, or click the download icon in your library to cache it for instant offline listening.
            </p>
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            <AnimatePresence>
              {filteredTracks.map((t: Track, idx: number) => (
                <motion.div
                  key={t.path || t.id || idx}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.04)',
                    gap: 14
                  }}
                  className="downloaded-row hover:bg-white/5 transition-colors"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: 6,
                      overflow: 'hidden',
                      flexShrink: 0,
                      background: 'rgba(0,0,0,0.3)',
                      position: 'relative'
                    }}>
                      <img 
                        src={t.cover_url || defaultCover} 
                        alt={t.title || 'Track'} 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { (e.target as HTMLImageElement).src = defaultCover; }}
                      />
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: '#fff'
                      }}>
                        {t.title || 'Untitled'}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: 'var(--text-dim)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}>
                        <span>{t.artist || 'Unknown Artist'}</span>
                        {t.album && <span>• {t.album}</span>}
                        {t.format && (
                          <span style={{
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#10b981',
                            fontSize: 9,
                            fontWeight: 700
                          }}>
                            {t.format}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', marginRight: 8 }}>
                      {t.duration ? fmt(t.duration) : '--:--'}
                    </span>
                    <button
                      className="icon-btn"
                      onClick={() => playTrack(t)}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'var(--accent)',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title="Play Track"
                    >
                      <Play size={14} fill="#fff" />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        addToQueue(t);
                        window.dispatchEvent(new CustomEvent('ui-toast', {
                          detail: { message: 'Added to queue', type: 'info' }
                        }));
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: 'none',
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title="Add to Queue"
                    >
                      <ListPlus size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => handleDeleteCachedTrack(t.path)}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title="Remove from Cache"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}
