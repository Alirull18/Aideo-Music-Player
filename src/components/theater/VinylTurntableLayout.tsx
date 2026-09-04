import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Disc3, Disc, Music } from 'lucide-react';
import { TheaterLayoutProps } from './types';
import { baseName, getStreamName } from '../../utils';

export function VinylTurntableLayout({
  currentTrack,
  effectiveCover,
  playbackCurrentTrack,
  lyrics,
  activeIdx,
  playbackPositionSecs,
  playbackStatus,
  accentColor,
  telemetryText,
}: TheaterLayoutProps) {
  const isPlaying = playbackStatus === 'Playing';
  const duration = currentTrack?.duration || 180;
  const progressRatio = Math.max(0, Math.min(1, playbackPositionSecs / duration));

  // Tonearm angle: 0deg when stopped/parked on rest clip.
  // When playing: 21deg (outer lead-in groove) to 43deg (inner run-out groove).
  const tonearmAngle = useMemo(() => {
    if (playbackStatus === 'Stopped') return 0;
    return 21 + progressRatio * 22;
  }, [playbackStatus, progressRatio]);

  const currentLyric = lyrics[activeIdx]?.text || '♪';
  const nextLyric = lyrics[activeIdx + 1]?.text || '';

  return (
    <motion.div
      key="vinyl"
      className="fullscreen-content-stage vinyl-layout-container"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: '40px 6%',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      {/* Turntable Plinth Deck */}
      <div
        className="vinyl-turntable-deck"
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 420px) 1fr',
          gap: 48,
          alignItems: 'center',
          background: 'linear-gradient(145deg, #18181f 0%, #121217 100%)',
          borderRadius: 20,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
          padding: '40px 48px',
        }}
      >
        {/* Left: Leaning Album Jacket */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            perspective: 1000,
          }}
        >
          <div
            style={{
              position: 'relative',
              width: 340,
              height: 340,
              borderRadius: 14,
              overflow: 'hidden',
              transform: 'rotateY(-12deg) rotateX(4deg) scale(0.95)',
              boxShadow: '-15px 25px 50px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)',
              background: '#111',
              transition: 'transform 0.5s ease',
            }}
          >
            {/* Cardboard edge sheen */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, transparent 40%, rgba(0, 0, 0, 0.4) 100%)',
                zIndex: 2,
                pointerEvents: 'none',
              }}
            />
            <img
              src={effectiveCover}
              alt="Vinyl Sleeve"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>

          {/* Sleeve Metadata */}
          <div style={{ marginTop: 24, textAlign: 'center', maxWidth: 320 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px', marginBottom: 6 }}>
              {currentTrack?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack || ''))}
            </h2>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-dim)', marginBottom: 12 }}>
              {currentTrack?.artist || 'Unknown Artist'} {currentTrack?.album ? `— ${currentTrack.album}` : ''}
            </p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255, 255, 255, 0.05)', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, color: accentColor }}>
              <Disc size={13} />
              <span>{telemetryText || '33⅓ RPM VINYL CUT'}</span>
            </div>
          </div>
        </div>

        {/* Right: Realistic Turntable Platter with Tonearm */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 460,
          }}
        >
          {/* Turntable Circular Well */}
          <div
            style={{
              position: 'relative',
              width: 440,
              height: 440,
              borderRadius: '50%',
              background: 'radial-gradient(circle, #09090d 0%, #15151b 70%, #20202a 100%)',
              boxShadow: 'inset 0 10px 30px rgba(0, 0, 0, 0.9), 0 0 0 2px rgba(255, 255, 255, 0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Spinning 12-Inch Vinyl Record */}
            <div
              data-testid="vinyl-record"
              className={`vinyl-disc ${isPlaying ? 'spinning' : 'paused'}`}
              style={{
                position: 'relative',
                width: 410,
                height: 410,
                borderRadius: '50%',
                background: `radial-gradient(circle, 
                  #111116 0%, 
                  #1c1c24 15%, 
                  #0c0c10 20%, 
                  #181820 40%, 
                  #0a0a0e 55%, 
                  #1a1a22 75%, 
                  #0f0f14 85%, 
                  #15151c 100%
                )`,
                boxShadow: '0 15px 40px rgba(0, 0, 0, 0.85), inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'vinyl-spin 1.8s linear infinite',
                animationPlayState: isPlaying ? 'running' : 'paused',
              }}
            >
              {/* Concentric Micro-Grooves Anisotropic Sheen Overlay */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  background: 'conic-gradient(from 0deg at 50% 50%, rgba(255, 255, 255, 0.06) 0deg, transparent 60deg, rgba(255, 255, 255, 0.08) 120deg, transparent 180deg, rgba(255, 255, 255, 0.06) 240deg, transparent 300deg, rgba(255, 255, 255, 0.08) 360deg)',
                  pointerEvents: 'none',
                }}
              />

              {/* Vinyl Center Label */}
              <div
                style={{
                  position: 'relative',
                  width: 140,
                  height: 140,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  border: '2px solid rgba(255, 255, 255, 0.15)',
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#222',
                }}
              >
                <img
                  src={effectiveCover}
                  alt="Label Art"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                {/* Center Spindle Hole */}
                <div
                  style={{
                    position: 'absolute',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, #e4e4e7 0%, #71717a 60%, #18181b 100%)',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.8), inset 0 1px 2px rgba(255, 255, 255, 0.5)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Mechanical Tonearm Assembly */}
          <div
            data-testid="vinyl-tonearm"
            style={{
              position: 'absolute',
              top: 10,
              right: 20,
              width: 120,
              height: 380,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            {/* Pivot Base Tower */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                right: 30,
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: 'radial-gradient(circle, #3f3f46 0%, #18181b 80%)',
                border: '2px solid #52525b',
                boxShadow: '0 6px 14px rgba(0, 0, 0, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Counterweight */}
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #a1a1aa 0%, #52525b 100%)',
                  boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.5)',
                }}
              />
            </div>

            {/* Rotating Arm Beam */}
            <div
              style={{
                position: 'absolute',
                top: 30,
                right: 58,
                width: 6,
                height: 300,
                transformOrigin: 'top center',
                transform: `rotate(-${tonearmAngle}deg)`,
                transition: 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)',
              }}
            >
              {/* Metallic S-Arm */}
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  background: 'linear-gradient(to right, #d4d4d8 0%, #71717a 50%, #52525b 100%)',
                  borderRadius: 3,
                  boxShadow: '2px 4px 8px rgba(0, 0, 0, 0.6)',
                }}
              />

              {/* Headshell & Stylus Cartridge */}
              <div
                style={{
                  position: 'absolute',
                  bottom: -10,
                  left: -10,
                  width: 26,
                  height: 36,
                  background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
                  borderRadius: '4px 4px 10px 10px',
                  border: '1px solid #52525b',
                  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* Needle Point Indicator */}
                <div
                  style={{
                    width: 3,
                    height: 8,
                    background: '#ef4444',
                    borderRadius: 1,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Synchronized Vinyl Lyric Ticker */}
      <div
        style={{
          width: '100%',
          textAlign: 'center',
          padding: '14px 28px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        <div style={{ fontSize: 19, fontWeight: 700, color: '#fff', letterSpacing: '-0.2px', marginBottom: 4 }}>
          {currentLyric}
        </div>
        {nextLyric && (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', opacity: 0.65 }}>
            {nextLyric}
          </div>
        )}
      </div>
    </motion.div>
  );
}
