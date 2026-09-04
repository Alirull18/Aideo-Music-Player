import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '../store';
import { FullscreenView } from '../components/FullscreenView';
import { TheaterHudStyle } from '../store/types';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: vi.fn().mockResolvedValue(false),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
  }),
}));

beforeEach(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;

  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    roundRect: vi.fn(),
    createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  }) as any;

  localStorage.clear();
});

describe('Theater HUD Styles (Store & UI Integration)', () => {
  beforeEach(() => {
    useStore.setState({
      theaterHudStyle: 'capsule',
      currentTrack: {
        id: 1,
        path: '/music/test-track.flac',
        title: 'Master Audio Track',
        artist: 'Hi-Fi Master',
        album: 'Studio Sessions',
        duration: 240,
        format: 'FLAC',
        lyric_offset: 0,
        loved: 0,
      },
      playback: {
        current_track: '/music/test-track.flac',
        status: 'Playing',
        position_secs: 45,
        volume: 0.85,
        bit_perfect: true,
        dev_rate: 96000,
        is_buffering: false,
        driver_type: 'WASAPI',
        exclusive: true,
        effective_audio_path: null,
      },
      theaterModeDesign: 'stage',
      view: 'fullscreen',
    });
  });

  it('initializes with default style "capsule" and persists updates to localStorage', () => {
    expect(useStore.getState().theaterHudStyle).toBe('capsule');

    const styles: TheaterHudStyle[] = ['capsule', 'master', 'minimal', 'analog'];
    for (const style of styles) {
      useStore.getState().setTheaterHudStyle(style);
      expect(useStore.getState().theaterHudStyle).toBe(style);
      expect(localStorage.getItem('aideo-theater-hud-style')).toBe(style);
    }
  });

  it('renders the corresponding CSS class on .fullscreen-hud for each archetype', () => {
    const { container, rerender } = render(<FullscreenView />);

    // 1. Capsule
    useStore.setState({ theaterHudStyle: 'capsule' });
    rerender(<FullscreenView />);
    const hud = container.querySelector('.fullscreen-hud');
    expect(hud).toHaveClass('hud-capsule');

    // 2. Master
    useStore.setState({ theaterHudStyle: 'master' });
    rerender(<FullscreenView />);
    expect(container.querySelector('.fullscreen-hud')).toHaveClass('hud-master');
    // Master includes hardware screw accents and LED meter
    expect(container.querySelector('.hud-master-screw')).toBeInTheDocument();
    expect(container.querySelector('.hud-master-led-meter')).toBeInTheDocument();

    // 3. Minimal
    useStore.setState({ theaterHudStyle: 'minimal' });
    rerender(<FullscreenView />);
    expect(container.querySelector('.fullscreen-hud')).toHaveClass('hud-minimal');

    // 4. Analog
    useStore.setState({ theaterHudStyle: 'analog' });
    rerender(<FullscreenView />);
    expect(container.querySelector('.fullscreen-hud')).toHaveClass('hud-analog');
    // Analog includes tube stage badge
    expect(container.querySelector('.hud-analog-tube-badge')).toBeInTheDocument();
  });

  it('cycles HUD styles when clicking the top-bar HUD style button', () => {
    render(<FullscreenView />);

    const hudBtn = screen.getByTitle(/HUD: Floating Capsule/i);
    expect(hudBtn).toBeInTheDocument();

    fireEvent.click(hudBtn);
    expect(useStore.getState().theaterHudStyle).toBe('master');

    fireEvent.click(screen.getByTitle(/HUD: Master Deck/i));
    expect(useStore.getState().theaterHudStyle).toBe('minimal');

    fireEvent.click(screen.getByTitle(/HUD: Zen Minimal/i));
    expect(useStore.getState().theaterHudStyle).toBe('analog');

    fireEvent.click(screen.getByTitle(/HUD: Vintage Analog/i));
    expect(useStore.getState().theaterHudStyle).toBe('capsule');
  });

  it('cycles HUD styles via keyboard shortcut "h"', () => {
    render(<FullscreenView />);
    expect(useStore.getState().theaterHudStyle).toBe('capsule');

    fireEvent.keyDown(window, { key: 'h' });
    expect(useStore.getState().theaterHudStyle).toBe('master');

    fireEvent.keyDown(window, { key: 'h' });
    expect(useStore.getState().theaterHudStyle).toBe('minimal');

    fireEvent.keyDown(window, { key: 'h' });
    expect(useStore.getState().theaterHudStyle).toBe('analog');

    fireEvent.keyDown(window, { key: 'h' });
    expect(useStore.getState().theaterHudStyle).toBe('capsule');
  });

  it('preserves rock-solid left, center, and right HUD clusters across all HUD styles without layout shifts or missing controls', () => {
    const { container, rerender } = render(<FullscreenView />);

    const styles: TheaterHudStyle[] = ['capsule', 'master', 'minimal', 'analog'];
    for (const style of styles) {
      useStore.setState({ theaterHudStyle: style });
      rerender(<FullscreenView />);

      const controls = container.querySelector('.fullscreen-hud-controls');
      expect(controls).toBeInTheDocument();

      const left = controls?.querySelector('.fullscreen-hud-left');
      const center = controls?.querySelector('.fullscreen-hud-center');
      const right = controls?.querySelector('.fullscreen-hud-right');

      expect(left).toBeInTheDocument();
      expect(center).toBeInTheDocument();
      expect(right).toBeInTheDocument();

      // Left cluster contents
      expect(left?.querySelector('.fullscreen-telemetry-btn')).toBeInTheDocument();
      expect(left?.querySelector('.fullscreen-love-btn')).toBeInTheDocument();

      // Center cluster contents (6 transport buttons)
      const centerButtons = center?.querySelectorAll('button');
      expect(centerButtons).toHaveLength(6);

      // Right cluster contents (8 utility items: 7 buttons + volume slider)
      expect(right?.querySelector('.fullscreen-hud-volume-wrap')).toBeInTheDocument();
      expect(right?.querySelector('.fullscreen-hud-volume-slider')).toBeInTheDocument();
      expect(right?.querySelector('button[title*="Display Mode"]')).toBeInTheDocument();
      expect(right?.querySelector('button[title*="Romaji"]')).toBeInTheDocument();
      expect(right?.querySelector('button[title*="Translation"], button[title*="Translate"]')).toBeInTheDocument();
      expect(right?.querySelector('button[title*="Visualizer Mode"]')).toBeInTheDocument();
      expect(right?.querySelector('button[title*="Visualizer Aura"]')).toBeInTheDocument();
      expect(right?.querySelector('button[title*="Queue"]')).toBeInTheDocument();
      expect(right?.querySelector('button[title*="Fullscreen"]')).toBeInTheDocument();
    }
  });
});
