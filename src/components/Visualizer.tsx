import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../store';

export function Visualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { accentColor, playback } = useStore();
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
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const smoothedBands = new Array(64).fill(0);

    const render = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      if (playback.status !== 'Playing') {
        animationId = requestAnimationFrame(render);
        return;
      }

      const bands = spectrumRef.current;
      const barWidth = (width / bands.length) * 0.8;
      const gap = (width / bands.length) * 0.2;

      ctx.shadowBlur = 15;
      ctx.shadowColor = accentColor;
      ctx.fillStyle = accentColor;

      for (let i = 0; i < bands.length; i++) {
        // Smoothing
        smoothedBands[i] += (bands[i] - smoothedBands[i]) * 0.2;
        
        const val = smoothedBands[i] * height * 0.8;
        const x = i * (barWidth + gap);
        const y = height - val;

        // Draw bar with rounded top
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, val, [4, 4, 0, 0]);
        ctx.fill();
      }

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [accentColor, playback.status]);

  return (
    <canvas 
      ref={canvasRef} 
      width={600} 
      height={120} 
      style={{ width: '100%', height: '120px', marginTop: '24px', opacity: 0.8 }} 
    />
  );
}
