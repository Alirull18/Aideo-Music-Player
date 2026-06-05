import { useEffect, useState } from 'react';
import { useStore } from './store';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Radio, Check, Download, X } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import './App.css';

import { Sidebar } from './components/Sidebar';
import { LibraryView } from './components/LibraryView';
import { AideoView } from './components/AideoView';
import { NowPlayingView } from './components/NowPlayingView';
import { LastfmView } from './components/LastfmView';
import { ListenbrainzView } from './components/ListenbrainzView';
import { AideoSearchView } from './components/AideoSearchView';

import { PlayerBar } from './components/PlayerBar';
import { AudioControlCenter } from './components/AudioControlCenter';
import { SettingsView } from './components/SettingsView';
import { AideoPrompt } from './components/AideoPrompt';
import { ToastContainer } from './components/Toast';
import { QueueView } from './components/QueueView';
import { AideoLabView } from './components/AideoLabView';
import { OnboardingWizard } from './components/OnboardingWizard';
import { FullscreenView } from './components/FullscreenView';
import { CoverArtModal } from './components/CoverArtModal';
import { BrowserCallbackLanding } from './components/BrowserCallbackLanding';
import { OauthChildCallback } from './components/OauthChildCallback';

// Global Error Logging to Backend Terminal
if (typeof window !== 'undefined') {
  window.onerror = (msg, _url, line, col, error) => {
    if ((window as any).__TAURI_INTERNALS__) {
      invoke('log_error', { msg: `[JS Error] ${msg} at line ${line}:${col} - ${error?.stack || 'No stack'}` });
    } else {
      console.error(`[JS Error] ${msg} at line ${line}:${col}`, error);
    }
    return false;
  };
  window.onunhandledrejection = (event) => {
    if ((window as any).__TAURI_INTERNALS__) {
      invoke('log_error', { msg: `[Unhandled Rejection] ${event.reason}` });
    } else {
      console.error(`[Unhandled Rejection]`, event.reason);
    }
  };
}

