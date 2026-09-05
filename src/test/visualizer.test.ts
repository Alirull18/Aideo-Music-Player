import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import {
  Visualizer,
  DECAY_PROFILES,
  resolveVisualizerMode,
  getNextVisualizerMode,
  createInitialPhysicsState,
  updateVisualizerPhysics,
  hexToRgba,
} from '../components/Visualizer';
import { useStore } from '../store';
import type { VisualizerMode, VisualizerDecayRate } from '../store/types';

describe('Modular Canvas Visualizer Engine Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      visualizerMode: 'bars',
      visualizerDecayRate: 'balanced',
      accentColor: '#8b5cf6',
      lowSpecMode: false,
      playback: {
        status: 'Playing',
        current_track: null,
        position_secs: 0,
        volume: 1,
        exclusive: false,
        bit_perfect: false,
        dev_rate: 44100,
        driver_type: 'WASAPI',
      },
    });

    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      scale: vi.fn(),
      setTransform: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      roundRect: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
    }) as any;
  });

  describe('Decay & Smoothing Profiles', () => {
    it('should define correct values for snappy, balanced, and silky profiles', () => {
      const snappyKey: VisualizerDecayRate = 'snappy';
      const balancedKey: VisualizerDecayRate = 'balanced';
      const silkyKey: VisualizerDecayRate = 'silky';

      expect(DECAY_PROFILES[snappyKey]).toEqual({
        smoothFactor: 0.35,
        gravity: 0.25,
        holdDuration: 8,
      });

      expect(DECAY_PROFILES[balancedKey]).toEqual({
        smoothFactor: 0.20,
        gravity: 0.15,
        holdDuration: 12,
      });

      expect(DECAY_PROFILES[silkyKey]).toEqual({
        smoothFactor: 0.10,
        gravity: 0.08,
        holdDuration: 18,
      });
    });
  });

  describe('Mode Resolution & Cycling', () => {
    it('should resolve legacy baseline to bars, and keep other modes intact', () => {
      expect(resolveVisualizerMode('baseline')).toBe('bars');
      expect(resolveVisualizerMode('bars')).toBe('bars');
      expect(resolveVisualizerMode('mirror')).toBe('mirror');
      expect(resolveVisualizerMode('wave')).toBe('wave');
      expect(resolveVisualizerMode('circle')).toBe('circle');
      expect(resolveVisualizerMode('dots')).toBe('dots');
      expect(resolveVisualizerMode(undefined)).toBe('bars');
    });

    it('should cycle through modes in the required sequence', () => {
      const initialMode: VisualizerMode = 'bars';
      expect(getNextVisualizerMode(initialMode)).toBe('mirror');
      expect(getNextVisualizerMode('mirror')).toBe('wave');
      expect(getNextVisualizerMode('wave')).toBe('circle');
      expect(getNextVisualizerMode('circle')).toBe('dots');
      expect(getNextVisualizerMode('dots')).toBe('bars');
      // Legacy alias baseline should cycle like bars to mirror
      expect(getNextVisualizerMode('baseline')).toBe('mirror');
    });
  });

  describe('Physics & Buffers Engine', () => {
    it('should initialize 64-band zero buffers', () => {
      const state = createInitialPhysicsState(64);
      expect(state.smoothedBands).toHaveLength(64);
      expect(state.peakLevels).toHaveLength(64);
      expect(state.peakHoldFrames).toHaveLength(64);
      expect(state.peakVelocities).toHaveLength(64);
      expect(state.smoothedBands.every((v) => v === 0)).toBe(true);
    });

    it('should update smoothed bands using lerp when playing', () => {
      const state = createInitialPhysicsState(64);
      const bands = new Array(64).fill(1.0);
      const profile = DECAY_PROFILES.balanced; // smoothFactor = 0.20

      const result = updateVisualizerPhysics(state, bands, true, profile);
      expect(result.isAmbient).toBe(false);

      // 0 + (1.0 - 0) * 0.20 = 0.20
      expect(state.smoothedBands[0]).toBeCloseTo(0.2, 5);
      expect(state.peakLevels[0]).toBeCloseTo(0.2, 5);
      expect(state.peakHoldFrames[0]).toBe(profile.holdDuration);
      expect(state.peakVelocities[0]).toBe(0);
    });

    it('should hold peak levels during hold frames and drop with gravity afterwards', () => {
      const state = createInitialPhysicsState(64);
      const profile = DECAY_PROFILES.snappy; // holdDuration = 8, gravity = 0.25

      // Step 1: Spike up
      updateVisualizerPhysics(state, [1.0], true, profile);
      const initialPeak = state.peakLevels[0];
      expect(initialPeak).toBeCloseTo(0.35, 5);
      expect(state.peakHoldFrames[0]).toBe(8);

      // Step 2: Audio drops to 0, hold counter decrements
      updateVisualizerPhysics(state, [0], true, profile);
      expect(state.peakHoldFrames[0]).toBe(7);
      expect(state.peakLevels[0]).toBe(initialPeak);

      // Step 3: Run remaining hold frames down to 0
      for (let i = 0; i < 7; i++) {
        updateVisualizerPhysics(state, [0], true, profile);
      }
      expect(state.peakHoldFrames[0]).toBe(0);

      // Step 4: Next frame gravity applies
      updateVisualizerPhysics(state, [0], true, profile);
      expect(state.peakVelocities[0]).toBe(profile.gravity);
      expect(state.peakLevels[0]).toBe(Math.max(0, initialPeak - profile.gravity));
    });

    it('should decay exponentially when paused/stopped and detect ambient state', () => {
      const state = createInitialPhysicsState(64);
      state.smoothedBands[0] = 0.5;
      state.peakLevels[0] = 0.5;

      const profile = DECAY_PROFILES.balanced;

      // 1 frame of pause decay: 0.5 * 0.88 = 0.44
      let result = updateVisualizerPhysics(state, [], false, profile);
      expect(state.smoothedBands[0]).toBeCloseTo(0.44, 5);
      expect(state.peakLevels[0]).toBeCloseTo(0.44, 5);
      expect(result.isAmbient).toBe(false);

      // Run multiple decay cycles until below 0.005 threshold
      for (let i = 0; i < 50; i++) {
        result = updateVisualizerPhysics(state, [], false, profile);
      }
      expect(state.smoothedBands[0]).toBeLessThan(0.005);
      expect(result.isAmbient).toBe(true);
    });
  });

  describe('hexToRgba Helper', () => {
    it('should convert 6-character hex and 3-character hex to rgba', () => {
      expect(hexToRgba('#ffffff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
      expect(hexToRgba('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
      expect(hexToRgba('#fff', 0.8)).toBe('rgba(255, 255, 255, 0.8)');
    });

    it('should handle already rgb strings or fallback gracefully', () => {
      expect(hexToRgba('rgb(10, 20, 30)', 0.4)).toBe('rgba(10, 20, 30, 0.4)');
      expect(hexToRgba('', 0.5)).toBe('rgba(139, 92, 246, 0.5)');
    });
  });

  describe('Component Props, Store, and Interaction', () => {
    it('should render canvas with pointer cursor when propMode is not provided', () => {
      const { container } = render(React.createElement(Visualizer));
      const canvas = container.querySelector('canvas');
      expect(canvas).toBeTruthy();
      expect(canvas?.style.cursor).toBe('pointer');
    });

    it('should render canvas with default cursor when propMode is provided', () => {
      const { container } = render(React.createElement(Visualizer, { mode: 'circle' }));
      const canvas = container.querySelector('canvas');
      expect(canvas).toBeTruthy();
      expect(canvas?.style.cursor).toBe('default');
    });

    it('should cycle store visualizerMode and dispatch ui-toast when clicked without propMode', () => {
      const toastListener = vi.fn();
      window.addEventListener('ui-toast', toastListener);

      useStore.setState({ visualizerMode: 'bars' });

      const { container } = render(React.createElement(Visualizer));
      const canvas = container.querySelector('canvas');
      expect(canvas).toBeTruthy();

      // Click 1: bars -> mirror
      fireEvent.click(canvas!);
      expect(useStore.getState().visualizerMode).toBe('mirror');
      expect(toastListener).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            message: 'Visualizer mode set to MIRROR',
            type: 'info',
          },
        })
      );

      // Click 2: mirror -> wave
      fireEvent.click(canvas!);
      expect(useStore.getState().visualizerMode).toBe('wave');

      // Click 3: wave -> circle
      fireEvent.click(canvas!);
      expect(useStore.getState().visualizerMode).toBe('circle');

      // Click 4: circle -> dots
      fireEvent.click(canvas!);
      expect(useStore.getState().visualizerMode).toBe('dots');

      // Click 5: dots -> bars
      fireEvent.click(canvas!);
      expect(useStore.getState().visualizerMode).toBe('bars');

      window.removeEventListener('ui-toast', toastListener);
    });

    it('should not cycle mode when propMode is set', () => {
      const toastListener = vi.fn();
      window.addEventListener('ui-toast', toastListener);

      useStore.setState({ visualizerMode: 'bars' });

      const { container } = render(React.createElement(Visualizer, { mode: 'wave' }));
      const canvas = container.querySelector('canvas');
      expect(canvas).toBeTruthy();

      fireEvent.click(canvas!);
      expect(useStore.getState().visualizerMode).toBe('bars');
      expect(toastListener).not.toHaveBeenCalled();

      window.removeEventListener('ui-toast', toastListener);
    });
  });
});
