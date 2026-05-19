import { useState, useEffect, memo } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { MoreVertical, RefreshCw, Activity } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';

function fmt(s: number | null) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function baseName(p: string | null) {
  return p ? (p.split(/[\\/]/).pop() ?? p) : '—';
}

const coverArtCache = new Map<string, string | null>();
const pendingArtRequests = new Map<string, Promise<any>>();

function TrackThumbnail({ path }: { path: string }) {
  const [art, setArt] = useState<string | null>(coverArtCache.get(path) || null);

  useEffect(() => {
    if (!art && !coverArtCache.has(path)) {
      if (!pendingArtRequests.has(path)) {
        const req = invoke('get_cover_art', { path }).then((res: any) => {
          const artUrl = (res && typeof res === 'string') ? res : null;
          coverArtCache.set(path, artUrl);
          return artUrl;
        }).catch(() => {
          coverArtCache.set(path, null);
          return null;
        }).finally(() => {
          pendingArtRequests.delete(path);
        });
        pendingArtRequests.set(path, req);
      }
      
      pendingArtRequests.get(path)?.then(resolvedArt => {
        if (resolvedArt) setArt(resolvedArt);
      });
    }
  }, [path, art]);

  return (
    <div className="lib-thumb-mini">
      <img src={art || defaultCover} alt="" loading="lazy" />
    </div>
  );
}

const TrackRow = memo(({ 
  t, i, active, isHighRes, menuOpenFor, isMatching, currentPlaylist, 
  playTrack, setView, setMenuOpenFor, playNextInQueue, addToQueue, matchMetadata, 
  setMatchData, setIsMatching, removeFromPlaylist, setPlaylistModalFor 
}: any) => {
  return (
    <tr className={`track-row${active ? ' playing' : ''}`}
      onClick={() => { playTrack(t); setView('nowplaying'); }}>
      <td style={{ textAlign: 'center', color: active ? 'var(--accent)' : 'var(--text-dim)', fontSize: 12 }}>
        {active ? '▶' : i + 1}
      </td>
      <td>
        <TrackThumbnail path={t.path} />
      </td>
      <td>
        <div className="track-name">{t.title || baseName(t.path)}</div>
      </td>
      <td>
        <div className="track-sub">{t.artist || '—'}</div>
      </td>
      <td>
        {t.format && (
          <span className={`quality-tag ${isHighRes ? 'high-res' : ''}`}>
            {t.format.toUpperCase()}
          </span>
        )}
      </td>
      <td style={{ textAlign: 'right' }}>
        <div className="track-sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
          {fmt(t.duration)}
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

export function LibraryView() {
  const { 
    tracks, playback, loadLibrary, playTrack, setView, currentPlaylist, removeFromPlaylist,
    matchMetadata, addToQueue, playNextInQueue, playlists, addToPlaylist 
  } = useStore();
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [matchData, setMatchData] = useState<{ track: any, match: any } | null>(null);
  const [isMatching, setIsMatching] = useState<number | null>(null);
  const [playlistModalFor, setPlaylistModalFor] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTracks = tracks.filter((t: any) => {
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

  return (
    <div className="library-wrap" onClick={() => setMenuOpenFor(null)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
        <div>
          <h1 className="library-title" style={{ marginBottom: 4 }}>{currentPlaylist ? currentPlaylist.name : 'Music Library'}</h1>
          <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            {searchQuery ? `${filteredTracks.length} / ${tracks.length}` : tracks.length} {tracks.length === 1 && !searchQuery ? 'track' : 'tracks'}
          </div>
        </div>

        {tracks.length > 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
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
            <button 
              className="btn btn-secondary"
              onClick={() => {
                useStore.setState({ shuffle: true, queue: [] });
                const randomIdx = Math.floor(Math.random() * tracks.length);
                playTrack(tracks[randomIdx]);
                setView('nowplaying');
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px' }}
            >
              <RefreshCw size={16} /> Shuffle
            </button>
            <button 
              className="btn btn-primary"
              onClick={() => {
                useStore.setState({ shuffle: false, queue: [] });
                playTrack(tracks[0]);
                setView('nowplaying');
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px' }}
            >
              <div style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: '8px solid white' }}></div>
              Play
            </button>
          </div>
        )}
      </div>

      {tracks.length === 0 && (
        <p style={{ color: 'var(--text-dim)' }}>
          {currentPlaylist ? "This playlist is empty." : "No tracks yet. Select a folder and press \"Scan Library\"."}
        </p>
      )}
      {tracks.length > 0 && (
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
            {filteredTracks.map((t: any, i: number) => {
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
                />
              );
            })}
          </tbody>
        </table>
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
    </div>
  );
}
