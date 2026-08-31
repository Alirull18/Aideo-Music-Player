import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import { 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  Lightbulb, 
  X, 
  Terminal
} from 'lucide-react';
import { useStore } from '../store';
import { ToastAction, ToastType } from '../utils/toast';

export interface ToastMessage {
  id: string;
  message: string;
  title?: string;
  type: ToastType;
  duration: number;
  action?: ToastAction;
  timestamp: number;
  isDiagnostic?: boolean;
  diagnosticContext?: string;
  technicalDetail?: string;
}

let toastIdCounter = 0;
const DEDUP_INTERVAL_MS = 2000;
const MAX_CONCURRENT_TOASTS = 4;
const recentToastsMap = new Map<string, number>();

function formatToastMessage(
  rawMessage: string,
  type: ToastType,
  developerMode: boolean
): {
  cleanMsg: string;
  isDiagnostic: boolean;
  context?: string;
  technicalDetail?: string;
} {
  if (type !== 'error') {
    return { cleanMsg: rawMessage, isDiagnostic: false };
  }

  let context = 'General System';
  let cleanMsg = rawMessage;
  const technicalDetail = rawMessage;

  const msgLower = rawMessage.toLowerCase();
  if (
    msgLower.includes('audio') ||
    msgLower.includes('cpal') ||
    msgLower.includes('wasapi') ||
    msgLower.includes('asio') ||
    msgLower.includes('device') ||
    msgLower.includes('playback-error') ||
    msgLower.includes('emergency')
  ) {
    context = 'Audio Engine (player.rs)';
    cleanMsg =
      'Audio playback system encountered an error. Aideo is attempting to automatically recover.';
  } else if (msgLower.includes('magicmatch') || msgLower.includes('match')) {
    context = 'MagicMatch Metadata (scanner.rs / db.rs)';
    cleanMsg = 'Metadata lookup failed. The track details could not be resolved.';
  } else if (msgLower.includes('lyrics') || msgLower.includes('lyric')) {
    context = 'Lyric Search & Sync (lyrics.rs / lib.rs)';
    cleanMsg = 'Could not sync or download lyrics online.';
  } else if (
    msgLower.includes('cover') ||
    msgLower.includes('artwork') ||
    msgLower.includes('image')
  ) {
    context = 'Artwork & Cover Manager (artwork.rs / lib.rs)';
    cleanMsg = 'Failed to fetch or apply album artwork.';
  } else if (
    msgLower.includes('subsonic') ||
    msgLower.includes('cloud') ||
    msgLower.includes('password')
  ) {
    context = 'Cloud Connections (cloud.rs)';
    cleanMsg = 'Cloud server connection or login failed. Please check credentials in Settings.';
  } else if (msgLower.includes('delete') || msgLower.includes('remove')) {
    context = 'Database/File System (db.rs)';
    cleanMsg = 'Could not delete or remove the track.';
  } else if (msgLower.includes('last.fm') || msgLower.includes('scrobble')) {
    context = 'Last.fm Scrobbler (lastfm.rs)';
    cleanMsg = 'Last.fm scrobbling connection error.';
  } else if (
    msgLower.includes('copyright') ||
    msgLower.includes('unavailable') ||
    msgLower.includes('removed') ||
    msgLower.includes('blocked') ||
    msgLower.includes('rate-limit') ||
    msgLower.includes('could not download') ||
    msgLower.includes('yt-dlp')
  ) {
    context = 'YouTube Downloader (youtube/mod.rs)';
    cleanMsg = rawMessage;
  } else if (msgLower.includes('update') || msgLower.includes('download')) {
    context = 'Downloader/Updater (updater.rs / downloader.rs)';
    cleanMsg = rawMessage;
  }

  return {
    cleanMsg,
    isDiagnostic: developerMode,
    context,
    technicalDetail,
  };
}

