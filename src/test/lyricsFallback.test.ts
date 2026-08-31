import { describe, it, expect } from 'vitest';
import { cleanSearchQuery } from '../utils';

// Types matching lyrics.rs / metadataSlice.ts
interface LyricWord {
  time_secs: number;
  text: string;
  duration_secs?: number;
}

interface LyricLine {
  time_secs: number;
  text: string;
  words?: LyricWord[];
}

interface SearchResult {
  id: string;
  title: string;
  artist: string;
  source: string;
  synced: boolean;
  content_id?: string;
  raw_lrc?: string;
  duration?: number;
}

function parseTimestamp(ts: string): number | null {
  const clean = ts.trim();
  if (clean.includes(',')) {
    const parts = clean.split(',');
    if (parts.length > 0) {
      const startStr = parts[0].trim();
      if (startStr.includes(':')) {
        return parseTimestamp(startStr);
      }
      const ms = parseFloat(startStr);
      if (!isNaN(ms)) return ms / 1000.0;
    }
  }
  if (clean.includes(':')) {
    const parts = clean.split(':');
    if (parts.length === 2) {
      const m = parseFloat(parts[0]);
      const sec = parseFloat(parts[1]);
      if (!isNaN(m) && !isNaN(sec)) return m * 60 + sec;
    } else if (parts.length === 3) {
      const h = parseFloat(parts[0]);
      const m = parseFloat(parts[1]);
      const sec = parseFloat(parts[2]);
      if (!isNaN(h) && !isNaN(m) && !isNaN(sec)) return h * 3600 + m * 60 + sec;
    }
  } else {
    const val = parseFloat(clean);
    if (!isNaN(val)) return val;
  }
  return null;
}

function parseLineWords(lineStartSecs: number, text: string): { cleanText: string; words?: LyricWord[] } {
  // 1. NetEase KLyric prefix (offset,dur)word vs QQ Music suffix word(offset,dur)
  if (text.includes('(') && text.includes(')')) {
    const words: LyricWord[] = [];
    const cleanParts: string[] = [];
    const parts = text.split('(');

    if (parts.length > 0) {
      const firstPart = parts[0];
      if (firstPart.trim().length === 0) {
        // Prefix format: (offset,dur)word
        for (const part of parts.slice(1)) {
          const closeIdx = part.indexOf(')');
          if (closeIdx > 0) {
            const metaStr = part.substring(0, closeIdx);
            const wordText = part.substring(closeIdx + 1);
            const nums = metaStr.split(',');
            if (nums.length >= 2) {
              const offsetMs = parseFloat(nums[0].trim());
              const durationMs = parseFloat(nums[1].trim());
              if (!isNaN(offsetMs) && !isNaN(durationMs)) {
                words.push({
                  time_secs: lineStartSecs + offsetMs / 1000,
                  text: wordText,
                  duration_secs: durationMs > 0 ? durationMs / 1000 : undefined,
                });
                cleanParts.push(wordText);
              }
            }
          }
        }
      } else {
        // Suffix format: word(offset,dur)
        let currentWordText = firstPart;
        for (const part of parts.slice(1)) {
          const closeIdx = part.indexOf(')');
          if (closeIdx > 0) {
            const metaStr = part.substring(0, closeIdx);
            const nextPrefix = part.substring(closeIdx + 1);
            const nums = metaStr.split(',');
            if (nums.length >= 2) {
              const offsetMs = parseFloat(nums[0].trim());
              const durationMs = parseFloat(nums[1].trim());
              if (!isNaN(offsetMs) && !isNaN(durationMs)) {
                words.push({
                  time_secs: lineStartSecs + offsetMs / 1000,
                  text: currentWordText,
                  duration_secs: durationMs > 0 ? durationMs / 1000 : undefined,
                });
                cleanParts.push(currentWordText);
              }
            }
            currentWordText = nextPrefix;
          }
        }
        if (currentWordText.trim().length > 0) {
          cleanParts.push(currentWordText);
        }
      }

      if (words.length > 0) {
        return { cleanText: cleanParts.join('').trim(), words };
      }
    }
  }

  return { cleanText: text.trim(), words: undefined };
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

    const lineStart = timestamps[0] ?? 0;
    const { cleanText, words } = parseLineWords(lineStart, rest);

    for (const ts of timestamps) {
      lines.push({
        time_secs: ts,
        text: cleanText,
        words,
      });
    }
  }

  // Plain lyrics fallback (e.g. ID3 USLT / LRCLIB plainLyrics without timestamps)
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

