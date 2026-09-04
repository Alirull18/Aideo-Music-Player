import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TheaterSignalPathModal } from '../components/theater/TheaterSignalPathModal';
import { useStore } from '../store';
import type { EffectiveAudioPath } from '../store/types';

describe('TheaterSignalPathModal', () => {
  const mockEffectivePath: EffectiveAudioPath = {
    active: true,
    engine: 'wasapi',
    share_mode: 'exclusive',
    source: {
      sample_rate: 96000,
      channels: 2,
      sample_format: 'pcm_s24',
      bits_per_sample: 24,
      valid_bits_per_sample: 24,
      channel_mask: 3,
    },
    pipeline_sample_format: 'pcm_s24',
    output: {
      sample_rate: 96000,
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
  };

  beforeEach(() => {
    useStore.setState({
      currentTrack: {
        id: 1,
        path: 'C:/music/test.flac',
        title: 'Audiophile Master Track',
        artist: 'Test Artist',
        album: 'Test Album',
        duration: 300,
        format: 'FLAC 96kHz 24-bit',
        lyric_offset: 0,
      },
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: 'C:/music/test.flac',
        exclusive: true,
        bit_perfect: true,
        dev_rate: 96000,
        driver_type: 'WASAPI',
        effective_audio_path: mockEffectivePath,
      },
      currentDevice: 'Topping DX3 Pro+ DAC',
      dsp: {
        ...useStore.getState().dsp,
        eq_enabled: false,
        auto_headroom: true,
        r128_enabled: false,
        upsample_rate: 0,
      },
    });
  });

  it('renders signal path stages when open', () => {
    render(<TheaterSignalPathModal isOpen={true} onClose={vi.fn()} spectrumBands={[0.5, 0.6, 0.7]} />);

    expect(screen.getByText(/Signal Path/i)).toBeInTheDocument();
    expect(screen.getByText('FLAC 96kHz 24-bit')).toBeInTheDocument();
    expect(screen.getByText(/Topping DX3 Pro\+ DAC/i)).toBeInTheDocument();
    expect(screen.getByText(/WASAPI Exclusive/i)).toBeInTheDocument();
    expect(screen.getByText(/BIT-PERFECT/i)).toBeInTheDocument();
  });

  it('shows active DSP transforms when not bit-perfect', () => {
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        effective_audio_path: {
          ...mockEffectivePath,
          strict_bit_perfect: false,
          active_transforms: ['10-Band EQ', 'Auto Headroom (-3dB)'],
        },
      },
      dsp: {
        ...useStore.getState().dsp,
        eq_enabled: true,
        auto_headroom: true,
      },
    });

    render(<TheaterSignalPathModal isOpen={true} onClose={vi.fn()} spectrumBands={[]} />);

    expect(screen.getByText(/10-Band EQ/i)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onCloseSpy = vi.fn();
    render(<TheaterSignalPathModal isOpen={true} onClose={onCloseSpy} spectrumBands={[]} />);

    const closeBtn = screen.getByLabelText(/Close signal path/i);
    fireEvent.click(closeBtn);

    expect(onCloseSpy).toHaveBeenCalled();
  });
});
