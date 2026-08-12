import { describe, it, expect } from 'vitest';

interface LyricLine {
  time_secs: number;
  text: string;
}

interface ConnectPayload {
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  volume: number;
  is_playing: boolean;
  cover_art: string | null;
  lyrics: LyricLine[];
}

function resolveActiveLyricIndex(lyrics: LyricLine[], positionSecs: number): number {
  if (!lyrics.length) return -1;
  let activeIdx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time_secs <= positionSecs) {
      activeIdx = i;
    } else {
      break;
    }
  }
  return activeIdx;
}

function createSeekCommand(timeSecs: number): string {
  return JSON.stringify({ action: 'seek', value: timeSecs });
}

describe('Aideo Connect Mobile Synced Lyrics', () => {
  const mockLyrics: LyricLine[] = [
    { time_secs: 0, text: 'Intro Instrumental' },
    { time_secs: 14.5, text: 'Looking at the stars tonight' },
    { time_secs: 28.0, text: 'Underneath the neon lights' },
    { time_secs: 45.2, text: 'Fade into the morning glow' },
  ];

  it('should find the matching active lyric index in real-time', () => {
    expect(resolveActiveLyricIndex(mockLyrics, 5)).toBe(0);
    expect(resolveActiveLyricIndex(mockLyrics, 14.5)).toBe(1);
    expect(resolveActiveLyricIndex(mockLyrics, 20.0)).toBe(1);
    expect(resolveActiveLyricIndex(mockLyrics, 30.0)).toBe(2);
    expect(resolveActiveLyricIndex(mockLyrics, 50.0)).toBe(3);
  });

  it('should return -1 when lyrics list is empty', () => {
    expect(resolveActiveLyricIndex([], 20)).toBe(-1);
  });

  it('should format tap-to-seek action payload correctly', () => {
    const payload = createSeekCommand(28.0);
    const parsed = JSON.parse(payload);
    expect(parsed.action).toBe('seek');
    expect(parsed.value).toBe(28.0);
  });

  it('should validate complete WebSocket connect payload structure', () => {
    const payload: ConnectPayload = {
      title: 'Midnight City',
      artist: 'M83',
      album: 'Hurry Up, We\'re Dreaming',
      duration: 244,
      position: 45.2,
      volume: 0.85,
      is_playing: true,
      cover_art: 'http://127.0.0.1:38562/cover.jpg',
      lyrics: mockLyrics,
    };

    expect(payload.lyrics.length).toBe(4);
    expect(payload.is_playing).toBe(true);
    expect(resolveActiveLyricIndex(payload.lyrics, payload.position)).toBe(3);
  });
});
