/**
 * Audio DSP Math & Frequency Curve Utilities
 * Provides biquad transfer function evaluation, logarithmic frequency mapping,
 * AutoEQ profile parsing, and tactile fader magnetic detent snapping.
 */

export const GRAPHIC_EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export interface CurvePoint {
  f: number;
  db: number;
}

export interface AutoEqParsedBand {
  freq: number;
  gain: number;
  q: number;
  band_type: 'peaking' | 'lowshelf' | 'highshelf' | 'highpass' | 'lowpass' | 'notch';
  enabled?: boolean;
}

/**
 * Calculates Biquad Filter Magnitude in dB at frequency f with sampling rate fs
 */
export function getBiquadMagnitudeDb(
  f: number,
  fs: number,
  b0: number,
  b1: number,
  b2: number,
  a1: number,
  a2: number
): number {
  const w = (2 * Math.PI * f) / fs;
  const cosW = Math.cos(w);
  const cos2W = Math.cos(2 * w);
  const sinW = Math.sin(w);
  const sin2W = Math.sin(2 * w);

  const nr = b0 + b1 * cosW + b2 * cos2W;
  const ni = -b1 * sinW - b2 * sin2W;
  const dr = 1 + a1 * cosW + a2 * cos2W;
  const di = -a1 * sinW - a2 * sin2W;

  const magSq = (nr * nr + ni * ni) / (dr * dr + di * di + 1e-15);
  return 10 * Math.log10(magSq);
}

/**
 * Calculates peaking EQ filter response in dB at frequency f
 */
