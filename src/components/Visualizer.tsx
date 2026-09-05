import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../store';
import type { VisualizerMode as StoreVisualizerMode, VisualizerDecayRate } from '../store/types';

// Backward-compatible VisualizerMode for legacy consumers (e.g. FullscreenView)
export type VisualizerMode = 'baseline' | 'circle' | 'wave';
export type ExtendedVisualizerMode = StoreVisualizerMode;
export type { VisualizerDecayRate, StoreVisualizerMode };

export interface VisualizerProps {
  mode?: StoreVisualizerMode;
  decayRate?: VisualizerDecayRate;
}

export const VISUALIZER_MODES: StoreVisualizerMode[] = ['bars', 'mirror', 'wave', 'circle', 'dots'];

export interface DecayConfig {
  smoothFactor: number;
  gravity: number;
  holdDuration: number;
}

export const DECAY_PROFILES: Record<VisualizerDecayRate, DecayConfig> = {
  snappy: { smoothFactor: 0.35, gravity: 0.25, holdDuration: 8 },
  balanced: { smoothFactor: 0.20, gravity: 0.15, holdDuration: 12 },
  silky: { smoothFactor: 0.10, gravity: 0.08, holdDuration: 18 },
};

export function resolveVisualizerMode(mode?: StoreVisualizerMode): StoreVisualizerMode {
  if (!mode || mode === 'baseline') return 'bars';
  return mode;
}

export function getNextVisualizerMode(current: StoreVisualizerMode): StoreVisualizerMode {
  const normalized = current === 'baseline' ? 'bars' : current;
  const cycle: StoreVisualizerMode[] = ['bars', 'mirror', 'wave', 'circle', 'dots'];
  const idx = cycle.indexOf(normalized);
  if (idx === -1) return 'bars';
  return cycle[(idx + 1) % cycle.length];
}

export interface VisualizerPhysicsState {
  smoothedBands: number[];
  peakLevels: number[];
  peakHoldFrames: number[];
  peakVelocities: number[];
}

export function createInitialPhysicsState(bandCount = 64): VisualizerPhysicsState {
  return {
    smoothedBands: new Array(bandCount).fill(0),
    peakLevels: new Array(bandCount).fill(0),
    peakHoldFrames: new Array(bandCount).fill(0),
    peakVelocities: new Array(bandCount).fill(0),
  };
}

export function updateVisualizerPhysics(
  state: VisualizerPhysicsState,
  bands: number[],
  isPlaying: boolean,
  profile: DecayConfig
): { isAmbient: boolean } {
  const { smoothFactor, gravity, holdDuration } = profile;
  const count = state.smoothedBands.length;

  if (isPlaying) {
    for (let i = 0; i < count; i++) {
      const target = bands[i] || 0;
      state.smoothedBands[i] += (target - state.smoothedBands[i]) * smoothFactor;

      if (state.smoothedBands[i] > state.peakLevels[i]) {
        state.peakLevels[i] = state.smoothedBands[i];
        state.peakHoldFrames[i] = holdDuration;
        state.peakVelocities[i] = 0;
      } else if (state.peakHoldFrames[i] > 0) {
        state.peakHoldFrames[i]--;
      } else {
        state.peakVelocities[i] += gravity;
        state.peakLevels[i] = Math.max(0, state.peakLevels[i] - state.peakVelocities[i]);
      }
    }
    return { isAmbient: false };
  } else {
    let allNearZero = true;
    for (let i = 0; i < count; i++) {
      state.smoothedBands[i] *= 0.88;
      state.peakLevels[i] *= 0.88;
      if (state.smoothedBands[i] >= 0.005) {
        allNearZero = false;
      }
    }
    return { isAmbient: allNearZero };
  }
}

export function hexToRgba(color: string, alpha: number): string {
  if (!color) return `rgba(139, 92, 246, ${alpha})`;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  return color;
}

