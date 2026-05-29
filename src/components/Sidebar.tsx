import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { Library, Headphones, Radio, Plus, ListMusic, Trash2, Settings, Sparkles, DownloadCloud, Activity } from 'lucide-react';

export function Sidebar() {
  const { 
    view, 
    setView, 
    playlists, 
    currentPlaylist, 
    loadPlaylistTracks, 
    loadLibrary, 
    createPlaylist, 
    deletePlaylist, 
    setCustomPrompt, 
    setPlaybackError,
    lastfmSessionKey,
    listenbrainzToken,
    sidebarLastfmVisible,
    sidebarListenbrainzVisible,
    appMode
  } = useStore();

  useEffect(() => {
    if (appMode === 'local' && (view === 'aideo' || view === 'aideo_search')) {
      setView('library');
    }
  }, [appMode, view, setView]);
  const [creating, setCreating] = useState(false);
  const [newPName, setNewPName] = useState('');

  const goLibrary = () => {
    useStore.setState({ currentPlaylist: null });
    loadLibrary();
    setView('library');
  };

  const goPlaylist = (id: number) => {
    loadPlaylistTracks(id);
    setView('library');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPName.trim()) createPlaylist(newPName.trim());
    setCreating(false);
    setNewPName('');
  };

  return (
    <aside className="app-sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-name">Aideo</span>
      </div>

      {/* Navigation */}
      {appMode === 'hybrid' && (
        <div className={`nav-item ${view === 'aideo' ? 'active' : ''}`} onClick={() => setView('aideo')}>
          <Sparkles size={18} /> Aideo
        </div>
      )}
      {appMode === 'hybrid' && (
        <div className={`nav-item ${view === 'aideo_search' ? 'active' : ''}`} onClick={() => setView('aideo_search')}>
          <DownloadCloud size={18} /> Aideo Search
        </div>
      )}
      <div className={`nav-item ${view === 'aideo_lab' ? 'active' : ''}`} onClick={() => setView('aideo_lab')}>
        <Activity size={18} /> Aideo Lab
      </div>
      <div className={`nav-item ${view === 'library' && !currentPlaylist ? 'active' : ''}`} onClick={goLibrary}>
        <Library size={18} /> Library
      </div>
      <div className={`nav-item ${view === 'nowplaying' ? 'active' : ''}`} onClick={() => setView('nowplaying')}>
        <Headphones size={18} /> Now Playing
      </div>
      {lastfmSessionKey && sidebarLastfmVisible && (
        <div className={`nav-item ${view === 'lastfm' ? 'active' : ''}`} onClick={() => setView('lastfm')}>
          <Radio size={18} /> Last.fm Stats
        </div>
      )}
      {listenbrainzToken && sidebarListenbrainzVisible && (
        <div className={`nav-item ${view === 'listenbrainz' ? 'active' : ''}`} onClick={() => setView('listenbrainz')}>
          <Radio size={18} style={{ color: 'rgba(235, 116, 59, 0.95)' }} /> ListenBrainz
        </div>
      )}

      {/* Playlists */}
      <div className="sidebar-section" style={{ marginTop: 24, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>Playlists</span>
          <button className="icon-btn" onClick={() => setCreating(!creating)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
            <Plus size={14} />
          </button>
        </div>

        {creating && (
          <form onSubmit={handleCreate} style={{ marginBottom: 12 }}>
            <input
              autoFocus
              type="text"
              placeholder="Playlist Name..."
              value={newPName}
              onChange={e => setNewPName(e.target.value)}
              onBlur={() => setCreating(false)}
              style={{ width: '100%', padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)', color: 'white', outline: 'none' }}
            />
          </form>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {playlists.map(p => (
            <div
              key={p.id}
              className={`nav-item ${currentPlaylist?.id === p.id && view === 'library' ? 'active' : ''}`}
              style={{ padding: '6px 12px', fontSize: 13 }}
              onClick={() => goPlaylist(p.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 12, overflow: 'hidden' }}>
                <ListMusic size={16} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
              </div>
              {currentPlaylist?.id === p.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); deletePlaylist(p.id); }}
                  style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  title="Delete Playlist"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {playlists.length === 0 && !creating && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0', fontStyle: 'italic' }}>
              No playlists yet.
            </div>
          )}
        </div>
      </div>

      {/* Online Tools */}
      {appMode === 'hybrid' && (
        <div className="sidebar-section" style={{ marginTop: 24, paddingLeft: 16, paddingRight: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 8 }}>Online Tools</span>
          <div className="nav-item" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => {
            setCustomPrompt({
              open: true,
              title: 'Stream Radio / URL',
              placeholder: 'Enter http:// or https:// stream URL...',
              actionLabel: 'Play Stream',
              onSubmit: async (url) => {
                if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                  useStore.getState().playStream(url);
                } else {
                  setPlaybackError('Invalid stream URL. Must start with http:// or https://');
                }
              }
            });
          }}>
            <Radio size={16} /> Play Stream URL
          </div>
        </div>
      )}

      {/* Settings */}
      <div style={{ marginTop: 'auto' }} className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
        <Settings size={18} /> Settings
      </div>
    </aside>
  );
}
