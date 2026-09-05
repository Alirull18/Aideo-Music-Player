import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useStore } from '../store';
import { SettingsView } from '../components/SettingsView';

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
  it('renders the Audio Spectrum Visualizer card in Settings under appearance tab', () => {
    render(<SettingsView />);

    expect(screen.getByText('Audio Spectrum Visualizer')).toBeInTheDocument();
    expect(
      screen.getByText('Customize visualizer rendering styles, decay kinetics, and display height in the player.')
    ).toBeInTheDocument();

    // Check style chips
    expect(screen.getByRole('button', { name: 'Studio Bars' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bilateral Mirror' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Silk Wave' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Radial Halo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dot Matrix' })).toBeInTheDocument();

    // Check decay buttons
    expect(screen.getByRole('button', { name: 'Snappy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Balanced' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Silky' })).toBeInTheDocument();

    // Check expanded toggle description
    expect(screen.getByText('Expanded Now Playing Canvas')).toBeInTheDocument();
  });

  it('updates visualizerMode in store when clicking a style chip', () => {
    render(<SettingsView />);

    expect(useStore.getState().visualizerMode).toBe('bars');

    const waveChip = screen.getByRole('button', { name: 'Silk Wave' });
    act(() => {
      fireEvent.click(waveChip);
    });

    expect(useStore.getState().visualizerMode).toBe('wave');

    const dotsChip = screen.getByRole('button', { name: 'Dot Matrix' });
    act(() => {
      fireEvent.click(dotsChip);
    });

    expect(useStore.getState().visualizerMode).toBe('dots');
  });

  it('updates visualizerDecayRate in store when clicking a decay profile pill', () => {
    render(<SettingsView />);

    expect(useStore.getState().visualizerDecayRate).toBe('balanced');

    const silkyBtn = screen.getByRole('button', { name: 'Silky' });
    act(() => {
      fireEvent.click(silkyBtn);
    });

    expect(useStore.getState().visualizerDecayRate).toBe('silky');

    const snappyBtn = screen.getByRole('button', { name: 'Snappy' });
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
