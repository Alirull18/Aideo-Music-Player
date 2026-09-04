import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { VinylTurntableLayout } from '../components/theater/VinylTurntableLayout';
import { TheaterLayoutProps } from '../components/theater/types';

const mockProps: TheaterLayoutProps = {
  currentTrack: {
    id: 1,
    path: 'C:/music/vinyl-cut.flac',
    title: 'Analog Vinyl Track',
    artist: 'Vintage Quintet',
    album: 'Direct to Acetate',
    duration: 180,
    format: 'FLAC 192kHz',
    lyric_offset: 0,
  },
  effectiveCover: 'data:image/png;base64,mock',
  playbackCurrentTrack: 'C:/music/vinyl-cut.flac',
  lyrics: [
    { time_secs: 0, text: 'Spinning on the platter' },
    { time_secs: 15, text: 'Grooves run deep into the disc' },
  ],
  lyricStatus: 'found',
  lyricsDisplayMode: 'line_sync',
  activeIdx: 0,
  playbackPositionSecs: 45, // 25% through 180s
  playbackStatus: 'Playing',
  lyricOffset: 0,
  showRomaji: false,
  showTranslation: false,
  accentColor: '#8b5cf6',
  telemetryText: 'ANALOG 33 RPM · 192kHz',
  albumArtFit: 'contain',
  vizMode: 'baseline',
  seek: vi.fn(),
  scrollRef: createRef<HTMLDivElement>(),
};

describe('VinylTurntableLayout', () => {
  it('renders turntable with rotating vinyl, tonearm, album sleeve, and lyric ticker', () => {
    render(<VinylTurntableLayout {...mockProps} />);
    expect(screen.getByText('Analog Vinyl Track')).toBeInTheDocument();
    expect(screen.getByText(/Vintage Quintet/)).toBeInTheDocument();
    expect(screen.getByText('Spinning on the platter')).toBeInTheDocument();
    expect(screen.getByTestId('vinyl-tonearm')).toBeInTheDocument();
    expect(screen.getByTestId('vinyl-record')).toBeInTheDocument();
  });
});
