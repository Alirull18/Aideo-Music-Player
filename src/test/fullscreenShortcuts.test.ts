import { describe, it, expect } from 'vitest';

type VisualizerMode = 'baseline' | 'circle' | 'wave';

function cycleVisualizerMode(current: VisualizerMode): VisualizerMode {
  const modes: VisualizerMode[] = ['baseline', 'circle', 'wave'];
  const nextIdx = (modes.indexOf(current) + 1) % modes.length;
  return modes[nextIdx];
}

function handleFullscreenShortcut(
  key: string,
  state: {
    layout: 'stage' | 'zen';
    vizMode: VisualizerMode;
    isPlaying: boolean;
    isMuted: boolean;
    volume: number;
    position: number;
    duration: number;
  }
) {
  const next = { ...state };
  const k = key.toLowerCase();

  if (k === ' ' || key === 'Space') {
    next.isPlaying = !next.isPlaying;
  } else if (k === 'l') {
    next.layout = next.layout === 'stage' ? 'zen' : 'stage';
  } else if (k === 'v') {
    next.vizMode = cycleVisualizerMode(next.vizMode);
  } else if (k === 'm') {
    next.isMuted = !next.isMuted;
  } else if (key === 'ArrowLeft') {
    next.position = Math.max(0, next.position - 5);
  } else if (key === 'ArrowRight') {
    next.position = Math.min(next.duration, next.position + 5);
  } else if (key === 'ArrowUp') {
    next.volume = Math.min(1, Math.round((next.volume + 0.05) * 100) / 100);
    next.isMuted = false;
  } else if (key === 'ArrowDown') {
    next.volume = Math.max(0, Math.round((next.volume - 0.05) * 100) / 100);
  }

  return next;
}

describe('Fullscreen Shortcuts & Visualizer Cycle Logic', () => {
  it('should cycle visualizer mode baseline -> circle -> wave -> baseline', () => {
    let mode: VisualizerMode = 'baseline';
    mode = cycleVisualizerMode(mode);
    expect(mode).toBe('circle');
    mode = cycleVisualizerMode(mode);
    expect(mode).toBe('wave');
    mode = cycleVisualizerMode(mode);
    expect(mode).toBe('baseline');
  });

  it('should toggle play/pause on Space', () => {
    const initialState = {
      layout: 'stage' as const,
      vizMode: 'baseline' as VisualizerMode,
      isPlaying: true,
      isMuted: false,
      volume: 0.8,
      position: 50,
      duration: 200,
    };
    const next = handleFullscreenShortcut('Space', initialState);
    expect(next.isPlaying).toBe(false);
  });

  it('should toggle layout on L', () => {
    const initialState = {
      layout: 'stage' as const,
      vizMode: 'baseline' as VisualizerMode,
      isPlaying: true,
      isMuted: false,
      volume: 0.8,
      position: 50,
      duration: 200,
    };
    const next = handleFullscreenShortcut('l', initialState);
    expect(next.layout).toBe('zen');
  });

  it('should adjust volume on ArrowUp and ArrowDown', () => {
    const initialState = {
      layout: 'stage' as const,
      vizMode: 'baseline' as VisualizerMode,
      isPlaying: true,
      isMuted: false,
      volume: 0.5,
      position: 50,
      duration: 200,
    };
    const up = handleFullscreenShortcut('ArrowUp', initialState);
    expect(up.volume).toBe(0.55);

    const down = handleFullscreenShortcut('ArrowDown', initialState);
    expect(down.volume).toBe(0.45);
  });

  it('should seek -5s and +5s on ArrowLeft and ArrowRight', () => {
    const initialState = {
      layout: 'stage' as const,
      vizMode: 'baseline' as VisualizerMode,
      isPlaying: true,
      isMuted: false,
      volume: 0.5,
      position: 50,
      duration: 200,
    };
    const left = handleFullscreenShortcut('ArrowLeft', initialState);
    expect(left.position).toBe(45);

    const right = handleFullscreenShortcut('ArrowRight', initialState);
    expect(right.position).toBe(55);
  });
});
