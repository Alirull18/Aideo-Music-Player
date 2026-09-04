import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { StudioDeckLayout } from '../components/theater/StudioDeckLayout';
import { TheaterLayoutProps } from '../components/theater/types';

const mockProps: TheaterLayoutProps = {
  currentTrack: {
    id: 1,
    path: 'C:/music/track.flac',
    title: 'Mastering Studio Track',
    artist: 'Hi-Fi Ensemble',
    album: 'Audiophile Sessions Vol. 1',
    duration: 300,
    format: 'FLAC 96kHz 24-bit',
    lyric_offset: 0,
  },
  effectiveCover: 'data:image/png;base64,mock',
  playbackCurrentTrack: 'C:/music/track.flac',
  lyrics: [
    { time_secs: 0, text: 'Analog warmth in the headphones' },
    { time_secs: 10, text: 'Needles dancing on the meter' },
  ],
  lyricStatus: 'found',
  lyricsDisplayMode: 'line_sync',
  activeIdx: 0,
  playbackPositionSecs: 5,
  playbackStatus: 'Playing',
  lyricOffset: 0,
  showRomaji: false,
  showTranslation: false,
  accentColor: '#8b5cf6',
  telemetryText: 'BIT-PERFECT WASAPI · 96kHz',
  albumArtFit: 'contain',
  vizMode: 'baseline',
  seek: vi.fn(),
  scrollRef: createRef<HTMLDivElement>(),
  spectrumBands: new Array(64).fill(0.4),
};

describe('StudioDeckLayout', () => {
  it('renders studio deck with track metadata, VU meters canvas, and signal path telemetry', () => {
    render(<StudioDeckLayout {...mockProps} />);
    expect(screen.getByText('Mastering Studio Track')).toBeInTheDocument();
    expect(screen.getByText(/Hi-Fi Ensemble/)).toBeInTheDocument();
    expect(screen.getByText('CH 1 · LEFT')).toBeInTheDocument();
    expect(screen.getByText('CH 2 · RIGHT')).toBeInTheDocument();
    expect(screen.getByText('Analog warmth in the headphones')).toBeInTheDocument();
  });
});
