import { useEffect } from 'react';
import { useStore } from './store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Radio, Check } from 'lucide-react';
import './App.css';

import { Sidebar } from './components/Sidebar';
import { LibraryView } from './components/LibraryView';
import { NowPlayingView } from './components/NowPlayingView';
import { LastfmView } from './components/LastfmView';
import { PlayerBar } from './components/PlayerBar';
import { AudioControlCenter } from './components/AudioControlCenter';
import { SettingsModal } from './components/SettingsModal';
import { AideoPrompt } from './components/AideoPrompt';
import { ToastContainer } from './components/Toast';
import { QueueView } from './components/QueueView';

// Global Error Logging to Backend Terminal
if (typeof window !== 'undefined') {
  window.onerror = (msg, _url, line, col, error) => {
    invoke('log_error', { msg: `[JS Error] ${msg} at line ${line}:${col} - ${error?.stack || 'No stack'}` });
    return false;
  };
  window.onunhandledrejection = (event) => {
    invoke('log_error', { msg: `[Unhandled Rejection] ${event.reason}` });
  };
}

export default function App() {
  const { view, pollStatus, loadLibrary, lastScrobble, fetchPlaylists, playbackError, playbackSuccess, customPrompt, setCustomPrompt, setPlaybackError, setPlaybackSuccess } = useStore();

  useEffect(() => {
    const { fetchDevices, initializeQueue } = useStore.getState();
    loadLibrary();
    fetchPlaylists();
    fetchDevices();
    initializeQueue();

    return () => { };
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

      if (unlistenPlay) unlistenPlay();
      if (unlistenPause) unlistenPause();
      if (unlistenToggle) unlistenToggle();
      if (unlistenNext) unlistenNext();
      if (unlistenPrev) unlistenPrev();
    };
  }, []);

  useEffect(() => {
    let unlisten: any;
    listen<string>('playback-success', (event) => {
      setPlaybackSuccess(event.payload);
    }).then(u => unlisten = u);
    return () => { if (unlisten) unlisten(); };
  }, [setPlaybackSuccess]);

  return (
    <div className="app">
      <Sidebar />
      <main className="app-main">
        <AnimatePresence mode="wait">
          {view === 'library' && (
            <motion.div key="lib" style={{ height: '100%' }}
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
        </AnimatePresence>
      </main>
      <PlayerBar />
      <ToastContainer />
      <AnimatePresence>
        <QueueView key="queue" />
        <AudioControlCenter key="audio-cc" />
        <SettingsModal key="settings" />
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
      </AnimatePresence>
    </div>
  );
}
