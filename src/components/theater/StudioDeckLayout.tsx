import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Sliders, Cpu, Activity } from 'lucide-react';
import { TheaterLayoutProps } from './types';
import { baseName, getStreamName } from '../../utils';

export function StudioDeckLayout({
  currentTrack,
  effectiveCover,
  playbackCurrentTrack,
  lyrics,
  activeIdx,
  playbackStatus,
  accentColor,
  telemetryText,
  spectrumBands = [],
  lowSpecMode = false,
}: TheaterLayoutProps) {
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const oscCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Ballistic needle state
  const physicsRef = useRef({
    leftAngle: -45,
    rightAngle: -45,
    leftVelocity: 0,
    rightVelocity: 0,
    leftPeak: false,
    rightPeak: false,
  });

  useEffect(() => {
    let animId: number;

    const renderMeters = () => {
      const isPlaying = playbackStatus === 'Playing';

      // Compute channel levels from spectrum bands
      let leftLevel = 0;
      let rightLevel = 0;

      if (isPlaying && spectrumBands && spectrumBands.length > 0) {
        // Lower half for left, upper half for right, with some bass sharing
        const half = Math.floor(spectrumBands.length / 2);
        for (let i = 0; i < half; i++) {
          leftLevel += spectrumBands[i] || 0;
        }
        for (let i = half; i < spectrumBands.length; i++) {
          rightLevel += spectrumBands[i] || 0;
        }
        leftLevel = Math.min(1.2, (leftLevel / (half * 0.45)));
        rightLevel = Math.min(1.2, (rightLevel / (half * 0.45)));
      }

      // Ballistic physics: target angle maps level (0..1.2) to -45deg .. +45deg
      const targetLeft = -45 + leftLevel * 75;
      const targetRight = -45 + rightLevel * 75;

      const p = physicsRef.current;
      // Spring acceleration and damping
      const spring = 0.18;
      const damping = 0.72;

      p.leftVelocity = (p.leftVelocity + (targetLeft - p.leftAngle) * spring) * damping;
      p.leftAngle = Math.max(-48, Math.min(48, p.leftAngle + p.leftVelocity));

      p.rightVelocity = (p.rightVelocity + (targetRight - p.rightAngle) * spring) * damping;
      p.rightAngle = Math.max(-48, Math.min(48, p.rightAngle + p.rightVelocity));

      p.leftPeak = p.leftAngle > 20;
      p.rightPeak = p.rightAngle > 20;

      // Draw Left Meter
      drawVUMeter(leftCanvasRef.current, p.leftAngle, p.leftPeak, 'CH 1 · LEFT');
      // Draw Right Meter
      drawVUMeter(rightCanvasRef.current, p.rightAngle, p.rightPeak, 'CH 2 · RIGHT');
      // Draw Oscilloscope (skip in low spec mode)
      if (!lowSpecMode) {
        drawOscilloscope(oscCanvasRef.current, spectrumBands, isPlaying, accentColor);
      }

      animId = requestAnimationFrame(renderMeters);
    };

    animId = requestAnimationFrame(renderMeters);
    return () => cancelAnimationFrame(animId);
  }, [playbackStatus, spectrumBands, accentColor]);

  const drawVUMeter = (
    canvas: HTMLCanvasElement | null,
    angleDeg: number,
    isPeak: boolean,
    label: string
  ) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Warm vintage parchment / brushed titanium dial background
    ctx.fillStyle = '#141419';
    ctx.fillRect(0, 0, w, h);

    // Subtle inner bevel
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    const pivotX = w / 2;
    const pivotY = h * 1.15;
    const radius = h * 0.95;

    // Draw VU scale arc
    ctx.save();
    ctx.translate(pivotX, pivotY);

    // Main arc background
    ctx.beginPath();
    ctx.arc(0, 0, radius, (-135 * Math.PI) / 180, (-45 * Math.PI) / 180);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Redline arc zone (> 0dB is from -65deg to -45deg)
    ctx.beginPath();
    ctx.arc(0, 0, radius, (-68 * Math.PI) / 180, (-45 * Math.PI) / 180);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Draw Ticks & Numbers (-20, -10, -7, -5, -3, -1, 0, +1, +2, +3)
    const ticks = [
      { deg: -135, val: '-20' },
      { deg: -115, val: '-10' },
      { deg: -100, val: '-7' },
      { deg: -88, val: '-5' },
      { deg: -78, val: '-3' },
      { deg: -68, val: '0', isRed: true },
      { deg: -56, val: '+1', isRed: true },
      { deg: -46, val: '+3', isRed: true },
    ];

    ctx.font = '600 10px sans-serif';
    ctx.textAlign = 'center';

    ticks.forEach(t => {
      const rad = (t.deg * Math.PI) / 180;
      const x1 = Math.cos(rad) * radius;
      const y1 = Math.sin(rad) * radius;
      const x2 = Math.cos(rad) * (radius - 8);
      const y2 = Math.sin(rad) * (radius - 8);
      const xText = Math.cos(rad) * (radius - 20);
      const yText = Math.sin(rad) * (radius - 20);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = t.isRed ? '#ef4444' : 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = t.isRed ? 2 : 1.2;
      ctx.stroke();

      ctx.fillStyle = t.isRed ? '#ef4444' : 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(t.val, xText, yText);
    });

    // VU Label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '700 11px sans-serif';
    ctx.fillText('VU', 0, -radius * 0.48);

    // Needle shadow
    const needleRad = ((angleDeg - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(2, 2);
    ctx.lineTo(Math.cos(needleRad) * radius + 2, Math.sin(needleRad) * radius + 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Ballistic needle
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(needleRad) * radius, Math.sin(needleRad) * radius);
    ctx.strokeStyle = angleDeg > 20 ? '#ef4444' : '#f59e0b';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Pivot cap
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#27272a';
    ctx.fill();
    ctx.strokeStyle = '#52525b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();

    // Channel label & Peak LED
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 14, 22);

    // Peak LED dot
    ctx.beginPath();
    ctx.arc(w - 20, 18, 5, 0, Math.PI * 2);
    ctx.fillStyle = isPeak ? '#ef4444' : '#3f3f46';
    ctx.fill();
    if (isPeak) {
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  };

  const drawOscilloscope = (
    canvas: HTMLCanvasElement | null,
    bands: number[],
    isPlaying: boolean,
    color: string
  ) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0a0d';
    ctx.fillRect(0, 0, w, h);

    // CRT grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 20; x < w; x += 25) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 15; y < h; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Phosphor vector trace
    ctx.beginPath();
    const midY = h / 2;
    ctx.moveTo(0, midY);

    if (isPlaying && bands && bands.length > 0) {
      const step = w / bands.length;
      for (let i = 0; i < bands.length; i++) {
        const val = (bands[i] || 0) * (h * 0.42);
        const waveY = i % 2 === 0 ? midY - val : midY + val;
        ctx.lineTo(i * step, waveY);
      }
    } else {
      // Flat idle line with slight noise
      ctx.lineTo(w, midY);
    }

    ctx.strokeStyle = color || '#10b981';
    ctx.lineWidth = 1.8;
    ctx.shadowColor = color || '#10b981';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const currentLyric = lyrics[activeIdx]?.text || '♪';
  const nextLyric = lyrics[activeIdx + 1]?.text || '';

  return (
    <motion.div
      key="studio"
      className="fullscreen-content-stage studio-deck-container"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: '60px 8%',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      {/* Studio Mastering Rack */}
      <div
        className="studio-deck-rack"
        style={{
          width: '100%',
          background: 'linear-gradient(180deg, #18181f 0%, #101015 100%)',
          borderRadius: 14,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Rack Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sliders size={18} style={{ color: accentColor }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-dim)' }}>
              AIDEO MASTERING CONSOLE · MODEL-100
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              BALLISTIC CALIBRATED
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-dim)' }}>
              CH 1 · LEFT
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-dim)' }}>
              CH 2 · RIGHT
            </span>
          </div>
        </div>

        {/* Center Gauges Section: Dual VU Meters + Oscilloscope */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 16, alignItems: 'center' }}>
          {/* Left VU Meter */}
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <canvas ref={leftCanvasRef} width={280} height={170} style={{ width: '100%', height: 'auto', display: 'block' }} />
          </div>

          {/* Right VU Meter */}
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <canvas ref={rightCanvasRef} width={280} height={170} style={{ width: '100%', height: 'auto', display: 'block' }} />
          </div>

          {/* Vector Scope Display */}
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <canvas ref={oscCanvasRef} width={340} height={170} style={{ width: '100%', height: 'auto', display: 'block' }} />
            <div style={{ position: 'absolute', top: 8, right: 10, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-dim)' }}>
              <Activity size={12} style={{ color: accentColor }} /> REALTIME SCOPE
            </div>
          </div>
        </div>

        {/* Signal Path & Metadata Telemetry Strip */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(0, 0, 0, 0.4)',
            padding: '14px 20px',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.05)',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          {/* Track Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img
              src={effectiveCover}
              alt="Track Cover"
              style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(255, 255, 255, 0.1)' }}
            />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 2 }}>
                {currentTrack?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack || ''))}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                {currentTrack?.artist || 'Unknown Artist'} {currentTrack?.album ? `— ${currentTrack.album}` : ''}
              </div>
            </div>
          </div>

          {/* Hardware Telemetry Indicators */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255, 255, 255, 0.04)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
              <Cpu size={13} style={{ color: accentColor }} />
              <span>{telemetryText}</span>
            </div>
            {currentTrack?.format && (
              <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                {currentTrack.format.toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Compact Lyrics Ticker */}
        <div
          style={{
            textAlign: 'center',
            padding: '12px 24px',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.04)',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', letterSpacing: '-0.2px', marginBottom: 4 }}>
            {currentLyric}
          </div>
          {nextLyric && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', opacity: 0.6 }}>
              {nextLyric}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
