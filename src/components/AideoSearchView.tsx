import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Search, Download, Loader2, Music, CheckCircle2, Globe, Check, ExternalLink, Info } from 'lucide-react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';

interface YoutubeTrack {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  duration_raw: string;
  url: string;
}

export function AideoSearchView() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [youtubeResults, setYoutubeResults] = useState<YoutubeTrack[]>([]);
  
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  
  // Copy state to show a checkmark temporarily
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);

    try {
      const finalQuery = query.trim();

      const tracks = await invoke<YoutubeTrack[]>('search_youtube', { query: finalQuery });
      setYoutubeResults(tracks);
    } catch (err) {
      console.error("Search error", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Search failed: ${err}`, type: 'error' } }));
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownloadYoutube = async (track: YoutubeTrack) => {
    if (downloadingIds.has(track.id) || downloadedIds.has(track.id)) return;
    
    setDownloadingIds(prev => {
      const next = new Set(prev);
      next.add(track.id);
      return next;
    });
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Downloading high-fidelity stream: ${track.title}...`, type: 'info' } 
    }));
    
    try {
      await invoke('download_track', { url: track.url, quality: 'high' });
      setDownloadedIds(prev => {
        const next = new Set(prev);
        next.add(track.id);
        return next;
      });
      useStore.getState().loadLibrary(); // Rescan database immediately
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Successfully added to offline library: ${track.title}!`, type: 'success' } 
      }));
    } catch (err) {
      console.error("Download error", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `YouTube download failed: ${err}`, type: 'error' } 
      }));
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  const handleOpenWebBypass = (trackName: string, provider: 'lucida' | 'squid') => {
    const searchString = trackName.trim();
    navigator.clipboard.writeText(searchString).then(() => {
      setCopiedId(`${searchString}-${provider}`);
      setTimeout(() => setCopiedId(null), 2000);
      
      const targetUrl = provider === 'lucida' 
        ? `https://lucida.to` 
        : `https://squid.wtf`;
      
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Copied "${searchString}"! Opening ${provider} in browser...`, type: 'success' } 
      }));
      
      openUrl(targetUrl).catch(() => {
        window.open(targetUrl, '_blank');
      });
    });
  };

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header Panel */}
      <div className="section-header" style={{ padding: '40px 40px 20px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 8, background: 'linear-gradient(90deg, #fff, #10b981)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Aideo Search
            </h1>
            <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
              Download studio-grade YouTube Music streams directly into your offline library.
            </p>
          </div>
          
          {/* Quick Manual Lossless Web Downloader Badges */}
          <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: 12, border: '1px solid var(--glass-border)', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Lossless FLAC:</span>
            <button 
              onClick={() => openUrl('https://lucida.to').catch(() => window.open('https://lucida.to', '_blank'))}
              style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#10b981', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
            >
              lucida.to <ExternalLink size={10} />
            </button>
            <button 
              onClick={() => openUrl('https://squid.wtf').catch(() => window.open('https://squid.wtf', '_blank'))}
              style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#3b82f6', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
            >
              squid.wtf <ExternalLink size={10} />
            </button>
          </div>
        </div>

        {/* Search Input Bar */}
        <form onSubmit={handleSearch} style={{ marginTop: 28, display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}>
              <Search size={18} />
            </div>
            <input 
              type="text" 
              placeholder="Search premium songs, artists, or albums..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '16px 20px 16px 48px',
                borderRadius: 14,
                border: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(0,0,0,0.35)',
                color: 'white',
                fontSize: 15,
                fontWeight: 500,
                outline: 'none',
                boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.3)',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = 'rgba(16, 185, 129, 0.4)'}
              onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.06)'}
            />
          </div>
          
          <button 
            type="submit"
            style={{
              padding: '0 28px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, #059669, #10b981)',
              color: 'white',
              border: 'none',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(16, 185, 129, 0.25)',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            {isSearching ? <Loader2 size={16} className="pulse" /> : <Search size={16} />}
            Search
          </button>
        </form>
      </div>

      {/* Results Panel */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 40px 40px' }}>
        {isSearching ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80%', color: 'var(--text-dim)' }}>
            <Loader2 className="pulse" size={32} style={{ marginBottom: 16, color: '#10b981' }} />
            <span>Scanning the digital airwaves...</span>
          </div>
        ) : (
          youtubeResults.length > 0 ? (
            <div className="track-list" style={{ marginTop: 12 }}>
              <div className="track-list-header" style={{ display: 'grid', gridTemplateColumns: '48px 1.2fr 0.8fr 80px 180px', padding: '0 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-dim)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                <div></div>
                <div>Title</div>
                <div>Channel</div>
                <div>Duration</div>
                <div style={{ textAlign: 'center' }}>Actions</div>
              </div>
              
              <AnimatePresence>
                {youtubeResults.map((track) => {
                  const isOfficial = track.artist.toLowerCase().includes('topic') || 
                                    track.artist.toLowerCase().includes('vevo') || 
                                    track.artist.toLowerCase().includes('official');
                  
                  return (
                    <motion.div 
                      key={track.id} 
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="track-item" 
                      style={{ display: 'grid', gridTemplateColumns: '48px 1.2fr 0.8fr 80px 180px', padding: '12px 16px', alignItems: 'center', borderRadius: 8, transition: 'background 0.2s', borderBottom: '1px solid rgba(255,255,255,0.02)' }}
                    >
                      {/* Cover Art */}
                      <div style={{ width: 36, height: 36, borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {track.cover_url ? <img src={track.cover_url} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={16} color="var(--text-dim)" />}
                      </div>
                      
                      {/* Title */}
                      <div style={{ paddingRight: 16, overflow: 'hidden' }}>
                        <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {track.title}
                          {isOfficial ? (
                            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                              STUDIO MASTER
                            </span>
                          ) : (
                            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 4, background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                              AAC HQ
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Channel */}
                      <div style={{ color: 'var(--text-dim)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 16 }}>
                        {track.artist}
                      </div>
                      
                      {/* Duration */}
                      <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                        {track.duration_raw}
                      </div>
                      
                      {/* Actions Grid */}
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                        {/* Lucida Bypass Copy Shortcut */}
                        <button
                          onClick={() => handleOpenWebBypass(`${track.artist.replace(' - Topic', '')} - ${track.title}`, 'lucida')}
                          title="Copy & Open in Lucida.to (Pristine Lossless FLAC)"
                          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#10b981', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
                        >
                          {copiedId === `${track.artist.replace(' - Topic', '')} - ${track.title}-lucida` ? <Check size={11} /> : <Globe size={11} />}
                          Lucida
                        </button>
  
                        {/* Squid Bypass Copy Shortcut */}
                        <button
                          onClick={() => handleOpenWebBypass(`${track.artist.replace(' - Topic', '')} - ${track.title}`, 'squid')}
                          title="Copy & Open in Squid.wtf (Lossless FLAC)"
                          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#3b82f6', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
                        >
                          {copiedId === `${track.artist.replace(' - Topic', '')} - ${track.title}-squid` ? <Check size={11} /> : <Globe size={11} />}
                          Squid
                        </button>
  
                        {/* Download to Library */}
                        {downloadedIds.has(track.id) ? (
                          <div style={{ color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: 'rgba(16, 185, 129, 0.1)' }}>
                            <CheckCircle2 size={14} />
                          </div>
                        ) : downloadingIds.has(track.id) ? (
                          <div style={{ color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}>
                            <Loader2 size={14} className="pulse" />
                          </div>
                        ) : (
                          <button 
                            onClick={() => handleDownloadYoutube(track)}
                            title="Download premium stream via robust yt-dlp"
                            style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(16,185,129,0.2)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(16,185,129,0.1)';
                            }}
                          >
                            <Download size={13} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', opacity: 0.4 }}>
              <Music size={48} style={{ marginBottom: 16, color: '#10b981' }} />
              <span style={{ fontSize: 15, fontWeight: 500 }}>Search the global YouTube Music archives.</span>
              <span style={{ fontSize: 12, marginTop: 4 }}>Bypass token block automatically and extract pristine 256kbps audio.</span>
            </div>
          )
        )}
      </div>
      
      {/* Information Banner */}
      <div style={{ margin: '0 40px 24px', padding: '12px 16px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.1)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Info size={16} color="#10b981" />
        <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          <strong>Aideo Stream Extractor</strong>: Downloads pristine high-fidelity AAC audio streams (prioritizing 256kbps M4A studio tracks) via an adaptive, self-healing <code>yt-dlp</code> layer. To obtain completely free, uncompressed lossless FLAC files, click <strong>Lucida</strong> or <strong>Squid</strong> on any card to copy the search string and download manually from the web.
        </span>
      </div>
    </div>
  );
}
