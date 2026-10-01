import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useStore } from '../store';
import { SettingsView } from '../components/SettingsView';
import { AudioControlCenter } from '../components/AudioControlCenter';

beforeEach(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;

  useStore.setState({
    visualizerMode: 'bars',
    visualizerDecayRate: 'balanced',
    visualizerExpanded: false,
  });
});

describe('SettingsView Audio Spectrum Visualizer Card', () => {

  it('updates visualizerMode in store when clicking a style chip', () => {
    render(<SettingsView />);

    expect(useStore.getState().visualizerMode).toBe('bars');

    const waveChip = screen.getByRole('button', { name: 'Wave' });
    act(() => {
      fireEvent.click(waveChip);
    });

    expect(useStore.getState().visualizerMode).toBe('wave');

    const dotsChip = screen.getByRole('button', { name: 'Dots' });
    act(() => {
      fireEvent.click(dotsChip);
    });

    expect(useStore.getState().visualizerMode).toBe('dots');
  });

  it('updates visualizerDecayRate in store when clicking a decay profile pill', () => {
    render(<SettingsView />);

    expect(useStore.getState().visualizerDecayRate).toBe('balanced');

    const silkyBtn = screen.getByRole('button', { name: 'Slow' });
    act(() => {
      fireEvent.click(silkyBtn);
    });

    expect(useStore.getState().visualizerDecayRate).toBe('silky');

    const snappyBtn = screen.getByRole('button', { name: 'Fast' });
    act(() => {
      fireEvent.click(snappyBtn);
    });

    expect(useStore.getState().visualizerDecayRate).toBe('snappy');
  });

  it('updates visualizerExpanded in store when toggling the canvas switch', () => {
    render(<SettingsView />);

    expect(useStore.getState().visualizerExpanded).toBe(false);

    const canvasLabel = screen.getByText('Expanded Now Playing Canvas');
    const switchEl = canvasLabel.parentElement?.nextElementSibling as HTMLElement;
    expect(switchEl).toBeInTheDocument();

    act(() => {
      fireEvent.click(switchEl!);
    });

    expect(useStore.getState().visualizerExpanded).toBe(true);

    act(() => {
      fireEvent.click(switchEl!);
    });

    expect(useStore.getState().visualizerExpanded).toBe(false);
  });
});

describe('SettingsView audio output request', () => {
  it('delegates upsample mode transition to setDSP without a second bit-perfect toggle', async () => {
    const originalSetDSP = useStore.getState().setDSP;
    const originalToggleBitPerfect = useStore.getState().toggleBitPerfect;
    const setDSP = vi.fn();
    const toggleBitPerfect = vi.fn();
    useStore.setState({
      setDSP,
      toggleBitPerfect,
      playback: { ...useStore.getState().playback, bit_perfect: true },
    });

    try {
      render(<SettingsView />);
      fireEvent.click(screen.getByRole('button', { name: 'Audio Engine' }));
      fireEvent.click(await screen.findByRole('button', { name: '96kHz' }));

      expect(setDSP).toHaveBeenCalledWith({ upsample_rate: 96000 });
      expect(toggleBitPerfect).not.toHaveBeenCalled();
    } finally {
      useStore.setState({ setDSP: originalSetDSP, toggleBitPerfect: originalToggleBitPerfect });
    }
  });
});

describe('AudioControlCenter output request', () => {
  it('delegates upsample mode transition to setDSP without toggling bit-perfect again', () => {
    const original = useStore.getState();
    const setDSP = vi.fn();
    const toggleBitPerfect = vi.fn();
    useStore.setState({
      showControlCenter: true,
      devices: ['[System Default Device]'],
      setDSP,
      toggleBitPerfect,
      playback: { ...original.playback, bit_perfect: true },
    });

    try {
      render(<AudioControlCenter />);
      fireEvent.click(screen.getByRole('button', { name: 'Hardware & Pipeline' }));
      fireEvent.click(screen.getByRole('button', { name: '96k' }));

      expect(setDSP).toHaveBeenCalledWith({ upsample_rate: 96000 });
      expect(toggleBitPerfect).not.toHaveBeenCalled();
    } finally {
      useStore.setState({ showControlCenter: original.showControlCenter, devices: original.devices, setDSP: original.setDSP, toggleBitPerfect: original.toggleBitPerfect });
    }
  });
});
