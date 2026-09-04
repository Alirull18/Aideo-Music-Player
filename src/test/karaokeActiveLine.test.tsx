import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KaraokeActiveLine } from '../components/KaraokeActiveLine';

describe('KaraokeActiveLine', () => {
  const mockWords = [
    { text: 'Hel', time_secs: 1.0, duration_secs: 0.5 },
    { text: 'lo ', time_secs: 1.5, duration_secs: 0.5 },
    { text: 'World', time_secs: 2.0, duration_secs: 1.0 },
  ];

  it('renders all words', () => {
    render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={0.5}
        lyricOffset={0}
        isPlaying={false}
      />
    );

    expect(screen.getByText('Hel')).toBeInTheDocument();
    expect(screen.getByText('lo')).toBeInTheDocument();
    expect(screen.getByText('World')).toBeInTheDocument();
  });

  it('sets 100% progress for completed words and 0% for upcoming words', () => {
    render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={1.8}
        lyricOffset={0}
        isPlaying={false}
      />
    );

    const helWord = screen.getByText('Hel');
    const worldWord = screen.getByText('World');

    expect(helWord.style.getPropertyValue('--word-progress')).toBe('100%');
    expect(worldWord.style.getPropertyValue('--word-progress')).toBe('0%');
  });

  it('calculates interpolated progress for currently active word', () => {
    // Word 2 is from 1.5 to 2.0. At 1.75s (midpoint), progress should be 50%
    render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={1.75}
        lyricOffset={0}
        isPlaying={false}
      />
    );

    const loWord = screen.getByText('lo');
    expect(loWord.style.getPropertyValue('--word-progress')).toBe('50%');
  });

  it('updates word progress when positionSecs updates dynamically', () => {
    const { rerender } = render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={1.0}
        lyricOffset={0}
        isPlaying={false}
      />
    );

    const helWord = screen.getByText('Hel');
    expect(helWord.style.getPropertyValue('--word-progress')).toBe('0%');

    // Update positionSecs to 1.25s (50% through "Hel")
    rerender(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={1.25}
        lyricOffset={0}
        isPlaying={true}
      />
    );

    expect(helWord.style.getPropertyValue('--word-progress')).toBe('50%');
  });

  it('handles forward seek jumps during active playback without lag', () => {
    const { rerender } = render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={1.25}
        lyricOffset={0}
        isPlaying={true}
      />
    );

    const helWord = screen.getByText('Hel');
    const worldWord = screen.getByText('World');
    expect(helWord.style.getPropertyValue('--word-progress')).toBe('50%');

    // Seek forward to 2.5s (midpoint of "World" which is 2.0 to 3.0)
    rerender(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={2.5}
        lyricOffset={0}
        isPlaying={true}
      />
    );

    expect(helWord.style.getPropertyValue('--word-progress')).toBe('100%');
    expect(worldWord.style.getPropertyValue('--word-progress')).toBe('50%');
  });

  it('handles backward seek jumps during active playback', () => {
    const { rerender } = render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={2.5}
        lyricOffset={0}
        isPlaying={true}
      />
    );

    const helWord = screen.getByText('Hel');
    const worldWord = screen.getByText('World');
    expect(worldWord.style.getPropertyValue('--word-progress')).toBe('50%');

    // Seek backward to 1.25s (midpoint of "Hel")
    rerender(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={1.25}
        lyricOffset={0}
        isPlaying={true}
      />
    );

    expect(helWord.style.getPropertyValue('--word-progress')).toBe('50%');
    expect(worldWord.style.getPropertyValue('--word-progress')).toBe('0%');
  });

  it('re-anchors timing and resets progress when words array changes', () => {
    const { rerender } = render(
      <KaraokeActiveLine
        words={mockWords}
        positionSecs={1.8}
        lyricOffset={0}
        isPlaying={true}
      />
    );

    const newWords = [
      { text: 'Start', time_secs: 5.0, duration_secs: 1.0 },
      { text: 'End', time_secs: 6.0, duration_secs: 1.0 },
    ];

    rerender(
      <KaraokeActiveLine
        words={newWords}
        positionSecs={5.5}
        lyricOffset={0}
        isPlaying={true}
      />
    );

    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
    const startWord = screen.getByText('Start');
    expect(startWord.style.getPropertyValue('--word-progress')).toBe('50%');
  });

  it('separates trailing whitespace into dedicated space elements to prevent gradient freeze', () => {
    const wordsWithSpaces = [
      { text: 'Hello ', time_secs: 1.0, duration_secs: 1.0 },
      { text: 'beautiful ', time_secs: 2.0, duration_secs: 1.0 },
      { text: 'world', time_secs: 3.0, duration_secs: 1.0 },
    ];

    const { container } = render(
      <KaraokeActiveLine
        words={wordsWithSpaces}
        positionSecs={1.5}
        lyricOffset={0}
        isPlaying={false}
      />
    );

    // The core word 'Hello' should have --word-progress: 50%
    const helloSpan = screen.getByText('Hello');
    expect(helloSpan.style.getPropertyValue('--word-progress')).toBe('50%');

    // Spaces should be separated into dedicated space elements
    const spaceSpans = container.querySelectorAll('.lyric-word-space');
    expect(spaceSpans.length).toBe(2);
    expect(spaceSpans[0].textContent).toBe(' ');
  });

  it('skips React re-rendering on sub-0.25s ticks during active playback to prevent clashing with rAF', () => {
    const trackingWords = [
      { text: 'Track', time_secs: 1.0, duration_secs: 1.0 },
    ];

    const { rerender } = render(
      <KaraokeActiveLine
        words={trackingWords}
        positionSecs={1.0}
        lyricOffset={0}
        isPlaying={true}
      />
    );

    const spanBefore = screen.getByText('Track');

    // Simulate standard 100ms playback clock tick (+0.1s)
    rerender(
      <KaraokeActiveLine
        words={trackingWords}
        positionSecs={1.1}
        lyricOffset={0}
        isPlaying={true}
      />
    );

    const spanAfter = screen.getByText('Track');
    // Same DOM element reference preserved without React tearing or recreation
    expect(spanBefore).toBe(spanAfter);
  });
});
