import { describe, it, expect, beforeEach } from 'vitest';
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
    pendingSettingsTab: null,
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

describe('Settings navigation and playback speed', () => {
  it('consumes the pending Library request and permits subsequent tab selection', () => {
    useStore.setState({ pendingSettingsTab: 'library' });
    const settings = render(<SettingsView />);
    expect(screen.getByRole('button', { name: 'Library' })).toHaveClass('active');
    expect(useStore.getState().pendingSettingsTab).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    settings.rerender(<SettingsView />);
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveClass('active');
  });

  it('disables speed controls in Bit-Perfect mode and enables them when it is off', () => {
    const original = useStore.getState();
    useStore.setState({ showControlCenter: true, playback: { ...original.playback, bit_perfect: true } });
    try {
      render(<AudioControlCenter />);
      fireEvent.click(screen.getByRole('button', { name: 'Telemetry & Utilities' }));
      expect(screen.getByRole('slider', { name: 'Playback speed' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '1.25x' })).toBeDisabled();

      act(() => useStore.setState({ playback: { ...useStore.getState().playback, bit_perfect: false } }));
      expect(screen.getByRole('slider', { name: 'Playback speed' })).toBeEnabled();
      expect(screen.getByRole('button', { name: '1.25x' })).toBeEnabled();
    } finally {
      useStore.setState({ showControlCenter: original.showControlCenter, playback: original.playback });
    }
  });
});
