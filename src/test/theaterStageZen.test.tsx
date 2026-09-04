import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { StageLayout } from '../components/theater/StageLayout';
import { ZenLayout } from '../components/theater/ZenLayout';
import { TheaterLayoutProps } from '../components/theater/types';

const mockProps: TheaterLayoutProps = {
  currentTrack: {
    id: 1,
    path: 'C:/music/song.flac',
    title: 'Test Song Title',
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 240,
    format: 'FLAC 96kHz',
    lyric_offset: 0,
  },
  effectiveCover: 'data:image/png;base64,mock',
  playbackCurrentTrack: 'C:/music/song.flac',
  lyrics: [
    { time_secs: 0, text: 'First line of lyric' },
    { time_secs: 5, text: 'Second line of lyric' },
  ],
  lyricStatus: 'found',
  lyricsDisplayMode: 'line_sync',
  activeIdx: 0,
  playbackPositionSecs: 2,
  playbackStatus: 'Playing',
  lyricOffset: 0,
  showRomaji: false,
  showTranslation: false,
  accentColor: '#8b5cf6',
  telemetryText: 'FLAC 96kHz · BIT-PERFECT',
  albumArtFit: 'contain',
  vizMode: 'baseline',
  seek: vi.fn(),
  scrollRef: createRef<HTMLDivElement>(),
};

describe('Theater Stage and Zen Layouts', () => {
  it('renders StageLayout with track title, artist, and lyrics', () => {
    render(<StageLayout {...mockProps} />);
    expect(screen.getByText('Test Song Title')).toBeInTheDocument();
    expect(screen.getByText('Test Artist')).toBeInTheDocument();
    expect(screen.getByText('First line of lyric')).toBeInTheDocument();
    expect(screen.getByText('Second line of lyric')).toBeInTheDocument();
  });

  it('renders ZenLayout with centered lyrics and floating mini art', () => {
    render(<ZenLayout {...mockProps} />);
    expect(screen.getByText('Test Song Title')).toBeInTheDocument();
    expect(screen.getByText('First line of lyric')).toBeInTheDocument();
  });
});
