import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { Search, Download, Loader2, Music, CheckCircle2 } from 'lucide-react';
import { useStore } from '../store';

interface YoutubeTrack {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  duration_raw: string;
  url: string;
}

export function YoutubeSearchView() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<YoutubeTrack[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const tracks = await invoke<YoutubeTrack[]>('search_youtube', { query });
      setResults(tracks);
    } catch (err) {
      console.error("Search error", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownload = async (track: YoutubeTrack) => {
    if (downloadingId === track.id || downloadedIds.has(track.id)) return;
    
    setDownloadingId(track.id);
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Downloading: ${track.title}...`, type: 'info' }}));
    
    try {
      await invoke('download_track', { url: track.url });
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
        <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 8, background: 'linear-gradient(90deg, #fff, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Discover Music
        </h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Search the globe and download high-fidelity streams directly to your library.</p>
        
        <form onSubmit={handleSearch} style={{ marginTop: 24, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}>
            <Search size={18} />
          </div>
          <input 
            type="text" 
            placeholder="Search artists, tracks, or albums..."
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
                  {track.cover_url ? <img src={track.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={16} color="var(--text-dim)" />}
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
                    <div style={{ color: 'var(--primary-bright)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}>
                      <Loader2 size={16} className="pulse" />
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
    </div>
  );
}
