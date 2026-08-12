import { describe, it, expect } from 'vitest';

interface CrossfadeConfig {
  enabled: boolean;
  duration: number;
}

function clampCrossfadeDuration(val: number): number {
  return Math.min(10.0, Math.max(0.0, Math.round(val * 10) / 10));
}

function applyCrossfadePreset(
  _current: CrossfadeConfig,
  preset: { label: string; val: number; enable: boolean }
): CrossfadeConfig {
  return {
    enabled: preset.enable,
    duration: clampCrossfadeDuration(preset.val),
  };
}

function getCrossfadeLabel(duration: number, enabled: boolean): string {
  if (!enabled || duration === 0) return 'Pure Gapless Cut';
  if (duration <= 3.0) return 'Radio Blend';
  if (duration <= 6.0) return 'DJ Crossfade';
  return 'Club Ambient Morph';
}

describe('Configurable Audio Crossfade & Gapless Transition Engine', () => {
  it('should clamp crossfade duration between 0.0s and 10.0s', () => {
    expect(clampCrossfadeDuration(-2.5)).toBe(0.0);
    expect(clampCrossfadeDuration(0.0)).toBe(0.0);
    expect(clampCrossfadeDuration(4.5)).toBe(4.5);
    expect(clampCrossfadeDuration(10.0)).toBe(10.0);
    expect(clampCrossfadeDuration(15.2)).toBe(10.0);
  });

  it('should apply preset chips correctly', () => {
    const initial: CrossfadeConfig = { enabled: false, duration: 0 };

    const preset25 = applyCrossfadePreset(initial, { label: '2.5s', val: 2.5, enable: true });
    expect(preset25.enabled).toBe(true);
    expect(preset25.duration).toBe(2.5);

    const presetOff = applyCrossfadePreset(preset25, { label: 'Off', val: 0, enable: false });
    expect(presetOff.enabled).toBe(false);
    expect(presetOff.duration).toBe(0.0);
  });

  it('should return descriptive transition labels based on duration', () => {
    expect(getCrossfadeLabel(0, false)).toBe('Pure Gapless Cut');
    expect(getCrossfadeLabel(0, true)).toBe('Pure Gapless Cut');
    expect(getCrossfadeLabel(2.5, true)).toBe('Radio Blend');
    expect(getCrossfadeLabel(5.0, true)).toBe('DJ Crossfade');
    expect(getCrossfadeLabel(8.5, true)).toBe('Club Ambient Morph');
  });
});
