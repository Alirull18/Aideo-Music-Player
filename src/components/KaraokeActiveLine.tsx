import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LyricWord } from '../store/types';

interface KaraokeActiveLineProps {
  words: LyricWord[];
  positionSecs: number;
  lyricOffset: number;
  isPlaying: boolean;
  className?: string;
}

const formatProgress = (val: number): string => {
  return Number.isInteger(val) ? `${val}%` : `${val.toFixed(2)}%`;
};

function KaraokeActiveLineComponent({
  words,
  positionSecs,
  lyricOffset,
  isPlaying,
  className,
}: KaraokeActiveLineProps) {
  const [smoothedTime, setSmoothedTime] = useState(positionSecs);
  const lastPositionRef = useRef(positionSecs);
  const lastTimeRef = useRef(performance.now());
  const prevWordsRef = useRef(words);
  const prevPlayingRef = useRef(isPlaying);

  // When words change (line transition), re-anchor immediately
  if (prevWordsRef.current !== words) {
    prevWordsRef.current = words;
    lastPositionRef.current = positionSecs;
    lastTimeRef.current = performance.now();
    if (smoothedTime !== positionSecs) {
      setSmoothedTime(positionSecs);
    }
  }

  // Handle play/pause transitions and external seek jumps
  useEffect(() => {
    const isPlayingTransition = prevPlayingRef.current !== isPlaying;
    prevPlayingRef.current = isPlaying;

    if (!isPlaying || isPlayingTransition) {
      lastPositionRef.current = positionSecs;
      lastTimeRef.current = performance.now();
      setSmoothedTime(positionSecs);
      return;
    }

    // During active playback, calculate extrapolated time from continuous monotonic clock
    const now = performance.now();
    const elapsed = Math.max(0, (now - lastTimeRef.current) / 1000);
    const currentExtrapolated = lastPositionRef.current + elapsed;
    const diff = positionSecs - currentExtrapolated;

    // Only re-anchor if there is a real external seek/skip (diff >= 0.8s)
    // Routine 100ms clock ticks and 2s backend reconciliations (< 0.8s) are ignored so rAF is completely smooth
    if (Math.abs(diff) >= 0.8) {
      lastPositionRef.current = positionSecs;
      lastTimeRef.current = now;
      setSmoothedTime(positionSecs);
    }
  }, [positionSecs, isPlaying]);

  // RequestAnimationFrame loop: exact v0.9.6 continuous 60fps/120fps/144fps interpolation
  useEffect(() => {
    if (!isPlaying) return;

    let frameId: number;
    const update = () => {
      const now = performance.now();
      const delta = Math.max(0, (now - lastTimeRef.current) / 1000);
      const interpolated = lastPositionRef.current + delta;
      setSmoothedTime(interpolated);
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying]);

  const calculateWordProgress = useCallback((word: LyricWord, nextWord: LyricWord | undefined, currentTime: number) => {
    const duration =
      word.duration_secs && word.duration_secs > 0
        ? word.duration_secs
        : nextWord && nextWord.time_secs > word.time_secs
        ? nextWord.time_secs - word.time_secs
        : 0.8;

    if (currentTime < word.time_secs) {
      return 0;
    }

    const finishTime =
      word.duration_secs && word.duration_secs > 0
        ? word.time_secs + word.duration_secs
        : nextWord && nextWord.time_secs > word.time_secs
        ? nextWord.time_secs
        : word.time_secs + duration;

    if (currentTime >= finishTime) {
      return 100;
    }

    return Math.min(100, Math.max(0, ((currentTime - word.time_secs) / duration) * 100));
  }, []);

  const currentTime = smoothedTime + lyricOffset / 1000;

  return (
    <>
      {words.map((word, wordIdx) => {
        const nextWord = words[wordIdx + 1];
        const progress = calculateWordProgress(word, nextWord, currentTime);
        const progressStr = formatProgress(progress);

        const rawText = word.text || '';
        const trimmed = rawText.trim();
        let leadingSpace = '';
        let coreText = rawText;
        let trailingSpace = '';

        if (trimmed.length === 0) {
          coreText = '';
        } else {
          const firstNonSpace = rawText.indexOf(trimmed);
          leadingSpace = rawText.slice(0, firstNonSpace);
          trailingSpace = rawText.slice(firstNonSpace + trimmed.length);
          coreText = trimmed;
        }

        if (!coreText) {
          return (
            <span
              key={wordIdx}
              className={className || 'lyric-word'}
              style={{
                '--word-progress': progressStr,
                whiteSpace: 'pre',
              } as React.CSSProperties}
            >
              {rawText}
            </span>
          );
        }

        return (
          <React.Fragment key={wordIdx}>
            {leadingSpace && (
              <span className="lyric-word-space" style={{ whiteSpace: 'pre' }}>
                {leadingSpace}
              </span>
            )}
            <span
              className={className || 'lyric-word'}
              style={{
                '--word-progress': progressStr,
              } as React.CSSProperties}
            >
              {coreText}
            </span>
            {trailingSpace && (
              <span className="lyric-word-space" style={{ whiteSpace: 'pre' }}>
                {trailingSpace}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

export const KaraokeActiveLine = React.memo(KaraokeActiveLineComponent, (prev, next) => {
  if (prev.words !== next.words) return false;
  if (prev.isPlaying !== next.isPlaying) return false;
  if (prev.lyricOffset !== next.lyricOffset) return false;
  if (prev.className !== next.className) return false;
  // If paused or stopped, re-render when position changes so scrub/step reflects immediately
  if (!next.isPlaying) {
    return prev.positionSecs === next.positionSecs;
  }
  // During active playback:
  // Normal 100ms clock ticks and backend status reconciliations (< 0.8s) must NOT trigger React re-renders from parent!
  // The internal requestAnimationFrame loop drives continuous 60fps/120fps/144fps state updates directly.
  // Only re-render if there is an explicit external seek jump (diff >= 0.8s).
  if (Math.abs(prev.positionSecs - next.positionSecs) < 0.8) {
    return true; // Skip React re-render from parent during normal continuous playback!
  }
  return false; // Substantial seek jump: allow re-render to resync.
});