interface ToastCardProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function ToastCard({ toast, onDismiss }: ToastCardProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [remainingTime, setRemainingTime] = useState(toast.duration);
  const startTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isPaused) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const elapsed = Date.now() - startTimeRef.current;
      setRemainingTime(prev => Math.max(prev - elapsed, 500));
    } else {
      startTimeRef.current = Date.now();
      timerRef.current = setTimeout(() => {
        onDismiss(toast.id);
      }, remainingTime);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPaused, onDismiss, toast.id, remainingTime]);

  const getStyleProps = () => {
    switch (toast.type) {
      case 'success':
        return {
          icon: <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />,
          accentBorder: 'rgba(16, 185, 129, 0.45)',
          accentGlow: '0 8px 30px rgba(16, 185, 129, 0.12)',
          barBg: 'linear-gradient(90deg, #10b981, #059669)',
          defaultTitle: toast.title || 'Success',
        };
      case 'warning':
        return {
          icon: <AlertTriangle size={18} className="text-amber-400 shrink-0" />,
          accentBorder: 'rgba(245, 158, 11, 0.45)',
          accentGlow: '0 8px 30px rgba(245, 158, 11, 0.12)',
          barBg: 'linear-gradient(90deg, #f59e0b, #d97706)',
          defaultTitle: toast.title || 'Notice',
        };
      case 'error':
        return {
          icon: <AlertCircle size={18} className="text-rose-400 shrink-0" />,
          accentBorder: 'rgba(244, 63, 94, 0.45)',
          accentGlow: '0 8px 30px rgba(244, 63, 94, 0.15)',
          barBg: 'linear-gradient(90deg, #f43f5e, #e11d48)',
          defaultTitle: toast.title || 'Error',
        };
      case 'help':
        return {
          icon: <Lightbulb size={18} className="text-cyan-400 shrink-0" />,
          accentBorder: 'rgba(6, 182, 212, 0.45)',
          accentGlow: '0 8px 30px rgba(6, 182, 212, 0.12)',
          barBg: 'linear-gradient(90deg, #06b6d4, #0284c7)',
          defaultTitle: toast.title || 'Guide',
        };
      case 'info':
      default:
        return {
          icon: <Info size={18} className="text-violet-400 shrink-0" />,
          accentBorder: 'rgba(139, 92, 246, 0.45)',
          accentGlow: '0 8px 30px rgba(139, 92, 246, 0.12)',
          barBg: 'linear-gradient(90deg, #8b5cf6, #6366f1)',
          defaultTitle: toast.title || 'Info',
        };
    }
  };

  const { icon, accentBorder, accentGlow, barBg, defaultTitle } = getStyleProps();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, y: 8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      style={{
        width: 340,
        maxWidth: 'calc(100vw - 32px)',
        background: 'var(--toast-bg, rgba(18, 18, 24, 0.92))',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${accentBorder}`,
        borderRadius: 14,
        boxShadow: `0 14px 40px rgba(0, 0, 0, 0.4), ${accentGlow}`,
        overflow: 'hidden',
        pointerEvents: 'auto',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '14px 16px 12px 16px', display: 'flex', gap: 12 }}>
        <div style={{ paddingTop: 2 }}>{icon}</div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 650,
                color: 'var(--toast-text, #ffffff)',
                letterSpacing: '-0.01em',
              }}
            >
              {defaultTitle}
            </span>
          </div>

          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.45,
              color: 'var(--toast-text-dim, rgba(255, 255, 255, 0.8))',
              wordBreak: 'break-word',
            }}
          >
            {toast.message}
          </div>

          {toast.isDiagnostic && toast.technicalDetail && (
            <div
              style={{
                marginTop: 6,
                padding: '6px 8px',
                borderRadius: 6,
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontSize: 11,
                fontFamily: 'ui-monospace, monospace',
                color: 'rgba(255, 255, 255, 0.85)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, color: '#f43f5e' }}>
                <Terminal size={12} />
                <strong>{toast.diagnosticContext}</strong>
              </div>
              <div style={{ opacity: 0.85, whiteSpace: 'pre-wrap' }}>{toast.technicalDetail}</div>
            </div>
          )}

          {toast.action && (
            <div style={{ marginTop: 8, display: 'flex' }}>
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  onDismiss(toast.id);
                }}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  padding: '5px 12px',
                  borderRadius: 6,
                  background: 'rgba(255, 255, 255, 0.12)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease, transform 0.1s ease',
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.96)')}
                onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              >
                {toast.action.label}
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          title="Dismiss notification"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--toast-text-dim, rgba(255, 255, 255, 0.5))',
            cursor: 'pointer',
            padding: 4,
            marginLeft: -4,
            marginTop: -2,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'flex-start',
            transition: 'color 0.15s ease, background 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--toast-text-dim, rgba(255, 255, 255, 0.5))')}
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress countdown bar */}
      <div
        style={{
          height: 2.5,
          width: '100%',
          background: 'rgba(255, 255, 255, 0.08)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <motion.div
          initial={{ width: '100%' }}
          animate={{ width: isPaused ? undefined : '0%' }}
          transition={{ duration: toast.duration / 1000, ease: 'linear' }}
          style={{
            height: '100%',
            background: barBg,
          }}
        />
      </div>
    </motion.div>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [bufferingState, setBufferingState] = useState<{ title: string; artist: string } | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (options: {
      message: string;
      title?: string;
      type?: ToastType;
      duration?: number;
      action?: ToastAction;
      dedupKey?: string;
    }) => {
      const state = useStore.getState();
      if (!state.notificationsEnabled) return;

      const rawMsg = (options.message || '').trim();
      if (!rawMsg) return;

      const type: ToastType = options.type || 'info';

      // Deduplication check
      const dedupKey = options.dedupKey || `${type}:${options.title || ''}:${rawMsg}`;
      const now = Date.now();
      const lastSeen = recentToastsMap.get(dedupKey);
      if (lastSeen && now - lastSeen < DEDUP_INTERVAL_MS) {
        return;
      }
      recentToastsMap.set(dedupKey, now);

      const formatted = formatToastMessage(rawMsg, type, state.developerNotifications);

      const defaultDuration =
        options.duration ||
        (type === 'error' && state.developerNotifications ? 8000 : type === 'error' ? 5500 : 4000);

      const id = String(++toastIdCounter);

      const newToast: ToastMessage = {
        id,
        message: formatted.cleanMsg,
        title: options.title,
        type,
        duration: defaultDuration,
        action: options.action,
        timestamp: now,
        isDiagnostic: formatted.isDiagnostic,
        diagnosticContext: formatted.context,
        technicalDetail: formatted.technicalDetail,
      };

      setToasts((prev) => {
        // Keep max visible toasts to prevent overflowing viewport
        const sliced = prev.length >= MAX_CONCURRENT_TOASTS ? prev.slice(prev.length - (MAX_CONCURRENT_TOASTS - 1)) : prev;
        return [...sliced, newToast];
      });
    },
    []
  );

  useEffect(() => {
    // Listen for backend playback-errors
    const unlistenPlaybackError = listen<string>('playback-error', (event) => {
      addToast({ message: event.payload, type: 'error', title: 'Playback System' });
      setBufferingState(null);
    });

    const unlistenUiToast = listen<{ message?: string; title?: string; type?: ToastType; duration?: number } | string>(
      'ui-toast',
      (event) => {
        if (typeof event.payload === 'string') {
          addToast({ message: event.payload, type: 'info' });
        } else if (event.payload && typeof event.payload === 'object') {
          const msg = event.payload.message || '';
          const t = event.payload.type || 'info';
          const title = event.payload.title;
          const duration = event.payload.duration;
          if (msg) addToast({ message: msg, title, type: t, duration });
        }
      }
    );

    const unlistenInfo = listen<string>('ui-toast-info', (event) => {
      addToast({ message: event.payload, type: 'info' });
    });

    const unlistenSuccess = listen<string>('ui-toast-success', (event) => {
      addToast({ message: event.payload, type: 'success' });
      setBufferingState(null);
    });

    const unlistenStreamStart = listen<string>('stream-buffering-start', (event) => {
      const state = useStore.getState();
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

    const unsubStore = useStore.subscribe((state) => {
      if (state.playback.status === 'Playing' && (state.playback.position_secs || 0) > 0.2) {
        setBufferingState(null);
      }
    });

    const handleCustomToast = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        if (typeof customEvent.detail === 'string') {
          addToast({ message: customEvent.detail, type: 'info' });
        } else {
          addToast({
            message: customEvent.detail.message,
            title: customEvent.detail.title,
            type: customEvent.detail.type || 'info',
            duration: customEvent.detail.duration,
            action: customEvent.detail.action,
            dedupKey: customEvent.detail.dedupKey,
          });
        }
      }
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

    window.addEventListener('ui-toast', handleCustomToast);
    window.addEventListener('ui-stream-buffering', handleBuffering);

    return () => {
      unlistenPlaybackError.then((f) => f());
      unlistenUiToast.then((f) => f());
      unlistenInfo.then((f) => f());
      unlistenSuccess.then((f) => f());
      unlistenStreamStart.then((f) => f());
      unlistenStreamEnd.then((f) => f());
      unsubStore();
      window.removeEventListener('ui-toast', handleCustomToast);
      window.removeEventListener('ui-stream-buffering', handleBuffering);
    };
  }, [addToast]);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {bufferingState && (
          <motion.div
            key="stream-buffering-card"
            layout
            initial={{ opacity: 0, y: 16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.94 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{
              width: 340,
              maxWidth: 'calc(100vw - 32px)',
              background: 'var(--toast-bg, rgba(18, 18, 24, 0.92))',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              borderRadius: 14,
              padding: '14px 16px',
              boxShadow: '0 14px 40px rgba(0,0,0,0.4), 0 0 20px rgba(139, 92, 246, 0.1)',
              pointerEvents: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  border: '2.5px solid var(--toast-track, rgba(255, 255, 255, 0.15))',
                  borderTopColor: 'var(--accent, #8b5cf6)',
                  borderRadius: '50%',
                  animation: 'aideo-spin 0.8s linear infinite',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 650,
                    color: 'var(--toast-text, #ffffff)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {bufferingState.title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--toast-text-dim, rgba(255, 255, 255, 0.6))', marginTop: 2 }}>
                  Buffering audio stream...
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBufferingState(null)}
                title="Dismiss notification"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.5)',
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: 6,
                  display: 'flex',
                }}
              >
                <X size={14} />
              </button>
            </div>
            {/* Animated Progress Bar */}
            <div
              style={{
                height: 3,
                width: '100%',
                background: 'var(--toast-track, rgba(255, 255, 255, 0.1))',
                borderRadius: 3,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: '100%' }}
                transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                style={{
                  height: '100%',
                  width: '60%',
                  background: 'linear-gradient(90deg, #8b5cf6, #ec4899)',
                  borderRadius: 3,
                }}
              />
            </div>
          </motion.div>
        )}

        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={dismissToast} />
        ))}
      </AnimatePresence>
    </div>
  );
}
