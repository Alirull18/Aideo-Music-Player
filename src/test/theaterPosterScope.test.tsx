import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { EditorialPosterLayout } from '../components/theater/EditorialPosterLayout';
import { PureScopeLayout } from '../components/theater/PureScopeLayout';
import { TheaterLayoutSwitch } from '../components/theater/TheaterLayoutSwitch';
import { TheaterLayoutProps } from '../components/theater/types';
import { TheaterModeDesign } from '../store/types';

const mockProps: TheaterLayoutProps = {
  currentTrack: {
    id: 1,
    path: 'C:/music/broadsheet.flac',
    title: 'Editorial Masterwork',
    artist: 'Swiss Typographer',
    album: 'Modernist Archive 1968',
    duration: 210,
    format: 'FLAC 96kHz',
    lyric_offset: 0,
  },
  effectiveCover: 'data:image/png;base64,mock',
  playbackCurrentTrack: 'C:/music/broadsheet.flac',
  lyrics: [
    { time_secs: 0, text: 'Ink on paper beats the screen' },
    { time_secs: 10, text: 'Pure geometry and sound' },
  ],
  lyricStatus: 'found',
  lyricsDisplayMode: 'line_sync',
  activeIdx: 0,
  playbackPositionSecs: 3,
  playbackStatus: 'Playing',
  lyricOffset: 0,
  showRomaji: false,
  showTranslation: false,
  accentColor: '#8b5cf6',
  telemetryText: 'SWISS EDITORIAL · 96kHz',
  albumArtFit: 'contain',
  vizMode: 'baseline',
  seek: vi.fn(),
  scrollRef: createRef<HTMLDivElement>(),
  spectrumBands: new Array(64).fill(0.5),
};

describe('EditorialPosterLayout, PureScopeLayout, and TheaterLayoutSwitch', () => {
  it('renders EditorialPosterLayout with bold typography and liner notes', () => {
    render(<EditorialPosterLayout {...mockProps} />);
    expect(screen.getByText('Editorial Masterwork')).toBeInTheDocument();
    expect(screen.getByText(/Swiss Typographer/)).toBeInTheDocument();
    expect(screen.getByText('Ink on paper beats the screen')).toBeInTheDocument();
  });

  it('renders PureScopeLayout with canvas scope and ethereal overlay', () => {
    render(<PureScopeLayout {...mockProps} />);
    expect(screen.getByText('Editorial Masterwork')).toBeInTheDocument();
    expect(screen.getByTestId('pure-scope-canvas')).toBeInTheDocument();
  });

  it('resolves the correct layout in TheaterLayoutSwitch for all 6 designs', () => {
    const designs: TheaterModeDesign[] = ['stage', 'zen', 'studio', 'vinyl', 'poster', 'scope'];
    for (const design of designs) {
      const { unmount } = render(<TheaterLayoutSwitch {...mockProps} design={design} />);
      expect(screen.getByText('Editorial Masterwork')).toBeInTheDocument();
      unmount();
    }
  });
});
