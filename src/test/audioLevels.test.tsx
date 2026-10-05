import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useAudioLevels } from '../utils/useAudioLevels';
import { AudioLevelReadout } from '../components/AudioLevelReadout';

const levels = { peak_dbfs: -6.0206, headroom_db: 6.0206, silent: false };
const flush = () => act(async () => { await Promise.resolve(); });

describe('inspector-only audio levels', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(levels);
  });

  afterEach(async () => {
    cleanup();
    await flush();
    vi.useRealTimers();
  });

  it('does not request measurement with the inspector closed', async () => {
    const { result } = renderHook(() => useAudioLevels(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reads live output while open and disables on close', async () => {
    const { result, rerender } = renderHook(({ open }) => useAudioLevels(open), { initialProps: { open: true } });
    await flush();
    expect(result.current).toEqual(levels);
    rerender({ open: false });
    await flush();
    expect(result.current).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith('get_audio_levels', { enabled: false });
    const calls = vi.mocked(invoke).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(invoke).toHaveBeenCalledTimes(calls);
  });

  it('keeps metering until the last inspector unmounts', async () => {
    const first = renderHook(() => useAudioLevels(true));
    const second = renderHook(() => useAudioLevels(true));
    await flush();
    first.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(second.result.current).toEqual(levels);
    expect(invoke).not.toHaveBeenCalledWith('get_audio_levels', { enabled: false });
    second.unmount();
    await flush();
    expect(invoke).toHaveBeenLastCalledWith('get_audio_levels', { enabled: false });
  });

  it('serializes shutdown after an in-flight opening request', async () => {
    let finish!: (value: typeof levels) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ open }) => useAudioLevels(open), { initialProps: { open: true } });
    await flush();
    rerender({ open: false });
    await act(async () => { finish(levels); });
    await flush();
    expect(result.current).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith('get_audio_levels', { enabled: false });
  });

  it('clears stale readings on IPC failure and retries while open', async () => {
    const { result } = renderHook(() => useAudioLevels(true));
    await flush();
    expect(result.current).toEqual(levels);
    vi.mocked(invoke).mockRejectedValueOnce(new Error('device unavailable'));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(result.current).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(result.current).toEqual(levels);
  });

  it('does not overlap polls or reuse a late reply after reopening', async () => {
    let finish!: (value: typeof levels) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ open }) => useAudioLevels(open), { initialProps: { open: true } });
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(invoke).toHaveBeenCalledTimes(1);
    rerender({ open: false });
    rerender({ open: true });
    const newLevels = { peak_dbfs: -12, headroom_db: 12, silent: false };
    vi.mocked(invoke).mockResolvedValue(newLevels);
    await act(async () => { finish(levels); });
    await flush();
    expect(result.current).toEqual(newLevels);
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_audio_levels', { enabled: false });
    expect(invoke).toHaveBeenNthCalledWith(3, 'get_audio_levels', { enabled: true });
  });

  it('renders measured units, silence, and unavailable samples distinctly', () => {
    const { rerender } = render(<AudioLevelReadout levels={levels} />);
    expect(screen.getByText('-6.0 dBFS')).toBeInTheDocument();
    expect(screen.getByText('6.0 dB')).toBeInTheDocument();
    rerender(<AudioLevelReadout levels={{ peak_dbfs: null, headroom_db: null, silent: true }} />);
    expect(screen.getByText('Silence')).toBeInTheDocument();
    expect(screen.getByText('∞ dB (silence)')).toBeInTheDocument();
    rerender(<AudioLevelReadout levels={null} />);
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
  });

  it('rejects invalid level readings instead of displaying NaN', async () => {
    vi.mocked(invoke).mockResolvedValue({ ...levels, peak_dbfs: NaN });
    const { result } = renderHook(() => useAudioLevels(true));
    await flush();
    expect(result.current).toBeNull();
  });

  it('holds the highest measured peak until Reset peak is pressed', () => {
    const { rerender } = render(<AudioLevelReadout levels={levels} />);
    rerender(<AudioLevelReadout levels={{ peak_dbfs: -12, headroom_db: 12, silent: false }} />);
    expect(screen.getByLabelText('Held sample peak')).toHaveTextContent('-6.0 dBFS');
    expect(screen.getByRole('meter', { name: 'Output sample peak' })).toHaveAttribute('aria-valuenow', '-12');
    fireEvent.click(screen.getByRole('button', { name: 'Reset peak' }));
    expect(screen.getByLabelText('Held sample peak')).toHaveTextContent('-12.0 dBFS');
    rerender(<AudioLevelReadout levels={{ peak_dbfs: -3, headroom_db: 3, silent: false }} />);
    expect(screen.getByLabelText('Held sample peak')).toHaveTextContent('-3.0 dBFS');
    expect(screen.getByText('Low headroom')).toBeInTheDocument();
  });

  it('bounds the visual meter without hiding over-full-scale measurements', () => {
    render(<AudioLevelReadout levels={{ peak_dbfs: 6, headroom_db: -6, silent: false }} />);
    expect(screen.getByRole('meter', { name: 'Output sample peak' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('6.0 dBFS')).toBeInTheDocument();
    expect(screen.getByText('Above full scale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset peak' })).toBeEnabled();
  });

  it('offers accessible explanations and disables reset before any samples arrive', () => {
    render(<AudioLevelReadout levels={null} />);
    expect(screen.getByRole('button', { name: 'Reset peak' })).toBeDisabled();
    const explanation = screen.getByText('About these readings').closest('details');
    expect(explanation).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('About these readings'));
    expect(explanation).toHaveAttribute('open');
    expect(screen.getByText(/Sample peak does not detect/i)).toBeInTheDocument();
  });
});
