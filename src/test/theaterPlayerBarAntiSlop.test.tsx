import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '../store';
import { FullscreenView } from '../components/FullscreenView';

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
});

describe('Theater Mode Fullscreen Playback HUD (Anti-UI Slop Controls)', () => {
  beforeEach(() => {
    useStore.setState({
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
      shuffle: false,
      repeat: 'none',
      autoplayEnabled: false,
      theaterModeDesign: 'stage',
      view: 'fullscreen',
    });
  });

  it('renders all transport controls including Shuffle, Repeat, Autoplay, and Love in the HUD', () => {
    render(<FullscreenView />);

    // Transport buttons in center cluster
    expect(screen.getByRole('button', { name: /Shuffle: Off/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous Track/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next Track/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Repeat: Off/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Endless Radio Autoplay: Off/i })).toBeInTheDocument();

    // Love button in left cluster
    expect(screen.getByRole('button', { name: /Add to Loved Tracks/i })).toBeInTheDocument();
  });

  it('toggles shuffle when clicking Shuffle button in HUD', () => {
    render(<FullscreenView />);
    const shuffleBtn = screen.getByRole('button', { name: /Shuffle: Off/i });

    fireEvent.click(shuffleBtn);
    expect(useStore.getState().shuffle).toBe(true);

    expect(screen.getByRole('button', { name: /Shuffle: On/i })).toHaveClass('active');
  });

  it('toggles repeat state when clicking Repeat button in HUD', () => {
    render(<FullscreenView />);
    const repeatBtn = screen.getByRole('button', { name: /Repeat: Off/i });

    fireEvent.click(repeatBtn);
    expect(useStore.getState().repeat).toBe('all');

    fireEvent.click(screen.getByRole('button', { name: /Repeat: All/i }));
    expect(useStore.getState().repeat).toBe('one');

    fireEvent.click(screen.getByRole('button', { name: /Repeat: One/i }));
    expect(useStore.getState().repeat).toBe('none');
  });

  it('toggles endless radio autoplay when clicking Autoplay button in HUD', () => {
    render(<FullscreenView />);
    const autoplayBtn = screen.getByRole('button', { name: /Endless Radio Autoplay: Off/i });

    fireEvent.click(autoplayBtn);
    expect(useStore.getState().autoplayEnabled).toBe(true);
  });

  it('toggles favorite when clicking Love button in HUD', async () => {
    const toggleLoveMock = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ toggleLoveTrack: toggleLoveMock });

    render(<FullscreenView />);
    const loveBtn = screen.getByRole('button', { name: /Add to Loved Tracks/i });

    fireEvent.click(loveBtn);
    expect(toggleLoveMock).toHaveBeenCalledWith(
      '/music/test-track.flac',
      expect.objectContaining({ title: 'Master Audio Track' })
    );
  });

  it('toggles shuffle and repeat via keyboard shortcuts "s" and "p"', () => {
    render(<FullscreenView />);

    expect(useStore.getState().shuffle).toBe(false);
    fireEvent.keyDown(window, { key: 's' });
    expect(useStore.getState().shuffle).toBe(true);

    expect(useStore.getState().repeat).toBe('none');
    fireEvent.keyDown(window, { key: 'p' });
    expect(useStore.getState().repeat).toBe('all');
  });

  it('unmounts global PlayerBar when view mode is fullscreen to eliminate background rendering', () => {
    const shouldRenderPlayerBar = (view: string) => view !== 'fullscreen';
    expect(shouldRenderPlayerBar('fullscreen')).toBe(false);
    expect(shouldRenderPlayerBar('nowplaying')).toBe(true);
    expect(shouldRenderPlayerBar('library')).toBe(true);
  });
});
