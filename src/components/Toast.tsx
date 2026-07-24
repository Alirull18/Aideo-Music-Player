import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import { X } from 'lucide-react';
import { useStore } from '../store';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

let toastIdCounter = 0;

function formatToastMessage(
  rawMessage: string,
  type: 'info' | 'error' | 'success',
  developerMode: boolean
): string {
  if (type !== 'error') {
    return rawMessage;
  }

  let context = "General System";
  let cleanMsg = rawMessage;
  let technicalDetail = rawMessage;

  const msgLower = rawMessage.toLowerCase();
  if (msgLower.includes("audio") || msgLower.includes("cpal") || msgLower.includes("wasapi") || msgLower.includes("asio") || msgLower.includes("device") || msgLower.includes("playback-error") || msgLower.includes("emergency")) {
    context = "Audio Engine (player.rs)";
    cleanMsg = "Audio playback system encountered an error. Aideo is attempting to automatically recover.";
  } else if (msgLower.includes("magicmatch") || msgLower.includes("match")) {
    context = "MagicMatch Metadata (scanner.rs / db.rs)";
    cleanMsg = "Metadata lookup failed. The track details could not be resolved.";
  } else if (msgLower.includes("lyrics") || msgLower.includes("lyric")) {
    context = "Lyric Search & Sync (lyrics.rs / lib.rs)";
    cleanMsg = "Could not sync or download lyrics online.";
  } else if (msgLower.includes("cover") || msgLower.includes("artwork") || msgLower.includes("image")) {
    context = "Artwork & Cover Manager (artwork.rs / lib.rs)";
    cleanMsg = "Failed to fetch or apply album artwork.";
  } else if (msgLower.includes("subsonic") || msgLower.includes("cloud") || msgLower.includes("password")) {
    context = "Cloud Connections (cloud.rs)";
    cleanMsg = "Cloud server connection or login failed.";
  } else if (msgLower.includes("delete") || msgLower.includes("remove")) {
    context = "Database/File System (db.rs)";
    cleanMsg = "Could not delete or remove the track.";
  } else if (msgLower.includes("last.fm") || msgLower.includes("scrobble")) {
    context = "Last.fm Scrobbler (lastfm.rs)";
    cleanMsg = "Last.fm scrobbling connection error.";
  } else if (msgLower.includes("update") || msgLower.includes("download")) {
    context = "Downloader/Updater (updater.rs / downloader.rs)";
    cleanMsg = "Operation failed during download or update check.";
  }

  if (developerMode) {
    return `[DEV DIAGNOSTICS]\n• Component: ${context}\n• Error: ${technicalDetail}`;
  } else {
    return cleanMsg;
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [bufferingState, setBufferingState] = useState<{ title: string; artist: string } | null>(null);

  useEffect(() => {
    // Listen for backend playback-errors
    const unlisten = listen<string>('playback-error', (event) => {
      addToast(event.payload, 'error');
      setBufferingState(null);
    });
    const unlistenInfo = listen<string>('ui-toast-info', (event) => {
      addToast(event.payload, 'info');
    });
    const unlistenSuccess = listen<string>('ui-toast-success', (event) => {
      addToast(event.payload, 'success');
      setBufferingState(null);
    });
    const unlistenPlaybackSuccess = listen<string>('playback-success', (event) => {
      addToast(event.payload, 'success');
      setBufferingState(null);
    });
    const unlistenStreamStart = listen<string>('stream-buffering-start', (event) => {
      const state = useStore.getState();
      // If song is already playing and progressing, don't show buffering toast
      if (state.playback.status === 'Playing' && (state.playback.position_secs || 0) > 0.2) {
        setBufferingState(null);
        return;
      }
      const currentTrack = state.currentTrack;
      const title = currentTrack?.title || event.payload.split(/[\\/]/).pop() || 'Online Stream';
      const artist = currentTrack?.artist || 'Preparing stream & buffering...';
      setBufferingState({ title, artist });
    });

    const unlistenStreamEnd = listen<string>('stream-buffering-end', () => {
      setBufferingState(null);
    });

    // Auto-dismiss buffering state as soon as track starts playing and advancing in position
    const unsubStore = useStore.subscribe((state) => {
      if (state.playback.status === 'Playing' && (state.playback.position_secs || 0) > 0.2) {
        setBufferingState(null);
      }
    });

    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent;
      addToast(customEvent.detail.message, customEvent.detail.type);
    };

    const handleBuffering = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.active) {
        const state = useStore.getState();
        if (state.playback.status === 'Playing' && (state.playback.position_secs || 0) > 0.2) {
          setBufferingState(null);
          return;
        }
        setBufferingState({
          title: customEvent.detail.title || 'Unknown Track',
          artist: customEvent.detail.artist || 'Unknown Artist',
        });
      } else {
        setBufferingState(null);
      }
    };
    
    window.addEventListener('ui-toast', handleToast);
    window.addEventListener('ui-stream-buffering', handleBuffering);

    return () => {
      unlisten.then(f => f());
      unlistenInfo.then(f => f());
      unlistenSuccess.then(f => f());
      unlistenPlaybackSuccess.then(f => f());
      unlistenStreamStart.then(f => f());
      unlistenStreamEnd.then(f => f());
      unsubStore();
      window.removeEventListener('ui-toast', handleToast);
      window.removeEventListener('ui-stream-buffering', handleBuffering);
    };
  }, []);

  const addToast = (message: string, type: 'info' | 'error' | 'success') => {
    const state = useStore.getState();
    if (!state.notificationsEnabled) return;

    const formattedMessage = formatToastMessage(message, type, state.developerNotifications);

    const id = String(++toastIdCounter);
    setToasts(prev => [...prev, { id, message: formattedMessage, type }]);
    
    const duration = type === 'error' && state.developerNotifications ? 8000 : 5000;
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      zIndex: 9999,
      pointerEvents: 'none'
    }}>
      <AnimatePresence>
        {bufferingState && (
          <motion.div
            key="stream-buffering-card"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            style={{
              width: 320,
              background: 'rgba(20, 20, 32, 0.92)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: 12,
              padding: '14px 18px',
              boxShadow: '0 12px 36px rgba(0,0,0,0.5), 0 0 20px rgba(139, 92, 246, 0.2)',
              pointerEvents: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div 
                style={{ 
                  width: 20, 
                  height: 20, 
                  border: '2.5px solid rgba(255,255,255,0.15)', 
                  borderTopColor: 'var(--accent, #8b5cf6)', 
                  borderRadius: '50%',
                  animation: 'aideo-spin 0.8s linear infinite',
                  flexShrink: 0
                }} 
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {bufferingState.title}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.65)', marginTop: 2 }}>
                  Starting stream & pre-buffering audio...
                </div>
              </div>
              <button
                onClick={() => setBufferingState(null)}
                title="Dismiss notification"
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.6)',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  transition: 'background 0.2s, color 0.2s',
                  flexShrink: 0
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)';
                  e.currentTarget.style.color = '#ffffff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                }}
              >
                <X size={14} />
              </button>
            </div>
            {/* Animated Progress Bar */}
            <div style={{ height: 3, width: '100%', background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                style={{
                  height: '100%',
                  width: '60%',
                  background: 'linear-gradient(90deg, #8b5cf6, #ec4899)',
                  borderRadius: 3
                }}
              />
            </div>
          </motion.div>
        )}

        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            style={{
              background: t.type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 
                          t.type === 'success' ? 'rgba(16, 185, 129, 0.95)' : 
                          'rgba(30, 30, 40, 0.95)',
              color: 'white',
              padding: '12px 20px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(8px)',
              pointerEvents: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: t.message.includes('[DEV DIAGNOSTICS]') ? 'monospace, monospace' : 'inherit'
            }}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