// Function matching scoring formula in metadataSlice.ts & LyricsPanel.tsx
function scoreLyricResult(
  r: SearchResult,
  targetTitle: string,
  targetArtist: string,
  targetDuration?: number,
  index: number = 0
): { score: number; titleScore: number } {
  const clean = (s: string) => s.toLowerCase()
    .replace(/[()\[\]\-\s_]+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

  const pTitle = clean(targetTitle);
  const rTitle = clean(r.title);

  let titleScore = 0;
  if (pTitle === rTitle) {
    titleScore = 1.0;
  } else if (pTitle.includes(rTitle) || rTitle.includes(pTitle)) {
    titleScore = 0.6;
  }

  const pArtist = clean(targetArtist);
  const rArtist = clean(r.artist);
  let artistScore = 0;
  if (pArtist && rArtist) {
    if (pArtist === rArtist || rArtist.includes(pArtist) || pArtist.includes(rArtist)) {
      artistScore = 1.0;
    }
  } else if (!targetArtist || targetArtist.trim() === '') {
    artistScore = 0.5;
  }

  let durationBonus = 0;
  if (targetDuration && r.duration) {
    const diff = Math.abs(targetDuration - r.duration);
    if (diff <= 3) {
      durationBonus = 0.5;
    } else if (diff <= 15) {
      durationBonus = 0.2;
    } else if (diff > 60) {
      durationBonus = -0.3;
    }
  }

  // Word-sync bonus (BiniLyrics Apple TTML, Better Lyrics TTML, NetEase YRC, Kugou KRC, QQ QRC) vs line sync vs plain text
  let syncBonus = 0.0;
  const raw = r.raw_lrc || '';
  const hasWordTiming = raw.includes('<span') || raw.includes('<tt') || raw.includes('(') || raw.includes('<');
  if (r.source === 'BiniLyrics' || r.source === 'Better Lyrics' || r.source === 'Unison' || r.source === 'NetEase' || r.source === 'Kugou' || hasWordTiming) {
    syncBonus = 0.40;
  } else if (r.synced || raw.includes('[')) {
    syncBonus = 0.15;
  }

  // Provider cascade priority bonus: BiniLyrics / Better Lyrics (1) > NetEase / Kugou (2) > QQMusic (3) > LRCLIB (4)
  let sourceBonus = 0.0;
  if (r.source === 'BiniLyrics' || r.source === 'Better Lyrics' || r.source === 'Unison') sourceBonus = 0.25;
  else if (r.source === 'NetEase' || r.source === 'Kugou') sourceBonus = 0.15;
  else if (r.source === 'QQMusic') sourceBonus = 0.05;

  const rankBonus = Math.max(0, 0.15 - (index * 0.03));
  const score = (titleScore * 0.5) + (artistScore * 0.3) + durationBonus + syncBonus + sourceBonus + rankBonus;

  return { score, titleScore };
}

// Function matching duration-delta intro offset calibration
function calculateDurationDeltaOffset(audioDuration?: number, lyricDuration?: number): number {
  if (!audioDuration || !lyricDuration) return 0;
  const diffSec = audioDuration - lyricDuration;
  if (diffSec > 2 && diffSec < 120) {
    return Math.round(diffSec * 10) * 100;
  }
  return 0;
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

  it('correctly parses NetEase KLyric prefix timestamps into word tokens', () => {
    const klyric = '[00:10.00](0,500)Ne(500,300)ver (800,400)gon(1200,300)na';
    const parsed = parseLrc(klyric);
    expect(parsed.length).toBe(1);
    expect(parsed[0].time_secs).toBe(10.0);
    expect(parsed[0].text).toBe('Never gonna');
    expect(parsed[0].words?.length).toBe(4);
    expect(parsed[0].words![0].text).toBe('Ne');
    expect(parsed[0].words![0].time_secs).toBeCloseTo(10.0);
    expect(parsed[0].words![1].text).toBe('ver ');
    expect(parsed[0].words![1].time_secs).toBeCloseTo(10.5);
  });

  it('correctly parses QQ Music QRC suffix timestamps and comma-delimited brackets', () => {
    const qrc = '[0,3500]Never(0,500) gonna(500,400) give(900,300)\n[3500,4000]you(0,200) up(200,500)';
    const parsed = parseLrc(qrc);
    expect(parsed.length).toBe(2);
    expect(parsed[0].time_secs).toBe(0.0);
    expect(parsed[0].text).toBe('Never gonna give');
    expect(parsed[0].words?.length).toBe(3);
    expect(parsed[0].words![0].text).toBe('Never');
    expect(parsed[0].words![0].time_secs).toBe(0.0);
    expect(parsed[0].words![1].text).toBe(' gonna');
    expect(parsed[0].words![1].time_secs).toBe(0.5);
    expect(parsed[1].time_secs).toBe(3.5);
  });
});

