import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { X, Play, Shuffle, User, Disc, Music } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';

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

interface ArtistDiscographyDrawerProps {
  artistName: string | null;
  allTracks: any[];
  onClose: () => void;
  onSelectAlbum?: (albumTitle: string) => void;
}

export function ArtistDiscographyDrawer({ 
  artistName, 
  allTracks, 
  onClose,
  onSelectAlbum 
}: ArtistDiscographyDrawerProps) {
  const { playTrack } = useStore();

  // Filter tracks by artist
  const artistTracks = useMemo(() => {
    if (!artistName) return [];
    const target = artistName.toLowerCase().trim();
    return allTracks.filter((t) => t.artist?.toLowerCase().trim() === target);
  }, [artistName, allTracks]);

  // Group artist tracks into Albums
  const artistAlbums = useMemo(() => {
    const map = new Map<string, { title: string; coverUrl: string | null; sampleTrack: any; tracks: any[] }>();

    artistTracks.forEach((t) => {
      const albumTitle = t.album?.trim() || 'Unknown Album';
      const key = albumTitle.toLowerCase();

      if (!map.has(key)) {
        map.set(key, {
          title: albumTitle,
          coverUrl: t.cover_url || null,
          sampleTrack: t,
          tracks: [t],
        });
      } else {
        const group = map.get(key)!;
        group.tracks.push(t);
        if (!group.coverUrl && t.cover_url) {
          group.coverUrl = t.cover_url;
          group.sampleTrack = t;
        }
      }
    });

    return Array.from(map.values());
  }, [artistTracks]);

  const totalDuration = useMemo(() => {
    return artistTracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  }, [artistTracks]);

  const handlePlayArtist = async (shuffle = false) => {
    if (artistTracks.length === 0) return;
    let trackList = [...artistTracks];
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

  return (
    <AnimatePresence>
      {artistName && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
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
              maxWidth: 720,
              height: '100%',
              background: '#12121a',
              borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.8)',
            }}
          >
            {/* Header */}
            <div style={{ padding: '28px 32px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', position: 'relative', background: 'linear-gradient(180deg, rgba(var(--accent-rgb), 0.15) 0%, rgba(18, 18, 26, 0.95) 100%)' }}>
              <button
                onClick={onClose}
                style={{
                  position: 'absolute',
                  top: 24,
                  right: 24,
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 34,
                  height: 34,
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
              >
                <X size={18} />
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(var(--accent-rgb), 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--accent)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                  <User size={36} color="var(--accent)" />
                </div>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent)' }}>ARTIST</span>
                  <h2 style={{ margin: '4px 0 0 0', fontSize: 26, fontWeight: 700, color: 'white', lineHeight: 1.2 }}>{artistName}</h2>
                  <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                    {artistAlbums.length} {artistAlbums.length === 1 ? 'Album' : 'Albums'} • {artistTracks.length} tracks • {fmt(totalDuration)}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handlePlayArtist(false)}
                  style={{ padding: '9px 22px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 20, fontWeight: 600 }}
                >
                  <Play size={16} fill="white" />
                  Play Artist
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => handlePlayArtist(true)}
                  style={{ padding: '9px 22px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 20, fontWeight: 600 }}
                >
                  <Shuffle size={16} />
                  Shuffle
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
              {/* Discography Albums Section */}
              <div style={{ marginBottom: 36 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, color: 'white' }}>
                    <Disc size={20} color="var(--accent)" />
                    Albums & Releases
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{artistAlbums.length} releases</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 14 }}>
                  {artistAlbums.map((album) => (
                    <div
                      key={album.title}
                      onClick={() => {
                        if (onSelectAlbum) onSelectAlbum(album.title);
                      }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        borderRadius: 12,
                        padding: 8,
                        cursor: 'pointer',
                        transition: 'transform 0.2s, background 0.2s, border-color 0.2s',
                        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.2)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-3px)';
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                        e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb), 0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.07)';
                      }}
                    >
                      <div style={{ width: '100%', paddingTop: '100%', position: 'relative', borderRadius: 8, overflow: 'hidden', marginBottom: 6, background: '#0e0e14' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                          <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} />
                        </div>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }} title={album.title}>
                        {album.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                        {album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* All Tracks Section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, color: 'white' }}>
                    <Music size={20} color="var(--accent)" />
                    All Songs
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{artistTracks.length} total tracks</span>
                </div>

                <table className="track-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ width: 44, textAlign: 'center' }}>#</th>
                      <th>Title</th>
                      <th>Album</th>
                      <th style={{ width: 76, textAlign: 'right' }}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artistTracks.map((t, idx) => (
                      <tr 
                        key={t.id || idx} 
                        onClick={() => playTrack(t)} 
                        style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                      >
                        <td style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>{idx + 1}</td>
                        <td>
                          <div style={{ fontWeight: 600, color: 'white', fontSize: 14 }}>{t.title || '—'}</div>
                        </td>
                        <td style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t.album || '—'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-dim)', fontSize: 13 }}>{fmt(t.duration)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
