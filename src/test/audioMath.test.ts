import { describe, it, expect } from 'vitest';
import {
  GRAPHIC_EQ_FREQUENCIES,
  getBiquadMagnitudeDb,
  getPeakingResponse,
  getLowshelfResponse,
  getHighshelfResponse,
  calculateGraphicEqCurve,
  snapToDetent,
  freqToX,
  dbToY,
  generateSvgCurvePath,
  formatFrequency,
} from '../utils/audioMath';

describe('audioMath DSP helpers', () => {
  it('should have 10 standard graphic EQ frequencies', () => {
    expect(GRAPHIC_EQ_FREQUENCIES).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  });

  describe('getBiquadMagnitudeDb', () => {
    it('returns 0 dB for a unity passthrough filter', () => {
      // passthrough: b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0
      const mag = getBiquadMagnitudeDb(1000, 48000, 1, 0, 0, 0, 0);
      expect(mag).toBeCloseTo(0, 5);
    });
  });

  describe('getPeakingResponse', () => {
    it('returns 0 dB when gain is 0', () => {
      expect(getPeakingResponse(1000, 48000, 1000, 0, 1.0)).toBe(0);
    });

    it('returns approximately center gain at center frequency', () => {
      const response = getPeakingResponse(1000, 48000, 1000, 6.0, 1.4);
      expect(response).toBeGreaterThan(5.8);
      expect(response).toBeLessThan(6.2);
    });

    it('attenuates at center frequency for negative gain', () => {
      const response = getPeakingResponse(1000, 48000, 1000, -6.0, 1.4);
      expect(response).toBeLessThan(-5.8);
      expect(response).toBeGreaterThan(-6.2);
    });

    it('has minimal impact far away from center frequency', () => {
      const response = getPeakingResponse(100, 48000, 10000, 6.0, 1.4);
      expect(Math.abs(response)).toBeLessThan(0.5);
    });
  });

  describe('getLowshelfResponse & getHighshelfResponse', () => {
    it('low shelf boosts low frequencies and stays near 0 at high frequencies', () => {
      const lowResp = getLowshelfResponse(50, 48000, 100, 6.0, 0.707);
      const highResp = getLowshelfResponse(10000, 48000, 100, 6.0, 0.707);
      expect(lowResp).toBeGreaterThan(5.0);
      expect(Math.abs(highResp)).toBeLessThan(0.5);
    });

    it('high shelf boosts high frequencies and stays near 0 at low frequencies', () => {
      const lowResp = getHighshelfResponse(50, 48000, 8000, 6.0, 0.707);
      const highResp = getHighshelfResponse(12000, 48000, 8000, 6.0, 0.707);
      expect(Math.abs(lowResp)).toBeLessThan(0.5);
      expect(highResp).toBeGreaterThan(5.0);
    });
  });

  describe('calculateGraphicEqCurve', () => {
    it('returns flat curve (all 0 dB) when gains are 0 and preamp is 0', () => {
      const flatGains = new Array(10).fill(0);
      const points = calculateGraphicEqCurve(flatGains, 0, 48000, 20);
      expect(points.length).toBe(21);
      points.forEach(pt => {
        expect(pt.db).toBeCloseTo(0, 4);
      });
    });

    it('offsets the entire curve by preamp gain', () => {
      const flatGains = new Array(10).fill(0);
      const points = calculateGraphicEqCurve(flatGains, 3.5, 48000, 20);
      points.forEach(pt => {
        expect(pt.db).toBeCloseTo(3.5, 4);
      });
    });

    it('produces peaked response at boosted frequency band', () => {
      const gains = [0, 0, 0, 0, 6, 0, 0, 0, 0, 0]; // 500 Hz boosted +6dB
      const points = calculateGraphicEqCurve(gains, 0, 48000, 50);
      const midPoint = points.find(p => Math.abs(p.f - 500) < 50);
      expect(midPoint).toBeDefined();
      if (midPoint) {
        expect(midPoint.db).toBeGreaterThan(4.5);
      }
    });
  });

  describe('snapToDetent', () => {
    it('snaps values within threshold to zero detent', () => {
      expect(snapToDetent(0.2, 0.35, 0)).toBe(0);
      expect(snapToDetent(-0.25, 0.35, 0)).toBe(0);
      expect(snapToDetent(0.0, 0.35, 0)).toBe(0);
    });

    it('preserves values outside threshold', () => {
      expect(snapToDetent(1.5, 0.35, 0)).toBe(1.5);
      expect(snapToDetent(-2.0, 0.35, 0)).toBe(-2.0);
    });
  });

  describe('coordinate & formatting helpers', () => {
    it('maps logarithmic frequency to X coordinate', () => {
      const xMin = freqToX(20, 1000);
      const xMax = freqToX(20000, 1000);
      const xMid = freqToX(632.45, 1000); // geometric mean of 20 and 20000 is ~632.45

      expect(xMin).toBeCloseTo(0, 1);
      expect(xMax).toBeCloseTo(1000, 1);
      expect(xMid).toBeCloseTo(500, 1);
    });

    it('maps dB value to Y coordinate correctly', () => {
      const yMin = dbToY(-15, 200, -15, 15);
      const yMax = dbToY(15, 200, -15, 15);
      const yZero = dbToY(0, 200, -15, 15);

      expect(yMin).toBe(200);
      expect(yMax).toBe(0);
      expect(yZero).toBe(100);
    });

    it('generates SVG curve path string', () => {
      const points = [
        { f: 20, db: 0 },
        { f: 1000, db: 6 },
        { f: 20000, db: 0 },
      ];
      const path = generateSvgCurvePath(points, 500, 100, -15, 15);
      expect(path).toMatch(/^M 0\.0 50\.0 L \d+\.\d+ \d+\.\d+ L 500\.0 50\.0$/);
    });

    it('formats frequency labels cleanly', () => {
      expect(formatFrequency(31)).toBe('31');
      expect(formatFrequency(500)).toBe('500');
      expect(formatFrequency(1000)).toBe('1k');
      expect(formatFrequency(2000)).toBe('2k');
      expect(formatFrequency(16000)).toBe('16k');
    });
  });
});
