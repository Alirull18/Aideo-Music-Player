import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { X, Play, Shuffle, User, Disc, Music, Download } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { sortAlbumTracks } from '../utils/albumUtils';
import { SimpleLRU } from '../utils/lruCache';
import { fmt } from '../utils';
import { shuffleArray } from '../utils/shuffle';

const coverArtCache = new SimpleLRU<string, string | null>(300);
const pendingArtRequests = new SimpleLRU<string, Promise<any>>(300);

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
  const playTrack = useStore((s) => s.playTrack);
  const downloadBatchPlaylist = useStore((s) => s.downloadBatchPlaylist);

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

    const result = Array.from(map.values());
    result.forEach((group) => {
      group.tracks = sortAlbumTracks(group.tracks);
    });
    return result;
  }, [artistTracks]);

  const totalDuration = useMemo(() => {
    return artistTracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  }, [artistTracks]);

  const handlePlayArtist = async (shuffle = false) => {
    if (artistTracks.length === 0) return;
    const trackList = shuffle ? shuffleArray(artistTracks) : [...artistTracks];
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

  const handleDownloadTracks = async (trackList: any[], albumOrName?: string) => {
    if (!trackList || trackList.length === 0) return;
    const items = trackList.map((t, idx) => ({
      url: t.stream_url || t.path || t.url || '',
      title: t.title || t.name || t.track || 'Untitled',
      artist: t.artist || artistName || 'Unknown Artist',
      album: t.album || albumOrName || `${artistName} Discography`,
      cover_url: t.cover_url || null,
      track_number: t.track_number || idx + 1,
    }));
    await downloadBatchPlaylist(items, albumOrName || `${artistName} Discography`);
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
              background: 'var(--drawer-bg)',
              borderLeft: '1px solid var(--glass-border)',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.8)',
            }}
          >
            {/* Header */}
            <div style={{ padding: '28px 32px', borderBottom: '1px solid var(--glass-border)', position: 'relative', background: 'linear-gradient(180deg, rgba(var(--accent-rgb), 0.15) 0%, var(--drawer-header-fade) 100%)' }}>
              <button
                onClick={onClose}
                style={{
                  position: 'absolute',
                  top: 24,
                  right: 24,
                  background: 'var(--glass-h)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 34,
                  height: 34,
                  color: 'var(--text)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(var(--accent-rgb), 0.15)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
              >
                <X size={18} />
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(var(--accent-rgb), 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--accent)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                  <User size={36} color="var(--accent)" />
                </div>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent)' }}>ARTIST</span>
                  <h2 style={{ margin: '4px 0 0 0', fontSize: 26, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>{artistName}</h2>
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
                <button
                  className="btn btn-secondary"
                  onClick={() => handleDownloadTracks(artistTracks, `${artistName} Complete Discography`)}
                  style={{ 
                    padding: '9px 20px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8, 
                    fontSize: 13, 
                    borderRadius: 20, 
                    fontWeight: 600,
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#10b981'
                  }}
                  title="Download full artist discography to local disk"
                >
                  <Download size={15} />
                  Download All
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
              {/* Discography Albums Section */}
              <div style={{ marginBottom: 36 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
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
                        background: 'var(--glass)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 12,
                        padding: 8,
                        cursor: 'pointer',
                        transition: 'transform 0.2s, background 0.2s, border-color 0.2s',
                        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.2)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-3px)';
                        e.currentTarget.style.background = 'var(--glass-h)';
                        e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb), 0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.background = 'var(--glass)';
                        e.currentTarget.style.borderColor = 'var(--glass-border)';
                      }}
                    >
                      <div style={{ width: '100%', paddingTop: '100%', position: 'relative', borderRadius: 8, overflow: 'hidden', marginBottom: 6, background: '#0e0e14' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                          <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} />
                        </div>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }} title={album.title}>
                        {album.title}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-dim)' }}>
                        <span>{album.tracks.length} {album.tracks.length === 1 ? 'song' : 'songs'}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadTracks(album.tracks, album.title);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-dim)',
                            cursor: 'pointer',
                            padding: 2,
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'color 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = '#10b981'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                          title={`Download ${album.title}`}
                        >
                          <Download size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* All Tracks Section */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)' }}>
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
                          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{t.title || '—'}</div>
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
