import { useState, useEffect, memo } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { MoreVertical, RefreshCw, Activity, Loader2, Heart, DownloadCloud, Check, Trash2 } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';

const isStreamTrack = (path: string, format?: string | null) => {
  return path.startsWith('http://') || path.startsWith('https://') || format === 'YouTube Direct' || format === 'Tidal FLAC' || format === 'SUBSONIC' || format === 'JELLYFIN';
};


interface CloudTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url: string | null;
  stream_url: string;
  provider: 'subsonic' | 'jellyfin';
}

const cloudTrackToVirtualTrack = (ct: CloudTrack) => {
  return {
    id: -1,
    path: ct.stream_url,
    title: ct.title,
    artist: ct.artist,
    duration: ct.duration,
    format: ct.provider.toUpperCase(),
    lyric_offset: 0,
    cover_url: ct.cover_url
  };
};

function fmt(s: number | null) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function baseName(p: string | null) {
  return p ? (p.split(/[\\/]/).pop() ?? p) : '—';
}

function CloudCacheButton({ streamUrl, cacheCloudTrack, deleteCachedTrack, cachedCloudHashes }: any) {
  const [hash, setHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    invoke<string>('get_url_hash', { url: streamUrl }).then(setHash);
  }, [streamUrl]);

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
        color: 'rgba(255, 255, 255, 0.4)',
        cursor: 'pointer',
        padding: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'color 0.2s',
        borderRadius: 6,
      }}
      onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
      onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)'}
      title="Cache Offline"
    >
      <DownloadCloud size={14} />
    </button>
  );
}

const coverArtCache = new Map<string, string | null>();
const pendingArtRequests = new Map<string, Promise<any>>();

function TrackThumbnail({ path, coverUrl }: { path: string, coverUrl?: string | null }) {
  const isCloud = path.startsWith('http://') || path.startsWith('https://') || (coverUrl && (coverUrl.startsWith('http://') || coverUrl.startsWith('https://')));
  const isSelfHosted = coverUrl && (coverUrl.startsWith('http://') || coverUrl.includes('/rest/getCoverArt.view') || coverUrl.includes('/Images/Primary'));
  const isRemote = coverUrl && coverUrl.startsWith('https://') && !isSelfHosted;
  const targetPath = isRemote ? coverUrl : (coverUrl || path);
  const [art, setArt] = useState<string | null>(isRemote ? coverUrl : (coverArtCache.get(targetPath) || null));

  useEffect(() => {
    if (isRemote) {
      setArt(coverUrl);
      return;
    }
    if (isCloud && !coverUrl) {
      setArt(null);
      return;
    }
    if (!art && !coverArtCache.has(targetPath)) {
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
        if (resolvedArt) setArt(resolvedArt);
      });
    }
  }, [targetPath, art, isRemote, isCloud, coverUrl]);

  return (
    <div className="lib-thumb-mini">
      <img src={art || defaultCover} alt="" loading="lazy" />
    </div>
  );
}

