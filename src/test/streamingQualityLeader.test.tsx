import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StreamingQualityControl } from '../components/SettingsView';

describe('StreamingQualityControl Leader Component', () => {
  const defaultProps = {
    streamingQuality: 'best_available' as const,
    setStreamingQuality: vi.fn(),
    preferredSource: 'auto' as const,
    setPreferredSource: vi.fn(),
    tidalConnected: false,
    qobuzConnected: false,
    qobuzExperimentalEnabled: false,
  };

  it('renders active preset as leader for Best Available', () => {
    render(<StreamingQualityControl {...defaultProps} />);

    expect(screen.getByText('Best Available')).toBeInTheDocument();
    expect(screen.getByText('Up to 24-bit / 192 kHz')).toBeInTheDocument();
    expect(screen.getByText('Preset 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();

    const upButton = screen.getByRole('button', { name: /increase streaming quality/i });
    expect(upButton).toBeDisabled();
    expect(screen.getByText('Highest Quality Reached')).toBeInTheDocument();

    const downButton = screen.getByRole('button', { name: /decrease streaming quality/i });
    expect(downButton).not.toBeDisabled();
    expect(screen.getByText('Lower Quality (Standard Lossless)')).toBeInTheDocument();
  });

  it('navigates down from Best Available to Standard Lossless on down button click', () => {
    const setStreamingQuality = vi.fn();
    const setPreferredSource = vi.fn();

    render(
      <StreamingQualityControl
        {...defaultProps}
        setStreamingQuality={setStreamingQuality}
        setPreferredSource={setPreferredSource}
      />
    );

    const downButton = screen.getByRole('button', { name: /decrease streaming quality/i });
    fireEvent.click(downButton);

    expect(setStreamingQuality).toHaveBeenCalledWith('standard_lossless');
    expect(setPreferredSource).toHaveBeenCalledWith('auto');
  });

  it('navigates down from Standard Lossless to Data Saver setting YouTube as default source', () => {
    const setStreamingQuality = vi.fn();
    const setPreferredSource = vi.fn();

    render(
      <StreamingQualityControl
        {...defaultProps}
        streamingQuality="standard_lossless"
        setStreamingQuality={setStreamingQuality}
        setPreferredSource={setPreferredSource}
      />
    );

    expect(screen.getByText('Standard Lossless')).toBeInTheDocument();
    expect(screen.getByText('16-bit / 44.1 kHz FLAC')).toBeInTheDocument();
    expect(screen.getByText('Preset 2 of 3')).toBeInTheDocument();

    const downButton = screen.getByRole('button', { name: /decrease streaming quality/i });
    fireEvent.click(downButton);

    expect(setStreamingQuality).toHaveBeenCalledWith('data_saver');
    expect(setPreferredSource).toHaveBeenCalledWith('youtube');
  });

  it('disables down button at lowest tier Data Saver and allows navigating up', () => {
    const setStreamingQuality = vi.fn();
    const setPreferredSource = vi.fn();

    render(
      <StreamingQualityControl
        {...defaultProps}
        streamingQuality="data_saver"
        preferredSource="youtube"
        setStreamingQuality={setStreamingQuality}
        setPreferredSource={setPreferredSource}
      />
    );

    expect(screen.getByText('Data Saver')).toBeInTheDocument();
    expect(screen.getByText('Compressed Stream')).toBeInTheDocument();
    expect(screen.getByText('Preset 3 of 3')).toBeInTheDocument();

    const downButton = screen.getByRole('button', { name: /decrease streaming quality/i });
    expect(downButton).toBeDisabled();
    expect(screen.getByText('Lowest Quality Reached')).toBeInTheDocument();

    const upButton = screen.getByRole('button', { name: /increase streaming quality/i });
    expect(upButton).not.toBeDisabled();
    expect(screen.getByText('Higher Quality (Standard Lossless)')).toBeInTheDocument();

    fireEvent.click(upButton);
    expect(setStreamingQuality).toHaveBeenCalledWith('standard_lossless');
    expect(setPreferredSource).toHaveBeenCalledWith('auto');
  });

  it('enters Custom Override mode when preferred source deviates from preset default', () => {
    const setStreamingQuality = vi.fn();
    const setPreferredSource = vi.fn();

    render(
      <StreamingQualityControl
        {...defaultProps}
        streamingQuality="best_available"
        preferredSource="tidal"
        setStreamingQuality={setStreamingQuality}
        setPreferredSource={setPreferredSource}
      />
    );

    expect(screen.getByText('Custom Override')).toBeInTheDocument();
    expect(screen.getByText('Custom Quality')).toBeInTheDocument();
    expect(screen.getByText('Base: Best Available')).toBeInTheDocument();

    // In custom mode at index 0, Up button snaps back to preset default
    const upButton = screen.getByRole('button', { name: /increase streaming quality/i });
    expect(upButton).not.toBeDisabled();
    expect(screen.getByText('Reset to Best Available')).toBeInTheDocument();

    fireEvent.click(upButton);
    expect(setStreamingQuality).toHaveBeenCalledWith('best_available');
    expect(setPreferredSource).toHaveBeenCalledWith('auto');
  });

  it('allows clicking step dots to jump directly to any tier with its default source', () => {
    const setStreamingQuality = vi.fn();
    const setPreferredSource = vi.fn();

    render(
      <StreamingQualityControl
        {...defaultProps}
        setStreamingQuality={setStreamingQuality}
        setPreferredSource={setPreferredSource}
      />
    );

    const step3 = screen.getByRole('button', { name: /select data saver/i });
    fireEvent.click(step3);

    expect(setStreamingQuality).toHaveBeenCalledWith('data_saver');
    expect(setPreferredSource).toHaveBeenCalledWith('youtube');
  });

  it('triggers setPreferredSource when the dropdown value changes', () => {
    const setPreferredSource = vi.fn();

    render(
      <StreamingQualityControl
        {...defaultProps}
        setPreferredSource={setPreferredSource}
      />
    );

    const select = screen.getByLabelText(/preferred source when quality is equal/i);
    fireEvent.change(select, { target: { value: 'local' } });

    expect(setPreferredSource).toHaveBeenCalledWith('local');
  });
});
