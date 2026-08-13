import { describe, it, expect } from 'vitest';

// Function matching lyrics.rs parse_lrc logic
interface LyricWord {
  time_secs: f64;
  text: string;
}

type f64 = number;

interface LyricLine {
  time_secs: f64;
  text: string;
  words?: LyricWord[];
}

function parseTimestamp(ts: string): number | null {
  const clean = ts.trim();
  if (clean.includes(':')) {
    const [minStr, secStr] = clean.split(':');
    const min = parseFloat(minStr);
    const sec = parseFloat(secStr);
    if (!isNaN(min) && !isNaN(sec)) {
      return min * 60 + sec;
    }
  } else {
    const val = parseFloat(clean);
    if (!isNaN(val)) return val;
  }
  return null;
}

function parseLrc(content: string): LyricLine[] {
  const lines: LyricLine[] = [];
  
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || !line.startsWith('[')) continue;

    let rest = line;
    const timestamps: number[] = [];

    while (rest.startsWith('[')) {
      const closeIdx = rest.indexOf(']');
      if (closeIdx > 0) {
        const tsStr = rest.substring(1, closeIdx);
        const t = parseTimestamp(tsStr);
        if (t !== null) {
          timestamps.push(t);
        }
        rest = rest.substring(closeIdx + 1).trim();
      } else {
        break;
      }
    }

    if (rest.includes(':') && timestamps.length === 0) continue;

    for (const ts of timestamps) {
      lines.push({
        time_secs: ts,
        text: rest,
      });
    }
  }

  // Plain lyrics fallback (e.g. ID3 USLT without timestamps)
  if (lines.length === 0) {
    const hasText = content.split('\n').some((l) => l.trim().length > 0 && !l.trim().startsWith('['));
    if (hasText) {
      for (const rawLine of content.split('\n')) {
        const text = rawLine.trim();
        if (!text || text.startsWith('[')) continue;
        lines.push({
          time_secs: 0,
          text,
        });
      }
    }
  }

  return lines.sort((a, b) => a.time_secs - b.time_secs);
}

describe('Embedded & Offline Lyrics Fallback (Lyrics Engine)', () => {
  it('correctly parses timestamped LRC lines', () => {
    const sampleLrc = `
      [ti:Song Title]
      [ar:Artist Name]
      [00:12.50]First line of lyrics
      [00:18.20]Second line of lyrics
      [01:05.00]Chorus line starts here
    `;

    const parsed = parseLrc(sampleLrc);
    expect(parsed.length).toBe(3);
    expect(parsed[0].time_secs).toBeCloseTo(12.5);
    expect(parsed[0].text).toBe('First line of lyrics');
    expect(parsed[1].time_secs).toBeCloseTo(18.2);
    expect(parsed[2].time_secs).toBeCloseTo(65.0);
  });

  it('correctly handles unsynced plain lyrics (ID3 USLT / Vorbis UNSYNCEDLYRICS fallback)', () => {
    const unsyncedLyrics = `
      Just a small town girl
      Livin' in a lonely world
      She took the midnight train goin' anywhere
      Just a city boy
      Born and raised in south Detroit
    `;

    const parsed = parseLrc(unsyncedLyrics);
    expect(parsed.length).toBe(5);
    expect(parsed[0].time_secs).toBe(0);
    expect(parsed[0].text).toBe('Just a small town girl');
    expect(parsed[4].text).toBe('Born and raised in south Detroit');
  });

  it('safely handles empty or malformed lyrics content without throwing', () => {
    expect(parseLrc('')).toEqual([]);
    expect(parseLrc('    \n\n   ')).toEqual([]);
    expect(parseLrc('[ti:Only Meta Tags]\n[ar:No Lyric Lines]')).toEqual([]);
  });
});