function AideoApp() {
  const { 
    view, 
    pollStatus, 
    loadLibrary, 
    lastScrobble, 
    fetchPlaylists, 
    playbackError, 
    playbackSuccess, 
    customPrompt, 
    setCustomPrompt, 
    setPlaybackError, 
    setPlaybackSuccess, 
    lowSpecMode,
    onboardingCompleted,
    showOnboarding
  } = useStore();
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const { fetchDevices, initializeQueue, loadSubsonicPassword } = useStore.getState();
    loadLibrary();
    fetchPlaylists();
    fetchDevices();
    initializeQueue();
    loadSubsonicPassword();

    // Synchronize Windows Keep Awake status with backend on startup
    const initialKeepAwake = localStorage.getItem('aideo_keep_awake') === 'true';
    if (initialKeepAwake) {
      invoke('toggle_keep_awake', { enable: true }).catch(e => console.error("toggle_keep_awake error:", e));
    }

    // Async background setup for yt-dlp audio decoder
    invoke('check_and_download_ytdlp').catch(e => console.error("ytdlp download error:", e));

    // Silent background check for updates
    invoke<any>('check_update').then(res => {
      if (res.available) {
        setUpdateInfo(res);
      }
    }).catch(e => console.error("Update check failed:", e));

    // Fix #7: Use async IIFE to ensure unlisten is assigned before cleanup runs
    let unlistenOAuth: (() => void) | undefined;
    const setupOAuthListener = async () => {
      unlistenOAuth = await listen<any>('oauth-success', (event) => {
        const session = event.payload;
        if (session) {
          useStore.setState({ 
            session, 
            user: session.user ?? null,
            authLoading: false
          });
          window.dispatchEvent(new CustomEvent('ui-toast', { 
            detail: { message: 'Signed in successfully!', type: 'success' } 
          }));
        }
      });
    };
    setupOAuthListener();

    return () => {
      if (unlistenOAuth) unlistenOAuth();
    };
  }, [loadLibrary, fetchPlaylists]);

  useEffect(() => {
    if (playbackError) {
      const t = setTimeout(() => setPlaybackError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [playbackError, setPlaybackError]);

  useEffect(() => {
    const id = setInterval(pollStatus, 200);

    let unlistenEnded: (() => void) | undefined;
    listen('track-ended', () => {
      useStore.getState().playNext();
    }).then(f => unlistenEnded = f);

    let unlistenLibraryUpdated: (() => void) | undefined;
    listen('library-updated', () => {
      useStore.getState().loadLibrary();
    }).then(f => unlistenLibraryUpdated = f);



    // OS Media Controls (souvlaki)
    let unlistenPlay: (() => void) | undefined;
    listen('media-play', () => useStore.getState().resumeTrack()).then(f => unlistenPlay = f);
    let unlistenPause: (() => void) | undefined;
    listen('media-pause', () => useStore.getState().pauseTrack()).then(f => unlistenPause = f);
    let unlistenToggle: (() => void) | undefined;
    listen('media-toggle', () => {
      const state = useStore.getState();
      if (state.playback.status === 'Playing') state.pauseTrack();
      else state.resumeTrack();
    }).then(f => unlistenToggle = f);
    let unlistenNext: (() => void) | undefined;
    listen('media-next', () => useStore.getState().playNext()).then(f => unlistenNext = f);
    let unlistenPrev: (() => void) | undefined;
    listen('media-prev', () => useStore.getState().playPrev()).then(f => unlistenPrev = f);

    // Global Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const key = e.keyCode || e.which;
      if (key === 32) { // Space
        e.preventDefault();
        const state = useStore.getState();
        if (state.playback.status === 'Playing') state.pauseTrack();
        else state.resumeTrack();
      } else if (key === 39) { // Right
        useStore.getState().playNext();
      } else if (key === 37) { // Left
        useStore.getState().playPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', handleKeyDown);
      if (unlistenEnded) unlistenEnded();
      if (unlistenLibraryUpdated) unlistenLibraryUpdated();

      if (unlistenPlay) unlistenPlay();
      if (unlistenPause) unlistenPause();
      if (unlistenToggle) unlistenToggle();
      if (unlistenNext) unlistenNext();
      if (unlistenPrev) unlistenPrev();
    };
  }, []);

  useEffect(() => {
    let unlistenSuccess: any;
    let unlistenError: any;
    listen<string>('playback-success', (event) => {
      setPlaybackSuccess(event.payload);
    }).then(u => unlistenSuccess = u);
    listen<string>('playback-error', (event) => {
      setPlaybackError(event.payload);
    }).then(u => unlistenError = u);
    return () => {
      if (unlistenSuccess) unlistenSuccess();
      if (unlistenError) unlistenError();
    };
  }, [setPlaybackSuccess, setPlaybackError]);

  return (
    <MotionConfig reducedMotion={lowSpecMode ? "always" : "user"}>
      <div className={lowSpecMode ? "app low-spec" : "app"}>
        <Sidebar />
      <main className="app-main">
        <AnimatePresence mode="wait">
          {view === 'aideo' && (
            <motion.div key="aideo" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AideoView />
            </motion.div>
          )}
          {(view === 'library' || view === 'loved_streams') && (
            <motion.div key={view} style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LibraryView />
            </motion.div>
          )}
          {view === 'nowplaying' && (
            <motion.div key="np" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <NowPlayingView />
            </motion.div>
          )}
          {view === 'lastfm' && (
            <motion.div key="lfm" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LastfmView />
            </motion.div>
          )}
          {view === 'listenbrainz' && (
            <motion.div key="listenbrainz" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ListenbrainzView />
            </motion.div>
          )}

          {view === 'aideo_search' && (
            <motion.div key="aideo_search" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AideoSearchView />
            </motion.div>
          )}

          {view === 'aideo_lab' && (
            <motion.div key="aideo_lab" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <AideoLabView />
            </motion.div>
          )}

          {view === 'settings' && (
            <motion.div key="settings" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <SettingsView />
            </motion.div>
          )}

          {view === 'fullscreen' && (
            <motion.div key="fullscreen" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <FullscreenView />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <PlayerBar />
      <ToastContainer />
      <AnimatePresence>
        <QueueView key="queue" />
        <AudioControlCenter key="audio-cc" />
        {lastScrobble && (
          <motion.div
            key="scrobble-toast"
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="scrobble-toast"
          >
            <Radio size={14} className="pulse" />
            <span>Scrobbled: <strong>{lastScrobble.track}</strong></span>
          </motion.div>
        )}

        {playbackSuccess && (
          <motion.div
            key="playback-success"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            style={{
              position: 'fixed',
              bottom: 100,
              right: 24,
              width: 320,
              background: 'rgba(21, 128, 61, 0.95)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              zIndex: 9999,
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ background: '#22c55e', borderRadius: '50%', padding: 4, display: 'flex' }}>
                <Check size={14} color="white" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'white', marginBottom: 2 }}>Streaming Success</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: 600, marginBottom: 2 }}>STATION CONNECTED</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', lineHeight: 1.4, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playbackSuccess}</div>
              </div>
            </div>
          </motion.div>
        )}

        {updateInfo && (
          <motion.div
            key="update-popup"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            style={{
              position: 'fixed',
              bottom: 24,
              right: 24,
              width: 340,
              background: 'var(--glass)',
              backdropFilter: 'blur(24px)',
              border: '1px solid var(--glass-border)',
              borderRadius: 16,
              padding: 24,
              boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
              zIndex: 10000,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: updateError ? '#ef4444' : 'var(--accent)', borderRadius: '50%', padding: 8, display: 'flex' }}>
                  <Download size={18} color="white" />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{updateError ? 'Update Failed' : 'Update Available'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Version {updateInfo.version}</div>
                </div>
              </div>
              <button 
                className="modal-close" 
                style={{ padding: 8, margin: -8, cursor: 'pointer' }} 
                onClick={(e) => { e.stopPropagation(); setUpdateInfo(null); setUpdateError(null); }}
              >
                <X size={16} />
              </button>
            </div>
            
            {updateError ? (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, color: '#f87171', marginBottom: 10, lineHeight: 1.4 }}>
                  The automatic installation encountered an issue: {updateError}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                  Since you are running an older release (like v0.6.0), the built-in process launcher might have run into an escaping limitation. Please download and install the update manually.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, maxHeight: 60, overflowY: 'auto', lineHeight: 1.5 }}>
                {updateInfo.body || 'A new version of Aideo is ready to install.'}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!updateError && (
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '10px 0', display: 'flex', justifyContent: 'center', gap: 8 }}
                  disabled={isDownloadingUpdate}
                  onClick={async () => {
                    setIsDownloadingUpdate(true);
                    setUpdateError(null);
                    try {
                      await invoke('download_and_install', { url: updateInfo.download_url });
                    } catch (e: any) {
                      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Update failed: ${e}`, type: 'error' } }));
                      setUpdateError(e.toString());
                      setIsDownloadingUpdate(false);
                    }
                  }}
                >
                  {isDownloadingUpdate ? (
                    'Downloading & Installing...'
                  ) : (
                    <>
                      <Download size={16} />
                      Install Update Now
                    </>
                  )}
                </button>
              )}

              <button
                className={updateError ? "btn btn-primary" : "btn btn-secondary"}
                style={{ width: '100%', padding: '10px 0', display: 'flex', justifyContent: 'center', gap: 8 }}
                onClick={() => {
                  openUrl('https://github.com/Alirull18/Aideo-Music-Player/releases/latest').catch(() => window.open('https://github.com/Alirull18/Aideo-Music-Player/releases/latest', '_blank'));
                }}
              >
                <Download size={16} />
                Download Manually from GitHub
              </button>

              {updateError && (
                <button
                  className="btn btn-secondary"
                  style={{ width: '100%', padding: '10px 0' }}
                  onClick={() => {
                    setUpdateInfo(null);
                    setUpdateError(null);
                  }}
                >
                  Dismiss
                </button>
              )}
            </div>
          </motion.div>
        )}

        <AnimatePresence>
          {customPrompt.open && (
            <AideoPrompt
              title={customPrompt.title}
              placeholder={customPrompt.placeholder}
              initialValue={customPrompt.initialValue}
              actionLabel={customPrompt.actionLabel}
              onClose={() => setCustomPrompt({ open: false })}
              onSubmit={customPrompt.onSubmit}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {useStore(s => s.coverArtModalTrack) && <CoverArtModal />}
        </AnimatePresence>
      </AnimatePresence>

      <AnimatePresence>
        {(showOnboarding || !onboardingCompleted) && (
          <motion.div
            key="onboarding-wizard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ zIndex: 99999 }}
          >
            <OnboardingWizard />
          </motion.div>
        )}
      </AnimatePresence>

      </div>
    </MotionConfig>
  );
}

export default function App() {
  const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
  const [isOauthChild, setIsOauthChild] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      if (win.label === 'supabase-login') {
        setIsOauthChild(true);
      }
    }).catch(() => {});
  }, [isTauri]);

  if (!isTauri) {
    return <BrowserCallbackLanding />;
  }

  if (isOauthChild) {
    return <OauthChildCallback />;
  }

  return <AideoApp />;
}
