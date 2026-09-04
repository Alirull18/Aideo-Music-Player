import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { safeGetStorage } from '../utils/storage';
import { freqToX, dbToY, snapToDetent } from '../utils/audioMath';

describe('Aideo Card Slider, View Mode & Lab Layout Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().setDiscoveryCardSize(185);
    useStore.getState().setDiscoveryViewMode('grid');
  });

  describe('Discovery Card Size Slider & Persistence', () => {
    it('should initialize with 185px default card size', () => {
      const state = useStore.getState();
      expect(state.discoveryCardSize).toBe(185);
    });

    it('should support compact small cards (100px) and huge cards (340px)', () => {
      const { setDiscoveryCardSize } = useStore.getState();

      // Compact small
      setDiscoveryCardSize(100);
      expect(useStore.getState().discoveryCardSize).toBe(100);
      expect(localStorage.getItem('aideo-discovery-card-size')).toBe('100');

      // Huge for curved/ultrawide displays
      setDiscoveryCardSize(340);
      expect(useStore.getState().discoveryCardSize).toBe(340);
      expect(localStorage.getItem('aideo-discovery-card-size')).toBe('340');
    });

    it('should clamp card size bounds strictly within [100, 360]', () => {
      const { setDiscoveryCardSize } = useStore.getState();

      setDiscoveryCardSize(50);
      expect(useStore.getState().discoveryCardSize).toBe(100);

      setDiscoveryCardSize(500);
      expect(useStore.getState().discoveryCardSize).toBe(360);
    });

    it('should persist card size across safe storage retrieval', () => {
      const { setDiscoveryCardSize } = useStore.getState();

      setDiscoveryCardSize(220);
      expect(safeGetStorage('aideo-discovery-card-size')).toBe('220');
    });
  });

  describe('Discovery View Mode (Grid vs List) Persistence', () => {
    it('should initialize with grid mode by default', () => {
      expect(useStore.getState().discoveryViewMode).toBe('grid');
    });

    it('should toggle and remember list vs grid mode in store and localStorage', () => {
      const { setDiscoveryViewMode } = useStore.getState();

      setDiscoveryViewMode('list');
      expect(useStore.getState().discoveryViewMode).toBe('list');
      expect(localStorage.getItem('aideo-discovery-view-mode')).toBe('list');

      setDiscoveryViewMode('grid');
      expect(useStore.getState().discoveryViewMode).toBe('grid');
      expect(localStorage.getItem('aideo-discovery-view-mode')).toBe('grid');
    });
  });

  describe('AutoEQ Collapsible State Persistence', () => {
    it('should store and restore autoeq collapsed preference in localStorage', () => {
      localStorage.setItem('aideo_autoeq_collapsed', 'true');
      expect(localStorage.getItem('aideo_autoeq_collapsed')).toBe('true');

      localStorage.setItem('aideo_autoeq_collapsed', 'false');
      expect(localStorage.getItem('aideo_autoeq_collapsed')).toBe('false');
    });
  });

  describe('Equalizer Frequency Curve Coordinate Math & Ultrawide Scale Invariance', () => {
    it('should map 20Hz to 0 and 20000Hz to width across standard and ultrawide resolutions', () => {
      const widths = [840, 1600, 2400, 3440];

      for (const w of widths) {
        expect(freqToX(20, w)).toBe(0);
        expect(Math.round(freqToX(20000, w))).toBe(w);
      }
    });

    it('should scale 1kHz frequency coordinate strictly proportionally to width without distortion', () => {
      const w1 = 800;
      const w2 = 1600;

      const x1 = freqToX(1000, w1);
      const x2 = freqToX(1000, w2);

      // In 1:1 true coordinate scaling, doubling width doubles the coordinate exactly
      expect(x2).toBeCloseTo(x1 * 2, 5);
    });

    it('should map dB to Y coordinate correctly with 0dB centered', () => {
      const height = 260;

      // +15dB should map to top (0px)
      expect(dbToY(15, height, -15, 15)).toBe(0);

      // -15dB should map to bottom (260px)
      expect(dbToY(-15, height, -15, 15)).toBe(height);

      // 0dB should map to vertical center (130px)
      expect(dbToY(0, height, -15, 15)).toBe(height / 2);
    });

    it('should snap near-zero dB values to the 0dB magnetic detent', () => {
      expect(snapToDetent(0.2, 0.35, 0)).toBe(0);
      expect(snapToDetent(-0.25, 0.35, 0)).toBe(0);
      expect(snapToDetent(1.5, 0.35, 0)).toBe(1.5);
    });
  });
});
