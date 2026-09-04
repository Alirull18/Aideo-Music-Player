import { RefObject } from 'react';
import { Track, LyricLine, LyricsDisplayMode } from '../../store/types';

export interface TheaterLayoutProps {
  currentTrack: Track | null;
  effectiveCover: string;
  playbackCurrentTrack: string | null;
  lyrics: LyricLine[];
  lyricStatus: 'idle' | 'loading' | 'found' | 'not_found' | 'error';
  lyricsDisplayMode: LyricsDisplayMode;
  activeIdx: number;
  playbackPositionSecs: number;
  playbackStatus: 'Playing' | 'Paused' | 'Stopped';
  lyricOffset: number;
  showRomaji: boolean;
  showTranslation: boolean;
  accentColor: string;
  telemetryText: string;
  albumArtFit: 'cover' | 'contain';
  vizMode: 'baseline' | 'circle' | 'wave';
  seek: (secs: number) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  spectrumBands?: number[];
  lowSpecMode?: boolean;
}
