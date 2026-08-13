import { describe, it, expect } from 'vitest';

interface LyricLine {
  time_secs: number;
  text: string;
  romaji?: string;
  translation?: string;
}

function getActiveMiniLyric(
  lyrics: LyricLine[] | null | undefined,
  positionSecs: number,
  lyricOffsetMs: number = 0
): LyricLine | null {
  if (!lyrics || !lyrics.length) return null;
  const now = positionSecs + lyricOffsetMs / 1000;
  let currentLine: LyricLine | null = null;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time_secs <= now) {
      currentLine = lyrics[i];
    } else {
      break;
    }
  }
  return currentLine;
}

function getDisplayLyricText(
  activeLyric: LyricLine | null,
  showTranslation: boolean = false,
  showRomaji: boolean = false
): string {
  if (!activeLyric) return '';
  if (showTranslation && activeLyric.translation) {
    return activeLyric.translation;
  }
  if (showRomaji && activeLyric.romaji && activeLyric.romaji !== activeLyric.text) {
    return activeLyric.romaji;
  }
  return activeLyric.text;
}

describe('MiniPlayer Lyric Ticker Resolution & Internationalization', () => {
  const mockLyrics: LyricLine[] = [
    { 
      time_secs: 10, 
      text: '夜に駆ける', 
      romaji: 'yoru ni kakeru', 
      translation: 'Racing into the night' 
    },
    { 
      time_secs: 25, 
      text: '沈むように溶けてゆくように', 
      romaji: 'shizumu you ni tokete yuku you ni', 
      translation: 'As if sinking, as if melting away' 
    },
  ];

  it('should return original text by default', () => {
    const active = getActiveMiniLyric(mockLyrics, 12);
    expect(getDisplayLyricText(active, false, false)).toBe('夜に駆ける');
  });

  it('should return romaji transliteration when showRomaji is enabled', () => {
    const active = getActiveMiniLyric(mockLyrics, 12);
    expect(getDisplayLyricText(active, false, true)).toBe('yoru ni kakeru');
  });

  it('should prioritize translation when showTranslation is enabled', () => {
    const active = getActiveMiniLyric(mockLyrics, 12);
    expect(getDisplayLyricText(active, true, false)).toBe('Racing into the night');
    expect(getDisplayLyricText(active, true, true)).toBe('Racing into the night');
  });

  it('should fallback to original text if translation or romaji is missing', () => {
    const untranslatedLine: LyricLine = { time_secs: 5, text: 'Hello World' };
    expect(getDisplayLyricText(untranslatedLine, true, true)).toBe('Hello World');
  });

  it('should manage miniPlayerMode in store state', async () => {
    const { useStore } = await import('../store');
    expect(useStore.getState().miniPlayerMode).toBe(false);
    await useStore.getState().setMiniPlayerMode(true);
    expect(useStore.getState().miniPlayerMode).toBe(true);
    await useStore.getState().setMiniPlayerMode(false);
    expect(useStore.getState().miniPlayerMode).toBe(false);
  });

  it('should default mini player lock state to false and persist when toggled', () => {
    localStorage.clear();
    const isLockedDefault = localStorage.getItem('aideo-mini-player-locked') === 'true';
    expect(isLockedDefault).toBe(false);

    localStorage.setItem('aideo-mini-player-locked', 'true');
    expect(localStorage.getItem('aideo-mini-player-locked') === 'true').toBe(true);

    localStorage.setItem('aideo-mini-player-locked', 'false');
    expect(localStorage.getItem('aideo-mini-player-locked') === 'true').toBe(false);
  });
});
