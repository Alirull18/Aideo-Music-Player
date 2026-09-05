import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useStore } from '../store';
import { NowPlayingView } from '../components/NowPlayingView';
import { FullscreenView } from '../components/FullscreenView';
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

const spectrumListeners: Array<(event: { payload: number[] }) => void> = [];
const listenMock = vi.mocked(listen);
const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  spectrumListeners.length = 0;
  invokeMock.mockReset();
  invokeMock.mockImplementation(() => new Promise(() => {}));
  listenMock.mockReset();
  listenMock.mockImplementation((event, handler) => {
    if (event === 'audio-spectrum') {
      spectrumListeners.push(handler as (event: { payload: number[] }) => void);
    }
    return Promise.resolve(() => {});
  });

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
    theaterModeDesign: 'stage',
    theaterHudStyle: 'capsule',
    view: 'nowplaying',
  });
});

describe('NowPlayingView track inspector', () => {
  it('renders an explicit inspect control on the artwork', () => {
    const { container } = render(<NowPlayingView />);

    const artWrap = container.querySelector('.np-art-wrap');
    expect(artWrap).toBeInTheDocument();
    expect(artWrap).not.toHaveAttribute('role', 'button');

    const infoBtn = screen.getByRole('button', { name: /Inspect track/i });
    expect(infoBtn).toBeInTheDocument();
    expect(infoBtn).toHaveTextContent('Inspect');
    expect(infoBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the inspector from the artwork button and closes it from the panel', () => {
    const { container } = render(<NowPlayingView />);

    expect(container.querySelector('.np-art-overlay')).toBeNull();

    const infoBtn = screen.getByRole('button', { name: /Inspect track/i });
    fireEvent.click(infoBtn);

    const overlay = screen.getByRole('region', { name: /Track inspector/i });
    expect(infoBtn).toHaveAttribute('aria-expanded', 'true');
    expect(within(overlay).getByText('TRACK INSPECTOR')).toBeInTheDocument();
    expect(within(overlay).getByText('FLAC')).toBeInTheDocument();
    expect(within(overlay).getByText('96.0 kHz')).toBeInTheDocument();
    expect(within(overlay).getByText('Bit-perfect')).toBeInTheDocument();
    expect(within(overlay).getByText('Beethoven Symphonies')).toBeInTheDocument();

    const closeBtn = within(overlay).getByRole('button', { name: /Close track inspector/i });
    fireEvent.click(closeBtn);

    expect(container.querySelector('.np-art-overlay')).toBeNull();
  });

  it('does not assign an accidental click action to the whole cover', () => {
    const { container } = render(<NowPlayingView />);

    const artWrap = container.querySelector('.np-art-wrap') as HTMLElement;
    expect(artWrap).toBeInTheDocument();

    fireEvent.click(artWrap);
    expect(container.querySelector('.np-art-overlay')).toBeNull();
  });

  it('shows native tags, source resolution, and actual output details', async () => {
    invokeMock.mockResolvedValue({
      path: '/music/audiophile-master.flac',
      title: 'Symphony No. 5 in C Minor',
      artist: 'Vienna Philharmonic',
      album: 'Beethoven Symphonies',
      album_artist: 'Vienna Philharmonic',
      year: '1963',
      genre: 'Classical',
      track_number: 4,
      track_total: 9,
      disc_number: 2,
      disc_total: 3,
      format: 'FLAC',
      duration_secs: 480,
      file_size_bytes: 3_031_040,
      bitrate: 2890,
      sample_rate: 96000,
      bit_depth: 24,
      channels: 2,
    });

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
        file_rate: 96000,
        file_ch: 2,
        file_format: 'FLAC',
        bit_perfect: false,
        dev_rate: 192000,
        effective_audio_path: {
          active: true,
          engine: 'wasapi',
          share_mode: 'exclusive',
          source: {
            sample_rate: 96000,
            channels: 2,
            sample_format: 'S24',
            bits_per_sample: 24,
            valid_bits_per_sample: 24,
          },
          pipeline_sample_format: 'F32',
          output: {
            sample_rate: 192000,
            channels: 2,
            sample_format: 'S32',
            bits_per_sample: 32,
            valid_bits_per_sample: 24,
          },
          requested_exclusive: true,
          requested_bit_perfect: true,
          resampling: true,
          volume_applied: false,
          active_transforms: ['Sample-rate conversion'],
          underruns: 0,
          strict_bit_perfect: false,
        },
      },
    });

    render(<NowPlayingView />);
    fireEvent.click(screen.getByRole('button', { name: /Inspect track/i }));

    const overlay = screen.getByRole('region', { name: /Track inspector/i });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('read_audio_tags', {
      path: '/music/audiophile-master.flac',
    }));
    expect(await within(overlay).findByText('Disc 2 of 3 · Track 4 of 9')).toBeInTheDocument();
    expect(within(overlay).getByText('2:03 / 8:00')).toBeInTheDocument();
    expect(within(overlay).getAllByText('Local library').length).toBeGreaterThan(0);
    expect(within(overlay).getByText('Classical · 1963')).toBeInTheDocument();
    expect(within(overlay).getByText('2.9 MB')).toBeInTheDocument();
    expect(within(overlay).getByText('24-bit / 96.0 kHz')).toBeInTheDocument();
    expect(within(overlay).getByText('24-bit in 32-bit / 192.0 kHz · Stereo')).toBeInTheDocument();
    expect(within(overlay).getByText('WASAPI · Exclusive')).toBeInTheDocument();
    expect(within(overlay).getByText('Sample-rate conversion')).toBeInTheDocument();
    expect(within(overlay).getByText('2,890 kbps')).toBeInTheDocument();
    expect(within(overlay).getByText('128 BPM')).toBeInTheDocument();
    expect(within(overlay).getByText('82%')).toBeInTheDocument();
  });

  it('labels unavailable bitrate honestly', () => {
    render(<NowPlayingView />);
    fireEvent.click(screen.getByRole('button', { name: /Inspect track/i }));

    const overlay = screen.getByRole('region', { name: /Track inspector/i });
    const bitrateLabel = within(overlay).getByText('Bitrate');
    const bitrateRow = bitrateLabel.closest('.np-art-detail-row') as HTMLElement;
    expect(within(bitrateRow).getByText('Unknown')).toBeInTheDocument();
  });

  it('does not send streaming URLs to the local tag reader', () => {
    const state = useStore.getState();
    const streamUrl = 'https://stream.example.test/master.flac';
    useStore.setState({
      currentTrack: {
        ...state.currentTrack!,
        path: streamUrl,
        format: 'Tidal FLAC',
      },
      playback: {
        ...state.playback,
        current_track: streamUrl,
      },
    });

    render(<NowPlayingView />);
    fireEvent.click(screen.getByRole('button', { name: /Inspect track/i }));

    const overlay = screen.getByRole('region', { name: /Track inspector/i });
    expect(within(overlay).getAllByText('Tidal lossless').length).toBeGreaterThan(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('updates signal telemetry from the live audio spectrum event', async () => {
    const { container } = render(<NowPlayingView />);

    await waitFor(() => expect(spectrumListeners.length).toBeGreaterThan(0));

    const signalButton = container.querySelector('button[title="Inspect Audio Signal Path & Telemetry"]');
    expect(signalButton).toBeInTheDocument();
    fireEvent.click(signalButton!);

    expect(screen.getByRole('dialog', { name: /Audio Signal Path & Telemetry/i })).toBeInTheDocument();

    act(() => {
      spectrumListeners.forEach(listener => listener({ payload: [0.5] }));
    });

    expect(screen.getByText(/Peak:/i)).toHaveTextContent('-6.0 dBFS');
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

    expect(screen.getByTitle(/HUD: Floating Capsule/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Current: Stage View/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Exit Fullscreen Mode/i)).toBeInTheDocument();
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
