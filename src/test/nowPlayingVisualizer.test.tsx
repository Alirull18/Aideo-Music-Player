import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '../store';
import { NowPlayingView } from '../components/NowPlayingView';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: vi.fn().mockResolvedValue(false),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

const listenMock = vi.mocked(listen);
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => new Promise(() => {}));
  listenMock.mockReset();
  listenMock.mockImplementation(() => Promise.resolve(() => {}));

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
    createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  }) as any;

  useStore.setState({
    visualizerExpanded: false,
    currentTrack: {
      id: 42,
      path: '/music/audiophile-master.flac',
      title: 'Symphony No. 5 in C Minor',
      artist: 'Vienna Philharmonic',
      album: 'Beethoven Symphonies',
      duration: 480,
      format: 'flac',
      lyric_offset: 0,
      loved: 0,
    },
    playback: {
      current_track: '/music/audiophile-master.flac',
      status: 'Playing',
      position_secs: 120,
      volume: 0.8,
      bit_perfect: true,
      dev_rate: 96000,
      is_buffering: false,
      driver_type: 'WASAPI',
      exclusive: true,
      effective_audio_path: null,
    },
    view: 'nowplaying',
  });
});

describe('NowPlayingView Adaptive Visualizer Container', () => {
  it('renders default visualizer container with 64px height and expand button', () => {
    const { container } = render(<NowPlayingView />);

    const visualizerContainer = container.querySelector('.np-visualizer-container') as HTMLElement;
    expect(visualizerContainer).toBeInTheDocument();
    expect(visualizerContainer).toHaveStyle({ height: '64px' });

    const toggleBtn = screen.getByRole('button', { name: /expand visualizer/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute('title', 'Expand Visualizer');
  });

  it('expands container to 140px on click and updates store state', () => {
    const { container } = render(<NowPlayingView />);

    const toggleBtn = screen.getByRole('button', { name: /expand visualizer/i });
    act(() => {
      fireEvent.click(toggleBtn);
    });

    expect(useStore.getState().visualizerExpanded).toBe(true);

    const visualizerContainer = container.querySelector('.np-visualizer-container') as HTMLElement;
    expect(visualizerContainer).toHaveStyle({ height: '140px' });

    const collapseBtn = screen.getByRole('button', { name: /collapse visualizer/i });
    expect(collapseBtn).toBeInTheDocument();
    expect(collapseBtn).toHaveAttribute('title', 'Collapse Visualizer');
  });

  it('collapses container back to 64px when clicked again', () => {
    useStore.setState({ visualizerExpanded: true });
    const { container } = render(<NowPlayingView />);

    const visualizerContainer = container.querySelector('.np-visualizer-container') as HTMLElement;
    expect(visualizerContainer).toHaveStyle({ height: '140px' });

    const collapseBtn = screen.getByRole('button', { name: /collapse visualizer/i });
    act(() => {
      fireEvent.click(collapseBtn);
    });

    expect(useStore.getState().visualizerExpanded).toBe(false);
    expect(visualizerContainer).toHaveStyle({ height: '64px' });

    const expandBtn = screen.getByRole('button', { name: /expand visualizer/i });
    expect(expandBtn).toBeInTheDocument();
  });
});
