import { useEffect, useRef, useState, memo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { CanvasResult } from '../store/types';
import Hls from 'hls.js';

export interface CanvasVideoPlayerProps {
  canvas: CanvasResult | null;
  isPlaying: boolean;
  variant?: 'artwork' | 'backdrop';
  className?: string;
  onLoaded?: () => void;
}

function safePlayVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  try {
    const res = video.play();
    if (res && typeof res.catch === 'function') {
      res.catch(() => {});
    }
  } catch {
    // Ignore autoplay or unmounted error
  }
}

function safePauseVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  try {
    video.pause();
  } catch {
    // Ignore
  }
}

export const CanvasVideoPlayer = memo(function CanvasVideoPlayer({
  canvas,
  isPlaying,
  variant = 'artwork',
  className = '',
  onLoaded,
}: CanvasVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const hlsRef = useRef<Hls | null>(null);

  // Clean URL: handle local file path conversion vs remote HTTP URLs
  const resolvedUrl = (() => {
    if (!canvas?.url) return null;
    if (canvas.is_local) {
      try {
        return convertFileSrc(canvas.url);
      } catch {
        return canvas.url;
      }
    }
    return canvas.url;
  })();

  // Lifecycle: HLS / Native video source setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolvedUrl) {
      setIsReady(false);
      return;
    }

    setIsReady(false);

    // Destroy existing HLS instance if any
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = canvas?.format === 'hls' || resolvedUrl.includes('.m3u8');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.loadSource(resolvedUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (isPlaying) {
          safePlayVideo(video);
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setIsReady(false);
        }
      });
    } else {
      video.src = resolvedUrl;
      if (isPlaying) {
        safePlayVideo(video);
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [resolvedUrl, canvas?.format]);

  // Sync video play/pause with transport status
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      // Check prefers-reduced-motion
      const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      if (!prefersReduced) {
        safePlayVideo(video);
      }
    } else {
      safePauseVideo(video);
    }
  }, [isPlaying]);

  // Window visibility & blur guard: auto-pause video when minimized/hidden
  useEffect(() => {
    const handleVisibility = () => {
      const video = videoRef.current;
      if (!video) return;

      if (document.visibilityState === 'hidden') {
        safePauseVideo(video);
      } else if (isPlaying) {
        const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (!prefersReduced) {
          safePlayVideo(video);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isPlaying]);

  if (!resolvedUrl) return null;

  const handleVideoReady = () => {
    setIsReady(true);
    onLoaded?.();
  };

  if (variant === 'backdrop') {
    return (
      <div className={`canvas-backdrop-container ${className}`} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <video
          ref={videoRef}
          muted
          playsInline
          loop
          preload="auto"
          onLoadedData={handleVideoReady}
          onError={() => setIsReady(false)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: isReady ? 1 : 0,
            transition: 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
            filter: 'blur(12px) brightness(0.7)',
            transform: 'scale(1.08) translateZ(0)',
            willChange: 'transform, opacity',
          }}
        />
        {/* Anti-slop cinematic vignette & dark scrim for text readability (WCAG >= 4.5:1) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, rgba(0, 0, 0, 0.45) 0%, rgba(5, 5, 8, 0.82) 80%, rgba(5, 5, 8, 0.95) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>
    );
  }

  return (
    <div className={`canvas-artwork-container ${className}`} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        muted
        playsInline
        loop
        preload="auto"
        onLoadedData={handleVideoReady}
        onError={() => setIsReady(false)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: isReady ? 1 : 0,
          transition: 'opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});
