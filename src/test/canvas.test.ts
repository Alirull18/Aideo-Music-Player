import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '../store';
import { NowPlayingView } from '../components/NowPlayingView';
import type { CanvasResult } from '../store/types';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: vi.fn().mockResolvedValue(false),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

beforeEach(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
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
    createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  }) as any;
});

describe('Animated Video Canvas (Motion Artwork) Store & Cycling', () => {
  beforeEach(() => {
    useStore.setState({
      canvasEnabled: true,
      canvasMode: 'both',
      canvasAllowOnline: true,
      currentCanvas: null,
    });
  });

  it('has correct default canvas settings', () => {
    const state = useStore.getState();
    expect(state.canvasEnabled).toBe(true);
    expect(state.canvasMode).toBe('both');
    expect(state.canvasAllowOnline).toBe(true);
    expect(state.currentCanvas).toBeNull();
  });

  it('toggles canvasEnabled state', () => {
    const { toggleCanvasEnabled } = useStore.getState();
    toggleCanvasEnabled();
    expect(useStore.getState().canvasEnabled).toBe(false);

    toggleCanvasEnabled();
    expect(useStore.getState().canvasEnabled).toBe(true);
  });

  it('sets specific canvas presentation modes', () => {
    const { setCanvasMode } = useStore.getState();

    setCanvasMode('artwork');
    expect(useStore.getState().canvasMode).toBe('artwork');

    setCanvasMode('backdrop');
    expect(useStore.getState().canvasMode).toBe('backdrop');

    setCanvasMode('off');
    expect(useStore.getState().canvasMode).toBe('off');

    setCanvasMode('both');
    expect(useStore.getState().canvasMode).toBe('both');
  });

  it('cycles through all canvas modes in correct sequence', () => {
    const { cycleCanvasMode, setCanvasMode } = useStore.getState();

    setCanvasMode('artwork');
    cycleCanvasMode();
    expect(useStore.getState().canvasMode).toBe('backdrop');

    cycleCanvasMode();
    expect(useStore.getState().canvasMode).toBe('both');

    cycleCanvasMode();
    expect(useStore.getState().canvasMode).toBe('off');

    cycleCanvasMode();
    expect(useStore.getState().canvasMode).toBe('artwork');
  });

  it('manages currentCanvas resolution result', () => {
    const { setCurrentCanvas } = useStore.getState();
    const mockCanvas: CanvasResult = {
      url: 'https://resources.tidal.com/videos/mock/1280x1280.mp4',
      fallback_url: null,
      source: 'tidal',
      format: 'mp4',
      is_local: false,
      title: 'Mock Track',
      artist: 'Mock Artist',
      album: 'Mock Album',
    };

    setCurrentCanvas(mockCanvas);
    expect(useStore.getState().currentCanvas).toEqual(mockCanvas);

    setCurrentCanvas(null);
    expect(useStore.getState().currentCanvas).toBeNull();
  });

  it('toggles online canvas discovery preference', () => {
    const { setCanvasAllowOnline } = useStore.getState();
    setCanvasAllowOnline(false);
    expect(useStore.getState().canvasAllowOnline).toBe(false);

    setCanvasAllowOnline(true);
    expect(useStore.getState().canvasAllowOnline).toBe(true);
  });

  it('renders Motion Canvas cycle button and containers in NowPlayingView when canvas is active', () => {
    const mockCanvas: CanvasResult = {
      url: 'https://resources.tidal.com/videos/mock/1280x1280.mp4',
      fallback_url: null,
      source: 'tidal',
      format: 'mp4',
      is_local: false,
      title: 'Kill Bill',
      artist: 'SZA',
      album: 'SOS',
    };

    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        current_track: 'Kill Bill.flac',
        status: 'Playing',
      },
      currentTrack: {
        id: 1,
        title: 'Kill Bill',
        artist: 'SZA',
        album: 'SOS',
        path: 'C:/Music/Kill Bill.flac',
        duration: 154,
        format: 'FLAC',
        lyric_offset: 0,
      },
      canvasEnabled: true,
      canvasMode: 'both',
      currentCanvas: mockCanvas,
    });

    const { container } = render(createElement(NowPlayingView));

    // Motion Canvas button exists
    const cycleBtn = screen.getByTitle(/Motion Canvas: Both/i);
    expect(cycleBtn).toBeInTheDocument();

    // Both backdrop and artwork canvas containers are present
    expect(container.querySelector('.canvas-backdrop-container')).toBeInTheDocument();
    expect(container.querySelector('.canvas-artwork-container')).toBeInTheDocument();

    // Clicking cycle button cycles mode from 'both' to 'off'
    fireEvent.click(cycleBtn);
    expect(useStore.getState().canvasMode).toBe('off');

    // Next click cycles from 'off' to 'artwork'
    fireEvent.click(cycleBtn);
    expect(useStore.getState().canvasMode).toBe('artwork');
  });
});
