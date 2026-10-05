import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useStore } from '../store';
import { NowPlayingView } from '../components/NowPlayingView';
import { FullscreenView } from '../components/FullscreenView';
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
    createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  }) as any;

  useStore.setState({
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
    chromecast_connected: false,
    theaterModeDesign: 'stage',
    theaterHudStyle: 'capsule',
    view: 'nowplaying',
  });
});

describe('NowPlayingView Interactive Artwork & Specs Overlay', () => {
  it('renders interactive artwork container', () => {
    const { container } = render(<NowPlayingView />);

    const artWrap = container.querySelector('.np-art-wrap');
    expect(artWrap).toBeInTheDocument();
    expect(artWrap).toHaveClass('np-art-interactive');

    const infoBtn = screen.getByRole('button', { name: /Inspect track/i });
    expect(infoBtn).toBeInTheDocument();
    expect(infoBtn).toBe(artWrap);
  });

  it('toggles track inspector overlay when clicking artwork or pressing close', () => {
    const { container } = render(<NowPlayingView />);

    // Initially overlay is not visible
    expect(container.querySelector('.np-art-overlay')).toBeNull();

    // Click artwork to open overlay
    const artWrap = container.querySelector('.np-art-wrap') as HTMLElement;
    fireEvent.click(artWrap);

    const overlay = container.querySelector('.np-art-overlay') as HTMLElement;
    expect(overlay).toBeInTheDocument();
    expect(within(overlay).getByText('TRACK INSPECTOR')).toBeInTheDocument();
    expect(within(overlay).getByText('FLAC')).toBeInTheDocument();
    expect(within(overlay).getByText('Path pending')).toBeInTheDocument();
    expect(within(overlay).queryByText('Bit-perfect')).not.toBeInTheDocument();
    expect(within(overlay).getByText('Beethoven Symphonies')).toBeInTheDocument();

    // Click close button inside inspector overlay
    const closeBtn = within(overlay).getByRole('button', { name: /Close track inspector/i });
    fireEvent.click(closeBtn);

    expect(container.querySelector('.np-art-overlay')).toBeNull();
  });

  it('tilts the artwork toward the pointer and resets when the pointer leaves', () => {
    const { container } = render(<NowPlayingView />);
    const artWrap = container.querySelector('.np-art-wrap') as HTMLDivElement;
    expect(artWrap).toBeInTheDocument();

    vi.spyOn(artWrap, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 360,
      height: 360,
      right: 360,
      bottom: 360,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerMove(artWrap, { clientX: 288, clientY: 72, pointerType: 'mouse' });
    expect(artWrap.style.getPropertyValue('--np-art-tilt-x')).not.toBe('0deg');
    expect(artWrap.style.getPropertyValue('--np-art-tilt-y')).not.toBe('0deg');
    expect(artWrap.style.getPropertyValue('--np-art-light-x')).not.toBe('50%');

    fireEvent.pointerLeave(artWrap);
    expect(artWrap.style.getPropertyValue('--np-art-tilt-x')).toBe('0deg');
    expect(artWrap.style.getPropertyValue('--np-art-tilt-y')).toBe('0deg');
    expect(artWrap.style.getPropertyValue('--np-art-light-x')).toBe('50%');
  });

  it('closes track inspector overlay on Escape key', () => {
    const { container } = render(<NowPlayingView />);
    const artWrap = container.querySelector('.np-art-wrap') as HTMLElement;

    fireEvent.click(artWrap);
    expect(container.querySelector('.np-art-overlay')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.np-art-overlay')).toBeNull();
  });

  it('shows expanded track and playback details in the artwork info panel', () => {
    const state = useStore.getState();
    useStore.setState({
      currentTrack: {
        ...state.currentTrack!,
        track_number: 4,
        disc_number: 2,
        bpm: 128,
        energy: 0.82,
        bass_ratio: 0.65,
        treble_ratio: 0.41,
      },
      playback: {
        ...state.playback,
        position_secs: 123,
        file_rate: 48000,
        file_ch: 2,
        file_format: 'FLAC',
      },
    });

    const { container } = render(<NowPlayingView />);
    fireEvent.click(screen.getByRole('button', { name: /Inspect track/i }));

    const overlay = container.querySelector('.np-art-overlay') as HTMLElement;
    expect(overlay).toBeInTheDocument();
    expect(within(overlay).getByText(/Disc 2 · Track 4/)).toBeInTheDocument();
    expect(within(overlay).getByText(/2:03/)).toBeInTheDocument();
    expect(within(overlay).getAllByText('Local library').length).toBeGreaterThan(0);
    expect(within(overlay).getAllByText(/Stereo/).length).toBeGreaterThan(0);
  });

  it('does not infer dBFS from display spectrum bands', () => {
    const { container } = render(<NowPlayingView />);
    const signalControl = container.querySelector('[title="Inspect Audio Signal Path & Telemetry"]');
    expect(signalControl).toBeInTheDocument();
    fireEvent.click(signalControl!);

    expect(screen.getByRole('dialog', { name: /Audio Signal Path & Telemetry/i })).toBeInTheDocument();
    const readout = screen.getByRole('group', { name: 'Output sample levels' });
    expect(within(readout).queryByText(/\d+(?:\.\d+)?\s*dBFS/i, { selector: 'strong' })).not.toBeInTheDocument();
    expect(within(readout).getAllByText('Unavailable')).toHaveLength(2);
  });

  it('starts and stops measured levels with the artwork inspector', async () => {
    let measuring = false;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command !== 'get_audio_levels') return null;
      measuring = (args as { enabled: boolean }).enabled;
      return measuring ? { peak_dbfs: -6, headroom_db: 6, silent: false } : null;
    });
    render(<NowPlayingView />);
    expect(measuring).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Inspect track/i }));
    await waitFor(() => expect(screen.getByText('-6.0 dBFS')).toBeInTheDocument());
    expect(screen.getByText('6.0 dB')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Close track inspector/i }));
    await waitFor(() => expect(measuring).toBe(false));
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it('toggles signal telemetry with the I shortcut', async () => {
    render(<NowPlayingView />);

    fireEvent.keyDown(window, { key: 'i' });
    expect(screen.getByRole('dialog', { name: /Audio Signal Path & Telemetry/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'i' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Audio Signal Path & Telemetry/i })).toBeNull(),
    );
  });
});

