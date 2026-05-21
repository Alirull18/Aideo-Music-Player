import { useState } from 'react';
import { useStore } from '../store';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open } from '@tauri-apps/plugin-dialog';
import { Settings, Library, Radio, FolderSearch, RefreshCw, X, DownloadCloud, Activity } from 'lucide-react';

export function SettingsModal() {
  const {
    showSettings, toggleSettings, scanDirs, addScanDir, removeScanDir, scanLibrary, scanStatus,
    toggleScrobble, setLastFmSession, lastfmSessionKey, lastfmToken,
    scrobbleThreshold, setScrobbleThreshold,
    keepAwake, toggleKeepAwake,
    discordEnabled, toggleDiscord,
  } = useStore();
  const [activeTab, setActiveTab] = useState('library');
  const [lfmLoading, setLfmLoading] = useState(false);
  const [lfmError, setLfmError] = useState('');
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');

  if (!showSettings) return null;

  const browse = async () => {
    const sel = await open({ directory: true, multiple: false }).catch(() => null);
    if (sel && typeof sel === 'string') addScanDir(sel);
  };

  return (
    <div className="modal-overlay" onClick={toggleSettings} style={{ backdropFilter: 'blur(16px)', background: 'rgba(0,0,0,0.6)' }}>
      <motion.div className="modal-box" onClick={e => e.stopPropagation()}
        style={{ width: 800, maxWidth: '90vw', height: 600, maxHeight: '90vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Settings size={24} color="var(--accent)" />
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Settings</h2>
          </div>
          <button className="modal-close" onClick={toggleSettings}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Tabs Sidebar */}
          <div style={{ width: 200, padding: 24, borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className={`nav-item ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>
              <Library size={18} /> Library
            </div>
            <div className={`nav-item ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>
              <Radio size={18} /> Services
            </div>
            <div className={`nav-item ${activeTab === 'behavior' ? 'active' : ''}`} onClick={() => setActiveTab('behavior')}>
              <Activity size={18} /> Behavior
            </div>
            <div className={`nav-item ${activeTab === 'updates' ? 'active' : ''}`} onClick={() => setActiveTab('updates')}>
              <DownloadCloud size={18} /> Updates
            </div>
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
            {activeTab === 'library' && (
              <div>
                <h3 style={{ margin: 0, marginBottom: 24, fontSize: 18, fontWeight: 500 }}>Library Folders</h3>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>
                  Add multiple folders to your library. Aideo will scan all of them and aggregate your music.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {scanDirs.map(dir => (
                    <div key={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8 }}>
                      <span style={{ fontSize: 13, wordBreak: 'break-all' }}>{dir}</span>
                      <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => removeScanDir(dir)}>Remove</button>
                    </div>
                  ))}
                  {scanDirs.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: 16, textAlign: 'center', background: 'rgba(0,0,0,0.1)', borderRadius: 8 }}>No folders tracked.</div>}
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button className="btn btn-secondary" onClick={browse}>
                    <FolderSearch size={16} style={{ marginRight: 8 }} /> Add Folder
                  </button>
                  <button className="btn btn-primary" onClick={scanLibrary} disabled={scanDirs.length === 0}>
                    <RefreshCw size={16} style={{ marginRight: 8 }} /> Sync Library
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--text-dim)', marginLeft: 8 }}>{scanStatus}</span>
                </div>
              </div>
            )}

            {activeTab === 'services' && (
              <div>
                <h3 style={{ margin: 0, marginBottom: 24, fontSize: 18, fontWeight: 500 }}>Connected Services</h3>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>
                  Connect Aideo to external services to improve playback stability and scrobble your listening history.
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, background: '#ba0000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>
                      as
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Last.fm Scrobbling</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Automatically log songs you play to your Last.fm profile.</div>
                    </div>
                  </div>
                  {lastfmSessionKey ? (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>Active Connection</div>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '8px 20px' }}
                        onClick={toggleScrobble}
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {!lastfmToken ? (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '8px 24px' }}
                          disabled={lfmLoading}
                          onClick={async () => {
                            setLfmLoading(true); setLfmError('');
                            try {
                              const token = await invoke<string>('lastfm_get_token');
                              useStore.setState({ lastfmToken: token });
                              const apiKey = "f4cbad896003f0f61f05b844ee3c5b0b";
                              await openUrl(`https://www.last.fm/api/auth/?api_key=${apiKey}&token=${token}`);
                            } catch (e: any) {
                              setLfmError(String(e));
                              window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Last.fm auth failed: ${e}`, type: 'error' } }));
                            } finally {
                              setLfmLoading(false);
                            }
                          }}
                        >
                          {lfmLoading ? 'Connecting...' : 'Connect to Last.fm'}
                        </button>
                      ) : (
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Waiting for Browser...</span>
                          <button
                            className="btn btn-primary"
                            style={{ padding: '8px 24px' }}
                            disabled={lfmLoading}
                            onClick={async () => {
                              setLfmLoading(true); setLfmError('');
                              try {
                                const session = await invoke<string>('lastfm_get_session', { token: lastfmToken });
                                setLastFmSession(session);
                                useStore.setState({ lastfmToken: null });
                              } catch (e: any) {
                                setLfmError("Could not find authorization. Did you click 'Allow' in your browser?");
                                window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Last.fm session error: ${e}`, type: 'error' } }));
                              } finally {
                                setLfmLoading(false);
                              }
                            }}
                          >
                            {lfmLoading ? 'Checking...' : 'I have Authorized'}
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={() => useStore.setState({ lastfmToken: null })}>Cancel</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {lastfmSessionKey && (
                  <div style={{ marginTop: 20, padding: '16px', background: 'var(--glass)', borderRadius: 12, border: '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>Scrobble Threshold</span>
                      <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>{scrobbleThreshold}%</span>
                    </div>
                    <input
                      type="range"
                      min="10" max="100" step="5"
                      value={scrobbleThreshold}
                      onChange={(e) => setScrobbleThreshold(parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--accent)' }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
                      Song will be scrobbled after playing {scrobbleThreshold}% of its duration.
                    </div>
                  </div>
                )}
                {lfmError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 12, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 6 }}>{lfmError}</div>}
                <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  Aideo uses official Web Auth. We never see or store your Last.fm password.
                </div>
              </div>
            )}

            {activeTab === 'behavior' && (
              <div>
                <h3 style={{ margin: 0, marginBottom: 24, fontSize: 18, fontWeight: 500 }}>Player Behavior</h3>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>
                  Customize how Aideo interacts with your system.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Prevent System Sleep</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Keeps your PC awake while Aideo is open and playing music.</div>
                    </div>
                    <label className="switch">
                      <input type="checkbox" checked={keepAwake} onChange={toggleKeepAwake} />
                      <span className="slider round"></span>
                    </label>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Discord Rich Presence</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Show your current song, artist, and playback status on Discord.</div>
                    </div>
                    <label className="switch">
                      <input type="checkbox" checked={discordEnabled} onChange={toggleDiscord} />
                      <span className="slider round"></span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'updates' && (
              <div>
                <h3 style={{ margin: 0, marginBottom: 24, fontSize: 18, fontWeight: 500 }}>App Updates</h3>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>
                  Check for the latest version of Aideo Music Player.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Auto-Updater</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Pull the latest version directly from GitHub Releases.</div>
                    </div>
                    <button
                      className="btn btn-primary"
                      disabled={updateChecking}
                      onClick={async () => {
                        setUpdateChecking(true);
                        setUpdateStatus('Checking for updates...');
                        try {
                          const res = await invoke<any>('check_update');
                          if (res.available) {
                            setUpdateStatus(`Version ${res.version} is available!`);
                            // We dispatch event so App.tsx can show the popup
                            window.dispatchEvent(new CustomEvent('update-available', { detail: res }));
                          } else {
                            setUpdateStatus(`You are on the latest version (${res.version}).`);
                          }
                        } catch (e: any) {
                          setUpdateStatus(`Error checking for updates: ${e}`);
                        } finally {
                          setUpdateChecking(false);
                        }
                      }}
                    >
                      {updateChecking ? 'Checking...' : 'Check for Updates'}
                    </button>
                  </div>
                  {updateStatus && (
                    <div style={{ fontSize: 13, color: 'var(--accent)', marginTop: 8 }}>
                      {updateStatus}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
