import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { TheaterLayoutProps } from './types';
import { KaraokeActiveLine } from '../KaraokeActiveLine';
import { baseName, getStreamName } from '../../utils';

export function PureScopeLayout({
  currentTrack,
  playbackCurrentTrack,
  lyrics,
  activeIdx,
  playbackPositionSecs,
  playbackStatus,
  lyricOffset,
  accentColor,
  telemetryText,
  spectrumBands = [],
  lyricsDisplayMode,
}: TheaterLayoutProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Particle nodes for audio vector simulation
    const particles = Array.from({ length: 60 }, (_, i) => ({
      x: (width / 60) * i,
      y: height / 2,
      baseY: height / 2,
      vy: 0,
      radius: 2 + (i % 3),
    }));

    let phase = 0;

    const render = () => {
      ctx.fillStyle = 'rgba(5, 5, 8, 0.25)';
      ctx.fillRect(0, 0, width, height);

      const isPlaying = playbackStatus === 'Playing';
      phase += 0.03;

      // Draw flowing audio vector mesh
      ctx.beginPath();
      const centerY = height / 2;
      const bands = spectrumBands || [];

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const bandVal = (bands[i % bands.length] || 0) * (isPlaying ? 1 : 0.05);
        const targetY = centerY + Math.sin(phase + i * 0.2) * (bandVal * 180 + 20);

        p.y += (targetY - p.y) * 0.15;

        if (i === 0) {
          ctx.moveTo(p.x, p.y);
        } else {
          const prev = particles[i - 1];
          const cx = (prev.x + p.x) / 2;
          const cy = (prev.y + p.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, cx, cy);
        }
      }

      ctx.strokeStyle = accentColor || '#8b5cf6';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = accentColor || '#8b5cf6';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw secondary mirror echo line
      ctx.beginPath();
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const mirrorY = centerY - (p.y - centerY) * 0.6;
        if (i === 0) {
          ctx.moveTo(p.x, mirrorY);
        } else {
          const prev = particles[i - 1];
          const prevMirrorY = centerY - (prev.y - centerY) * 0.6;
          const cx = (prev.x + p.x) / 2;
          const cy = (prevMirrorY + mirrorY) / 2;
          ctx.quadraticCurveTo(prev.x, prevMirrorY, cx, cy);
        }
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
    };
  }, [playbackStatus, spectrumBands, accentColor]);

  const currentLyric = lyrics[activeIdx];

  return (
    <motion.div
      key="scope"
      className="fullscreen-content-zen pure-scope-container"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Full-Bleed 60fps Vector Scope Canvas */}
      <canvas
        ref={canvasRef}
        data-testid="pure-scope-canvas"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
        }}
      />

      {/* Floating Ethereal Typography Overlay */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          textAlign: 'center',
          maxWidth: 900,
          padding: '0 32px',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '1.5px',
            color: 'var(--text-dim)',
            marginBottom: 16,
            background: 'rgba(0, 0, 0, 0.5)',
            padding: '4px 14px',
            borderRadius: 20,
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <Activity size={13} style={{ color: accentColor }} />
          <span>{telemetryText || 'PURE VECTOR SCOPE'}</span>
        </div>

        <h1
          style={{
            fontSize: 'clamp(2.5rem, 5vw, 4.5rem)',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: '#fff',
            marginBottom: 8,
            textWrap: 'balance',
            textShadow: '0 10px 30px rgba(0, 0, 0, 0.8)',
          }}
        >
          {currentTrack?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack || ''))}
        </h1>

        <p
          style={{
            fontSize: '1.3rem',
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.7)',
            marginBottom: 36,
            textShadow: '0 4px 12px rgba(0, 0, 0, 0.8)',
          }}
        >
          {currentTrack?.artist || 'Unknown Artist'}
        </p>

        {/* Current Karaoke/Synced Line */}
        {currentLyric && (
          <div
            style={{
              fontSize: '1.6rem',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '-0.2px',
              textShadow: '0 4px 16px rgba(0, 0, 0, 0.9)',
              minHeight: 48,
            }}
          >
            {lyricsDisplayMode === 'karaoke' && currentLyric.words && currentLyric.words.length > 0 ? (
              <KaraokeActiveLine
                words={currentLyric.words}
                positionSecs={playbackPositionSecs}
                lyricOffset={lyricOffset}
                isPlaying={playbackStatus === 'Playing'}
              />
            ) : (
              currentLyric.text || '♪'
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
