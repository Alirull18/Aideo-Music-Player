import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { Library, Headphones, Radio, Plus, ListMusic, Trash2, Settings, Sparkles, Activity, Heart, ChevronLeft, ChevronRight, BarChart3, Download, Upload, Wand2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';

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
    appMode,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    smartPlaylists,
    createSmartPlaylist,
    deleteSmartPlaylist
  } = useStore(useShallow(s => ({
    view: s.view,
    setView: s.setView,
    playlists: s.playlists,
    currentPlaylist: s.currentPlaylist,
    loadPlaylistTracks: s.loadPlaylistTracks,
    loadLibrary: s.loadLibrary,
    createPlaylist: s.createPlaylist,
    deletePlaylist: s.deletePlaylist,
    setCustomPrompt: s.setCustomPrompt,
    setPlaybackError: s.setPlaybackError,
    lastfmSessionKey: s.lastfmSessionKey,
    listenbrainzToken: s.listenbrainzToken,
    sidebarLastfmVisible: s.sidebarLastfmVisible,
    sidebarListenbrainzVisible: s.sidebarListenbrainzVisible,
    appMode: s.appMode,
    sidebarCollapsed: s.sidebarCollapsed,
    toggleSidebarCollapsed: s.toggleSidebarCollapsed,
    smartPlaylists: s.smartPlaylists || [],
    createSmartPlaylist: s.createSmartPlaylist,
    deleteSmartPlaylist: s.deleteSmartPlaylist,
  })));

  useEffect(() => {
    if (appMode === 'local' && (view === 'aideo_search' || view === 'loved_streams')) {
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

  const handleExportPlaylist = async (p: any) => {
    try {
      const dest = await save({
        title: `Export "${p.name}" as M3U8`,
        defaultPath: `${p.name.replace(/[\\/:*?"<>|]/g, '_')}.m3u8`,
        filters: [{ name: 'M3U Playlist', extensions: ['m3u8', 'm3u'] }]
      });
      if (!dest) return;
      const count = await invoke<number>('export_playlist_m3u', { playlistId: p.id, destPath: dest });
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Exported ${count} tracks to ${dest.split(/[\\/]/).pop()}`, type: 'success' }
      }));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Export failed: ${e}`, type: 'error' }
      }));
    }
  };

  const handleImportPlaylist = async () => {
    try {
      const src = await open({
        title: 'Import M3U Playlist',
        multiple: false,
        filters: [{ name: 'M3U Playlist', extensions: ['m3u8', 'm3u'] }]
      });
      if (!src) return;
      const result = await invoke<{ resolved: number; skipped: number }>('import_playlist_m3u', { srcPath: src });
      await useStore.getState().fetchPlaylists();
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: {
          message: result.resolved > 0
            ? `Imported playlist: ${result.resolved} tracks matched${result.skipped > 0 ? `, ${result.skipped} skipped (not in library)` : ''}`
            : 'No tracks in this playlist matched your library',
          type: result.resolved > 0 ? 'success' : 'warning'
        }
      }));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Import failed: ${e}`, type: 'error' }
      }));
    }
  };

  const [showSmartModal, setShowSmartModal] = useState(false);
  const [smartName, setSmartName] = useState('');
  const [smartField, setSmartField] = useState('artist');
  const [smartOperator, setSmartOperator] = useState('contains');
  const [smartValue, setSmartValue] = useState('');

  const handleExecuteSmart = async (sp: any) => {
    try {
      const tracks = await invoke<any[]>('execute_smart_playlist', { rulesJson: sp.rules_json });
      useStore.setState({ currentPlaylist: { id: -sp.id, name: `⚡ ${sp.name}` }, tracks });
      setView('library');
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Execution failed: ${e}`, type: 'error' } }));
    }
  };

  const handleCreateSmart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smartName.trim() || !smartValue.trim()) return;
    const rules = {
      match_all: true,
      rules: [{ field: smartField, operator: smartOperator, value: smartValue.trim() }]
    };
    await createSmartPlaylist(smartName.trim(), rules);
    setShowSmartModal(false);
    setSmartName('');
    setSmartValue('');
  };

  return (
    <aside className="app-sidebar">
      <div className="sidebar-logo" style={{ display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between', padding: sidebarCollapsed ? '0' : '0 10px', marginBottom: 36, width: '100%' }}>
        {!sidebarCollapsed && <span className="sidebar-logo-name">Aideo</span>}
        <button 
          className="sidebar-toggle-btn" 
          onClick={toggleSidebarCollapsed}
          title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <div className={`nav-item ${view === 'aideo' ? 'active' : ''}`} onClick={() => setView('aideo')} title={sidebarCollapsed ? "Aideo" : undefined}>
        <Sparkles size={18} />
        {!sidebarCollapsed && <span>Aideo</span>}
      </div>
      {appMode === 'hybrid' && (
        <div className={`nav-item ${view === 'charts' ? 'active' : ''}`} onClick={() => setView('charts')} title={sidebarCollapsed ? "Top Charts" : undefined}>
          <BarChart3 size={18} style={{ color: '#f59e0b' }} />
          {!sidebarCollapsed && <span>Top Charts</span>}
        </div>
      )}


      <div className={`nav-item ${view === 'aideo_lab' ? 'active' : ''}`} onClick={() => setView('aideo_lab')} title={sidebarCollapsed ? "Aideo Lab" : undefined}>
        <Activity size={18} />
        {!sidebarCollapsed && <span>Aideo Lab</span>}
      </div>
      <div className={`nav-item ${view === 'library' && !currentPlaylist ? 'active' : ''}`} onClick={goLibrary} title={sidebarCollapsed ? "Library" : undefined}>
        <Library size={18} />
        {!sidebarCollapsed && <span>Library</span>}
      </div>
      {appMode === 'hybrid' && (
        <div className={`nav-item ${view === 'loved_streams' ? 'active' : ''}`} onClick={() => { useStore.setState({ currentPlaylist: null }); loadLibrary(); setView('loved_streams'); }} title={sidebarCollapsed ? "Loved Streams" : undefined}>
          <Heart size={18} />
          {!sidebarCollapsed && <span>Loved Streams</span>}
        </div>
      )}
      <div className={`nav-item ${view === 'nowplaying' ? 'active' : ''}`} onClick={() => setView('nowplaying')} title={sidebarCollapsed ? "Now Playing" : undefined}>
        <Headphones size={18} />
        {!sidebarCollapsed && <span>Now Playing</span>}
      </div>
      <div className={`nav-item ${view === 'insights' ? 'active' : ''}`} onClick={() => setView('insights')} title={sidebarCollapsed ? "Aideo Insights" : undefined}>
        <BarChart3 size={18} />
        {!sidebarCollapsed && <span>Aideo Insights</span>}
      </div>
      {lastfmSessionKey && sidebarLastfmVisible && (
        <div className={`nav-item ${view === 'lastfm' ? 'active' : ''}`} onClick={() => setView('lastfm')} title={sidebarCollapsed ? "Last.fm Stats" : undefined}>
          <Radio size={18} />
          {!sidebarCollapsed && <span>Last.fm Stats</span>}
        </div>
      )}
      {listenbrainzToken && sidebarListenbrainzVisible && (
        <div className={`nav-item ${view === 'listenbrainz' ? 'active' : ''}`} onClick={() => setView('listenbrainz')} title={sidebarCollapsed ? "ListenBrainz" : undefined}>
          <Radio size={18} style={{ color: 'rgba(235, 116, 59, 0.95)' }} />
          {!sidebarCollapsed && <span>ListenBrainz</span>}
        </div>
      )}

      {/* Playlists */}
      {!sidebarCollapsed && (
        <div className="sidebar-section" style={{ marginTop: 24, paddingLeft: 16, paddingRight: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.6, fontFamily: 'monospace' }}>PLAYLISTS</span>
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="icon-btn" onClick={handleImportPlaylist} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }} title="Import M3U/M3U8 Playlist">
                <Upload size={13} />
              </button>
              <button className="icon-btn" onClick={() => setCreating(!creating)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }} title="New Playlist">
                <Plus size={14} />
              </button>
            </div>
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
            {playlists.map((p: any) => (
              <div
                key={p.id}
                className={`nav-item ${currentPlaylist?.id === p.id && view === 'library' ? 'active' : ''}`}
                style={{ fontSize: 13 }}
                onClick={() => goPlaylist(p.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 12, overflow: 'hidden' }}>
                  <ListMusic size={16} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                </div>
                {currentPlaylist?.id === p.id && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleExportPlaylist(p); }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      title="Export as M3U8"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deletePlaylist(p.id); }}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      title="Delete Playlist"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {playlists.length === 0 && !creating && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0', fontStyle: 'italic' }}>
                No playlists yet.
              </div>
            )}
          </div>

          {/* Smart Playlists Section */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1.5, opacity: 0.6, fontFamily: 'monospace' }}>SMART RULES</span>
              <button className="icon-btn" onClick={() => setShowSmartModal(true)} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer' }} title="New Smart Playlist">
                <Wand2 size={13} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {smartPlaylists.map((sp: any) => (
                <div
                  key={sp.id}
                  className={`nav-item ${currentPlaylist?.id === -sp.id ? 'active' : ''}`}
                  style={{ fontSize: 13 }}
                  onClick={() => handleExecuteSmart(sp)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 10, overflow: 'hidden' }}>
                    <Wand2 size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sp.name}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSmartPlaylist(sp.id); }}
                    style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    title="Delete Smart Playlist"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {smartPlaylists.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  No smart rules yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Online Tools */}
      {!sidebarCollapsed && appMode === 'hybrid' && (
        <div className="sidebar-section" style={{ marginTop: 24, paddingLeft: 16, paddingRight: 16 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1.5, display: 'block', marginBottom: 8, opacity: 0.6, fontFamily: 'monospace' }}>ONLINE TOOLS</span>
          <div className="nav-item" style={{ fontSize: 13 }} onClick={() => {
            setCustomPrompt({
              open: true,
              title: 'Stream Radio / URL',
              placeholder: 'Enter http:// or https:// stream URL...',
              actionLabel: 'Play Stream',
              onSubmit: async (url: string) => {
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
      <div style={{ marginTop: 'auto' }} className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')} title={sidebarCollapsed ? "Settings" : undefined}>
        <Settings size={18} />
        {!sidebarCollapsed && <span>Settings</span>}
      </div>

      {/* Smart Playlist Modal */}
      {showSmartModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 420, padding: 24, borderRadius: 16, background: '#121218', border: '1px solid var(--glass-border)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700, color: 'white' }}>
                <Wand2 size={18} color="var(--accent)" /> New Smart Playlist
              </div>
              <button onClick={() => setShowSmartModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreateSmart} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>PLAYLIST NAME</label>
                <input
                  type="text"
                  placeholder="e.g. 90s Rock / Loved Jazz"
                  value={smartName}
                  onChange={e => setSmartName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--glass-h)', color: 'white', fontSize: 13, outline: 'none' }}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>FIELD</label>
                  <select
                    value={smartField}
                    onChange={e => setSmartField(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--glass-border)', background: '#1a1a24', color: 'white', fontSize: 12 }}
                  >
                    <option value="artist">Artist</option>
                    <option value="title">Title</option>
                    <option value="album">Album</option>
                    <option value="format">Format</option>
                    <option value="loved">Loved (1 or 0)</option>
                    <option value="bpm">BPM</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>CONDITION</label>
                  <select
                    value={smartOperator}
                    onChange={e => setSmartOperator(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--glass-border)', background: '#1a1a24', color: 'white', fontSize: 12 }}
                  >
                    <option value="contains">Contains</option>
                    <option value="equals">Equals</option>
                    <option value="greater_than">Greater than</option>
                    <option value="less_than">Less than</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', display: 'block', marginBottom: 4 }}>VALUE</label>
                <input
                  type="text"
                  placeholder="e.g. Miles / FLAC / 1"
                  value={smartValue}
                  onChange={e => setSmartValue(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--glass-h)', color: 'white', fontSize: 13, outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowSmartModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Create Rule</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