export function Visualizer({ mode: propMode, decayRate: propDecay }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentColor = useStore((s) => s.accentColor);
  const playbackStatus = useStore((s) => s.playback.status);
  const lowSpecMode = useStore((s) => s.lowSpecMode);
  const storeMode = useStore((s) => s.visualizerMode);
  const setStoreMode = useStore((s) => s.setVisualizerMode);
  const storeDecay = useStore((s) => s.visualizerDecayRate);

  const currentMode = propMode || storeMode || 'bars';
  const effectiveMode = resolveVisualizerMode(currentMode);
  const currentDecay = propDecay || storeDecay || 'balanced';

  const spectrumRef = useRef<number[]>(new Array(64).fill(0));
  const physicsRef = useRef<VisualizerPhysicsState>(createInitialPhysicsState(64));

  const handleCanvasClick = () => {
    if (propMode) return;
    const next = getNextVisualizerMode(effectiveMode);
    setStoreMode(next);
    window.dispatchEvent(
      new CustomEvent('ui-toast', {
        detail: { message: `Visualizer mode set to ${next.toUpperCase()}`, type: 'info' },
      })
    );
  };

  useEffect(() => {
    const unlisten = listen<number[]>('audio-spectrum', (event) => {
      spectrumRef.current = event.payload;
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const physics = physicsRef.current;
    const profile = DECAY_PROFILES[currentDecay] || DECAY_PROFILES.balanced;

    let width = canvas.clientWidth || 600;
    let height = canvas.clientHeight || 80;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width || 600;
      height = rect.height || 80;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

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
      ctx.shadowBlur = 0;

      const isPlaying = playbackStatus === 'Playing';
      const { isAmbient } = updateVisualizerPhysics(physics, spectrumRef.current, isPlaying, profile);

      if (isAmbient) {
        // Render breathing ambient resting state
        const breathOpacity = 0.2 + 0.08 * Math.sin(Date.now() / 1200);

        if (effectiveMode === 'circle') {
          const restingRadius = Math.min(width, height) * 0.32;
          ctx.beginPath();
          ctx.arc(width / 2, height / 2, restingRadius, 0, Math.PI * 2);
          ctx.lineWidth = 1;
          ctx.strokeStyle = accentColor;
          ctx.globalAlpha = breathOpacity;
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        } else if (effectiveMode === 'mirror' || effectiveMode === 'wave') {
          const centerY = height / 2;
          ctx.beginPath();
          ctx.moveTo(0, centerY);
          ctx.lineTo(width, centerY);
          ctx.lineWidth = 1;
          ctx.strokeStyle = accentColor;
          ctx.globalAlpha = breathOpacity;
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        } else {
          // 'bars' and 'dots'
          ctx.beginPath();
          ctx.moveTo(0, height - 1);
          ctx.lineTo(width, height - 1);
          ctx.lineWidth = 1;
          ctx.strokeStyle = accentColor;
          ctx.globalAlpha = breathOpacity;
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }

        animationId = requestAnimationFrame(render);
        return;
      }

      const { smoothedBands, peakLevels } = physics;

      if (effectiveMode === 'bars') {
        const numBars = 64;
        const barWidth = (width / numBars) * 0.8;
        const gap = (width / numBars) * 0.2;

        if (!lowSpecMode) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = accentColor;
        }

        for (let i = 0; i < numBars; i++) {
          const val = smoothedBands[i] * height * 0.8;
          const x = i * (barWidth + gap);
          const y = height - val;

          const grad = ctx.createLinearGradient(x, y, x, height);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(0.2, accentColor);
          grad.addColorStop(1, hexToRgba(accentColor, 0.05));
          ctx.fillStyle = grad;

          if (val > 0) {
            const capRadius = Math.min(4, barWidth / 2, val / 2);
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(x, y, barWidth, val, [capRadius, capRadius, 0, 0]);
            } else {
              ctx.rect(x, y, barWidth, val);
            }
            ctx.fill();
          }

          // Floating peak indicator
          const peakH = peakLevels[i] * height * 0.8;
          if (peakH > 2) {
            const peakY = height - peakH;
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(x, Math.max(0, peakY - 2), barWidth, 2);
          }
        }

        // Baseline
        ctx.beginPath();
        ctx.moveTo(0, height - 1);
        ctx.lineTo(width, height - 1);
        ctx.lineWidth = 1;
        ctx.strokeStyle = accentColor;
        ctx.globalAlpha = 0.4;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      } else if (effectiveMode === 'mirror') {
        const numBars = 64;
        const barWidth = (width / numBars) * 0.8;
        const gap = (width / numBars) * 0.2;
        const centerY = height / 2;

        if (!lowSpecMode) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = accentColor;
        }

        for (let i = 0; i < numBars; i++) {
          const distFromCenter = Math.abs(i - 31.5);
          const bandIdx = Math.min(63, Math.floor(distFromCenter * 2));
          const val = smoothedBands[bandIdx] * (height / 2) * 0.8;
          const x = i * (barWidth + gap);
          const topY = centerY - val;
          const barH = Math.max(0, val * 2);

          const grad = ctx.createLinearGradient(0, topY, 0, topY + barH);
          grad.addColorStop(0, '#06b6d4');
          grad.addColorStop(0.5, accentColor);
          grad.addColorStop(1, '#a855f7');
          ctx.fillStyle = grad;

          if (barH > 0) {
            const capRadius = Math.min(2, barWidth / 2, val);
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(x, topY, barWidth, barH, [capRadius, capRadius, capRadius, capRadius]);
            } else {
              ctx.rect(x, topY, barWidth, barH);
            }
            ctx.fill();
          }

          // Mirrored peak indicators
          const peakH = peakLevels[bandIdx] * (height / 2) * 0.8;
          if (peakH > 2) {
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(x, Math.max(0, centerY - peakH - 2), barWidth, 2);
            ctx.fillRect(x, Math.min(height - 2, centerY + peakH), barWidth, 2);
          }
        }

        // Center line
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.lineWidth = 1;
        ctx.strokeStyle = accentColor;
        ctx.globalAlpha = 0.3;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      } else if (effectiveMode === 'wave') {
        const centerY = height / 2;
        const numPoints = 64;
        const timeFactor = Date.now() / 240;
        const points: { x: number; y: number }[] = [];

        if (!lowSpecMode) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = accentColor;
        }

        for (let i = 0; i < numPoints; i++) {
          const x = (i / (numPoints - 1)) * width;
          const sineFactor = Math.sin((i / (numPoints - 1)) * Math.PI * 4 + timeFactor);
          const val = smoothedBands[i] || 0;
          const waveHeight = val * (height * 0.42) * sineFactor;
          points.push({ x, y: centerY + waveHeight });
        }

        // Area gradient fill underneath
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();

        const areaGrad = ctx.createLinearGradient(0, centerY, 0, height);
        areaGrad.addColorStop(0, hexToRgba(accentColor, 0.12));
        areaGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = areaGrad;
        ctx.fill();

        // Wave ribbon stroke
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.lineWidth = 2.5;

        const strokeGrad = ctx.createLinearGradient(0, 0, width, 0);
        strokeGrad.addColorStop(0, '#c084fc');
        strokeGrad.addColorStop(0.5, accentColor);
        strokeGrad.addColorStop(1, '#38bdf8');
        ctx.strokeStyle = strokeGrad;
        ctx.stroke();

        // Subtle center line
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.lineWidth = 1;
        ctx.strokeStyle = accentColor;
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      } else if (effectiveMode === 'circle') {
        const centerX = width / 2;
        const centerY = height / 2;
        const minDim = Math.min(width, height);
        const baseRadius = minDim * 0.36;
        const numSpokes = height <= 80 ? 32 : 64;

        if (!lowSpecMode) {
          ctx.shadowBlur = 12;
          ctx.shadowColor = accentColor;
        }

        ctx.lineCap = 'round';
        const spokeWidth = Math.max(2, ((Math.PI * 2 * baseRadius) / numSpokes) * 0.45);
        ctx.lineWidth = spokeWidth;

        for (let i = 0; i < numSpokes; i++) {
          const bandIdx = Math.floor((i / numSpokes) * 64);
          const val = smoothedBands[bandIdx] || 0;
          const peakVal = peakLevels[bandIdx] || 0;
          const outerRadius = baseRadius + val * (minDim * 0.35);
          const angle = (i / numSpokes) * Math.PI * 2 - Math.PI / 2;

          const cos = Math.cos(angle);
          const sin = Math.sin(angle);

          const x1 = centerX + cos * baseRadius;
          const y1 = centerY + sin * baseRadius;
          const x2 = centerX + cos * outerRadius;
          const y2 = centerY + sin * outerRadius;

          const grad = ctx.createLinearGradient(x1, y1, x2, y2);
          grad.addColorStop(0, accentColor);
          grad.addColorStop(0.8, '#c084fc');
          grad.addColorStop(1, '#ffffff');
          ctx.strokeStyle = grad;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          // Radial peak marker
          if (peakVal > 0.05) {
            const peakRadius = baseRadius + peakVal * (minDim * 0.35) + 3;
            const px = centerX + cos * peakRadius;
            const py = centerY + sin * peakRadius;
            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(px, py, Math.max(1.5, spokeWidth / 2), 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Inner halo ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = accentColor;
        ctx.globalAlpha = 0.35;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      } else if (effectiveMode === 'dots') {
        const numCols = 32;
        const numDots = height <= 80 ? 8 : 12;
        const colWidth = width / numCols;
        const marginY = 4;
        const availableHeight = height - marginY * 2;
        const dotSpacing = availableHeight / numDots;
        const dotRadius = Math.max(1.5, Math.min(colWidth * 0.28, dotSpacing * 0.35));

        if (!lowSpecMode) {
          ctx.shadowBlur = 8;
          ctx.shadowColor = accentColor;
        }

        for (let c = 0; c < numCols; c++) {
          const bandIdx = c * 2;
          const val = smoothedBands[bandIdx] || 0;
          const peakVal = peakLevels[bandIdx] || 0;

          const litCount = Math.min(numDots, Math.round(val * numDots));
          const peakIndex = Math.min(numDots - 1, Math.round(peakVal * numDots));
          const colX = c * colWidth + colWidth / 2;

          for (let d = 0; d < numDots; d++) {
            const dotY = height - marginY - (d + 0.5) * dotSpacing;
            const isPeak = d === peakIndex && peakVal > 0.05;
            const isLit = d < litCount;

            ctx.beginPath();
            ctx.arc(colX, dotY, dotRadius, 0, Math.PI * 2);

            if (isPeak) {
              ctx.fillStyle = '#fbbf24';
              ctx.globalAlpha = 1.0;
              ctx.fill();
            } else if (isLit) {
              ctx.fillStyle = accentColor;
              ctx.globalAlpha = 0.7 + 0.3 * (d / numDots);
              ctx.fill();
            } else {
              ctx.fillStyle = accentColor;
              ctx.globalAlpha = 0.08;
              ctx.fill();
            }
          }
        }

        // 1px baseline
        ctx.beginPath();
        ctx.moveTo(0, height - 1);
        ctx.lineTo(width, height - 1);
        ctx.lineWidth = 1;
        ctx.strokeStyle = accentColor;
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      ctx.shadowBlur = 0;
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => {
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
    };
  }, [accentColor, playbackStatus, lowSpecMode, effectiveMode, currentDecay]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        opacity: 0.8,
        display: 'block',
        cursor: propMode ? 'default' : 'pointer',
      }}
      onClick={handleCanvasClick}
    />
  );
}
