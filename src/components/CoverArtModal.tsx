import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { Search, UploadCloud, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { baseName } from '../utils';
import { extractDominantColor } from '../store/types';

interface SearchResult {
  id: string;
  title: string;
  artist: string;
  source: string;
  cover_url?: string;
}

export function CoverArtModal() {
  const { coverArtModalTrack, setCoverArtModalTrack, applyOnlineCover } = useStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize search query with track details
  useEffect(() => {
    if (!coverArtModalTrack) return;
    setSearchQuery(`${coverArtModalTrack.artist ?? ''} ${coverArtModalTrack.title ?? baseName(coverArtModalTrack.path)}`.trim());
    setResults([]);
  }, [coverArtModalTrack]);

  const handleSearch = async (queryToSearch: string) => {
    if (!queryToSearch.trim()) return;
    setSearching(true);
    setResults([]);
    try {
      const res: SearchResult[] = await invoke('search_lyrics_online', { query: queryToSearch });
      // Filter out only results that actually contain cover art
      const coverResults = res.filter(r => r.cover_url && r.cover_url.trim().length > 0);
      setResults(coverResults);
    } catch (e) {
      console.error(e);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to search covers: ${e}`, type: 'error' } }));
    } finally {
      setSearching(false);
    }
  };

  // Trigger search on mount
  useEffect(() => {
    if (!coverArtModalTrack) return;
    const q = `${coverArtModalTrack.artist ?? ''} ${coverArtModalTrack.title ?? baseName(coverArtModalTrack.path)}`.trim();
    if (q) handleSearch(q);
  }, [coverArtModalTrack]);

  if (!coverArtModalTrack) return null;
  
  const track = coverArtModalTrack;

  const selectOnlineCover = async (url: string) => {
    setLoading(true);
    try {
      await applyOnlineCover(track.path, url);
      // Force reload cover art in local Zustand state
      const art = await invoke<string | null>('get_cover_art', { path: track.path });
      if (art) {
        useStore.setState({ coverArt: art });
        try {
          const color = await extractDominantColor(art);
          useStore.setState({ accentColor: color });
        } catch (_) {}
      }
      useStore.getState().loadLibrary(); // reload local tracks to display cover art immediately
      setCoverArtModalTrack(null);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Cover art applied successfully!', type: 'success' } }));
    } catch (e) {
      console.error(e);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to apply cover art: ${e}`, type: 'error' } }));
    } finally {
      setLoading(false);
    }
  };

  const processLocalFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Please select a valid image file (JPG/PNG).', type: 'warning' } }));
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      if (base64Data) {
        setLoading(true);
        try {
          await invoke('apply_local_cover', { path: track.path, base64Data });
          // Force reload cover art in player
          const art = await invoke<string | null>('get_cover_art', { path: track.path });
          if (art) {
            useStore.setState({ coverArt: art });
            try {
              const color = await extractDominantColor(art);
              useStore.setState({ accentColor: color });
            } catch (_) {}
          }
          useStore.getState().loadLibrary(); // refresh library list views
          setCoverArtModalTrack(null);
          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Local cover applied successfully!', type: 'success' } }));
        } catch (err) {
          console.error(err);
          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to apply local image: ${err}`, type: 'error' } }));
        } finally {
          setLoading(false);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // Drag & Drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processLocalFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processLocalFile(e.target.files[0]);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => setCoverArtModalTrack(null)}>
      <motion.div 
        className="modal-box" 
        onClick={e => e.stopPropagation()}
        style={{ width: 620, height: 600, display: 'flex', flexDirection: 'column' }}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
      >
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ImageIcon size={20} className="accent-color" />
              Manage Cover Art
            </h3>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              Update artwork for <strong>{track.title || baseName(track.path)}</strong>
            </div>
          </div>
          <button className="modal-close" onClick={() => setCoverArtModalTrack(null)}>✕</button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          {/* Drag & Drop Zone */}
          <div 
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragActive ? 'var(--accent)' : 'rgba(255, 255, 255, 0.15)'}`,
              borderRadius: 12,
              padding: '24px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragActive ? 'rgba(139, 92, 246, 0.05)' : 'rgba(255, 255, 255, 0.02)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8
            }}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              accept="image/*"
              onChange={handleFileBrowse}
            />
            {loading ? (
              <RefreshCw size={28} className="spin accent-color" />
            ) : (
              <UploadCloud size={28} className="accent-color" />
            )}
            <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>
              {loading ? 'Applying artwork...' : 'Drag & Drop Album Image here'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Supports PNG, JPG, or JPEG (saved alongside track filename)
            </div>
          </div>

          {/* Search Header */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input 
              type="text" 
              className="studio-editor" 
              style={{ 
                height: 40, 
                borderRadius: 8, 
                padding: '0 12px', 
                flex: 1, 
                fontSize: 13,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search album cover online..."
              onKeyDown={e => e.key === 'Enter' && handleSearch(searchQuery)}
            />
            <button 
              className="btn btn-primary" 
              style={{ width: 'auto', height: 40, padding: '0 16px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => handleSearch(searchQuery)}
              disabled={searching}
            >
              {searching ? <RefreshCw size={14} className="spin" /> : <Search size={14} />}
              Search
            </button>
          </div>

          {/* Search Results Grid */}
          <div style={{ flex: 1, minHeight: 180 }}>
            {searching && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', gap: 10, color: 'var(--text-dim)', fontSize: 13 }}>
                <RefreshCw size={18} className="spin" />
                Searching cover databases...
              </div>
            )}
            {!searching && results.length === 0 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-dim)', fontSize: 13 }}>
                No online cover art found. Try modifying the search query above.
              </div>
            )}
            {!searching && results.length > 0 && (
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(3, 1fr)', 
                gap: 12,
                paddingBottom: 12
              }}>
                {results.map((r, i) => (
                  <motion.div 
                    key={i}
                    onClick={() => r.cover_url && selectOnlineCover(r.cover_url)}
                    whileHover={{ scale: 1.03 }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 10,
                      padding: 8,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      alignItems: 'center',
                      position: 'relative',
                      overflow: 'hidden'
                    }}
                  >
                    {r.cover_url && (
                      <img 
                        src={r.cover_url} 
                        alt={r.title} 
                        referrerPolicy="no-referrer"
                        style={{
                          width: '100%',
                          aspectRatio: '1/1',
                          objectFit: 'cover',
                          borderRadius: 6,
                          background: '#0a0a0f'
                        }}
                      />
                    )}
                    <div style={{ width: '100%', textAlign: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>
                        {r.title}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.artist}
                      </div>
                      <div style={{ 
                        fontSize: 8, 
                        fontWeight: 800, 
                        letterSpacing: 0.5, 
                        textTransform: 'uppercase', 
                        color: 'var(--accent)',
                        marginTop: 2
                      }}>
                        {r.source}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
