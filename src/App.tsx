import { useEffect, useState, lazy, Suspense } from 'react';
import { useStore } from './store';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Radio, Check, Download, X } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import './App.css';

import { Sidebar } from './components/Sidebar';
import { LibraryView } from './components/LibraryView';
import { NowPlayingView } from './components/NowPlayingView';

const AideoView = lazy(() => import('./components/AideoView').then(m => ({ default: m.AideoView })));
const LastfmView = lazy(() => import('./components/LastfmView').then(m => ({ default: m.LastfmView })));
const ListenbrainzView = lazy(() => import('./components/ListenbrainzView').then(m => ({ default: m.ListenbrainzView })));
const SettingsView = lazy(() => import('./components/SettingsView').then(m => ({ default: m.SettingsView })));
const AideoLabView = lazy(() => import('./components/AideoLabView').then(m => ({ default: m.AideoLabView })));
const FullscreenView = lazy(() => import('./components/FullscreenView').then(m => ({ default: m.FullscreenView })));
const ListeningInsightsView = lazy(() => import('./components/ListeningInsightsView').then(m => ({ default: m.ListeningInsightsView })));
const AlbumsView = lazy(() => import('./components/AlbumsView').then(m => ({ default: m.AlbumsView })));
const ChartsView = lazy(() => import('./components/ChartsView').then(m => ({ default: m.ChartsView })));

