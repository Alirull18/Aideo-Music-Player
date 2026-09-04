import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { Library, Headphones, Radio, Plus, ListMusic, Trash2, Settings, Sparkles, Activity, Heart, ChevronLeft, ChevronRight, BarChart3, TrendingUp, Download, DownloadCloud, Upload, Wand2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { SmartPlaylistBuilderModal } from './SmartPlaylistBuilderModal';

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
    appMode,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    smartPlaylists,
    deleteSmartPlaylist,
    sidebarNavItems
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
    appMode: s.appMode,
    sidebarCollapsed: s.sidebarCollapsed,
    toggleSidebarCollapsed: s.toggleSidebarCollapsed,
    smartPlaylists: s.smartPlaylists || [],
    deleteSmartPlaylist: s.deleteSmartPlaylist,
    sidebarNavItems: s.sidebarNavItems || [],
  })));

  useEffect(() => {
    if (appMode === 'local' && view === 'loved_streams') {
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

  const handleExecuteSmart = async (sp: any) => {
    try {
      const tracks = await invoke<any[]>('execute_smart_playlist', { rulesJson: sp.rules_json });
      useStore.setState({ currentPlaylist: { id: -sp.id, name: `⚡ ${sp.name}` }, tracks });
      setView('library');
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Execution failed: ${e}`, type: 'error' } }));
    }
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

      {/* Dynamic Navigation */}
      {sidebarNavItems.map((item) => {
        if (!item.visible) return null;
        if (item.requiresHybrid && appMode === 'local') return null;
        if (item.id === 'lastfm' && !lastfmSessionKey) return null;
        if (item.id === 'listenbrainz' && !listenbrainzToken) return null;

        let icon = <Sparkles size={18} />;
        let isActive = false;
        let onClick = () => {};

        switch (item.id) {
          case 'aideo':
            icon = <Sparkles size={18} />;
            isActive = view === 'aideo';
            onClick = () => setView('aideo');
            break;
          case 'charts':
            icon = <TrendingUp size={18} />;
            isActive = view === 'charts';
            onClick = () => setView('charts');
            break;
          case 'library':
            icon = <Library size={18} />;
            isActive = view === 'library' && !currentPlaylist;
            onClick = goLibrary;
            break;
          case 'nowplaying':
            icon = <Headphones size={18} />;
            isActive = view === 'nowplaying';
            onClick = () => setView('nowplaying');
            break;
          case 'loved_streams':
            icon = <Heart size={18} />;
            isActive = view === 'loved_streams';
            onClick = () => { useStore.setState({ currentPlaylist: null }); loadLibrary(); setView('loved_streams'); };
            break;
          case 'downloaded':
            icon = <DownloadCloud size={18} />;
            isActive = view === 'downloaded';
            onClick = () => setView('downloaded');
            break;
          case 'aideo_lab':
            icon = <Activity size={18} />;
            isActive = view === 'aideo_lab';
            onClick = () => setView('aideo_lab');
            break;
          case 'insights':
            icon = <BarChart3 size={18} />;
            isActive = view === 'insights';
            onClick = () => setView('insights');
            break;
          case 'lastfm':
            icon = <Radio size={18} />;
            isActive = view === 'lastfm';
            onClick = () => setView('lastfm');
            break;
          case 'listenbrainz':
            icon = <Radio size={18} style={{ color: 'rgba(235, 116, 59, 0.95)' }} />;
            isActive = view === 'listenbrainz';
            onClick = () => setView('listenbrainz');
            break;
        }

        return (
          <div
            key={item.id}
            className={`nav-item ${isActive ? 'active' : ''}`}
            onClick={onClick}
            title={sidebarCollapsed ? item.label : undefined}
          >
            {icon}
            {!sidebarCollapsed && <span>{item.label}</span>}
          </div>
        );
      })}

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
      <SmartPlaylistBuilderModal
        isOpen={showSmartModal}
        onClose={() => setShowSmartModal(false)}
      />
    </aside>
  );
}