describe('FullscreenView Top Bar & Scope Mode Pitch Black Background', () => {
  it('renders floating top bar with layout, HUD style, and exit buttons without overlap', () => {
    const { container } = render(<FullscreenView />);

    const topBar = container.querySelector('.fullscreen-top-bar');
    expect(topBar).toBeInTheDocument();

    expect(screen.getByTitle(/Current: Stage View/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Exit Fullscreen Mode/i)).toBeInTheDocument();
  });

  it('disables unsupported Cast receiver volume controls', () => {
    useStore.setState({ chromecast_connected: true });
    const { container } = render(<FullscreenView />);
    expect(screen.getByRole('button', { name: 'Cast receiver volume unavailable' })).toBeDisabled();
    expect(container.querySelector('.fullscreen-hud-volume-slider')).toBeDisabled();
    expect(screen.getByText('Cast volume unavailable')).toBeInTheDocument();
  });

  it('renders Scope mode with pure black full-screen background and disables LiquidBackground', () => {
    useStore.setState({ theaterModeDesign: 'scope' });
    const { container } = render(<FullscreenView />);

    // Scope canvas is rendered
    const scopeCanvas = screen.getByTestId('pure-scope-canvas');
    expect(scopeCanvas).toBeInTheDocument();

    // Scope container has pure black background style
    const scopeContainer = container.querySelector('.pure-scope-container') as HTMLElement;
    expect(scopeContainer).toBeInTheDocument();
    expect(scopeContainer.style.backgroundColor).toBe('rgb(0, 0, 0)');
  });
});