import { PlayerBar } from './components/PlayerBar';
import { AudioControlCenter } from './components/AudioControlCenter';
import { AideoPrompt } from './components/AideoPrompt';
import { ToastContainer } from './components/Toast';
import { QueueView } from './components/QueueView';
import { OnboardingWizard } from './components/OnboardingWizard';
import { CoverArtModal } from './components/CoverArtModal';
import { BrowserCallbackLanding } from './components/BrowserCallbackLanding';
import { OauthChildCallback } from './components/OauthChildCallback';
import { MiniPlayer } from './components/MiniPlayer';

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
    showOnboarding,
    sidebarCollapsed,
    miniPlayerMode,
    colorScheme,
    coverArtModalTrack
  } = useStore();
  const [systemIsLight, setSystemIsLight] = useState(window.matchMedia('(prefers-color-scheme: light)').matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const listener = (e: MediaQueryListEvent) => setSystemIsLight(e.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  const isLightTheme = colorScheme === 'light' || (colorScheme === 'system' && systemIsLight);

  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const { fetchDevices, initializeQueue, loadSubsonicPassword, checkSession } = useStore.getState();
    loadLibrary();
    fetchPlaylists();
    fetchDevices();
    initializeQueue();
    loadSubsonicPassword();
    checkSession().catch(e => console.error("checkSession error:", e));

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
    let isCancelled = false;
    let unlistenOAuth: (() => void) | undefined;
    let unlistenOAuthCallback: (() => void) | undefined;

    const setupOAuthListener = async () => {
      const u1 = await listen<any>('oauth-success', (event) => {
        if (isCancelled) return;
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
      if (isCancelled) {
        u1();
        return;
      }
      unlistenOAuth = u1;

      const u2 = await listen<string>('oauth-callback-url', async (event) => {
        if (isCancelled) return;
        const url = event.payload;
        try {
          const hash = url.split('#')[1];
          if (!hash) return;
          const params = new URLSearchParams(hash);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');

          if (access_token && refresh_token) {
            const { getSupabaseClient } = await import('./utils/supabaseClient');
            const client = getSupabaseClient();
            if (client) {
              const { data: { session }, error } = await client.auth.setSession({ access_token, refresh_token });
              if (error) throw error;
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
            }
          }
        } catch (e: any) {
          console.error('Failed to resolve OAuth session from callback:', e);
          useStore.setState({ authLoading: false });
          window.dispatchEvent(new CustomEvent('ui-toast', { 
            detail: { message: `OAuth callback error: ${e.message || e}`, type: 'error' } 
          }));
        }
      });
      if (isCancelled) {
        u2();
        return;
      }
      unlistenOAuthCallback = u2;
    };
    setupOAuthListener();

    return () => {
      isCancelled = true;
      if (unlistenOAuth) unlistenOAuth();
      if (unlistenOAuthCallback) unlistenOAuthCallback();
    };
  }, [loadLibrary, fetchPlaylists]);

  useEffect(() => {
    if (playbackError) {
      const t = setTimeout(() => setPlaybackError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [playbackError, setPlaybackError]);

  useEffect(() => {
    let isCancelled = false;
    const cleanups: (() => void)[] = [];
    let intervalId: any;

    const startPolling = (ms: number) => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(pollStatus, ms);
    };

    // Initial polling frequency based on page visibility state
    startPolling(document.visibilityState === 'visible' ? 200 : 2000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startPolling(200);
      } else {
        startPolling(2000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const setupListeners = async () => {
      const uEnded = await listen('track-ended', () => {
        if (isCancelled) return;
        useStore.getState().playNext();
      });
      if (isCancelled) { uEnded(); return; }
      cleanups.push(uEnded);

      const uLib = await listen('library-updated', () => {
        if (isCancelled) return;
        useStore.getState().loadLibrary();
      });
      if (isCancelled) { uLib(); return; }
      cleanups.push(uLib);

      const uPlay = await listen('media-play', () => {
        if (isCancelled) return;
        useStore.getState().resumeTrack();
      });
      if (isCancelled) { uPlay(); return; }
      cleanups.push(uPlay);

      const uPause = await listen('media-pause', () => {
        if (isCancelled) return;
        useStore.getState().pauseTrack();
      });
      if (isCancelled) { uPause(); return; }
      cleanups.push(uPause);

      const uToggle = await listen('media-toggle', () => {
        if (isCancelled) return;
        const state = useStore.getState();
        if (state.playback.status === 'Playing') state.pauseTrack();
        else state.resumeTrack();
      });
      if (isCancelled) { uToggle(); return; }
      cleanups.push(uToggle);

      const uNext = await listen('media-next', () => {
        if (isCancelled) return;
        useStore.getState().playNext();
      });
      if (isCancelled) { uNext(); return; }
      cleanups.push(uNext);

      const uPrev = await listen('media-prev', () => {
        if (isCancelled) return;
        useStore.getState().playPrev();
      });
      if (isCancelled) { uPrev(); return; }
      cleanups.push(uPrev);
    };
    setupListeners();

    // Global Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const state = useStore.getState();
      const userShortcuts = state.shortcuts || {};
      const keyName = e.key === ' ' ? 'Space' : e.key;

      if (keyName === userShortcuts.playPause) {
        e.preventDefault();
        if (state.playback.status === 'Playing') state.pauseTrack();
        else state.resumeTrack();
      } else if (keyName === userShortcuts.next) {
        e.preventDefault();
        state.playNext();
      } else if (keyName === userShortcuts.prev) {
        e.preventDefault();
        state.playPrev();
      } else if (keyName === userShortcuts.volumeUp) {
        e.preventDefault();
        const currentVol = state.playback.volume;
        state.setVolume(Math.min(currentVol + 0.05, 1));
      } else if (keyName === userShortcuts.volumeDown) {
        e.preventDefault();
        const currentVol = state.playback.volume;
        state.setVolume(Math.max(currentVol - 0.05, 0));
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      isCancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('keydown', handleKeyDown);
      cleanups.forEach(f => f());
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    let unlistenSuccess: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    const setup = async () => {
      const u1 = await listen<string>('playback-success', (event) => {
        if (isCancelled) return;
        setPlaybackSuccess(event.payload);
      });
      if (isCancelled) { u1(); return; }
      unlistenSuccess = u1;

      const u2 = await listen<string>('playback-error', (event) => {
        if (isCancelled) return;
        setPlaybackError(event.payload);
      });
      if (isCancelled) { u2(); return; }
      unlistenError = u2;
    };
    setup();

    return () => {
      isCancelled = true;
      if (unlistenSuccess) unlistenSuccess();
      if (unlistenError) unlistenError();
    };
  }, [setPlaybackSuccess, setPlaybackError]);

  if (miniPlayerMode) {
    return (
      <MotionConfig reducedMotion={lowSpecMode ? "always" : "user"}>
        <div className={`mini-player-outer-wrapper ${isLightTheme ? 'light-theme' : ''}`}>
          <MiniPlayer />
          <ToastContainer />
        </div>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion={lowSpecMode ? "always" : "user"}>
      <div className={`${lowSpecMode ? "app low-spec" : "app"} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${isLightTheme ? "light-theme" : ""}`}>
        <Sidebar />
      <main className="app-main">
        {/* Keep the core heavy AideoView and LibraryView mounted to ensure buttery-smooth instant transitions */}
        <div style={{ display: view === 'aideo' ? 'block' : 'none', height: '100%', width: '100%' }}>
          <AideoView />
        </div>
        <div style={{ display: (view === 'library' || view === 'loved_streams') ? 'block' : 'none', height: '100%', width: '100%' }}>
          <LibraryView />
        </div>

        <AnimatePresence mode="wait">
          {view === 'albums' && (
            <motion.div key="albums" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                  <span>Loading Albums...</span>
                </div>
              }>
                <AlbumsView />
              </Suspense>
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
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                  <span>Loading Last.fm...</span>
                </div>
              }>
                <LastfmView />
              </Suspense>
            </motion.div>
          )}
          {view === 'listenbrainz' && (
            <motion.div key="listenbrainz" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                  <span>Loading ListenBrainz...</span>
                </div>
              }>
                <ListenbrainzView />
              </Suspense>
            </motion.div>
          )}

          {view === 'aideo_lab' && (
            <motion.div key="aideo_lab" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                  <span>Loading Aideo Lab...</span>
                </div>
              }>
                <AideoLabView />
              </Suspense>
            </motion.div>
          )}

          {view === 'settings' && (
            <motion.div key="settings" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                  <span>Loading Settings...</span>
                </div>
              }>
                <SettingsView />
              </Suspense>
            </motion.div>
          )}

          {view === 'insights' && (
            <motion.div key="insights" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                  <span>Loading Insights...</span>
                </div>
              }>
                <ListeningInsightsView />
              </Suspense>
            </motion.div>
          )}

          {view === 'charts' && (
            <motion.div key="charts" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                  <span>Loading Top Charts...</span>
                </div>
              }>
                <ChartsView />
              </Suspense>
            </motion.div>
          )}

          {view === 'fullscreen' && (
            <motion.div key="fullscreen" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
                  <span>Loading Fullscreen...</span>
                </div>
              }>
                <FullscreenView />
              </Suspense>
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
          {coverArtModalTrack && <CoverArtModal />}
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