describe('Multi-Provider Online Cascade & Fallback Pipeline', () => {
  it('ranks providers by priority cascade: Unison > NetEase > QQMusic > LRCLIB for identical metadata', () => {
    const targetTitle = 'Blinding Lights';
    const targetArtist = 'The Weeknd';
    const targetDuration = 200;

    const unisonResult: SearchResult = {
      id: 'unison-1',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      source: 'Unison',
      synced: true,
      raw_lrc: '<tt xmlns="http://www.w3.org/ns/ttml">...</tt>',
      duration: 200,
    };

    const neteaseResult: SearchResult = {
      id: 'netease-1',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      source: 'NetEase',
      synced: true,
      content_id: '12345',
      duration: 200,
    };

    const qqResult: SearchResult = {
      id: 'qq-1',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      source: 'QQMusic',
      synced: true,
      content_id: 'mid123',
      duration: 200,
    };

    const lrclibResult: SearchResult = {
      id: 'lrclib-1',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      source: 'LRCLIB',
      synced: true,
      raw_lrc: '[00:10.00] I said, ooh',
      duration: 200,
    };

    const sUnison = scoreLyricResult(unisonResult, targetTitle, targetArtist, targetDuration, 0).score;
    const sNetEase = scoreLyricResult(neteaseResult, targetTitle, targetArtist, targetDuration, 0).score;
    const sQQ = scoreLyricResult(qqResult, targetTitle, targetArtist, targetDuration, 0).score;
    const sLRCLIB = scoreLyricResult(lrclibResult, targetTitle, targetArtist, targetDuration, 0).score;

    expect(sUnison).toBeGreaterThan(sNetEase);
    expect(sNetEase).toBeGreaterThan(sQQ);
    expect(sQQ).toBeGreaterThan(sLRCLIB);
  });

  it('filters out results with zero title match score', () => {
    const targetTitle = 'Shape of You';
    const targetArtist = 'Ed Sheeran';

    const unrelatedResult: SearchResult = {
      id: 'lrclib-99',
      title: 'Perfect',
      artist: 'Ed Sheeran',
      source: 'LRCLIB',
      synced: true,
      duration: 260,
    };

    const { titleScore } = scoreLyricResult(unrelatedResult, targetTitle, targetArtist, 233, 0);
    expect(titleScore).toBe(0);
  });

  it('calculates duration-delta intro offset calibration for video/audio discrepancies', () => {
    // 1. YouTube MV with 6.5s intro skit (Audio: 216.5s, Lyric: 210.0s)
    const offset1 = calculateDurationDeltaOffset(216.5, 210.0);
    expect(offset1).toBe(6500);

    // 2. Negligible difference (< 2s) should not trigger offset adjustment
    const offset2 = calculateDurationDeltaOffset(180.5, 181.0);
    expect(offset2).toBe(0);

    // 3. Negative difference (video shorter than studio audio) should not shift forward
    const offset3 = calculateDurationDeltaOffset(200.0, 210.0);
    expect(offset3).toBe(0);

    // 4. Discrepancy > 120s (e.g. extended live version) should not apply auto intro offset
    const offset4 = calculateDurationDeltaOffset(450.0, 200.0);
    expect(offset4).toBe(0);
  });

  it('correctly cleans dirty search queries from YouTube and video stream titles', () => {
    const dirty = cleanSearchQuery('HYBE LABELS', '[MV] BTS (방탄소년단) - Dynamite [Official Video]');
    expect(dirty.artist).toBe('BTS (방탄소년단)');
    expect(dirty.title).toBe('Dynamite');

    const cleanDirect = cleanSearchQuery('Taylor Swift', 'Cruel Summer');
    expect(cleanDirect.artist).toBe('Taylor Swift');
    expect(cleanDirect.title).toBe('Cruel Summer');
  });

  it('simulates multi-provider sequential fallback cascade', async () => {
    // Mock providers returning results or null
    const mockProviders = {
      unison: async (title: string) => title === 'Western Hit' ? { ttml: '<tt>...</tt>' } : null,
      netease: async (title: string) => title === 'K-Pop Hit' ? { klyric: '[00:05.00](0,500)Karaoke' } : null,
      qqmusic: async (title: string) => title === 'C-Pop Hit' ? { qrc: '[0,3500]Word(0,500)' } : null,
      lrclib: async (_title: string) => ({ syncedLyrics: '[00:10.00]Fallback Line' }),
    };

    // Sequential fallback runner
    const runCascade = async (song: string) => {
      const u = await mockProviders.unison(song);
      if (u) return { source: 'Unison', content: u.ttml, wordSync: true };

      const ne = await mockProviders.netease(song);
      if (ne) return { source: 'NetEase', content: ne.klyric, wordSync: true };

      const qq = await mockProviders.qqmusic(song);
      if (qq) return { source: 'QQMusic', content: qq.qrc, wordSync: true };

      const lrc = await mockProviders.lrclib(song);
      if (lrc) return { source: 'LRCLIB', content: lrc.syncedLyrics, wordSync: false };

      return null;
    };

    const res1 = await runCascade('Western Hit');
    expect(res1?.source).toBe('Unison');
    expect(res1?.wordSync).toBe(true);

    const res2 = await runCascade('K-Pop Hit');
    expect(res2?.source).toBe('NetEase');
    expect(res2?.wordSync).toBe(true);

    const res3 = await runCascade('C-Pop Hit');
    expect(res3?.source).toBe('QQMusic');
    expect(res3?.wordSync).toBe(true);

    const res4 = await runCascade('Obscure Indie Song');
    expect(res4?.source).toBe('LRCLIB');
    expect(res4?.wordSync).toBe(false);
  });

  it('correctly resolves lyrics for all supported providers on manual search pick', async () => {
    const mockInvoke = async (cmd: string, args: any): Promise<string> => {
      if (cmd === 'get_unison_ttml') return `<ttml>${args.song}</ttml>`;
      if (cmd === 'get_kugou_krc') return `[00:01.00]kugou:${args.id}`;
      if (cmd === 'get_netease_lrc') return `[00:02.00]netease:${args.id}`;
      if (cmd === 'get_qqmusic_lrc') return `[00:03.00]qqmusic:${args.mid}`;
      return '';
    };

    const resolvePickedLrc = async (r: SearchResult): Promise<string> => {
      let lrc = r.raw_lrc ?? '';
      if (!lrc && (r.source === 'BiniLyrics' || r.source === 'Better Lyrics' || r.source === 'Unison')) {
        lrc = await mockInvoke('get_unison_ttml', { song: r.title });
      }
      if (!lrc && r.source === 'Kugou' && r.content_id) {
        lrc = await mockInvoke('get_kugou_krc', { id: r.content_id, accesskey: r.id });
      }
      if (!lrc && r.source === 'NetEase' && r.content_id) {
        lrc = await mockInvoke('get_netease_lrc', { id: r.content_id });
      }
      if (!lrc && r.source === 'QQMusic' && r.content_id) {
        lrc = await mockInvoke('get_qqmusic_lrc', { mid: r.content_id });
      }
      return lrc;
    };

    const bini = await resolvePickedLrc({ id: '1', title: 'Song A', artist: 'Artist', source: 'BiniLyrics', synced: true });
    expect(bini).toBe('<ttml>Song A</ttml>');

    const better = await resolvePickedLrc({ id: '2', title: 'Song B', artist: 'Artist', source: 'Better Lyrics', synced: true });
    expect(better).toBe('<ttml>Song B</ttml>');

    const kugou = await resolvePickedLrc({ id: 'key123', title: 'Song C', artist: 'Artist', source: 'Kugou', content_id: 'kg99', synced: true });
    expect(kugou).toBe('[00:01.00]kugou:kg99');
  });
});
