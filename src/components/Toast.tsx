import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
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

  useEffect(() => {
    // Listen for backend playback-errors
    const unlisten = listen<string>('playback-error', (event) => {
      addToast(event.payload, 'error');
    });
    const unlistenInfo = listen<string>('ui-toast-info', (event) => {
      addToast(event.payload, 'info');
    });
    const unlistenSuccess = listen<string>('ui-toast-success', (event) => {
      addToast(event.payload, 'success');
    });
    const unlistenPlaybackSuccess = listen<string>('playback-success', (event) => {
      addToast(event.payload, 'success');
    });

    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent;
      addToast(customEvent.detail.message, customEvent.detail.type);
    };
    
    window.addEventListener('ui-toast', handleToast);

    return () => {
      unlisten.then(f => f());
      unlistenInfo.then(f => f());
      unlistenSuccess.then(f => f());
      unlistenPlaybackSuccess.then(f => f());
      window.removeEventListener('ui-toast', handleToast);
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
