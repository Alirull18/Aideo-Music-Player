import { useState, useEffect } from 'react';
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

function TrackThumbnail({ path }: { path: string }) {
  const [art, setArt] = useState<string | null>(null);

  useEffect(() => {
    if (!art) {
      invoke('get_cover_art', { path }).then((res: any) => {
        if (res && typeof res === 'string') setArt(res);
      }).catch(() => { });
    }
  }, [path, art]);

  return (
    <div className="lib-thumb-mini">
      <img src={art || defaultCover} alt="" />
    </div>
  );
}

export function LibraryView() {
  const { 
    tracks, playback, loadLibrary, playTrack, setView, playlists, addToPlaylist, currentPlaylist, removeFromPlaylist, 
    matchMetadata, addToQueue, playNextInQueue 
  } = useStore();
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);
  const [matchData, setMatchData] = useState<{ track: any, match: any } | null>(null);
  const [isMatching, setIsMatching] = useState<number | null>(null);

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
      <h1 className="library-title">{currentPlaylist ? currentPlaylist.name : 'Music Library'}</h1>
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
            {tracks.map((t, i) => {
              const active = playback.current_track === t.path;
              const isHighRes = t.format?.toLowerCase() === 'flac' || t.format?.toLowerCase() === 'wav';

              return (
                <tr key={t.id} className={`track-row${active ? ' playing' : ''}`}
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
                              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                              style={{ position: 'absolute', right: 0, top: '100%', zIndex: 100, background: '#1a1a24', border: '1px solid var(--glass-border)', borderRadius: 8, padding: 8, minWidth: 150, boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div
                                onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); playNextInQueue(t); }}
                                style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text)', cursor: 'pointer', borderRadius: 4 }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              >
                                Play Next
                              </div>
                              <div
                                onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); addToQueue(t); }}
                                style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text)', cursor: 'pointer', borderRadius: 4 }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              >
                                Add to Queue
                              </div>

                              <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />

                              <div
                                onClick={async (e) => { 
                                  e.stopPropagation();
                                  setMenuOpenFor(null);
                                  setIsMatching(t.id);
                                  invoke('log_error', { msg: `[MagicMatch] Starting search for: ${t.title || t.path}` });
                                  try {
                                    const match = await matchMetadata(t);
                                    if (match) {
                                      invoke('log_error', { msg: '[MagicMatch] Match found: ' + match.title });
                                      setMatchData({ track: t, match });
                                    } else {
                                      invoke('log_error', { msg: '[MagicMatch] No match found on MusicBrainz.' });
                                      alert('No match found on MusicBrainz for this track.');
                                    }
                                  } catch (err) {
                                    invoke('log_error', { msg: '[MagicMatch] Error: ' + err });
                                  } finally {
                                    setIsMatching(null);
                                  }
                                }}
                                style={{ padding: '8px 12px', fontSize: 12, color: 'var(--accent)', cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(var(--accent-rgb), 0.1)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              >
                                {isMatching === t.id ? (
                                    <RefreshCw size={14} className="spin" />
                                  ) : (
                                    <Activity size={14} />
                                  )}
                                  {isMatching === t.id ? 'Searching...' : 'Magic Match'}
                              </div>
                              <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />

                              {currentPlaylist ? (
                                <div
                                  onClick={(e) => { e.stopPropagation(); removeFromPlaylist(currentPlaylist.id, t.path); setMenuOpenFor(null); }}
                                  style={{ padding: '8px 12px', fontSize: 12, color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                  Remove from Playlist
                                </div>
                              ) : (
                                <>
                                  <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Add to Playlist</div>
                                  {playlists.map(p => (
                                    <div
                                      key={p.id}
                                      onClick={(e) => { e.stopPropagation(); addToPlaylist(p.id, t.path); setMenuOpenFor(null); }}
                                      style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 4 }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                      {p.name}
                                    </div>
                                  ))}
                                  {playlists.length === 0 && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-dim)' }}>No playlists</div>}
                                </>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </td>
                </tr>
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
    </div>
  );
}
