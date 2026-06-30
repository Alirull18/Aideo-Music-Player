import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Search, Download, Loader2, Music, CheckCircle2, X } from 'lucide-react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { YoutubeTrack } from '../store/types';

export function YoutubeSearchView() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<YoutubeTrack[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [searchMode, setSearchMode] = useState<'music' | 'video'>('music');
  const [pendingDownload, setPendingDownload] = useState<YoutubeTrack | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, { percent: number; downloaded_mb: number; total_mb: number }>>({});

  useEffect(() => {
    const sub = listen<any>('ytdlp-download-progress', (event) => {
      const { url, percent, downloaded_mb, total_mb } = event.payload;
      setDownloadProgress(prev => ({
        ...prev,
        [url]: { percent, downloaded_mb, total_mb }
      }));
    });

    return () => {
      sub.then(f => f());
    };
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'You are offline. Please check your internet connection.', type: 'warning' } }));
      return;
    }

    setIsSearching(true);
    try {
      const finalQuery = query.trim();
      const tracks = await invoke<YoutubeTrack[]>('search_youtube', { query: finalQuery });
      setResults(tracks);
    } catch (err) {
      console.error("Search error", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `YouTube search failed: ${err}`, type: 'error' } }));
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownload = (track: YoutubeTrack) => {
    if (downloadingId === track.id || downloadedIds.has(track.id)) return;
    setPendingDownload(track);
  };

  const confirmDownload = async (quality: string) => {
    if (!pendingDownload) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'You are offline. Cannot download tracks.', type: 'warning' } }));
      setPendingDownload(null);
      return;
    }

    const track = pendingDownload;
    setPendingDownload(null);
    setDownloadingId(track.id);
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Downloading: ${track.title}...`, type: 'info' }}));
    
    try {
      await invoke('download_track', {
        url: track.url,
        quality,
        title: track.title,
        artist: track.artist,
        coverUrl: track.cover_url
      });
      setDownloadedIds(prev => new Set(prev).add(track.id));
      useStore.getState().loadLibrary(); // Rescan immediately
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Download complete: ${track.title} added to library!`, type: 'success' }}));
    } catch (err) {
      console.error("Download error", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Download failed: ${err}`, type: 'error' }}));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="section-header" style={{ padding: '40px 40px 20px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.4), transparent)' }}>
        <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 8, color: 'white' }}>
          Discover Music
        </h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Search the globe and download high-fidelity streams directly to your library.</p>
        
        <form onSubmit={handleSearch} style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}>
              <Search size={18} />
            </div>
            <input 
              type="text" 
              placeholder={searchMode === 'music' ? "Search official artists & albums..." : "Search all videos..."}
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '16px 20px 16px 48px',
                borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.05)',
                background: 'rgba(0,0,0,0.3)',
                color: 'white',
                fontSize: 16,
                fontWeight: 500,
                outline: 'none',
                boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.2)'
              }}
            />
          </div>

          <select
            value={searchMode}
            onChange={e => setSearchMode(e.target.value as 'music' | 'video')}
            style={{
              padding: '16px 36px 16px 20px',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.05)',
              background: 'rgba(0,0,0,0.3)',
              color: 'white',
              fontSize: 14,
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 16px center',
              minWidth: 180,
              boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.2)'
            }}
          >
            <option value="music" style={{ background: '#0c0c14' }}>YT Music (Official)</option>
            <option value="video" style={{ background: '#0c0c14' }}>YT Video (Standard)</option>
          </select>
        </form>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 40px 40px' }}>
        {isSearching ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
            <Loader2 className="pulse" size={32} style={{ marginBottom: 16 }} />
            <span>Scanning frequencies...</span>
          </div>
        ) : results.length > 0 ? (
          <div className="track-list" style={{ marginTop: 12 }}>
            <div className="track-list-header" style={{ display: 'grid', gridTemplateColumns: '48px 1fr 200px 80px 60px', padding: '0 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-dim)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
              <div></div>
              <div>Title</div>
              <div>Channel</div>
              <div>Time</div>
              <div style={{ textAlign: 'center' }}>Get</div>
            </div>
            
            {results.map((track) => (
              <div key={track.id} className="track-item" style={{ display: 'grid', gridTemplateColumns: '48px 1fr 200px 80px 60px', padding: '12px 16px', alignItems: 'center', borderRadius: 8, transition: 'background 0.2s', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {track.cover_url ? <img src={track.cover_url} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={16} color="var(--text-dim)" />}
                </div>
                
                <div style={{ paddingRight: 16, overflow: 'hidden' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
                </div>
                
                <div style={{ color: 'var(--text-dim)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
                
                <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{track.duration_raw}</div>
                
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {downloadedIds.has(track.id) ? (
                    <div style={{ color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)' }}>
                      <CheckCircle2 size={16} />
                    </div>
                  ) : downloadingId === track.id ? (
                    <div style={{ color: '#10b981', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 80 }}>
                      <Loader2 size={12} className="pulse" style={{ marginBottom: 4 }} />
                      {downloadProgress[track.url] ? (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                            {Math.round(downloadProgress[track.url].percent)}%
                          </span>
                          {/* Horizontal Progress Bar */}
                          <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${downloadProgress[track.url].percent}%`, background: '#10b981', transition: 'width 0.2s ease-out' }} />
                          </div>
                          <span style={{ fontSize: 8, fontWeight: 500, opacity: 0.6, textAlign: 'center' }}>
                            {downloadProgress[track.url].total_mb > 0 ? `${downloadProgress[track.url].downloaded_mb.toFixed(1)}/${downloadProgress[track.url].total_mb.toFixed(1)} MB` : ''}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: 8, fontWeight: 600, opacity: 0.8 }}>Connecting...</span>
                      )}
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleDownload(track)}
                      className="icon-btn"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                    >
                      <Download size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
            <Search size={48} style={{ marginBottom: 16 }} />
            <span style={{ fontSize: 16, fontWeight: 500 }}>Search for any track or artist globally.</span>
          </div>
        )}
      </div>

      {/* Quality Selection Modal */}
      <AnimatePresence>
        {pendingDownload && (
          <div className="modal-overlay" onClick={() => setPendingDownload(null)}>
            <motion.div 
              className="modal-box" 
              onClick={e => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }}
              style={{ maxWidth: 400 }}
            >
              <div className="modal-header">
                <h3>Select Audio Quality</h3>
                <button className="modal-close" onClick={() => setPendingDownload(null)}><X size={20} /></button>
              </div>
              <div className="modal-body">
                <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 20 }}>
                  Choose the download quality for <strong style={{ color: 'white' }}>{pendingDownload.title}</strong>.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={() => confirmDownload('high')}
                    style={{ padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span style={{ fontWeight: 600 }}>High Quality</span>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>Best available (m4a/opus)</span>
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => confirmDownload('standard')}
                    style={{ padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span style={{ fontWeight: 600 }}>Standard</span>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>~128kbps AAC</span>
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => confirmDownload('low')}
                    style={{ padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)' }}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--text-dim)' }}>Data Saver</span>
                    <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Lowest usage</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
