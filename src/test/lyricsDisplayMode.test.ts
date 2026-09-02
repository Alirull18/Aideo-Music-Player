import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { LyricLine, LyricWord } from '../store/types';
import { safeGetStorage, safeSetStorage } from '../utils/storage';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// Intra-word syllable progress calculation helper matching component logic
function computeWordProgress(
  currentTime: number,
  word: LyricWord,
  nextWord?: LyricWord
): { isStarted: boolean; isFinished: boolean; progress: number; duration: number } {
  const duration = word.duration_secs && word.duration_secs > 0
    ? word.duration_secs
    : (nextWord && nextWord.time_secs > word.time_secs ? (nextWord.time_secs - word.time_secs) : 0.8);
  const isStarted = currentTime >= word.time_secs;
  const isFinished = (word.duration_secs && word.duration_secs > 0)
    ? currentTime >= (word.time_secs + word.duration_secs)
    : (nextWord ? currentTime >= nextWord.time_secs : currentTime >= (word.time_secs + duration));

  let progress = 0;
  if (isFinished) {
    progress = 100;
  } else if (isStarted) {
    progress = Math.min(100, Math.max(0, ((currentTime - word.time_secs) / duration) * 100));
  }

  return { isStarted, isFinished, progress, duration };
}

describe('Lyrics Display Mode & Word-by-Word Karaoke Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('1. Store State & Display Mode Transitions', () => {
    it('defaults to karaoke mode when storage is empty', () => {
      const state = useStore.getState();
      expect(state.lyricsDisplayMode).toBe('karaoke');
    });

    it('transitions between karaoke, line_sync, and static modes', () => {
      const store = useStore.getState();

      store.setLyricsDisplayMode('line_sync');
      expect(useStore.getState().lyricsDisplayMode).toBe('line_sync');
      expect(safeGetStorage('aideo-lyrics-display-mode')).toBe('line_sync');

      store.setLyricsDisplayMode('static');
      expect(useStore.getState().lyricsDisplayMode).toBe('static');
      expect(safeGetStorage('aideo-lyrics-display-mode')).toBe('static');

      store.setLyricsDisplayMode('karaoke');
      expect(useStore.getState().lyricsDisplayMode).toBe('karaoke');
      expect(safeGetStorage('aideo-lyrics-display-mode')).toBe('karaoke');
    });

    it('persists mode selection to localStorage across storage reads', () => {
      safeSetStorage('aideo-lyrics-display-mode', 'static');
      expect(safeGetStorage('aideo-lyrics-display-mode', 'karaoke')).toBe('static');

      safeSetStorage('aideo-lyrics-display-mode', 'line_sync');
      expect(safeGetStorage('aideo-lyrics-display-mode', 'karaoke')).toBe('line_sync');
    });

    it('emits desktop-lyrics-sync event when desktop lyrics window is open', () => {
      useStore.setState({ desktopLyricsOpen: true });
      const store = useStore.getState();

      store.setLyricsDisplayMode('line_sync');

      expect(emit).toHaveBeenCalledWith('desktop-lyrics-sync', expect.objectContaining({
        lyricsDisplayMode: 'line_sync'
      }));
    });
  });

  describe('2. Word-by-Word Intra-Syllable Progress Mathematics', () => {
    it('returns 0% before word start time', () => {
      const word: LyricWord = { time_secs: 10.0, duration_secs: 1.5, text: 'Hello' };
      const res = computeWordProgress(9.5, word);
      expect(res.isStarted).toBe(false);
      expect(res.isFinished).toBe(false);
      expect(res.progress).toBe(0);
    });

    it('returns exactly 50% at midpoint with explicit duration_secs', () => {
      const word: LyricWord = { time_secs: 10.0, duration_secs: 2.0, text: 'World' };
      const res = computeWordProgress(11.0, word);
      expect(res.isStarted).toBe(true);
      expect(res.isFinished).toBe(false);
      expect(res.progress).toBeCloseTo(50, 4);
    });

    it('returns 100% after word completion with explicit duration_secs', () => {
      const word: LyricWord = { time_secs: 10.0, duration_secs: 1.5, text: 'Shine' };
      const res = computeWordProgress(11.6, word);
      expect(res.isStarted).toBe(true);
      expect(res.isFinished).toBe(true);
      expect(res.progress).toBe(100);
    });

    it('correctly infers syllable duration from next word timestamp when duration_secs is absent', () => {
      const word1: LyricWord = { time_secs: 5.0, text: 'Sweet' };
      const word2: LyricWord = { time_secs: 6.0, text: 'Child' };

      const res = computeWordProgress(5.5, word1, word2);
      expect(res.duration).toBe(1.0);
      expect(res.progress).toBeCloseTo(50, 4);

      const resFinished = computeWordProgress(6.0, word1, word2);
      expect(resFinished.isFinished).toBe(true);
      expect(resFinished.progress).toBe(100);
    });

    it('uses 0.8s fallback duration for trailing word without explicit duration', () => {
      const lastWord: LyricWord = { time_secs: 20.0, text: 'Mine' };
      const resMid = computeWordProgress(20.4, lastWord);
      expect(resMid.duration).toBe(0.8);
      expect(resMid.progress).toBeCloseTo(50, 4);

      const resEnd = computeWordProgress(20.8, lastWord);
      expect(resEnd.isFinished).toBe(true);
      expect(resEnd.progress).toBe(100);
    });

    it('strictly clamps progress values within [0, 100]', () => {
      const word: LyricWord = { time_secs: 15.0, duration_secs: 1.0, text: 'Test' };
      expect(computeWordProgress(0.0, word).progress).toBe(0);
      expect(computeWordProgress(14.99, word).progress).toBe(0);
      expect(computeWordProgress(15.25, word).progress).toBeCloseTo(25, 4);
      expect(computeWordProgress(15.75, word).progress).toBeCloseTo(75, 4);
      expect(computeWordProgress(16.0, word).progress).toBe(100);
      expect(computeWordProgress(999.0, word).progress).toBe(100);
    });

    it('handles zero duration_secs without division by zero panics or NaN', () => {
      const zeroDurationWord: LyricWord = { time_secs: 10.0, duration_secs: 0, text: 'Zero' };
      const nextWord: LyricWord = { time_secs: 12.0, text: 'Next' };

      // With next word available, falls back to (12.0 - 10.0) = 2.0s
      const resWithNext = computeWordProgress(11.0, zeroDurationWord, nextWord);
      expect(resWithNext.duration).toBe(2.0);
      expect(resWithNext.progress).toBeCloseTo(50, 4);
      expect(Number.isNaN(resWithNext.progress)).toBe(false);

      // Without next word available, falls back to 0.8s default
      const resWithoutNext = computeWordProgress(10.4, zeroDurationWord);
      expect(resWithoutNext.duration).toBe(0.8);
      expect(resWithoutNext.progress).toBeCloseTo(50, 4);
      expect(Number.isNaN(resWithoutNext.progress)).toBe(false);
    });

    it('handles negative duration_secs safely by falling back to positive interval', () => {
      const negativeDurationWord: LyricWord = { time_secs: 10.0, duration_secs: -1.5, text: 'Neg' };
      const nextWord: LyricWord = { time_secs: 11.0, text: 'Next' };

      const res = computeWordProgress(10.5, negativeDurationWord, nextWord);
      expect(res.duration).toBe(1.0);
      expect(res.progress).toBeCloseTo(50, 4);
      expect(res.progress).toBeGreaterThanOrEqual(0);
    });

    it('handles overlapping or disordered word timestamps (T_{k+1} <= T_k) safely', () => {
      const word1: LyricWord = { time_secs: 10.0, text: 'First' };
      const word2: LyricWord = { time_secs: 9.5, text: 'Disordered' };

      const res = computeWordProgress(10.4, word1, word2);
      expect(res.duration).toBe(0.8);
      // Because word2.time_secs (9.5) <= currentTime (10.4), isFinished evaluates to true when nextWord exists
      expect(res.isFinished).toBe(true);
      expect(res.progress).toBe(100);
    });

    it('handles inter-word pauses and silence gaps correctly', () => {
      const word1: LyricWord = { time_secs: 1.0, duration_secs: 0.5, text: 'Wait ' };
      const word2: LyricWord = { time_secs: 3.0, duration_secs: 0.5, text: 'For it' };

      // During inter-word silence (t = 2.0s):
      // word1 is finished (100%)
      const res1 = computeWordProgress(2.0, word1, word2);
      expect(res1.isFinished).toBe(true);
      expect(res1.progress).toBe(100);

      // word2 has not started yet (0%)
      const res2 = computeWordProgress(2.0, word2);
      expect(res2.isStarted).toBe(false);
      expect(res2.isFinished).toBe(false);
      expect(res2.progress).toBe(0);
    });

    it('handles sub-millisecond precision durations accurately', () => {
      const microWord: LyricWord = { time_secs: 10.000, duration_secs: 0.010, text: 'Quick' };
      
      const resQuarter = computeWordProgress(10.0025, microWord);
      expect(resQuarter.progress).toBeCloseTo(25, 2);

      const resHalf = computeWordProgress(10.0050, microWord);
      expect(resHalf.progress).toBeCloseTo(50, 2);

      const resDone = computeWordProgress(10.0100, microWord);
      expect(resDone.progress).toBe(100);
    });

    it('handles extreme negative and infinite timestamps without crashing', () => {
      const word: LyricWord = { time_secs: 5.0, duration_secs: 1.0, text: 'Extreme' };
      
      expect(computeWordProgress(-999999, word).progress).toBe(0);
      expect(computeWordProgress(-999999, word).isStarted).toBe(false);

      expect(computeWordProgress(999999, word).progress).toBe(100);
      expect(computeWordProgress(999999, word).isFinished).toBe(true);
    });
  });

  describe('3. Multi-Word Line Karaoke Sequence Simulation', () => {
    const testLine: LyricLine = {
      time_secs: 10.0,
      text: 'Never gonna give you up',
      words: [
        { time_secs: 10.0, duration_secs: 0.5, text: 'Never ' },
        { time_secs: 10.5, duration_secs: 0.5, text: 'gonna ' },
        { time_secs: 11.0, duration_secs: 0.6, text: 'give ' },
        { time_secs: 11.6, duration_secs: 0.4, text: 'you ' },
        { time_secs: 12.0, duration_secs: 0.8, text: 'up' },
      ]
    };

    it('progresses sequentially across all words in the line', () => {
      const words = testLine.words!;

      // t = 9.9s -> All words at 0%
      words.forEach((w, i) => {
        expect(computeWordProgress(9.9, w, words[i + 1]).progress).toBe(0);
      });

      // t = 10.25s -> Word 0 at 50%, rest at 0%
      expect(computeWordProgress(10.25, words[0], words[1]).progress).toBeCloseTo(50, 4);
      expect(computeWordProgress(10.25, words[1], words[2]).progress).toBe(0);

      // t = 10.75s -> Word 0 at 100%, Word 1 at 50%, rest at 0%
      expect(computeWordProgress(10.75, words[0], words[1]).progress).toBe(100);
      expect(computeWordProgress(10.75, words[1], words[2]).progress).toBeCloseTo(50, 4);
      expect(computeWordProgress(10.75, words[2], words[3]).progress).toBe(0);

      // t = 13.0s -> All words at 100%
      words.forEach((w, i) => {
        expect(computeWordProgress(13.0, w, words[i + 1]).progress).toBe(100);
      });
    });
  });

  describe('4. Graceful Fallbacks & Mode Rendering Semantics', () => {
    it('handles lines without syllable words by falling back to line text', () => {
      const plainLine: LyricLine = {
        time_secs: 5.0,
        text: 'Plain line without word sync'
      };

      expect(plainLine.words).toBeUndefined();
      // In karaoke or line_sync mode, component renders plain text directly
      expect(plainLine.text).toBe('Plain line without word sync');
    });

    it('handles empty words array gracefully', () => {
      const emptyWordsLine: LyricLine = {
        time_secs: 8.0,
        text: 'Line with empty words array',
        words: []
      };

      const hasWords = Boolean(emptyWordsLine.words && emptyWordsLine.words.length > 0);
      expect(hasWords).toBe(false);
    });

    it('correctly calculates hasWordSync for mixed tracks', () => {
      const mixedLyrics: LyricLine[] = [
        { time_secs: 0, text: 'Intro (instrumental)' },
        { time_secs: 4, text: 'Synced syllable line', words: [{ time_secs: 4, text: 'Synced ' }, { time_secs: 5, text: 'line' }] },
        { time_secs: 8, text: 'Plain line' }
      ];

      const hasWordSync = mixedLyrics.some(l => l.words && l.words.length > 0);
      expect(hasWordSync).toBe(true);

      const plainOnlyLyrics: LyricLine[] = [
        { time_secs: 0, text: 'Line 1' },
        { time_secs: 4, text: 'Line 2' }
      ];
      expect(plainOnlyLyrics.some(l => l.words && l.words.length > 0)).toBe(false);
    });

    it('simulates cyclic mode switcher sequence', () => {
      let currentMode: 'karaoke' | 'line_sync' | 'static' = 'karaoke';
      const cycleMode = (mode: 'karaoke' | 'line_sync' | 'static'): 'karaoke' | 'line_sync' | 'static' => {
        return mode === 'karaoke' ? 'line_sync' : mode === 'line_sync' ? 'static' : 'karaoke';
      };

      currentMode = cycleMode(currentMode);
      expect(currentMode).toBe('line_sync');

      currentMode = cycleMode(currentMode);
      expect(currentMode).toBe('static');

      currentMode = cycleMode(currentMode);
      expect(currentMode).toBe('karaoke');
    });
  });

  describe('5. IPC Cross-Window Synchronization (desktop-lyrics-sync)', () => {
    it('carries lyricsDisplayMode in pollStatus periodic broadcast when desktop lyrics are open', async () => {
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === 'get_playback_status') {
          return Promise.resolve({
            status: 'Playing',
            current_track: 'C:/Music/test.flac',
            position_secs: 15.0,
            volume: 0.8,
            exclusive: false,
            bit_perfect: false,
            dev_rate: 44100,
            driver_type: 'WASAPI'
          });
        }
        return Promise.resolve(null);
      });

      useStore.setState({
        desktopLyricsOpen: true,
        lyricsDisplayMode: 'line_sync',
        accentColor: '#10b981',
        desktopLyricsLocked: true,
        playback: {
          status: 'Playing',
          current_track: 'C:/Music/test.flac',
          position_secs: 10.0,
          volume: 0.8,
          exclusive: false,
          bit_perfect: false,
          dev_rate: 44100,
          driver_type: 'WASAPI',
        },
        currentTrack: {
          id: 1,
          path: 'C:/Music/test.flac',
          title: 'Test Song',
          artist: 'Test Artist',
          duration: 180,
          format: 'FLAC',
          lyric_offset: 0
        },
        lyrics: [{ time_secs: 10, text: 'Hello World' }]
      });

      await useStore.getState().pollStatus();

      expect(emit).toHaveBeenCalledWith('desktop-lyrics-sync', {
        currentTrack: expect.objectContaining({ title: 'Test Song' }),
        playback: expect.objectContaining({ status: 'Playing', position_secs: 15.0 }),
        lyrics: expect.arrayContaining([{ time_secs: 10, text: 'Hello World' }]),
        lyricOffset: 0,
        showRomaji: false,
        showTranslation: false,
        accentColor: '#10b981',
        desktopLyricsLocked: true,
        lyricsDisplayMode: 'line_sync',
      });
    });

    it('does not emit desktop-lyrics-sync when desktop lyrics window is closed', async () => {
      vi.clearAllMocks();
      (invoke as any).mockResolvedValue({
        status: 'Playing',
        current_track: 'C:/Music/test.flac',
        position_secs: 5.0,
      });

      useStore.setState({
        desktopLyricsOpen: false,
        lyricsDisplayMode: 'karaoke'
      });

      await useStore.getState().pollStatus();

      expect(emit).not.toHaveBeenCalledWith('desktop-lyrics-sync', expect.anything());
    });
  });

  describe('6. DesktopLyricBar Accent-Colored Gradient Wipe & Visual Semantics', () => {
    function computeDesktopWordStyle(
      currentTime: number,
      word: LyricWord,
      nextWord: LyricWord | undefined,
      accentColor: string,
      mode: 'karaoke' | 'line_sync' | 'static'
    ) {
      if (mode !== 'karaoke') {
        return { isKaraokeRender: false, text: word.text, style: undefined as Record<string, string> | undefined };
      }

      const { progress } = computeWordProgress(currentTime, word, nextWord);
      return {
        isKaraokeRender: true,
        text: word.text,
        className: 'desktop-lyric-word',
        style: {
          '--word-progress': `${progress}%`,
          '--desktop-accent': accentColor,
        },
        progress,
      };
    }

    it('generates dynamic accent-colored linear gradient in Karaoke mode', () => {
      const word: LyricWord = { time_secs: 10.0, duration_secs: 2.0, text: 'Vibrant' };
      const accent = '#ec4899';

      // 50% progress at t=11.0s
      const midStyle = computeDesktopWordStyle(11.0, word, undefined, accent, 'karaoke');
      expect(midStyle.isKaraokeRender).toBe(true);
      expect(midStyle.progress).toBeCloseTo(50, 4);
      expect(midStyle.style?.['--word-progress']).toBe('50%');
      expect(midStyle.style?.['--desktop-accent']).toBe('#ec4899');

      // 0% progress at t=9.0s
      const preStyle = computeDesktopWordStyle(9.0, word, undefined, accent, 'karaoke');
      expect(preStyle.progress).toBe(0);
      expect(preStyle.style?.['--word-progress']).toBe('0%');

      // 100% progress at t=13.0s
      const postStyle = computeDesktopWordStyle(13.0, word, undefined, accent, 'karaoke');
      expect(postStyle.progress).toBe(100);
      expect(postStyle.style?.['--word-progress']).toBe('100%');
    });

    it('does not apply word gradient wipe when display mode is line_sync or static', () => {
      const word: LyricWord = { time_secs: 10.0, duration_secs: 2.0, text: 'Plain' };
      const accent = '#8b5cf6';

      const lineSyncStyle = computeDesktopWordStyle(11.0, word, undefined, accent, 'line_sync');
      expect(lineSyncStyle.isKaraokeRender).toBe(false);
      expect((lineSyncStyle as any).background).toBeUndefined();

      const staticStyle = computeDesktopWordStyle(11.0, word, undefined, accent, 'static');
      expect(staticStyle.isKaraokeRender).toBe(false);
      expect((staticStyle as any).background).toBeUndefined();
    });
  });

  describe('8. Lyrics Header Visibility & Persistence Suite', () => {
    it('defaults showLyricsHeader to true when storage is empty', () => {
      const state = useStore.getState();
      expect(state.showLyricsHeader).toBe(true);
    });

    it('toggles showLyricsHeader using toggleLyricsHeader and persists state', () => {
      const store = useStore.getState();
      expect(store.showLyricsHeader).toBe(true);

      store.toggleLyricsHeader();
      expect(useStore.getState().showLyricsHeader).toBe(false);
      expect(safeGetStorage('aideo-show-lyrics-header')).toBe('false');

      store.toggleLyricsHeader();
      expect(useStore.getState().showLyricsHeader).toBe(true);
      expect(safeGetStorage('aideo-show-lyrics-header')).toBe('true');
    });

    it('sets showLyricsHeader explicitly via setShowLyricsHeader and persists to storage', () => {
      const store = useStore.getState();

      store.setShowLyricsHeader(false);
      expect(useStore.getState().showLyricsHeader).toBe(false);
      expect(safeGetStorage('aideo-show-lyrics-header')).toBe('false');

      store.setShowLyricsHeader(true);
      expect(useStore.getState().showLyricsHeader).toBe(true);
      expect(safeGetStorage('aideo-show-lyrics-header')).toBe('true');
    });
  });

  describe('9. Smooth Playback Position Clock & Real-time Active Index Suite', () => {
    it('advances activeIdx in real-time as position moves in sub-second increments', () => {
      const sampleLyrics: LyricLine[] = [
        { time_secs: 0.0, text: 'First line', words: [{ time_secs: 0.0, duration_secs: 1.0, text: 'First' }] },
        { time_secs: 1.2, text: 'Second line', words: [{ time_secs: 1.2, duration_secs: 1.0, text: 'Second' }] },
        { time_secs: 2.5, text: 'Third line', words: [{ time_secs: 2.5, duration_secs: 1.0, text: 'Third' }] },
      ];

      const getActiveIndex = (currentTime: number, offsetMs = 0) => {
        const now = currentTime + offsetMs / 1000;
        let idx = -1;
        for (let i = 0; i < sampleLyrics.length; i++) {
          if (sampleLyrics[i].time_secs <= now) idx = i; else break;
        }
        return idx;
      };

      // At 0.5s -> line 0
      expect(getActiveIndex(0.5)).toBe(0);

      // At 1.25s (before 2s heartbeat) -> smoothly transitions to line 1 immediately
      expect(getActiveIndex(1.25)).toBe(1);

      // At 2.55s -> smoothly transitions to line 2 immediately
      expect(getActiveIndex(2.55)).toBe(2);
    });

    it('smooth clock extrapolation calculates correct delta and clamps to duration', () => {
      let currentPos = 10.0;
      const trackDuration = 10.5;
      const deltaSecs = 0.1; // 100ms tick

      currentPos = Math.min(trackDuration, currentPos + deltaSecs);
      expect(currentPos).toBeCloseTo(10.1, 4);

      // Multiple ticks up to and beyond duration
      for (let i = 0; i < 10; i++) {
        currentPos = Math.min(trackDuration, currentPos + deltaSecs);
      }
      expect(currentPos).toBe(10.5);
    });
  });
});
