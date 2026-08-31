import React, { useRef, useEffect, useCallback } from 'react';
import { LyricWord } from '../store/types';

interface KaraokeActiveLineProps {
  words: LyricWord[];
  positionSecs: number;
  lyricOffset: number;
  isPlaying: boolean;
  className?: string;
}

export function KaraokeActiveLine({
  words,
  positionSecs,
  lyricOffset,
  isPlaying,
  className,
}: KaraokeActiveLineProps) {
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const lastPosRef = useRef(positionSecs);
  const lastTimeRef = useRef(performance.now());
  const lyricOffsetRef = useRef(lyricOffset);
  const wordsRef = useRef(words);

  lastPosRef.current = positionSecs;
  lyricOffsetRef.current = lyricOffset;
  wordsRef.current = words;

  const calculateWordProgress = useCallback((word: LyricWord, nextWord: LyricWord | undefined, currentTime: number) => {
    const duration =
      word.duration_secs && word.duration_secs > 0
        ? word.duration_secs
        : nextWord && nextWord.time_secs > word.time_secs
        ? nextWord.time_secs - word.time_secs
        : 0.8;
    const isStarted = currentTime >= word.time_secs;
    const isFinished =
      word.duration_secs && word.duration_secs > 0
        ? currentTime >= word.time_secs + word.duration_secs
        : nextWord
        ? currentTime >= nextWord.time_secs
        : currentTime >= word.time_secs + duration;

    let progress = 0;
    if (isFinished) {
      progress = 100;
    } else if (isStarted) {
      progress = Math.min(100, Math.max(0, ((currentTime - word.time_secs) / duration) * 100));
    }
    return progress;
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
    lastPosRef.current = positionSecs;
    lastTimeRef.current = performance.now();
    updateDomProgress(positionSecs + lyricOffset / 1000);
  }, [positionSecs, lyricOffset, updateDomProgress]);

  useEffect(() => {
    if (!isPlaying) return;
    let frameId: number;
    const update = () => {
      const delta = (performance.now() - lastTimeRef.current) / 1000;
      const currentTime = lastPosRef.current + Math.max(0, delta) + lyricOffsetRef.current / 1000;
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