const TrackRow = memo(({ 
  t, i, active, isHighRes, menuOpenFor, isMatching, currentPlaylist, 
  playTrack, setView, setMenuOpenFor, playNextInQueue, addToQueue, matchMetadata, 
  setMatchData, setIsMatching, removeFromPlaylist, setPlaylistModalFor, setEditModalFor,
  toggleLoveTrack, setCoverArtModalTrack, cacheCloudTrack, deleteCachedTrack, cachedCloudHashes
}: any) => {
  const isDolbyAtmos = t.format?.toLowerCase() === 'dolby' || t.format?.toLowerCase() === 'atmos' || t.format?.toLowerCase() === 'dolby atmos';

  return (
    <tr className={`track-row${active ? ' playing' : ''}`}
      onClick={() => { playTrack(t); setView('nowplaying'); }}>
      <td style={{ textAlign: 'center', color: active ? 'var(--accent)' : 'var(--text-dim)', fontSize: 12 }}>
        {active ? '▶' : i + 1}
      </td>
      <td style={{ textAlign: 'center', width: 36 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLoveTrack(t.path);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: t.loved === 1 ? '#ef4444' : 'rgba(255, 255, 255, 0.25)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.2)';
            if (t.loved !== 1) e.currentTarget.style.color = '#ef4444';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1.0)';
            if (t.loved !== 1) e.currentTarget.style.color = 'rgba(255, 255, 255, 0.25)';
          }}
        >
          <Heart size={16} fill={t.loved === 1 ? '#ef4444' : 'transparent'} />
        </button>
      </td>
      <td>
        <TrackThumbnail path={t.path} coverUrl={t.cover_url} />
      </td>
      <td>
        <div className="track-name">{t.title || baseName(t.path)}</div>
      </td>
      <td>
        <div className="track-sub">{t.artist || '—'}</div>
      </td>
      <td>
        {t.format && (
          <span 
            className={`quality-tag ${isHighRes ? 'high-res' : ''} ${
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
            {t.format.toUpperCase()}
          </span>
        )}
      </td>
      <td style={{ textAlign: 'right' }}>
        <div className="track-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
          {fmt(t.duration)}
          {isStreamTrack(t.path, t.format) && (
            <CloudCacheButton 
              streamUrl={t.path} 
              cacheCloudTrack={() => cacheCloudTrack(t)} 
              deleteCachedTrack={deleteCachedTrack} 
              cachedCloudHashes={cachedCloudHashes} 
            />
          )}
          <div style={{ position: 'relative' }}>
            <button
              className="icon-btn"
              onClick={(e) => { e.stopPropagation(); setMenuOpenFor(menuOpenFor === t.id ? null : t.id); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
            >
              <MoreVertical size={16} />
            </button>
            <AnimatePresence>
              {menuOpenFor === t.id && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  style={{ 
                    position: 'absolute', right: 0, top: '100%', zIndex: 100, 
                    background: 'rgba(20, 20, 30, 0.95)', backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, 
                    padding: 6, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    display: 'flex', flexDirection: 'column', gap: 2, transformOrigin: 'top right'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); playNextInQueue(t); }}
                    style={{ padding: '10px 14px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    Play Next
                  </div>
                  <div
                    onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); addToQueue(t); }}
                    style={{ padding: '10px 14px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    Add to Queue
                  </div>

                  <div
                    onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); setCoverArtModalTrack(t); }}
                    style={{ padding: '10px 14px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    Manage Cover Art
                  </div>

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 6px' }} />

                  <div
                    onClick={async (e) => { 
                      e.stopPropagation();
                      setMenuOpenFor(null);
                      setIsMatching(t.id);
                      try {
                        const match = await matchMetadata(t);
                        if (match) {
                          setMatchData({ track: t, match });
                        } else {
                          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'No match found for this track.', type: 'warning' } }));
                        }
                      } catch (err) {
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `MagicMatch failed: ${err}`, type: 'error' } }));
                      } finally {
                        setIsMatching(null);
                      }
                    }}
                    style={{ padding: '10px 14px', fontSize: 13, color: 'var(--accent)', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    {isMatching === t.id ? (
                        <RefreshCw size={14} className="spin" />
                      ) : (
                        <Activity size={14} />
                      )}
                      {isMatching === t.id ? 'Searching...' : 'Magic Match'}
                  </div>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 6px' }} />
                  <div
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setMenuOpenFor(null); 
                      setEditModalFor(t); 
                    }}
                    style={{ padding: '10px 14px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    Edit Song Data
                  </div>
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 6px' }} />

                  {currentPlaylist ? (
                    <div
                      onClick={(e) => { e.stopPropagation(); removeFromPlaylist(currentPlaylist.id, t.path); setMenuOpenFor(null); }}
                      style={{ padding: '10px 14px', fontSize: 13, color: '#ef4444', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      Remove from Playlist
                    </div>
                  ) : (
                    <div
                      onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); setPlaylistModalFor(t); }}
                      style={{ padding: '10px 14px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      Add to Playlist...
                    </div>
                  )}

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 6px' }} />

                  <div
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setMenuOpenFor(null); 
                      if (window.confirm(`Are you sure you want to delete "${t.title || t.path}"? This will remove it from your library and delete the file.`)) {
                        invoke('delete_track', { path: t.path }).then(() => {
                          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Track deleted permanently', type: 'success' } }));
                        }).catch((err) => {
                          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Delete failed: ${err}`, type: 'error' } }));
                        });
                      }
                    }}
                    style={{ padding: '10px 14px', fontSize: 13, color: '#ef4444', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    Delete Song
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </td>
    </tr>
  );
});

