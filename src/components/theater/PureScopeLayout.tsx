import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
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
  accentColor = '#8b5cf6',
  telemetryText,
  spectrumBands = [],
  lyricsDisplayMode,
  lowSpecMode = false,
}: TheaterLayoutProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumRef = useRef<number[]>(spectrumBands || new Array(64).fill(0));

  // Sync prop bands to ref (for testing or initial seed)
  useEffect(() => {
    if (spectrumBands && spectrumBands.length > 0) {
      spectrumRef.current = spectrumBands;
    }
  }, [spectrumBands]);

  // Direct live subscription to audio-spectrum without triggering React re-renders
  useEffect(() => {
    let active = true;
    const unlistenPromise = listen<number[]>('audio-spectrum', (event) => {
      if (active && event.payload && event.payload.length > 0) {
        spectrumRef.current = event.payload;
      }
    });

    return () => {
      active = false;
      unlistenPromise.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // 60fps/120fps High-DPI Vector Scope Canvas Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext ? canvas.getContext('2d') : null;
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    let animId: number;
    let phase = 0;
    let smoothedCorrelation = 0.85;
    const smoothedBands = new Array(64).fill(0);

    const updateDimensions = () => {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isPlaying = playbackStatus === 'Playing';

      ctx.save();
      ctx.scale(dpr, dpr);

      // 1. Phosphor Persistence Decay Trail (Edge-to-edge pure pitch black background)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(0, 0, width, height);

      // 2. Audio Spectrum Smoothing & Multi-Band Energy Extraction
      const rawBands = spectrumRef.current || [];
      let bassSum = 0;
      let midSum = 0;
      let highSum = 0;

      for (let i = 0; i < 64; i++) {
        const target = isPlaying ? (rawBands[i] || 0) : 0;
        if (target > smoothedBands[i]) {
          smoothedBands[i] += (target - smoothedBands[i]) * 0.35;
        } else {
          smoothedBands[i] += (target - smoothedBands[i]) * 0.12;
        }

        if (i < 8) bassSum += smoothedBands[i];
        else if (i < 24) midSum += smoothedBands[i];
        else highSum += smoothedBands[i];
      }

      const bassEnergy = bassSum / 8;
      const midEnergy = midSum / 16;
      const highEnergy = highSum / 40;

      // Phase correlation estimation (-1 = out of phase, +1 = mono)
      const instantCorrelation = Math.max(-1, Math.min(1, 1.0 - (midEnergy * 0.75 + highEnergy * 0.55)));
      smoothedCorrelation += (instantCorrelation - smoothedCorrelation) * 0.08;

      phase += isPlaying ? 0.045 : 0.015;

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.35;

      // 3. Laboratory Scope Reticle / Graticule
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 1;

      // Concentric Range Rings (100%, 66%, 33%)
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.arc(cx, cy, radius * 0.66, 0, Math.PI * 2);
      ctx.arc(cx, cy, radius * 0.33, 0, Math.PI * 2);
      ctx.stroke();

      // M/S & Diagonal 45-deg Crosshair Axes
      ctx.beginPath();
      // M-Axis (Mid / Mono Center: 90 deg)
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      // S-Axis (Side / Stereo Width: 0 deg)
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      // L Channel 45 deg
      ctx.moveTo(cx - radius * 0.707, cy + radius * 0.707);
      ctx.lineTo(cx + radius * 0.707, cy - radius * 0.707);
      // R Channel 135 deg
      ctx.moveTo(cx - radius * 0.707, cy - radius * 0.707);
      ctx.lineTo(cx + radius * 0.707, cy + radius * 0.707);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.stroke();

      // Axis Precision Ticks
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+M', cx, cy - radius - 10);
      ctx.fillText('+S', cx + radius + 14, cy);
      ctx.fillText('-S', cx - radius - 14, cy);
      ctx.fillText('L', cx - radius * 0.707 - 10, cy - radius * 0.707 - 10);
      ctx.fillText('R', cx + radius * 0.707 + 10, cy - radius * 0.707 - 10);

      // 4. Dual-Trace Lissajous Vector Scope Beam
      const numPoints = lowSpecMode ? 120 : 220;
      const stereoSpread = Math.max(0.1, (1.0 - smoothedCorrelation * 0.65)) * (radius * 0.88);
      const amplitude = Math.max(0.04, bassEnergy * 0.95 + midEnergy * 0.7) * (radius * 0.95);

      ctx.beginPath();
      for (let i = 0; i <= numPoints; i++) {
        const t = (i / numPoints) * Math.PI * 4;

        // X: Stereo difference component (Side signal)
        const xSide = (Math.sin(t * 2 + phase * 1.35) * (midEnergy * 0.65) +
                       Math.sin(t * 4 + phase * 2.05) * (highEnergy * 0.45) +
                       Math.sin(t * 6 + phase * 0.75) * 0.04) * stereoSpread;

        // Y: Mono sum component (Mid signal)
        const yMid = -(Math.cos(t + phase) * (bassEnergy * 0.85) +
                       Math.cos(t * 3 + phase * 1.75) * (midEnergy * 0.5) +
                       Math.sin(t * 5 + phase * 1.1) * 0.04) * amplitude;

        const px = cx + xSide;
        const py = cy + yMid;

        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }

      // Outer Phosphor Glow
      if (!lowSpecMode) {
        ctx.shadowBlur = 18;
        ctx.shadowColor = accentColor || '#8b5cf6';
      }

      const lissajousGrad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
      lissajousGrad.addColorStop(0, '#38bdf8'); // Electric Cyan
      lissajousGrad.addColorStop(0.5, accentColor || '#8b5cf6');
      lissajousGrad.addColorStop(1, '#ffffff'); // Phosphor White Peak
      ctx.strokeStyle = lissajousGrad;
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // Sharp Core Electron Trace
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 5. Flowing Horizon Harmonic Ribbon (Lower Full-Width Wave)
      ctx.beginPath();
      const waveY = height * 0.78;
      const waveAmp = (bassEnergy * 0.5 + midEnergy * 0.3) * 36;
      for (let x = 0; x <= width; x += 8) {
        const normX = x / width;
        const bandIdx = Math.floor(normX * 63);
        const bandVal = smoothedBands[bandIdx] || 0;
        const harmonic = Math.sin(normX * Math.PI * 6 + phase * 1.5) * (bandVal * 26 + waveAmp * 0.35);
        const y = waveY + harmonic;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 6. Real-time Telemetry Overlay (Bottom Reticle Meter)
      const meterW = Math.min(220, width * 0.4);
      const meterH = 4;
      const meterX = cx - meterW / 2;
      const meterY = cy + radius + 22;

      if (meterY + meterH + 16 < height) {
        // Meter Track
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.roundRect(meterX, meterY, meterW, meterH, 2);
        ctx.fill();

        // Zero center line
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.fillRect(cx - 0.5, meterY - 2, 1, meterH + 4);

        // Needle
        const needleX = cx + (smoothedCorrelation * (meterW / 2));
        ctx.fillStyle = smoothedCorrelation > 0.25 ? '#22c55e' : smoothedCorrelation > -0.2 ? '#f59e0b' : '#ef4444';
        ctx.beginPath();
        ctx.roundRect(needleX - 2, meterY - 1, 4, meterH + 2, 2);
        ctx.fill();

        // Telemetry Label
        ctx.font = '9px monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.textAlign = 'center';
        ctx.fillText(`PHASE: ${smoothedCorrelation >= 0 ? '+' : ''}${smoothedCorrelation.toFixed(2)}  ·  64 BANDS ACTIVE`, cx, meterY + meterH + 12);
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      window.removeEventListener('resize', updateDimensions);
      cancelAnimationFrame(animId);
    };
  }, [playbackStatus, accentColor, lowSpecMode]);

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
        backgroundColor: '#000000',
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '48px 32px 110px',
        boxSizing: 'border-box',
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
          pointerEvents: 'none',
        }}
      />

      {/* Top Floating Zone: Telemetry & Track Metadata */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          textAlign: 'center',
          maxWidth: 900,
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
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
            marginBottom: 12,
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(12px)',
            padding: '4px 14px',
            borderRadius: 20,
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <Activity size={13} style={{ color: accentColor || '#8b5cf6' }} />
          <span>{telemetryText || 'PURE VECTOR SCOPE · LAB RETICLE'}</span>
        </div>

        <h1
          style={{
            fontSize: 'clamp(2rem, 3.8vw, 3.2rem)',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: '#fff',
            marginBottom: 6,
            textWrap: 'balance',
            textShadow: '0 8px 24px rgba(0, 0, 0, 0.9)',
          }}
        >
          {currentTrack?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack || ''))}
        </h1>

        <p
          style={{
            fontSize: '1.15rem',
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.7)',
            margin: 0,
            textShadow: '0 4px 12px rgba(0, 0, 0, 0.85)',
          }}
        >
          {currentTrack?.artist || 'Unknown Artist'}
        </p>
      </div>

      {/* Bottom Floating Zone: Current Karaoke / Synced Lyric */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          textAlign: 'center',
          maxWidth: 850,
          width: '100%',
          minHeight: 48,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {currentLyric ? (
          <div
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '-0.2px',
              textShadow: '0 4px 16px rgba(0, 0, 0, 0.95)',
              padding: '8px 24px',
              borderRadius: 16,
              background: 'rgba(5, 7, 12, 0.45)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
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
        ) : (
          <div style={{ height: 48 }} />
        )}
      </div>
    </motion.div>
  );
}
