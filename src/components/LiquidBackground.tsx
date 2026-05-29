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

function shiftHue(hsl: { h: number; s: number; l: number }, degree: number) {
  const h = (hsl.h + degree + 360) % 360;
  return `hsl(${h}, ${hsl.s}%, ${Math.min(hsl.l * 0.75, 45)}%)`;
}

export function LiquidBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { accentColor, playback, lowSpecMode, liquidBackgroundEnabled } = useStore();
  const spectrumRef = useRef<number[]>(new Array(64).fill(0));

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
    let time = 0;

    const blobs = [
      { baseRad: 80, angle: 0 },
      { baseRad: 100, angle: Math.PI / 3 },
      { baseRad: 90, angle: Math.PI * 2 / 3 }
    ];

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Deep premium base dark backdrop
      ctx.fillStyle = 'rgba(9, 9, 14, 0.08)';
      ctx.fillRect(0, 0, w, h);

      const hsl = hexToHsl(accentColor);
      const color1 = `hsl(${hsl.h}, ${hsl.s}%, ${Math.min(hsl.l * 0.4, 25)}%)`;
      const color2 = shiftHue(hsl, 45);
      const color3 = shiftHue(hsl, -45);
      const colors = [color1, color2, color3];

      // Calculate audio energy from low-frequency bands
      const bands = spectrumRef.current;
      let energy = 0;
      if (bands && bands.length > 0) {
        const checkBands = Math.min(bands.length, 12);
        let sum = 0;
        for (let i = 0; i < checkBands; i++) {
          sum += bands[i];
        }
        energy = sum / checkBands;
      }

      const targetPulse = 1.0 + energy * 0.5; // up to 50% pulsing amplitude
      time += 0.0035 + energy * 0.012; // drift faster on audio spikes

      blobs.forEach((blob, idx) => {
        const cx = w / 2 + Math.cos(time + blob.angle) * (w * 0.25);
        const cy = h / 2 + Math.sin(time * 0.75 + blob.angle) * (h * 0.25);

        const radial = ctx.createRadialGradient(cx, cy, 2, cx, cy, blob.baseRad * targetPulse);
        radial.addColorStop(0, colors[idx]);
        radial.addColorStop(1, 'transparent');

        ctx.fillStyle = radial;
        ctx.beginPath();
        ctx.arc(cx, cy, blob.baseRad * targetPulse, 0, Math.PI * 2);
        ctx.fill();
      });

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