export function getPeakingResponse(
  f: number,
  fs: number,
  f0: number,
  gainDb: number,
  q: number = 1.0
): number {
  if (gainDb === 0) return 0;
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const A = Math.pow(10, gainDb / 40);

  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;

  return getBiquadMagnitudeDb(f, fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

/**
 * Calculates low-shelf filter response in dB at frequency f
 */
export function getLowshelfResponse(
  f: number,
  fs: number,
  f0: number,
  gainDb: number,
  q: number = 0.707
): number {
  if (gainDb === 0) return 0;
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  const sqrtA = Math.sqrt(A);
  const cosW0 = Math.cos(w0);

  const b0 = A * ((A + 1) - (A - 1) * cosW0 + 2 * sqrtA * alpha);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
  const b2 = A * ((A + 1) - (A - 1) * cosW0 - 2 * sqrtA * alpha);
  const a0 = (A + 1) + (A - 1) * cosW0 + 2 * sqrtA * alpha;
  const a1 = -2 * ((A - 1) + (A + 1) * cosW0);
  const a2 = (A + 1) + (A - 1) * cosW0 - 2 * sqrtA * alpha;

  return getBiquadMagnitudeDb(f, fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

/**
 * Calculates high-shelf filter response in dB at frequency f
 */
export function getHighshelfResponse(
  f: number,
  fs: number,
  f0: number,
  gainDb: number,
  q: number = 0.707
): number {
  if (gainDb === 0) return 0;
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  const sqrtA = Math.sqrt(A);
  const cosW0 = Math.cos(w0);

  const b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * sqrtA * alpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
  const b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * sqrtA * alpha);
  const a0 = (A + 1) - (A - 1) * cosW0 + 2 * sqrtA * alpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cosW0);
  const a2 = (A + 1) - (A - 1) * cosW0 - 2 * sqrtA * alpha;

  return getBiquadMagnitudeDb(f, fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

/**
 * Generates an array of curve points across the 20 Hz – 20 kHz audio spectrum
 * given 10-band graphic EQ gains and optional preamp gain.
 */
export function calculateGraphicEqCurve(
  gains: number[] = [],
  preampGainDb: number = 0,
  sampleRate: number = 48000,
  pointCount: number = 100
): CurvePoint[] {
  const minF = 20;
  const maxF = 20000;
  const points: CurvePoint[] = [];
  const logMin = Math.log10(minF);
  const logMax = Math.log10(maxF);

  for (let i = 0; i <= pointCount; i++) {
    const logF = logMin + (i / pointCount) * (logMax - logMin);
    const f = Math.pow(10, logF);

    let totalDb = preampGainDb;
    gains.forEach((gain, index) => {
      if (gain !== 0 && index < GRAPHIC_EQ_FREQUENCIES.length) {
        totalDb += getPeakingResponse(f, sampleRate, GRAPHIC_EQ_FREQUENCIES[index], gain, 1.4);
      }
    });

    points.push({ f, db: totalDb });
  }

  return points;
}

/**
 * Snaps a value to a zero-center magnetic detent if within snapThreshold.
 */
export function snapToDetent(value: number, snapThreshold: number = 0.35, detentValue: number = 0): number {
  if (Math.abs(value - detentValue) <= snapThreshold) {
    return detentValue;
  }
  return value;
}

/**
 * Maps a frequency (20Hz - 20kHz) to an X coordinate (0 to width) on a logarithmic scale.
 */
export function freqToX(freq: number, width: number, minF: number = 20, maxF: number = 20000): number {
  const logMin = Math.log10(minF);
  const logMax = Math.log10(maxF);
  const logVal = Math.log10(Math.max(minF, Math.min(maxF, freq)));
  return ((logVal - logMin) / (logMax - logMin)) * width;
}

/**
 * Maps a dB value (-15dB to +15dB) to a Y coordinate (height to 0) in SVG coordinates.
 */
export function dbToY(db: number, height: number, minDb: number = -15, maxDb: number = 15): number {
  const clamped = Math.max(minDb, Math.min(maxDb, db));
  return height - ((clamped - minDb) / (maxDb - minDb)) * height;
}

/**
 * Generates an SVG path `d` string for a given list of curve points.
 */
export function generateSvgCurvePath(
  points: CurvePoint[],
  width: number,
  height: number,
  minDb: number = -15,
  maxDb: number = 15
): string {
  if (points.length === 0) return '';
  return points.reduce((path, pt, idx) => {
    const x = freqToX(pt.f, width);
    const y = dbToY(pt.db, height, minDb, maxDb);
    return idx === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `${path} L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }, '');
}

/**
 * Formats frequency in human-readable notation (e.g. 31, 1k, 16k)
 */
export function formatFrequency(hz: number): string {
  if (hz >= 1000) {
    const khz = hz / 1000;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)}k`;
  }
  return `${hz}`;
}

/**
 * Helper to parse Jaakko Pasanen AutoEQ ParametricEQ.txt text
 */
export function parseAutoEqProfileText(text: string): { preamp: number; bands: AutoEqParsedBand[] } {
  const lines = text.split('\n');
  let preamp = 0;
  const bands: AutoEqParsedBand[] = [];

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed) continue;

    if (trimmed.includes('preamp:')) {
      const match = trimmed.match(/preamp:\s*(-?[\d.]+)\s*db/);
      if (match) preamp = parseFloat(match[1]);
      continue;
    }

    if (trimmed.includes('filter')) {
      const fcMatch = trimmed.match(/fc\s+([\d.]+)\s*hz/);
      const gainMatch = trimmed.match(/gain\s+(-?[\d.]+)\s*db/);
      const qMatch = trimmed.match(/q\s+([\d.]+)/) || trimmed.match(/s\s+([\d.]+)/);

      let bandType: AutoEqParsedBand['band_type'] = 'peaking';
      if (trimmed.includes('lsc') || trimmed.includes('lowshelf')) {
        bandType = 'lowshelf';
      } else if (trimmed.includes('hsc') || trimmed.includes('highshelf')) {
        bandType = 'highshelf';
      } else if (trimmed.includes('hpf') || trimmed.includes('highpass')) {
        bandType = 'highpass';
      } else if (trimmed.includes('lpf') || trimmed.includes('lowpass')) {
        bandType = 'lowpass';
      } else if (trimmed.includes('notch')) {
        bandType = 'notch';
      }

      if (fcMatch && gainMatch) {
        bands.push({
          freq: Math.max(20, Math.min(20000, parseFloat(fcMatch[1]))),
          gain: Math.max(-24, Math.min(24, parseFloat(gainMatch[1]))),
          q: qMatch ? Math.max(0.1, Math.min(10.0, parseFloat(qMatch[1]))) : 1.0,
          band_type: bandType,
          enabled: true,
        });
      }
    }
  }

  return { preamp, bands };
}
