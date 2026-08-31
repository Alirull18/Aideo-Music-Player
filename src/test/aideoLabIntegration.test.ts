import { describe, it, expect } from 'vitest';
import { parseAutoEqProfileText, snapToDetent } from '../utils/audioMath';
import { EQBand } from '../store/types';

describe('AideoLab AutoEQ and DSP Integration Tests', () => {
  const sampleOratoryProfile = `
Preamp: -6.2 dB
Filter 1: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.71
Filter 2: ON PK Fc 190 Hz Gain -3.2 dB Q 0.60
Filter 3: ON PK Fc 1250 Hz Gain 1.8 dB Q 1.50
Filter 4: ON PK Fc 3150 Hz Gain -2.5 dB Q 2.80
Filter 5: ON PK Fc 5800 Hz Gain -4.0 dB Q 3.50
Filter 6: ON HSC Fc 10000 Hz Gain -1.5 dB Q 0.71
`;

  it('parses preamp gain accurately from AutoEQ text', () => {
    const { preamp } = parseAutoEqProfileText(sampleOratoryProfile);
    expect(preamp).toBe(-6.2);
  });

  it('parses all biquad filter bands with correct frequency, gain, and Q', () => {
    const { bands } = parseAutoEqProfileText(sampleOratoryProfile);
    expect(bands.length).toBe(6);

    expect(bands[0]).toEqual({
      freq: 105,
      gain: 5.5,
      q: 0.71,
      band_type: 'lowshelf',
      enabled: true,
    });

    expect(bands[1]).toEqual({
      freq: 190,
      gain: -3.2,
      q: 0.60,
      band_type: 'peaking',
      enabled: true,
    });

    expect(bands[5]).toEqual({
      freq: 10000,
      gain: -1.5,
      q: 0.71,
      band_type: 'highshelf',
      enabled: true,
    });
  });

  it('clamps extreme frequencies and gains to safe bounds', () => {
    const extremeProfile = `
Preamp: -10.0 dB
Filter 1: ON PK Fc 10 Hz Gain 45.0 dB Q 15.0
Filter 2: ON PK Fc 25000 Hz Gain -40.0 dB Q 0.01
`;
    const { bands } = parseAutoEqProfileText(extremeProfile);
    expect(bands[0].freq).toBe(20);
    expect(bands[0].gain).toBe(24);
    expect(bands[0].q).toBe(10.0);

    expect(bands[1].freq).toBe(20000);
    expect(bands[1].gain).toBe(-24);
    expect(bands[1].q).toBe(0.1);
  });

  it('gracefully handles empty or malformed profile text', () => {
    const result = parseAutoEqProfileText('This is just arbitrary text with no filters');
    expect(result.preamp).toBe(0);
    expect(result.bands).toEqual([]);
  });

  it('maps parsed AutoEQ profile into a 10-band parametric EQ array with neutral fallbacks', () => {
    const { preamp, bands } = parseAutoEqProfileText(sampleOratoryProfile);
    const initialBands: EQBand[] = Array.from({ length: 10 }, () => ({
      freq: 1000,
      gain: 0,
      q: 1.0,
      band_type: 'peaking',
    }));

    const mappedBands: EQBand[] = [];
    for (let i = 0; i < 10; i++) {
      if (bands[i]) {
        mappedBands.push({
          freq: bands[i].freq,
          gain: bands[i].gain,
          q: bands[i].q,
          band_type: bands[i].band_type,
        });
      } else {
        mappedBands.push({
          ...initialBands[i],
          gain: 0,
        });
      }
    }

    expect(mappedBands.length).toBe(10);
    expect(mappedBands[0].gain).toBe(5.5);
    expect(mappedBands[5].gain).toBe(-1.5);
    expect(mappedBands[6].gain).toBe(0); // padded neutral band
    expect(preamp).toBe(-6.2);
  });

  it('supports zero-center magnetic detents for EQ sliders and gain controls', () => {
    expect(snapToDetent(0.2, 0.35, 0)).toBe(0);
    expect(snapToDetent(-0.3, 0.35, 0)).toBe(0);
    expect(snapToDetent(1.5, 0.35, 0)).toBe(1.5);
    expect(snapToDetent(-4.2, 0.35, 0)).toBe(-4.2);
  });
});
