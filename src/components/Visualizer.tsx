import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../store';

interface VisualizerProps {
  mode?: 'baseline' | 'circle' | 'wave';
}

export function Visualizer({ mode: propMode }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { accentColor, playback, lowSpecMode } = useStore();
  const spectrumRef = useRef<number[]>(new Array(64).fill(0));

  const [internalMode, setInternalMode] = useState<'baseline' | 'circle' | 'wave'>(() => {
    if (propMode) return propMode;
    const saved = localStorage.getItem('aideo_visualizer_mode');
    return (saved as any) || 'baseline';
  });

  useEffect(() => {
    if (propMode) {
      setInternalMode(propMode);
    }
  }, [propMode]);

  const currentMode = propMode || internalMode;

  const handleCanvasClick = () => {
    if (propMode) return;
    const nextModeMap = {
      baseline: 'circle',
      circle: 'wave',
      wave: 'baseline'
    } as const;
    const next = nextModeMap[internalMode];
    setInternalMode(next);
    localStorage.setItem('aideo_visualizer_mode', next);
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Visualizer mode set to ${next.toUpperCase()}`, type: 'info' } 
    }));
  };

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
    
    let width = canvas.clientWidth || 600;
    let height = canvas.clientHeight || 80;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width || 600;
      height = rect.height || 80;
      
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    resizeCanvas();

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      if (playback.status !== 'Playing') {
        animationId = requestAnimationFrame(render);
        return;
      }

      const bands = spectrumRef.current;

      if (currentMode === 'baseline') {
        const barWidth = (width / bands.length) * 0.8;
        const gap = (width / bands.length) * 0.2;

        if (!lowSpecMode) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = accentColor;
        }

        for (let i = 0; i < bands.length; i++) {
          smoothedBands[i] += (bands[i] - smoothedBands[i]) * 0.2;
          const val = smoothedBands[i] * height * 0.8;
          const x = i * (barWidth + gap);
          const y = height - val;

          const grad = ctx.createLinearGradient(x, y, x, height);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(0.2, accentColor);
          grad.addColorStop(1, 'rgba(139, 92, 246, 0.05)');
          ctx.fillStyle = grad;

          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, val, [4, 4, 0, 0]);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.moveTo(0, height - 1);
        ctx.lineTo(width, height - 1);
        ctx.lineWidth = 2;
        ctx.strokeStyle = accentColor;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      } else if (currentMode === 'circle') {
        const centerX = width / 2;
        const centerY = height / 2;
        const baseRadius = Math.min(width, height) * 0.32;
        const numBars = bands.length;

        if (!lowSpecMode) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = accentColor;
        }
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';

        for (let i = 0; i < numBars; i++) {
          smoothedBands[i] += (bands[i] - smoothedBands[i]) * 0.2;
          const val = smoothedBands[i] * (Math.min(width, height) * 0.28);

          const angle = (i / numBars) * Math.PI * 2;
          const x1 = centerX + Math.cos(angle) * baseRadius;
          const y1 = centerY + Math.sin(angle) * baseRadius;
          const x2 = centerX + Math.cos(angle) * (baseRadius + val);
          const y2 = centerY + Math.sin(angle) * (baseRadius + val);

          const grad = ctx.createLinearGradient(x1, y1, x2, y2);
          grad.addColorStop(0, accentColor);
          grad.addColorStop(0.8, '#c084fc');
          grad.addColorStop(1, '#ffffff');
          ctx.strokeStyle = grad;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = accentColor;
        ctx.globalAlpha = 0.3;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      } else if (currentMode === 'wave') {
        ctx.beginPath();
        ctx.lineWidth = 4;

        const grad = ctx.createLinearGradient(0, height / 2, width, height / 2);
        grad.addColorStop(0, '#c084fc');
        grad.addColorStop(0.5, accentColor);
        grad.addColorStop(1, '#f472b6');
        ctx.strokeStyle = grad;

        if (!lowSpecMode) {
          ctx.shadowBlur = 20;
          ctx.shadowColor = accentColor;
        }

        const len = bands.length;
        const timeFactor = Date.now() / 180;

        for (let x = 0; x < width; x += 2) {
          const segment = Math.floor((x / width) * len);
          smoothedBands[segment] += ((bands[segment] || 0) - (smoothedBands[segment] || 0)) * 0.2;
          const val = smoothedBands[segment] || 0;

          const sineFactor = Math.sin((x / width) * Math.PI * 8 + timeFactor);
          const waveHeight = val * height * 0.42 * sineFactor;
          const y = height / 2 + waveHeight;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = accentColor;
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      animationId = requestAnimationFrame(render);
    };

    render();
    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
    };
  }, [accentColor, playback.status, lowSpecMode, currentMode]);

  return (
    <canvas 
      ref={canvasRef} 
      style={{
        width: '100%',
        height: '100%',
        opacity: 0.8,
        display: 'block',
        cursor: propMode ? 'default' : 'pointer'
      }} 
      onClick={handleCanvasClick}
    />
  );
}
