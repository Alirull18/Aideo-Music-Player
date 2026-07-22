import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { 
  Disc, Play, Shuffle, MoreVertical, Plus, Trash2, Activity, ListPlus, Edit3, Image, X, Heart
} from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { extractDominantColor } from '../utils/colorExtractor';
import { ArtistDiscographyDrawer } from './ArtistDiscographyDrawer';

interface AlbumGroup {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  sampleTrack: any;
  tracks: any[];
  totalDuration: number;
}

const coverArtCache = new Map<string, string | null>();
const pendingArtRequests = new Map<string, Promise<any>>();

function AlbumThumbnail({ sampleTrack, title }: { sampleTrack: any; title: string }) {
  const targetPath = sampleTrack?.cover_url || sampleTrack?.path || sampleTrack?.stream_url;
  const [art, setArt] = useState<string | null>(coverArtCache.get(targetPath) || null);

  useEffect(() => {
    let active = true;
    const cached = coverArtCache.get(targetPath) || null;
    setArt(cached);

    if (!targetPath) return;

    if (targetPath.startsWith('data:') || targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
      setArt(targetPath);
      return;
    }

    if (!cached && !coverArtCache.has(targetPath)) {
      if (!pendingArtRequests.has(targetPath)) {
        const req = invoke('get_cover_art', { path: targetPath })
          .then((res: any) => {
            const artUrl = res && typeof res === 'string' ? res : null;
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

      pendingArtRequests.get(targetPath)?.then(resolvedArt => {
        if (active) {
          setArt(resolvedArt || null);
        }
      });
    }

    return () => {
      active = false;
    };
  }, [targetPath]);

  return (
    <img
      src={art || defaultCover}
      alt={title}
      loading="lazy"
      decoding="async"
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'block',
        transition: 'transform 0.4s ease',
      }}
      onError={(e) => {
        (e.target as HTMLImageElement).src = defaultCover;
      }}
    />
  );
}

function fmt(s: number | null) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

const getSavedLovedAlbums = (): string[] => {
  try {
    const raw = localStorage.getItem('aideo-loved-albums');
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
};

interface AlbumsViewProps {
  tracks?: any[];
  searchQuery?: string;
  sortBy?: 'title' | 'artist' | 'count';
  onAlbumCountChange?: (count: number) => void;
}

export function AlbumsView({ 
  tracks: customTracks, 
  searchQuery = '', 
  sortBy = 'title',
  onAlbumCountChange 
}: AlbumsViewProps = {}) {
  const storeTracks = useStore((s) => s.tracks);
  const tracks = customTracks || storeTracks;

  const { 
    playTrack, addToQueue, playNextInQueue, playlists, addToPlaylist,
    setCoverArtModalTrack
  } = useStore();

  const [selectedAlbum, setSelectedAlbum] = useState<AlbumGroup | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [lovedAlbumKeys, setLovedAlbumKeys] = useState<string[]>(getSavedLovedAlbums);
  const [filterLovedOnly, setFilterLovedOnly] = useState(false);
  const [ambientColor, setAmbientColor] = useState<string>('rgba(139, 92, 246, 0.25)');

  // Modals
  const [playlistModalTracks, setPlaylistModalTracks] = useState<any[] | null>(null);
  const [editAlbumModal, setEditAlbumModal] = useState<AlbumGroup | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [, setIsProcessing] = useState<string | null>(null);

  // Extract Ambient Color when Album Drawer opens
  useEffect(() => {
    if (selectedAlbum) {
      const artUrl = selectedAlbum.coverUrl || selectedAlbum.sampleTrack?.cover_url || selectedAlbum.sampleTrack?.path || selectedAlbum.sampleTrack?.stream_url;
      extractDominantColor(artUrl).then(setAmbientColor);
    } else {
      setAmbientColor('rgba(139, 92, 246, 0.25)');
    }
  }, [selectedAlbum]);

  const toggleLoveAlbum = (albumId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setLovedAlbumKeys((prev) => {
      const next = prev.includes(albumId)
        ? prev.filter((id) => id !== albumId)
        : [...prev, albumId];
      localStorage.setItem('aideo-loved-albums', JSON.stringify(next));
      return next;
    });
  };

  // Group tracks into Albums
  const albumGroups = useMemo(() => {
    const map = new Map<string, AlbumGroup>();

    tracks.forEach((t) => {
      const albumTitle = t.album?.trim() || 'Unknown Album';
      const artistName = t.artist?.trim() || 'Unknown Artist';
      const key = `${artistName.toLowerCase()}:::${albumTitle.toLowerCase()}`;

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          title: albumTitle,
          artist: artistName,
          coverUrl: t.cover_url || null,
          sampleTrack: t,
          tracks: [t],
          totalDuration: t.duration || 0,
        });
      } else {
        const group = map.get(key)!;
        group.tracks.push(t);
        group.totalDuration += t.duration || 0;
        if (!group.coverUrl && t.cover_url) {
          group.coverUrl = t.cover_url;
          group.sampleTrack = t;
        }
      }
    });

    return Array.from(map.values());
  }, [tracks]);

  // Filter & Sort
  const filteredAlbums = useMemo(() => {
    return albumGroups
      .filter((a) => {
        if (filterLovedOnly && !lovedAlbumKeys.includes(a.id)) return false;
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sortBy === 'title') return a.title.localeCompare(b.title);
        if (sortBy === 'artist') return a.artist.localeCompare(b.artist);
        if (sortBy === 'count') return b.tracks.length - a.tracks.length;
        return 0;
      });
  }, [albumGroups, searchQuery, sortBy, filterLovedOnly, lovedAlbumKeys]);

  // Notify parent of total album count
  useEffect(() => {
    if (onAlbumCountChange) {
      onAlbumCountChange(filteredAlbums.length);
    }
  }, [filteredAlbums.length, onAlbumCountChange]);

  // Action handlers
  const handlePlayAlbum = async (album: AlbumGroup, shuffle = false) => {
    if (album.tracks.length === 0) return;
    let trackList = [...album.tracks];
    if (shuffle) {
      for (let i = trackList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [trackList[i], trackList[j]] = [trackList[j], trackList[i]];
      }
    }
    const firstTrack = trackList[0];
    const restTracks = trackList.slice(1);
    
    useStore.setState({ queue: restTracks, shuffle });
    
    try {
      await invoke('clear_queue');
      if (restTracks.length > 0) {
        const paths = restTracks.map(t => t.path || t.stream_url);
        await invoke('add_to_queue_bulk', { paths });
      }
    } catch (e) {
      console.error('Failed to sync queue:', e);
    }

    await playTrack(firstTrack);
  };

  const handlePlayAlbumNext = async (album: AlbumGroup) => {
    for (let i = album.tracks.length - 1; i >= 0; i--) {
      await playNextInQueue(album.tracks[i]);
    }
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Queued "${album.title}" to play next!`, type: 'info' } 
    }));
  };

  const handleAddAlbumToQueue = async (album: AlbumGroup) => {
    for (const tr of album.tracks) {
      await addToQueue(tr);
    }
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Added ${album.tracks.length} tracks from "${album.title}" to queue`, type: 'success' } 
    }));
  };

  const handleDeleteAlbum = async (album: AlbumGroup) => {
    if (window.confirm(`Are you sure you want to delete the entire album "${album.title}"? This will permanently delete all ${album.tracks.length} track files.`)) {
      setIsProcessing(album.id);
      try {
        for (const tr of album.tracks) {
          if (tr.path) {
            await invoke('delete_track', { path: tr.path });
          }
        }
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Deleted album "${album.title}"`, type: 'success' } }));
        if (selectedAlbum?.id === album.id) setSelectedAlbum(null);
        await useStore.getState().loadLibrary();
      } catch (err) {
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to delete album: ${err}`, type: 'error' } }));
      } finally {
        setIsProcessing(null);
      }
    }
  };

  const handleSonicMix = async (album: AlbumGroup) => {
    if (album.tracks.length === 0) return;
    setIsProcessing(album.id);
    try {
      const sample = album.tracks[0];
      const targetPath = sample.path || sample.stream_url;
      const similar: any[] = await invoke('get_similar_tracks', { path: targetPath });
      if (similar && similar.length > 0) {
        const store = useStore.getState();
        await store.clearQueue();
        for (const track of similar) {
          await store.addToQueue(track);
        }
        await playTrack(similar[0]);
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Sonic Mix: Queued ${similar.length} tracks based on ${album.title}!`, type: 'success' } }));
      } else {
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Sonic Mix: No similar tracks found in library.', type: 'warning' } }));
      }
    } catch (err) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Sonic Mix failed: ${err}`, type: 'error' } }));
    } finally {
      setIsProcessing(null);
    }
  };

  const handleApplyBatchEdit = async () => {
    if (!editAlbumModal) return;
    setIsProcessing(editAlbumModal.id);
    try {
      for (const t of editAlbumModal.tracks) {
        if (t.path) {
          await invoke('update_track_metadata', {
            path: t.path,
            title: t.title || '',
            artist: editArtist || t.artist || '',
            album: editTitle || t.album || ''
          });
        }
      }
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Album metadata updated!', type: 'success' } }));
      setEditAlbumModal(null);
      useStore.getState().loadLibrary();
    } catch (err) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Update failed: ${err}`, type: 'error' } }));
    } finally {
      setIsProcessing(null);
    }
  };

  return (
    <div className="albums-grid-wrap" style={{ width: '100%' }}>
      
      {/* Sub Filter Pill Bar (All vs Loved Albums) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button
          onClick={() => setFilterLovedOnly(false)}
          style={{
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 16,
            border: 'none',
            background: !filterLovedOnly ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
            color: !filterLovedOnly ? 'white' : 'var(--text-dim)',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          All Albums ({albumGroups.length})
        </button>
        <button
          onClick={() => setFilterLovedOnly(true)}
          style={{
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 16,
            border: 'none',
            background: filterLovedOnly ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
            color: filterLovedOnly ? '#ef4444' : 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'all 0.2s',
          }}
        >
          <Heart size={13} fill={filterLovedOnly ? '#ef4444' : 'none'} color={filterLovedOnly ? '#ef4444' : 'var(--text-dim)'} />
          Loved Albums ({lovedAlbumKeys.length})
        </button>
      </div>

      {/* Albums Grid */}
      {filteredAlbums.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, gap: 16, color: 'var(--text-dim)' }}>
          <Disc size={48} style={{ opacity: 0.3 }} />
          <span>
            {filterLovedOnly
              ? 'No loved albums bookmarked yet. Click the Heart icon on any album card to love it!'
              : (searchQuery ? `No albums found matching "${searchQuery}"` : 'No albums found in your library.')}
          </span>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 24,
            paddingBottom: 40,
          }}
        >
          {filteredAlbums.map((album) => {
            const isLoved = lovedAlbumKeys.includes(album.id);
            return (
              <motion.div
                key={album.id}
                whileHover={{ y: -6 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSelectedAlbum(album)}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 16,
                  padding: 14,
                  cursor: 'pointer',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                  transition: 'border-color 0.2s, background 0.2s',
                  zIndex: menuOpenFor === album.id ? 1000 : 1,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb), 0.3)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                }}
              >
                {/* Cover Image Container */}
                <div
                  style={{
                    width: '100%',
                    paddingTop: '100%',
                    position: 'relative',
                    borderRadius: 12,
                    overflow: 'hidden',
                    marginBottom: 12,
                    background: '#0e0e14',
                  }}
                  className="album-card-art-container"
                >
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                    <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} />
                  </div>

                  {/* Loved Heart Toggle Button on Top-Left */}
                  <button
                    onClick={(e) => toggleLoveAlbum(album.id, e)}
                    style={{
                      position: 'absolute',
                      top: 10,
                      left: 10,
                      background: 'rgba(0, 0, 0, 0.65)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '50%',
                      width: 28,
                      height: 28,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isLoved ? '#ef4444' : 'rgba(255, 255, 255, 0.6)',
                      cursor: 'pointer',
                      transition: 'transform 0.2s',
                    }}
                    title={isLoved ? 'Remove from Loved Albums' : 'Love Album'}
                  >
                    <Heart size={14} fill={isLoved ? '#ef4444' : 'none'} color={isLoved ? '#ef4444' : 'white'} />
                  </button>

                  {/* Track count badge */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      background: 'rgba(0, 0, 0, 0.65)',
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 12,
                      padding: '3px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'white',
                    }}
                  >
                    {album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}
                  </div>

                  {/* Hover Play Button Overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 12,
                      right: 12,
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayAlbum(album, false);
                      }}
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        border: 'none',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 8px 20px rgba(0, 0, 0, 0.4)',
                        transition: 'transform 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      title="Play Album"
                    >
                      <Play size={20} fill="white" style={{ marginLeft: 2 }} />
                    </button>
                  </div>
                </div>

                {/* Album Title with Triple Dots Icon on the Far Right */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', marginBottom: 4 }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      color: 'white',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                    title={album.title}
                  >
                    {album.title}
                  </div>

                  {/* Triple Dots Button */}
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenFor(menuOpenFor === album.id ? null : album.id);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: menuOpenFor === album.id ? 'white' : 'var(--text-dim)',
                        cursor: 'pointer',
                        padding: 4,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'color 0.2s, background 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#fff';
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        if (menuOpenFor !== album.id) {
                          e.currentTarget.style.color = 'var(--text-dim)';
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                      title="Album Options"
                    >
                      <MoreVertical size={16} />
                    </button>

                    {/* Triple Dots Context Menu Dropdown */}
                    <AnimatePresence>
                      {menuOpenFor === album.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '100%',
                            zIndex: 1001,
                            background: 'rgba(20, 20, 32, 0.95)',
                            backdropFilter: 'blur(20px)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: 12,
                            padding: 6,
                            minWidth: 200,
                            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            transformOrigin: 'top right',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handlePlayAlbum(album, false); }}
                            style={{ padding: '8px 12px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Play size={14} fill="white" />
                            Play Album
                          </div>

                          <div
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handlePlayAlbumNext(album); }}
                            style={{ padding: '8px 12px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <ListPlus size={14} />
                            Play Album Next
                          </div>

                          <div
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handleAddAlbumToQueue(album); }}
                            style={{ padding: '8px 12px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Plus size={14} />
                            Add Album to Queue
                          </div>

                          <div
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); setPlaylistModalTracks(album.tracks); }}
                            style={{ padding: '8px 12px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Plus size={14} />
                            Add to Playlist...
                          </div>

                          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 4px' }} />

                          <div
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); setCoverArtModalTrack(album.sampleTrack); }}
                            style={{ padding: '8px 12px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Image size={14} />
                            Manage Cover Art
                          </div>

                          <div
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handleSonicMix(album); }}
                            style={{ padding: '8px 12px', fontSize: 13, color: '#10b981', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Activity size={14} style={{ color: '#10b981' }} />
                            Sonic Mix
                          </div>

                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenFor(null);
                              setEditAlbumModal(album);
                              setEditTitle(album.title);
                              setEditArtist(album.artist);
                            }}
                            style={{ padding: '8px 12px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Edit3 size={14} />
                            Edit Album Data
                          </div>

                          <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 4px' }} />

                          <div
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handleDeleteAlbum(album); }}
                            style={{ padding: '8px 12px', fontSize: 13, color: '#ef4444', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Trash2 size={14} color="#ef4444" />
                            Delete Album
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Artist Name (Clickable to open Artist Discography) */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedArtist(album.artist);
                  }}
                  style={{
                    fontSize: 12,
                    color: 'var(--text-dim)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                  title={`View discography of ${album.artist}`}
                >
                  {album.artist}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Album Detail Drawer / Modal with Dynamic Ambient Backdrop */}
      <AnimatePresence>
        {selectedAlbum && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedAlbum(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(16px)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 620,
                height: '100%',
                background: '#12121a',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.8)',
              }}
            >
              {/* Drawer Header with Dynamic Ambient Tint */}
              <div 
                style={{ 
                  padding: 24, 
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)', 
                  display: 'flex', 
                  gap: 20, 
                  position: 'relative',
                  background: `linear-gradient(180deg, ${ambientColor} 0%, rgba(18, 18, 26, 0.95) 100%)`,
                  transition: 'background 0.5s ease',
                }}
              >
                <button
                  onClick={() => setSelectedAlbum(null)}
                  style={{
                    position: 'absolute',
                    top: 20,
                    right: 20,
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: 'none',
                    borderRadius: '50%',
                    width: 32,
                    height: 32,
                    color: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={18} />
                </button>

                <div style={{ width: 130, height: 130, borderRadius: 12, overflow: 'hidden', flexShrink: 0, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                  <AlbumThumbnail sampleTrack={selectedAlbum.sampleTrack} title={selectedAlbum.title} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, flex: 1, paddingRight: 40 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--accent)' }}>ALBUM</span>
                    <button
                      onClick={(e) => toggleLoveAlbum(selectedAlbum.id, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
                      title="Love Album"
                    >
                      <Heart size={14} fill={lovedAlbumKeys.includes(selectedAlbum.id) ? '#ef4444' : 'none'} color={lovedAlbumKeys.includes(selectedAlbum.id) ? '#ef4444' : 'rgba(255, 255, 255, 0.6)'} />
                    </button>
                  </div>

                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'white', lineHeight: 1.2 }}>{selectedAlbum.title}</h2>
                  
                  {/* Clickable Artist Name */}
                  <div 
                    onClick={() => setSelectedArtist(selectedAlbum.artist)}
                    style={{ fontSize: 14, color: 'var(--text-dim)', cursor: 'pointer', transition: 'color 0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                    title={`View discography of ${selectedAlbum.artist}`}
                  >
                    {selectedAlbum.artist}
                  </div>

                  <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.4)', marginTop: 4 }}>
                    {selectedAlbum.tracks.length} tracks • {fmt(selectedAlbum.totalDuration)} total duration
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => handlePlayAlbum(selectedAlbum, false)}
                      style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 20 }}
                    >
                      <Play size={16} fill="white" />
                      Play Album
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handlePlayAlbum(selectedAlbum, true)}
                      style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 20 }}
                    >
                      <Shuffle size={16} />
                      Shuffle
                    </button>
                  </div>
                </div>
              </div>

              {/* Drawer Track List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                <table className="track-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40, textAlign: 'center' }}>#</th>
                      <th>Title</th>
                      <th style={{ width: 72, textAlign: 'right' }}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAlbum.tracks.map((t, idx) => (
                      <tr
                        key={t.id || idx}
                        onClick={() => playTrack(t)}
                        style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                      >
                        <td style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>{idx + 1}</td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'white', fontSize: 14 }}>{t.title || '—'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t.artist || '—'}</div>
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--text-dim)', fontSize: 13 }}>
                          {fmt(t.duration)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Artist Discography Drawer */}
      <ArtistDiscographyDrawer
        artistName={selectedArtist}
        allTracks={tracks}
        onClose={() => setSelectedArtist(null)}
      />

      {/* Add Album to Playlist Modal */}
      <AnimatePresence>
        {playlistModalTracks && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPlaylistModalTracks(null)}
          >
            <motion.div
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 400, width: '100%', padding: 24 }}
            >
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>Add Album to Playlist</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '4px 0 0 0' }}>
                  Select a playlist to add all {playlistModalTracks.length} songs.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 250, overflowY: 'auto', marginBottom: 20 }}>
                {playlists.length === 0 ? (
                  <p style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                    No playlists created yet.
                  </p>
                ) : (
                  playlists.map((pl) => (
                    <button
                      key={pl.id}
                      onClick={async () => {
                        for (const tr of playlistModalTracks) {
                          const targetPath = tr.path || tr.stream_url;
                          if (targetPath) {
                            await addToPlaylist(pl.id, targetPath);
                          }
                        }
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added ${playlistModalTracks.length} tracks to "${pl.name}"`, type: 'success' } }));
                        setPlaylistModalTracks(null);
                      }}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: 'white',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: 14,
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(var(--accent-rgb), 0.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                    >
                      {pl.name}
                    </button>
                  ))
                )}
              </div>

              <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setPlaylistModalTracks(null)}>
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Edit Album Modal */}
      <AnimatePresence>
        {editAlbumModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setEditAlbumModal(null)}
          >
            <motion.div
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 450, width: '100%', padding: 24 }}
            >
              <h2 style={{ margin: '0 0 16px 0', fontSize: 20 }}>Edit Album Metadata</h2>
              
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Album Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    outline: 'none',
                    fontSize: 14,
                  }}
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Artist Name</label>
                <input
                  type="text"
                  value={editArtist}
                  onChange={(e) => setEditArtist(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    outline: 'none',
                    fontSize: 14,
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditAlbumModal(null)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleApplyBatchEdit}>Save Changes</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
