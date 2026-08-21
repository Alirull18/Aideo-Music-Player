import { describe, it, expect } from 'vitest';
import { generateWaveformPeaks } from '../utils/waveform';

describe('Waveform Seekbar Generator', () => {
  it('generates specified number of peaks', () => {
    const peaks = generateWaveformPeaks('test-song.mp3', 50);
    assert_eq_len: expect(peaks.length).toBe(50);
  });

  it('all peaks are bounded between 0.15 and 1.0', () => {
    const peaks = generateWaveformPeaks('path/to/music.flac', 60);
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0.15);
      expect(p).toBeLessThanOrEqual(1.0);
    }
  });

  it('generates consistent peaks for the same track seed', () => {
    const p1 = generateWaveformPeaks('Bohemian Rhapsody', 40);
    const p2 = generateWaveformPeaks('Bohemian Rhapsody', 40);
    expect(p1).toEqual(p2);
  });

  it('generates different peaks for different track seeds', () => {
    const p1 = generateWaveformPeaks('Song A', 40);
    const p2 = generateWaveformPeaks('Song B', 40);
    expect(p1).not.toEqual(p2);
  });
});