const CloudTrackRow = memo(({ 
  t, i, active, menuOpenFor, setMenuOpenFor, playCloudTrack, addToQueue, playNextInQueue,
  cacheCloudTrack, deleteCachedTrack, cachedCloudHashes
}: {
  t: CloudTrack,
  i: number,
  active: boolean,
  menuOpenFor: string | null,
  setMenuOpenFor: (id: string | null) => void,
  playCloudTrack: (track: CloudTrack) => void,
  addToQueue: (track: any) => void,
  playNextInQueue: (track: any) => void,
  cacheCloudTrack: (track: any) => Promise<void>,
  deleteCachedTrack: (streamUrl: string) => Promise<void>,
  cachedCloudHashes: string[]
}) => {
  const vt = cloudTrackToVirtualTrack(t);
  
  return (
    <tr className={`track-row${active ? ' playing' : ''}`}
      onClick={() => playCloudTrack(t)}>
      <td style={{ textAlign: 'center', color: active ? 'var(--accent)' : 'var(--text-dim)', fontSize: 12 }}>
        {active ? '▶' : i + 1}
      </td>
      <td>
        <TrackThumbnail path={t.stream_url} coverUrl={t.cover_url} />
      </td>
      <td>
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
      <td>
        <div className="track-sub">{t.artist || '—'}</div>
      </td>
      <td>
        <span className="quality-tag high-res">LOSSLESS</span>
      </td>
      <td style={{ textAlign: 'right' }}>
        <div className="track-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
          {fmt(t.duration)}
          <CloudCacheButton 
            streamUrl={t.stream_url} 
            cacheCloudTrack={() => cacheCloudTrack(t)} 
            deleteCachedTrack={deleteCachedTrack} 
            cachedCloudHashes={cachedCloudHashes} 
          />
          <div style={{ position: 'relative' }}>
            <button
              className="icon-btn"
              onClick={(e) => { e.stopPropagation(); setMenuOpenFor(menuOpenFor === t.id ? null : t.id); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
            >
              <MoreVertical size={16} />
            </button>
            <AnimatePresence>
              {menuOpenFor === t.id && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  style={{ 
                    position: 'absolute', right: 0, top: '100%', zIndex: 100, 
                    background: 'rgba(20, 20, 30, 0.95)', backdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, 
                    padding: 6, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    display: 'flex', flexDirection: 'column', gap: 2, transformOrigin: 'top right'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); playNextInQueue(vt); }}
                    style={{ padding: '10px 14px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    Play Next
                  </div>
                  <div
                    onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); addToQueue(vt); }}
                    style={{ padding: '10px 14px', fontSize: 13, color: 'white', cursor: 'pointer', borderRadius: 8, transition: 'background 0.2s', display: 'flex', alignItems: 'center' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    Add to Queue
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </td>
    </tr>
  );
});

export function LibraryView() {
  const { 
    view, tracks, playback, loadLibrary, playTrack, setView, currentPlaylist, removeFromPlaylist,
    matchMetadata, addToQueue, playNextInQueue, playlists, addToPlaylist,
    subsonicUrl, subsonicUser, subsonicConnected, subsonicPass,
    jellyfinUrl, jellyfinConnected, toggleLoveTrack, cacheCloudTrack, deleteCachedTrack, cachedCloudHashes, fetchCachedCloudHashes,
    setCoverArtModalTrack
  } = useStore();

  useEffect(() => {
    fetchCachedCloudHashes();
  }, [view]);
  
  const [activeSector, setActiveSector] = useState<'local' | 'subsonic' | 'jellyfin'>('local');
  const [menuOpenFor, setMenuOpenFor] = useState<any>(null);
  const [matchData, setMatchData] = useState<{ track: any, match: any } | null>(null);
  const [isMatching, setIsMatching] = useState<number | null>(null);
  const [playlistModalFor, setPlaylistModalFor] = useState<any | null>(null);
  const [editModalFor, setEditModalFor] = useState<any | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [editAlbum, setEditAlbum] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleLocalCount, setVisibleLocalCount] = useState(150);

  // Reset local pagination count when search filters or sectors change
  useEffect(() => {
    setVisibleLocalCount(150);
  }, [searchQuery, view, currentPlaylist, activeSector]);
  
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
    const currentList = activeSector === 'subsonic' ? subsonicTracks : jellyfinTracks;
    const clickedIndex = currentList.findIndex(x => x.id === ct.id);
    const remainingCloudTracks = clickedIndex !== -1 ? currentList.slice(clickedIndex + 1) : [];
    const tracksToQueue = remainingCloudTracks.map(cloudTrackToVirtualTrack);

    useStore.setState({ queue: tracksToQueue });
    
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
      const shuffled = [...virtualTracks];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      firstTrack = shuffled[0];
      tracksToQueue = shuffled.slice(1);
      useStore.setState({ shuffle: true, queue: tracksToQueue });
    } else {
      firstTrack = virtualTracks[0];
      tracksToQueue = virtualTracks.slice(1);
      useStore.setState({ shuffle: false, queue: tracksToQueue });
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

    await playTrack(firstTrack);
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

  const filteredTracks = sourceTracks.filter((t: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (t.title?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q) || t.path.toLowerCase().includes(q));
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

  return (
    <div 
      className="library-wrap" 
      onClick={() => setMenuOpenFor(null)}
      onScroll={(e) => {
        const target = e.currentTarget;
        if (activeSector === 'local') {
          if (target.scrollHeight - target.scrollTop - target.clientHeight < 250) {
            setVisibleLocalCount(prev => Math.min(prev + 150, filteredTracks.length));
          }
          return;
        }
        if (target.scrollHeight - target.scrollTop - target.clientHeight < 120) {
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
            {currentPlaylist ? currentPlaylist.name : (isLovedStreamsView ? 'Loved Streams' : 'Music Library')}
          </h1>
          <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            {isCloudTab ? (
              activeSector === 'subsonic' 
                ? `${subsonicTracks.length} cloud tracks loaded`
                : `${jellyfinTracks.length} cloud tracks loaded`
            ) : (
              searchQuery ? `${filteredTracks.length} / ${sourceTracks.length}` : sourceTracks.length
            )} {!isCloudTab && (sourceTracks.length === 1 && !searchQuery ? 'track' : 'tracks')}
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
              <input 
                type="text" 
                placeholder="Find song..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'var(--glass)', border: '1px solid var(--glass-border)',
                  borderRadius: 10, padding: '9px 14px', color: 'var(--text)', outline: 'none',
                  width: 220, fontSize: 13, transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--glass-border)'}
              />
            )}

            <button 
              className="btn btn-secondary"
              onClick={() => {
                if (isLovedStreamsView) {
                  if (sourceTracks.length === 0) return;
                  const shuffled = [...sourceTracks];
                  for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                  }
                  const firstTrack = shuffled[0];
                  const restTracks = shuffled.slice(1);
                  useStore.setState({ shuffle: true, queue: restTracks });

                  invoke('clear_queue').then(() => {
                    if (restTracks.length > 0) {
                      invoke('add_to_queue_bulk', { paths: restTracks.map(t => t.path) });
                    }
                  });

                  playTrack(firstTrack);
                  setView('nowplaying');
                } else if (isCloudTab) {
                  handlePlayAllCloud(true);
                } else {
                  useStore.setState({ shuffle: true, queue: [] });
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

                  invoke('clear_queue').then(() => {
                    if (restTracks.length > 0) {
                      invoke('add_to_queue_bulk', { paths: restTracks.map(t => t.path) });
                    }
                  });

                  playTrack(firstTrack);
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
              <div style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: '8px solid white' }}></div>
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
          {sourceTracks.length > 0 && !libraryReady && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16, color: 'var(--text-dim)' }}>
              <Loader2 className="spin" size={32} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Loading your library...</span>
            </div>
          )}
          {sourceTracks.length > 0 && libraryReady && (
            <table className="track-table">
              <thead>
                <tr>
                  <th style={{ width: 48, textAlign: 'center' }}>#</th>
                  <th style={{ width: 36 }}></th>
                  <th style={{ width: 48 }}></th>
                  <th>Title</th>
                  <th>Artist</th>
                  <th style={{ width: 80 }}>Quality</th>
                  <th style={{ width: 72, textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredTracks.slice(0, visibleLocalCount).map((t: any, i: number) => {
                  const active = playback.current_track === t.path;
                  const isHighRes = t.format?.toLowerCase() === 'flac' || t.format?.toLowerCase() === 'wav';

                  return (
                    <TrackRow
                      key={t.id}
                      t={t}
                      i={i}
                      active={active}
                      isHighRes={isHighRes}
                      menuOpenFor={menuOpenFor}
                      isMatching={isMatching}
                      currentPlaylist={currentPlaylist}
                      playTrack={playTrack}
                      setView={setView}
                      setMenuOpenFor={setMenuOpenFor}
                      playNextInQueue={playNextInQueue}
                      addToQueue={addToQueue}
                      matchMetadata={matchMetadata}
                      setMatchData={setMatchData}
                      setIsMatching={setIsMatching}
                      removeFromPlaylist={removeFromPlaylist}
                      setPlaylistModalFor={setPlaylistModalFor}
                      setEditModalFor={setEditModalFor}
                      toggleLoveTrack={toggleLoveTrack}
                      setCoverArtModalTrack={setCoverArtModalTrack}
                      cacheCloudTrack={cacheCloudTrack}
                      deleteCachedTrack={deleteCachedTrack}
                      cachedCloudHashes={cachedCloudHashes}
                    />
                  );
                })}
              </tbody>
            </table>
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
                  <th style={{ width: 48, textAlign: 'center' }}>#</th>
                  <th style={{ width: 48 }}></th>
                  <th>Title</th>
                  <th>Artist</th>
                  <th style={{ width: 80 }}>Quality</th>
                  <th style={{ width: 72, textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {subsonicTracks.map((t: CloudTrack, i: number) => {
                  const active = playback.current_track === t.stream_url;
                  return (
                    <CloudTrackRow
                      key={t.id}
                      t={t}
                      i={i}
                      active={active}
                      menuOpenFor={menuOpenFor}
                      setMenuOpenFor={setMenuOpenFor}
                      playCloudTrack={playCloudTrack}
                      addToQueue={addToQueue}
                      playNextInQueue={playNextInQueue}
                      cacheCloudTrack={cacheCloudTrack}
                      deleteCachedTrack={deleteCachedTrack}
                      cachedCloudHashes={cachedCloudHashes}
                    />
                  );
                })}
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
                  <th style={{ width: 48, textAlign: 'center' }}>#</th>
                  <th style={{ width: 48 }}></th>
                  <th>Title</th>
                  <th>Artist</th>
                  <th style={{ width: 80 }}>Quality</th>
                  <th style={{ width: 72, textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {jellyfinTracks.map((t: CloudTrack, i: number) => {
                  const active = playback.current_track === t.stream_url;
                  return (
                    <CloudTrackRow
                      key={t.id}
                      t={t}
                      i={i}
                      active={active}
                      menuOpenFor={menuOpenFor}
                      setMenuOpenFor={setMenuOpenFor}
                      playCloudTrack={playCloudTrack}
                      addToQueue={addToQueue}
                      playNextInQueue={playNextInQueue}
                      cacheCloudTrack={cacheCloudTrack}
                      deleteCachedTrack={deleteCachedTrack}
                      cachedCloudHashes={cachedCloudHashes}
                    />
                  );
                })}
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
                <h2 style={{ margin: 0 }}>Magic Match Found</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>We found the official metadata for this track.</p>
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
                        addToPlaylist(p.id, playlistModalFor.path); 
                        setPlaylistModalFor(null); 
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added to ${p.name}`, type: 'success' } })); 
                      }}
                      style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, cursor: 'pointer', transition: 'background 0.2s', fontSize: 14, fontWeight: 500 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
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
    </div>
  );
}
