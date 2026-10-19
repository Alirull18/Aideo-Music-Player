import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Sliders, Cpu, Activity } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { TheaterLayoutProps } from './types';
import { Visualizer } from '../Visualizer';
import { KaraokeActiveLine } from '../KaraokeActiveLine';
import { CanvasVideoPlayer } from '../CanvasVideoPlayer';
import { baseName, getStreamName } from '../../utils';

export function StudioDeckLayout({
  currentTrack,
  effectiveCover,
  playbackCurrentTrack,
  lyrics,
  lyricStatus,
  lyricsDisplayMode,
  activeIdx,
  playbackPositionSecs,
  playbackStatus,
  lyricOffset,
  showRomaji,
  showTranslation,
  accentColor,
  telemetryText,
  albumArtFit,
  vizMode,
  seek,
  scrollRef,
  canvas,
  canvasMode,
  spectrumBands = [],
  lowSpecMode = false,
}: TheaterLayoutProps) {
  const isPlaying = playbackStatus === 'Playing';
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const oscCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumRef = useRef<number[]>(spectrumBands);

  const title = currentTrack?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack || ''));
  const artist = currentTrack?.artist || (playbackCurrentTrack?.startsWith('http') ? 'Online Stream' : 'Unknown Artist');

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

  // Auto-scroll active lyric into view smoothly
  useEffect(() => {
    if (activeIdx < 0 || !scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIdx, scrollRef]);

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
      const bands = spectrumRef.current;

      let leftLevel = 0;
      let rightLevel = 0;

      if (isPlaying && bands && bands.length > 0) {
        const half = Math.floor(bands.length / 2);
        for (let i = 0; i < half; i++) {
          leftLevel += bands[i] || 0;
        }
        for (let i = half; i < bands.length; i++) {
          rightLevel += bands[i] || 0;
        }
        leftLevel = Math.min(1.2, leftLevel / (half * 0.45));
        rightLevel = Math.min(1.2, rightLevel / (half * 0.45));
      }

      const targetLeft = -45 + leftLevel * 75;
      const targetRight = -45 + rightLevel * 75;

      const p = physicsRef.current;
      const spring = 0.18;
      const damping = 0.72;

      p.leftVelocity = (p.leftVelocity + (targetLeft - p.leftAngle) * spring) * damping;
      p.leftAngle = Math.max(-48, Math.min(48, p.leftAngle + p.leftVelocity));

      p.rightVelocity = (p.rightVelocity + (targetRight - p.rightAngle) * spring) * damping;
      p.rightAngle = Math.max(-48, Math.min(48, p.rightAngle + p.rightVelocity));

      p.leftPeak = p.leftAngle > 20;
      p.rightPeak = p.rightAngle > 20;

      drawVUMeter(leftCanvasRef.current, p.leftAngle, p.leftPeak, 'CH 1 · LEFT');
      drawVUMeter(rightCanvasRef.current, p.rightAngle, p.rightPeak, 'CH 2 · RIGHT');
      if (!lowSpecMode) {
        drawOscilloscope(oscCanvasRef.current, bands, isPlaying, accentColor);
      }

      animId = requestAnimationFrame(renderMeters);
    };

    animId = requestAnimationFrame(renderMeters);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, accentColor, lowSpecMode]);

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

    ctx.fillStyle = '#141419';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    const pivotX = w / 2;
    const pivotY = h * 1.15;
    const radius = h * 0.95;

    ctx.save();
    ctx.translate(pivotX, pivotY);

    ctx.beginPath();
    ctx.arc(0, 0, radius, (-135 * Math.PI) / 180, (-45 * Math.PI) / 180);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, radius, (-68 * Math.PI) / 180, (-45 * Math.PI) / 180);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 4;
    ctx.stroke();

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

    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '700 11px sans-serif';
    ctx.fillText('VU', 0, -radius * 0.48);

    const needleRad = ((angleDeg - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(2, 2);
    ctx.lineTo(Math.cos(needleRad) * radius + 2, Math.sin(needleRad) * radius + 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(needleRad) * radius, Math.sin(needleRad) * radius);
    ctx.strokeStyle = angleDeg > 20 ? '#ef4444' : '#f59e0b';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#27272a';
    ctx.fill();
    ctx.strokeStyle = '#52525b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 14, 22);

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
    playing: boolean,
    color: string
  ) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0a0d';
    ctx.fillRect(0, 0, w, h);

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

    ctx.beginPath();
    const midY = h / 2;
    ctx.moveTo(0, midY);

    if (playing && bands && bands.length > 0) {
      const step = w / bands.length;
      for (let i = 0; i < bands.length; i++) {
        const val = (bands[i] || 0) * (h * 0.42);
        const waveY = i % 2 === 0 ? midY - val : midY + val;
        ctx.lineTo(i * step, waveY);
      }
    } else {
      ctx.lineTo(w, midY);
    }

    ctx.strokeStyle = color || '#10b981';
    ctx.lineWidth = 1.8;
    ctx.shadowColor = color || '#10b981';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  return (
    <motion.div
      key="studio"
      className="fullscreen-content-stage studio-deck-container liquid-theater-layout"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
      style={{
        display: 'grid',
        gridTemplateColumns: '44% 56%',
        gap: 48,
        height: '100%',
        width: '100%',
        maxWidth: 1440,
        margin: '0 auto',
        padding: '32px 32px 100px',
        alignItems: 'center',
        boxSizing: 'border-box',
      }}
    >
      {/* ── LEFT COLUMN: Liquid Glass Cover Art + Studio Telemetry Deck ── */}
      <div
        className="liquid-theater-left"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          width: '100%',
        }}
      >
        {/* Artwork + Metadata Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            width: '100%',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 170,
              height: 170,
              flexShrink: 0,
            }}
          >
            <div
              className="fullscreen-cover-glow-aura"
              style={{
                position: 'absolute',
                inset: -16,
                background: `radial-gradient(circle, ${accentColor || 'var(--dynamic-accent, #8b5cf6)'} 0%, rgba(var(--accent-rgb, 139, 92, 246), 0.3) 45%, transparent 70%)`,
                filter: 'blur(28px)',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />

            {vizMode === 'circle' && (
              <div style={{ position: 'absolute', width: 220, height: 220, zIndex: 1, pointerEvents: 'none' }}>
                <Visualizer mode="circle" />
              </div>
            )}

            <div
              className={`fullscreen-cover-art-wrap ${albumArtFit === 'contain' ? 'contain-mode' : ''}`}
              style={{
                width: 160,
                height: 160,
                borderRadius: 20,
                overflow: 'hidden',
                boxShadow: 'inset 0 1px 0.5px rgba(255, 255, 255, 0.25), 0 18px 42px -10px rgba(0, 0, 0, 0.75)',
                position: 'relative',
                zIndex: 2,
                margin: 0,
              }}
            >
              {albumArtFit === 'contain' && (
                <div
                  className="fullscreen-cover-ambient-bg"
                  style={{ backgroundImage: `url(${effectiveCover})` }}
                />
              )}
              <img
                src={effectiveCover}
                alt="Album Artwork"
                className={`fullscreen-cover-art ${albumArtFit === 'contain' ? 'contain-art' : ''}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {!lowSpecMode && canvas && (canvasMode === 'artwork' || canvasMode === 'both') && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 3, borderRadius: 'inherit', overflow: 'hidden' }}>
                  <CanvasVideoPlayer
                    canvas={canvas}
                    isPlaying={isPlaying}
                    variant="artwork"
                  />
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              style={{
                fontFamily: "'Bricolage Grotesque', var(--font-display, sans-serif)",
                fontSize: 'clamp(1.25rem, 1.9vw, 1.75rem)',
                fontWeight: 800,
                letterSpacing: '-0.025em',
                lineHeight: 1.2,
                color: '#ffffff',
                margin: '0 0 6px 0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={title}
            >
              {title}
            </h1>
            <p
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--text-dim, rgba(255, 255, 255, 0.7))',
                margin: '0 0 12px 0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={artist}
            >
              {artist} {currentTrack?.album ? `— ${currentTrack.album}` : ''}
            </p>

            {/* Telemetry / Signal-Path Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div
                style={{
                  fontFamily: "var(--ah-mono, 'JetBrains Mono', monospace)",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  color: 'var(--cyan-ink, #22d3ee)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Cpu size={13} style={{ color: accentColor }} />
                <span>{telemetryText || 'BIT-PERFECT DIRECT'}</span>
              </div>
              {currentTrack?.format && (
                <div style={{ background: 'rgba(255, 255, 255, 0.06)', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                  {currentTrack.format.toUpperCase()}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Studio Mastering Telemetry Rack */}
        <div
          className="studio-deck-rack v2-liquid-glass"
          style={{
            width: '100%',
            background: 'color-mix(in srgb, var(--art-surface-tint, #14161f) 38%, rgba(16, 18, 24, 0.78))',
            backdropFilter: 'blur(24px) saturate(150%)',
            borderRadius: 16,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sliders size={15} style={{ color: accentColor }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Audio meters
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                AUDIO VISUALIZER
              </span>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-dim)' }}>
                CH 1 · LEFT
              </span>
              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-dim)' }}>
                CH 2 · RIGHT
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.15fr', gap: 12, alignItems: 'center' }}>
            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <canvas ref={leftCanvasRef} width={240} height={145} style={{ width: '100%', height: 'auto', display: 'block' }} />
            </div>

            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <canvas ref={rightCanvasRef} width={240} height={145} style={{ width: '100%', height: 'auto', display: 'block' }} />
            </div>

            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <canvas ref={oscCanvasRef} width={280} height={145} style={{ width: '100%', height: 'auto', display: 'block' }} />
              <div style={{ position: 'absolute', top: 6, right: 8, display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text-dim)' }}>
                <Activity size={11} style={{ color: accentColor }} /> REALTIME SCOPE
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT COLUMN: Liquid Theater Synced Lyrics with Progressive Blur ── */}
      <div
        className="liquid-theater-right"
        style={{
          height: '100%',
          maxHeight: 'calc(100vh - 160px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          className="fullscreen-lyrics-fade-wrap"
          style={{ height: '100%', overflow: 'hidden', position: 'relative' }}
        >
          <div
            className="fullscreen-lyrics-scroll"
            ref={scrollRef}
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: '60px 20px 140px 10px',
              scrollbarWidth: 'none',
              scrollBehavior: 'smooth',
            }}
          >
            {lyrics.length === 0 ? (
              <div
                className="liquid-right-ambient-stage"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  gap: 22,
                  padding: '30px 10px',
                  width: '100%',
                  maxWidth: 580,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: 'rgba(255, 255, 255, 0.07)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: accentColor || '#22d3ee',
                    }}
                  >
                    <Activity size={20} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#ffffff' }}>
                      {lyricStatus === 'loading' ? 'Loading Synced Lyrics…' : 'Ambient Audio Spectrum'}
                    </h3>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim, rgba(255, 255, 255, 0.6))' }}>
                      {lyricStatus === 'loading' ? 'Resolving word timing data' : 'Instrumental Mode · Signal Path Telemetry Active'}
                    </p>
                  </div>
                </div>

                <div
                  style={{
                    width: '100%',
                    height: 160,
                    borderRadius: 18,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: 'inset 0 1px 0.5px rgba(255, 255, 255, 0.1)',
                    position: 'relative',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '12px 16px',
                  }}
                >
                  <Visualizer mode={(vizMode === 'circle' || vizMode === 'vectorscope') ? 'baseline' : (vizMode || 'wave')} />
                </div>
              </div>
            ) : (
              lyrics.map((l, i) => {
                const isActive = lyricsDisplayMode !== 'static' && i === activeIdx;
                return (
                  <div
                    key={i}
                    data-idx={i}
                    onClick={() => {
                      if (lyricsDisplayMode !== 'static') {
                        seek(l.time_secs - lyricOffset / 1000);
                      }
                    }}
                    style={{
                      cursor: lyricsDisplayMode !== 'static' ? 'pointer' : 'default',
                      padding: '12px 0',
                      textAlign: 'left',
                      fontFamily: "'Bricolage Grotesque', var(--font-display, sans-serif)",
                      fontSize: 'clamp(1.5rem, 2.4vw, 2.35rem)',
                      fontWeight: 700,
                      lineHeight: 1.3,
                      letterSpacing: '-0.02em',
                      color: isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.45)',
                      opacity: isActive ? 1 : 0.30,
                      filter: isActive ? 'blur(0px)' : 'blur(1.8px)',
                      transform: isActive ? 'scale(1.03) translateX(6px)' : 'scale(1) translateX(0)',
                      transition: 'all 0.35s cubic-bezier(0.2, 0, 0, 1)',
                      willChange: 'filter, opacity, transform',
                    }}
                  >
                    <div>
                      {lyricsDisplayMode === 'karaoke' && isActive && l.words && l.words.length > 0 ? (
                        <KaraokeActiveLine
                          words={l.words}
                          positionSecs={playbackPositionSecs}
                          lyricOffset={lyricOffset}
                          isPlaying={isPlaying}
                        />
                      ) : (
                        l.text || '♪'
                      )}
                    </div>
                    {showRomaji && l.romaji && l.romaji !== l.text && (
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: 'var(--text-dim, rgba(255, 255, 255, 0.6))',
                          marginTop: 4,
                          letterSpacing: 0,
                          filter: 'none',
                        }}
                      >
                        {l.romaji}
                      </div>
                    )}
                    {showTranslation && l.translation && (
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: 'var(--text-dim, rgba(255, 255, 255, 0.6))',
                          marginTop: 4,
                          letterSpacing: 0,
                          filter: 'none',
                        }}
                      >
                        {l.translation}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
