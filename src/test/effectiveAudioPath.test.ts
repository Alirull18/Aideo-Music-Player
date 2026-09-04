import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayerBar } from '../components/PlayerBar';
import { useStore } from '../store';
import type { EffectiveAudioPath, PlaybackState } from '../store/types';
import { getAudioPathPresentation } from '../utils/audioPath';

const effectivePath = (overrides: Partial<EffectiveAudioPath> = {}): EffectiveAudioPath => ({
  active: true,
  engine: 'wasapi',
  share_mode: 'exclusive',
  source: {
    sample_rate: 96_000,
    channels: 2,
    sample_format: 'pcm_s24',
    bits_per_sample: 24,
    valid_bits_per_sample: 24,
    channel_mask: 3,
  },
  pipeline_sample_format: 'pcm_s24',
  output: {
    sample_rate: 96_000,
    channels: 2,
    sample_format: 'pcm_s24',
    bits_per_sample: 24,
    valid_bits_per_sample: 24,
    channel_mask: 3,
  },
  requested_exclusive: true,
  requested_bit_perfect: true,
  resampling: false,
  volume_applied: false,
  active_transforms: [],
  underruns: 0,
  strict_bit_perfect: true,
  strict_failure_reasons: [],
  fallback_reason: null,
  ...overrides,
});

const playback = (path: EffectiveAudioPath | null): PlaybackState => ({
  status: 'Playing',
  current_track: 'C:\\Music\\track.flac',
  position_secs: 1,
  volume: 1,
  exclusive: true,
  bit_perfect: true,
  dev_rate: 96_000,
  driver_type: 'WASAPI',
  effective_audio_path: path,
});

describe('effective audio path presentation', () => {
  afterEach(cleanup);

  it('shows bit-perfect only when the backend verifies the effective path', () => {
    const result = getAudioPathPresentation(playback(effectivePath()));

    expect(result.badge).toEqual({ label: 'BIT-PERFECT · 96kHz', kind: 'bit-perfect' });
    expect(result.hudLabel).toBe('WASAPI / BIT-PERFECT');
  });

  it('does not trust the requested bit-perfect flag after a shared fallback', () => {
    const result = getAudioPathPresentation(playback(effectivePath({
      engine: 'cpal',
      share_mode: 'shared',
      strict_bit_perfect: false,
      strict_failure_reasons: ['shared_output'],
      fallback_reason: 'wasapi_exclusive_unavailable',
    })));

    expect(result.badge).toBeNull();
    expect(result.hudLabel).toBe('SHARED ENGINE');
  });

  it('shows exclusive from the negotiated route even when bit-perfect is unverified', () => {
    const result = getAudioPathPresentation(playback(effectivePath({
      strict_bit_perfect: false,
      strict_failure_reasons: ['gain_ramp_active'],
      active_transforms: ['gain_ramp'],
    })));

    expect(result.badge).toEqual({ label: 'WASAPI EXCLUSIVE', kind: 'exclusive' });
    expect(result.hudLabel).toBe('WASAPI EXCLUSIVE');
  });

  it('stays pending until the backend reports a negotiated stream', () => {
    const result = getAudioPathPresentation(playback(null));

    expect(result.badge).toBeNull();
    expect(result.hudLabel).toBe('AUDIO PATH PENDING');
  });

  it('keeps the player bar bit-perfect badge hidden until verification succeeds', () => {
    const unverifiedPath = effectivePath({
      strict_bit_perfect: false,
      strict_failure_reasons: ['gain_ramp_active'],
      active_transforms: ['gain_ramp'],
    });
    act(() => {
      useStore.setState((state) => ({
        playback: { ...state.playback, ...playback(unverifiedPath) },
        playerBarDesign: 'classic',
      }));
    });

    const view = render(createElement(PlayerBar));
    expect(screen.queryByText(/^BIT-PERFECT/)).not.toBeInTheDocument();
    expect(screen.getByText('WASAPI EXCLUSIVE')).toBeInTheDocument();

    act(() => {
      useStore.setState((state) => ({
        playback: { ...state.playback, effective_audio_path: effectivePath() },
      }));
    });
    view.rerender(createElement(PlayerBar));

    expect(screen.getByText('BIT-PERFECT · 96kHz')).toBeInTheDocument();
  });

  it('keeps vinyl LED indicators unlit when bit-perfect or exclusive are not verified', () => {
    const unverifiedPath = effectivePath({
      engine: 'cpal',
      share_mode: 'shared',
      strict_bit_perfect: false,
      strict_failure_reasons: ['shared_output'],
      fallback_reason: 'wasapi_exclusive_unavailable',
    });

    act(() => {
      useStore.setState((state) => ({
        playback: { ...state.playback, ...playback(unverifiedPath) },
        playerBarDesign: 'vinyl',
      }));
    });

    const view = render(createElement(PlayerBar));
    const bitPerfectLabel = screen.getByText('BIT-PERFECT');
    const exclusiveLabel = screen.getByText('EXCLUSIVE');

    expect(bitPerfectLabel.parentElement).not.toHaveClass('lit-cyan');
    expect(exclusiveLabel.parentElement).not.toHaveClass('lit-emerald');

    act(() => {
      useStore.setState((state) => ({
        playback: { ...state.playback, effective_audio_path: effectivePath() },
      }));
    });
    view.rerender(createElement(PlayerBar));

    expect(bitPerfectLabel.parentElement).toHaveClass('lit-cyan');
    expect(exclusiveLabel.parentElement).toHaveClass('lit-emerald');
  });
});
