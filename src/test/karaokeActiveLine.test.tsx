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
});

