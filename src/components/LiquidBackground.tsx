import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../store';

function hexToHsl(hex: string) {
  let r = 139, g = 92, b = 246;
  if (hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g);
    if (m && m.length >= 3) {
      r = parseInt(m[0]); g = parseInt(m[1]); b = parseInt(m[2]);
    }
  } else if (hex.startsWith('#')) {
    const clean = hex.replace('#', '');
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
  }

  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}


export function LiquidBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { accentColor, playback, lowSpecMode, liquidBackgroundEnabled } = useStore();
  const spectrumRef = useRef<number[]>(new Array(64).fill(0));

  const smoothedBass = useRef(0);
  const smoothedMids = useRef(0);
  const smoothedTreble = useRef(0);
  const timeRef = useRef(0);

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

    // Small internal resolution stretched via CSS gives gorgeous blending and 0% CPU overhead
    canvas.width = 250;
    canvas.height = 250;

    let animId: number;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Deep premium base dark backdrop
      ctx.fillStyle = 'rgba(9, 9, 14, 0.08)';
      ctx.fillRect(0, 0, w, h);

      const hsl = hexToHsl(accentColor);
      
      // Calculate slow continuous hue drift (1 full cycle every 9 minutes)
      const hueShift = (Date.now() / 1500) % 360;
      const baseHue = (hsl.h + hueShift) % 360;
      
      const s = Math.max(hsl.s, 55); // ensure rich, premium saturation
      const l = Math.min(Math.max(hsl.l, 30), 65); // keep lightness in check

      const color1 = `hsl(${baseHue}, ${s}%, ${Math.min(l * 0.45, 25)}%)`;
      const color2 = `hsl(${(baseHue + 75) % 360}, ${s}%, ${Math.min(l * 0.45, 25)}%)`;
      const color3 = `hsl(${(baseHue - 75) % 360}, ${s}%, ${Math.min(l * 0.45, 25)}%)`;
      const colors = [color1, color2, color3];

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

      // Time variables updated dynamically by audio energy
      timeRef.current += 0.002 + smoothedBass.current * 0.008;

      const t = timeRef.current;

      // Render 3 audio-reactive, orbiting blobs with Lissajous trajectories
      // Blob 0: Bass (Reacts to low frequencies, orbits in a small central circle)
      {
        const cx = w / 2 + Math.cos(t * 1.2) * (w * 0.15);
        const cy = h / 2 + Math.sin(t * 1.2) * (h * 0.15);
        const rad = 70 * (1.0 + smoothedBass.current * 0.8);
        const radial = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
        radial.addColorStop(0, colors[0]);
        radial.addColorStop(1, 'transparent');
        ctx.fillStyle = radial;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Blob 1: Midrange (Reacts to vocal/mid frequencies, horizontal figure-8 pattern)
      {
        const cx = w / 2 + Math.cos(t * 0.8) * (w * 0.28);
        const cy = h / 2 + Math.sin(t * 1.6) * (h * 0.12);
        const rad = 90 * (1.0 + smoothedMids.current * 0.5);
        const radial = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
        radial.addColorStop(0, colors[1]);
        radial.addColorStop(1, 'transparent');
        ctx.fillStyle = radial;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // Blob 2: Treble (Reacts to hi-hats/detail, vertical figure-8 pattern)
      {
        const cx = w / 2 + Math.sin(t * 1.4) * (w * 0.12);
        const cy = h / 2 + Math.cos(t * 0.7) * (h * 0.28);
        const rad = 80 * (1.0 + smoothedTreble.current * 0.4);
        const radial = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
        radial.addColorStop(0, colors[2]);
        radial.addColorStop(1, 'transparent');
        ctx.fillStyle = radial;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [accentColor, playback.status, lowSpecMode, liquidBackgroundEnabled]);

  if (lowSpecMode || !liquidBackgroundEnabled) return null;

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: -1,
      overflow: 'hidden',
      pointerEvents: 'none',
      background: 'rgba(9, 9, 14, 0.95)'
    }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          opacity: 0.42,
          filter: 'blur(55px) saturate(1.8)',
          transform: 'scale(1.2)', // prevent edge clipping
          display: 'block'
        }}
      />
    </div>
  );
}
