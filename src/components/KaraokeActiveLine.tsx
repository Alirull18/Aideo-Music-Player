import React, { useRef, useEffect, useCallback } from 'react';
import { LyricWord } from '../store/types';

interface KaraokeActiveLineProps {
  words: LyricWord[];
  positionSecs: number;
  lyricOffset: number;
  isPlaying: boolean;
  className?: string;
}

function KaraokeActiveLineComponent({
  words,
  positionSecs,
  lyricOffset,
  isPlaying,
  className,
}: KaraokeActiveLineProps) {
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const basePosRef = useRef(positionSecs);
  const baseTimeRef = useRef(performance.now());
  const lyricOffsetRef = useRef(lyricOffset);
  const wordsRef = useRef(words);

  lyricOffsetRef.current = lyricOffset;
  wordsRef.current = words;

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

  const updateDomProgress = useCallback((currentTime: number) => {
    const currentWords = wordsRef.current;
    for (let i = 0; i < currentWords.length; i++) {
      const span = spanRefs.current[i];
      if (!span) continue;
      const progress = calculateWordProgress(currentWords[i], currentWords[i + 1], currentTime);
      span.style.setProperty('--word-progress', `${progress}%`);
    }
  }, [calculateWordProgress]);

  useEffect(() => {
    basePosRef.current = positionSecs;
    baseTimeRef.current = performance.now();
    updateDomProgress(positionSecs + lyricOffsetRef.current / 1000);
  }, [positionSecs, updateDomProgress]);

  useEffect(() => {
    if (!isPlaying) return;
    let frameId: number;
    const update = () => {
      const elapsed = (performance.now() - baseTimeRef.current) / 1000;
      const currentTime = basePosRef.current + Math.max(0, elapsed) + lyricOffsetRef.current / 1000;
      updateDomProgress(currentTime);
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, updateDomProgress]);

  const initialTime = positionSecs + lyricOffset / 1000;

  return (
    <>
      {words.map((word, wordIdx) => {
        const nextWord = words[wordIdx + 1];
        const progress = calculateWordProgress(word, nextWord, initialTime);

        return (
          <span
            key={wordIdx}
            ref={(el) => {
              spanRefs.current[wordIdx] = el;
            }}
            className={className || 'lyric-word'}
            style={{ '--word-progress': `${progress}%` } as React.CSSProperties}
          >
            {word.text}
          </span>
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
  // External seek jumps (> 0.35s) trigger re-render & re-sync
  if (Math.abs(prev.positionSecs - next.positionSecs) > 0.35) return false;
  // During normal playback, skip re-renders so RequestAnimationFrame drives 60fps DOM styles uninterrupted
  if (next.isPlaying) return true;
  return prev.positionSecs === next.positionSecs;
});

