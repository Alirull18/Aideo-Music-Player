import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
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

  useStore.setState({
    currentTrack: {
      id: 1,
      path: '/music/test-track.flac',
      title: 'Test Track',
      artist: 'Test Artist',
      album: 'Test Album',
      duration: 240,
      format: 'FLAC',
      lyric_offset: 0,
      loved: 0,
    },
    playback: {
      current_track: '/music/test-track.flac',
      status: 'Playing',
      position_secs: 45,
      volume: 0.8,
      bit_perfect: true,
      dev_rate: 96000,
      is_buffering: false,
      driver_type: 'WASAPI',
      exclusive: true,
      effective_audio_path: null,
    },
    theaterHudStyle: 'capsule',
    theaterModeDesign: 'stage',
    view: 'fullscreen',
  });
});

describe('Theater HUD overhaul contracts', () => {
  it('exposes one shared HUD shell and explicit style hook', () => {
    const { container } = render(<FullscreenView />);
    const hud = container.querySelector('.fullscreen-hud');

    expect(hud).toHaveClass('hud-shell');
    expect(hud).toHaveAttribute('data-hud-style', 'capsule');
    expect(container.querySelector('.fullscreen-hud-progress-wrap')).toHaveClass('hud-progress');
    expect(container.querySelector('.fullscreen-hud-controls')).toHaveClass('hud-controls');
  });

  it('does not use a structural divider between Now Playing columns', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8');
    const nowPlayingColumn = css.match(/\.np-left\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const lyricsToolbar = css.match(/\.lyrics-toolbar\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(nowPlayingColumn).not.toMatch(/border-right\s*:/);
    expect(nowPlayingColumn).not.toMatch(/border-left\s*:/);
    expect(lyricsToolbar).not.toMatch(/border-bottom\s*:/);
  });
});
