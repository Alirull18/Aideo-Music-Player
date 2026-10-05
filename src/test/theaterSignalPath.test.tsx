import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
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
    render(<TheaterSignalPathModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Signal Path/i)).toBeInTheDocument();
    expect(screen.getByText('FLAC 96kHz 24-bit')).toBeInTheDocument();
    expect(screen.getByText(/Topping DX3 Pro\+ DAC/i)).toBeInTheDocument();
    expect(screen.getByText(/WASAPI \/ BIT-PERFECT/i)).toBeInTheDocument();
    expect(screen.getByText('BIT-PERFECT PASSTHROUGH')).toBeInTheDocument();
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

    render(<TheaterSignalPathModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/10-Band EQ/i)).toBeInTheDocument();
  });

  it('does not infer transforms or strict output from requested settings', () => {
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        bit_perfect: true,
        effective_audio_path: {
          ...mockEffectivePath,
          strict_bit_perfect: false,
          active_transforms: [],
        },
      },
      dsp: {
        ...useStore.getState().dsp,
        eq_enabled: true,
        auto_headroom: true,
      },
    });

    render(<TheaterSignalPathModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('No active transforms')).toBeInTheDocument();
    expect(screen.queryByText('10-Band Graphic EQ')).not.toBeInTheDocument();
    expect(screen.queryByText('BIT-PERFECT PASSTHROUGH')).not.toBeInTheDocument();
  });

  it('does not present inactive path details as measured output', () => {
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        bit_perfect: true,
        effective_audio_path: { ...mockEffectivePath, active: false },
      },
    });

    render(<TheaterSignalPathModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Audio path pending')).toBeInTheDocument();
    expect(screen.getByText(/Unknown rate · Unknown depth · Unknown channels/)).toBeInTheDocument();
    expect(screen.getByText('Underruns unknown')).toBeInTheDocument();
    expect(screen.queryByText('BIT-PERFECT PASSTHROUGH')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onCloseSpy = vi.fn();
    render(<TheaterSignalPathModal isOpen={true} onClose={onCloseSpy} />);

    const closeBtn = screen.getByLabelText(/Close signal path/i);
    fireEvent.click(closeBtn);

    expect(onCloseSpy).toHaveBeenCalled();
  });

  it('requests live measurements only while the signal inspector is open', async () => {
    let measuring = false;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command !== 'get_audio_levels') return null;
      measuring = (args as { enabled: boolean }).enabled;
      return measuring ? { peak_dbfs: -12, headroom_db: 12, silent: false } : null;
    });
    const { rerender } = render(<TheaterSignalPathModal isOpen={false} onClose={vi.fn()} />);
    expect(measuring).toBe(false);
    rerender(<TheaterSignalPathModal isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('-12.0 dBFS')).toBeInTheDocument());
    expect(screen.getByText('12.0 dB')).toBeInTheDocument();
    expect(measuring).toBe(true);
    rerender(<TheaterSignalPathModal isOpen={false} onClose={vi.fn()} />);
    await waitFor(() => expect(measuring).toBe(false));
    vi.mocked(invoke).mockResolvedValue(null);
  });
});
