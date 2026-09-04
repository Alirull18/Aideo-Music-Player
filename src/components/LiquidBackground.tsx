import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../store';
import { hexToHsl, extractTopColors } from '../utils/colorExtractor';

export function LiquidBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentColor = useStore(s => s.accentColor);
  const currentTrack = useStore(s => s.currentTrack);
  const coverArt = useStore(s => s.coverArt);
  const playbackStatus = useStore(s => s.playback.status);
  const lowSpecMode = useStore(s => s.lowSpecMode);
  const liquidBackgroundEnabled = useStore(s => s.liquidBackgroundEnabled);
  const spectrumRef = useRef<number[]>(new Array(64).fill(0));

  const effectiveCover = coverArt || currentTrack?.cover_url || null;
  const [paletteColors, setPaletteColors] = useState<string[]>([]);

  const smoothedBass = useRef(0);
  const smoothedMids = useRef(0);
  const smoothedTreble = useRef(0);
  const timeRef = useRef(0);

  // Extract top 3 dominant colors whenever track cover changes
  useEffect(() => {
    let cancelled = false;
    extractTopColors(effectiveCover, 3).then(colors => {
      if (!cancelled && colors && colors.length > 0) {
        setPaletteColors(colors);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [effectiveCover]);

  useEffect(() => {
    const unlisten = listen<number[]>('audio-spectrum', (event) => {
      spectrumRef.current = event.payload;
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || lowSpecMode || !liquidBackgroundEnabled) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Small internal resolution stretched via CSS gives gorgeous blending and ultra-low CPU overhead
    canvas.width = 280;
    canvas.height = 280;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Deep premium base dark backdrop
      ctx.fillStyle = 'rgba(7, 7, 11, 0.12)';
      ctx.fillRect(0, 0, w, h);

      if (playbackStatus !== 'Playing' || document.visibilityState === 'hidden') {
        return;
      }

      // Determine top 3 dominant mesh colors
      const hsl = hexToHsl(accentColor);
      const fallbackCol1 = `hsl(${hsl.h}, ${Math.max(hsl.s, 60)}%, 32%)`;
      const fallbackCol2 = `hsl(${(hsl.h + 50) % 360}, ${Math.max(hsl.s, 55)}%, 28%)`;
      const fallbackCol3 = `hsl(${(hsl.h + 290) % 360}, ${Math.max(hsl.s, 55)}%, 26%)`;

      const c1 = paletteColors[0] || fallbackCol1;
      const c2 = paletteColors[1] || fallbackCol2;
      const c3 = paletteColors[2] || fallbackCol3;

      // Calculate audio energy from specific frequency bands
      const bands = spectrumRef.current;
      let bassEnergy = 0;
      let midEnergy = 0;
      let trebleEnergy = 0;

      if (bands && bands.length > 0) {
        // Bass (0-6)
        let bassSum = 0;
        for (let i = 0; i < 7; i++) bassSum += bands[i] || 0;
        bassEnergy = bassSum / 7;

        // Mids (7-20)
        let midSum = 0;
        for (let i = 7; i < 21; i++) midSum += bands[i] || 0;
        midEnergy = midSum / 14;

        // Treble (21-45)
        let trebleSum = 0;
        for (let i = 21; i < 46; i++) trebleSum += bands[i] || 0;
        trebleEnergy = trebleSum / 25;
      }

      // Smooth the energy values
      smoothedBass.current += (bassEnergy - smoothedBass.current) * 0.15;
      smoothedMids.current += (midEnergy - smoothedMids.current) * 0.15;
      smoothedTreble.current += (trebleEnergy - smoothedTreble.current) * 0.15;

      // Time variables updated dynamically by audio energy for natural breathing
      timeRef.current += 0.003 + smoothedBass.current * 0.007;
      const t = timeRef.current;

      // ── Organic Flowing Multi-Stop Mesh Aura Nodes ──
      // Node 1: Dominant Primary Hue (Anchors Bass & Core Pulsing, Center-Left)
      {
        const cx = w * 0.38 + Math.cos(t * 1.1) * (w * 0.18) + Math.sin(t * 0.4) * 10;
        const cy = h * 0.42 + Math.sin(t * 1.3) * (h * 0.16);
        const rad = 85 * (1.0 + smoothedBass.current * 0.85);
        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
        grad.addColorStop(0, c1);
        grad.addColorStop(0.65, c1);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node 2: Dominant Secondary Hue (Mid Vocal Energy, Sweeping Right Arc)
      {
        const cx = w * 0.65 + Math.cos(t * 0.85 + 1.6) * (w * 0.22);
        const cy = h * 0.52 + Math.sin(t * 1.5 + 0.8) * (h * 0.18);
        const rad = 100 * (1.0 + smoothedMids.current * 0.65);
        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
        grad.addColorStop(0, c2);
        grad.addColorStop(0.7, c2);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node 3: Dominant Tertiary Hue (Treble Shimmer, Orbital Lissajous Path)
      {
        const cx = w * 0.5 + Math.sin(t * 1.25 + 3.14) * (w * 0.24);
        const cy = h * 0.68 + Math.cos(t * 0.95) * (h * 0.15);
        const rad = 90 * (1.0 + smoothedTreble.current * 0.55);
        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
        grad.addColorStop(0, c3);
        grad.addColorStop(0.65, c3);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node 4: Obsidian Core Anchor (Keeps background deep, cinematic & perfectly readable)
      {
        const cx = w * 0.5 + Math.sin(t * 0.5) * (w * 0.1);
        const cy = h * 0.5 + Math.cos(t * 0.6) * (h * 0.1);
        const rad = 75;
        const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
        grad.addColorStop(0, 'rgba(6, 6, 10, 0.7)');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let animId: number | null = null;
    let isRunning = true;

    const loop = () => {
      if (!isRunning) return;
      if (document.visibilityState === 'visible') {
        render();
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isRunning && animId === null) {
        animId = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isRunning = false;
      if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [accentColor, paletteColors, playbackStatus, lowSpecMode, liquidBackgroundEnabled]);

  if (lowSpecMode || !liquidBackgroundEnabled) return null;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: -1,
      overflow: 'hidden',
      pointerEvents: 'none',
      background: 'radial-gradient(ellipse at 50% 50%, #0d0d15 0%, #060609 100%)'
    }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          opacity: 0.5,
          filter: 'blur(58px) saturate(1.85)',
          transform: 'scale(1.22)', // prevent edge clipping
          display: 'block'
        }}
      />
    </div>
  );
}
