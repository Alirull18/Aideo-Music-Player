import { describe, it, expect } from 'vitest';
import {
  isSameRecording,
  groupRecordings,
  extractPrimaryArtist,
  normalizeText,
  coreTitle,
} from '../utils/unifiedSources';
import type { Track } from '../store/types';

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: 'C:/Music/test.flac',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    duration_raw: '3:00',
    format: 'FLAC',
    lyric_offset: 0,
    ...overrides,
  };
}

describe('Adversarial Verification — Challenger M1-1 Gen2', () => {
  // =========================================================================
  // 1. Duration Boundary Probes: 2.9s vs 3.1s, 3.0s, and Invalid Values
  // =========================================================================
  describe('1. Duration Boundaries (2.9s vs 3.1s)', () => {
    it('accepts durations with 2.9s delta when title and artist match', () => {
      const a = createTrack({ duration: 200.0 });
      const b = createTrack({ duration: 202.9, path: 'C:/b.flac' });
      expect(isSameRecording(a, b)).toBe(true);

      const c = createTrack({ duration: 197.1, path: 'C:/c.flac' });
      expect(isSameRecording(a, c)).toBe(true);
    });

    it('accepts exact 3.0s boundary delta', () => {
      const a = createTrack({ duration: 200.0 });
      const b = createTrack({ duration: 203.0, path: 'C:/b.flac' });
      expect(isSameRecording(a, b)).toBe(true);

      const c = createTrack({ duration: 197.0, path: 'C:/c.flac' });
      expect(isSameRecording(a, c)).toBe(true);
    });

    it('hard-rejects durations with 3.1s delta', () => {
      const a = createTrack({ duration: 200.0 });
      const b = createTrack({ duration: 203.1, path: 'C:/b.flac' });
      expect(isSameRecording(a, b)).toBe(false);

      const c = createTrack({ duration: 196.9, path: 'C:/c.flac' });
      expect(isSameRecording(a, c)).toBe(false);
    });

    it('hard-rejects floating point delta just exceeding 3.0s (3.001s)', () => {
      const a = createTrack({ duration: 200.0 });
      const b = createTrack({ duration: 203.001, path: 'C:/b.flac' });
      expect(isSameRecording(a, b)).toBe(false);
    });

    it('hard-rejects non-positive, NaN, infinite, string, and null durations', () => {
      const normal = createTrack({ duration: 200.0 });
      expect(isSameRecording(normal, createTrack({ duration: 0 }))).toBe(false);
      expect(isSameRecording(normal, createTrack({ duration: -5 }))).toBe(false);
      expect(isSameRecording(normal, createTrack({ duration: NaN }))).toBe(false);
      expect(isSameRecording(normal, createTrack({ duration: Infinity }))).toBe(false);
      expect(isSameRecording(normal, createTrack({ duration: -Infinity }))).toBe(false);
      expect(isSameRecording(normal, createTrack({ duration: null as any }))).toBe(false);
      expect(isSameRecording(normal, createTrack({ duration: undefined as any }))).toBe(false);
      expect(isSameRecording(normal, createTrack({ duration: '200' as any }))).toBe(false);
    });

    it('prevents transitive duration drift in groupRecordings', () => {
      const tA = createTrack({ id: 1, path: 'C:/a.flac', duration: 180.0 });
      const tB = createTrack({ id: 2, path: 'C:/b.flac', duration: 182.5 });
      const tC = createTrack({ id: 3, path: 'C:/c.flac', duration: 185.0 });

      // Pairwise checks
      expect(isSameRecording(tA, tB)).toBe(true);  // |180 - 182.5| = 2.5 <= 3.0
      expect(isSameRecording(tB, tC)).toBe(true);  // |182.5 - 185| = 2.5 <= 3.0
      expect(isSameRecording(tA, tC)).toBe(false); // |180 - 185| = 5.0 > 3.0

      const groups = groupRecordings([tA, tB, tC], 'Song');
      expect(groups).toHaveLength(1);
      const row = groups[0];
      const safeSources = row.source_context!.sources;
      const candidates = row.source_context!.display_candidates || [];

      expect(safeSources.some(s => s.id === 'C:/a.flac')).toBe(true);
      expect(safeSources.some(s => s.id === 'C:/b.flac')).toBe(true);
      expect(safeSources.some(s => s.id === 'C:/c.flac')).toBe(false); // MUST NOT bridge
      expect(candidates.some(s => s.id === 'C:/c.flac')).toBe(true);
      expect(candidates.find(s => s.id === 'C:/c.flac')?.match_reason).toBe('duration_discrepancy');
    });
  });

  // =========================================================================
  // 2. Live Recordings at Different Venues / Years
  // =========================================================================
  describe('2. Live Recordings at Different Venues and Years', () => {
    it('hard-rejects live recordings at different venues', () => {
      const wembley = createTrack({ title: 'Hotel California (Live at Wembley)' });
      const budokan = createTrack({ title: 'Hotel California (Live at Budokan)', path: 'C:/b.flac' });
      expect(isSameRecording(wembley, budokan)).toBe(false);

      const tokyo = createTrack({ title: 'Sultans of Swing (Live in Tokyo)' });
      const paris = createTrack({ title: 'Sultans of Swing (Live in Paris)', path: 'C:/b.flac' });
      expect(isSameRecording(tokyo, paris)).toBe(false);

      const redRocks = createTrack({ title: 'Free Bird (Live from Red Rocks)' });
      const msg = createTrack({ title: 'Free Bird (Live from Madison Square Garden)', path: 'C:/b.flac' });
      expect(isSameRecording(redRocks, msg)).toBe(false);
    });

    it('hard-rejects live recordings from different years', () => {
      const live1994 = createTrack({ title: 'Hotel California (Live 1994)' });
      const live2024 = createTrack({ title: 'Hotel California (Live 2024)', path: 'C:/b.flac' });
      expect(isSameRecording(live1994, live2024)).toBe(false);
    });

    it('hard-rejects live recordings at same venue but different years', () => {
      const wembley1994 = createTrack({ title: 'Hotel California (Live at Wembley 1994)' });
      const wembley2004 = createTrack({ title: 'Hotel California (Live at Wembley 2004)', path: 'C:/b.flac' });
      expect(isSameRecording(wembley1994, wembley2004)).toBe(false);
    });

    it('hard-rejects generic Live vs venue-specific Live', () => {
      const genericLive = createTrack({ title: 'Hotel California (Live)' });
      const wembleyLive = createTrack({ title: 'Hotel California (Live at Wembley)', path: 'C:/b.flac' });
      expect(isSameRecording(genericLive, wembleyLive)).toBe(false);
    });

    it('hard-rejects studio recording vs live recording', () => {
      const studio = createTrack({ title: 'Hotel California' });
      const live = createTrack({ title: 'Hotel California (Live)', path: 'C:/b.flac' });
      expect(isSameRecording(studio, live)).toBe(false);
    });

    it('allows match when live venue and year are identical', () => {
      const a = createTrack({ title: 'Hotel California (Live at Wembley 1994)' });
      const b = createTrack({ title: 'Hotel California (Live at Wembley 1994)', path: 'C:/b.flac' });
      expect(isSameRecording(a, b)).toBe(true);
    });
  });

  // =========================================================================
  // 3. Acoustic, Instrumental, Remix, Remaster, Radio Edit, Sped/Slowed
  // =========================================================================
  describe('3. Version Qualifiers (Acoustic, Instrumental, Remix, Remaster, etc.)', () => {
    it('hard-rejects studio vs Acoustic / Unplugged', () => {
      const studio = createTrack({ title: 'Layla' });
      const acoustic = createTrack({ title: 'Layla (Acoustic)', path: 'C:/b.flac' });
      const unplugged = createTrack({ title: 'Layla (Unplugged)', path: 'C:/c.flac' });

      expect(isSameRecording(studio, acoustic)).toBe(false);
      expect(isSameRecording(studio, unplugged)).toBe(false);
      expect(isSameRecording(acoustic, unplugged)).toBe(false);
    });

    it('hard-rejects studio vs Instrumental / Karaoke / Piano Version / Backing Track', () => {
      const studio = createTrack({ title: 'Hello' });
      const instrumental = createTrack({ title: 'Hello (Instrumental)', path: 'C:/b.flac' });
      const karaoke = createTrack({ title: 'Hello (Karaoke Version)', path: 'C:/c.flac' });
      const piano = createTrack({ title: 'Hello (Piano Version)', path: 'C:/d.flac' });
      const backing = createTrack({ title: 'Hello (Backing Track)', path: 'C:/e.flac' });

      expect(isSameRecording(studio, instrumental)).toBe(false);
      expect(isSameRecording(studio, karaoke)).toBe(false);
      expect(isSameRecording(studio, piano)).toBe(false);
      expect(isSameRecording(studio, backing)).toBe(false);
    });

    it('hard-rejects studio vs Remix / VIP Mix / Club Mix / Dub Mix', () => {
      const studio = createTrack({ title: 'Satisfaction' });
      const remix = createTrack({ title: 'Satisfaction (Remix)', path: 'C:/b.flac' });
      const vip = createTrack({ title: 'Satisfaction (VIP Mix)', path: 'C:/c.flac' });
      const club = createTrack({ title: 'Satisfaction (Club Mix)', path: 'C:/d.flac' });
      const dub = createTrack({ title: 'Satisfaction (Dub Mix)', path: 'C:/e.flac' });

      expect(isSameRecording(studio, remix)).toBe(false);
      expect(isSameRecording(studio, vip)).toBe(false);
      expect(isSameRecording(studio, club)).toBe(false);
      expect(isSameRecording(studio, dub)).toBe(false);
      expect(isSameRecording(remix, vip)).toBe(false);
    });

    it('hard-rejects different Remaster years and studio vs Remastered', () => {
      const studio = createTrack({ title: 'Comfortably Numb' });
      const rem1994 = createTrack({ title: 'Comfortably Numb (1994 Remaster)', path: 'C:/b.flac' });
      const rem2011 = createTrack({ title: 'Comfortably Numb (2011 Remaster)', path: 'C:/c.flac' });

      expect(isSameRecording(studio, rem1994)).toBe(false);
      expect(isSameRecording(rem1994, rem2011)).toBe(false);
    });

    it('hard-rejects Radio Edit vs Extended Mix vs Single Version', () => {
      const radio = createTrack({ title: 'Levels (Radio Edit)' });
      const extended = createTrack({ title: 'Levels (Extended Mix)', path: 'C:/b.flac' });
      const single = createTrack({ title: 'Levels (Single Version)', path: 'C:/c.flac' });

      expect(isSameRecording(radio, extended)).toBe(false);
      expect(isSameRecording(extended, single)).toBe(false);
    });

    it('hard-rejects Mono vs Stereo', () => {
      const mono = createTrack({ title: 'Please Please Me (Mono)' });
      const stereo = createTrack({ title: 'Please Please Me (Stereo)', path: 'C:/b.flac' });
      expect(isSameRecording(mono, stereo)).toBe(false);
    });

    it('hard-rejects Sped Up vs Slowed + Reverb', () => {
      const original = createTrack({ title: 'Romantic Homicide' });
      const sped = createTrack({ title: 'Romantic Homicide (Sped Up)', path: 'C:/b.flac' });
      const slowed = createTrack({ title: 'Romantic Homicide (Slowed + Reverb)', path: 'C:/c.flac' });

      expect(isSameRecording(original, sped)).toBe(false);
      expect(isSameRecording(original, slowed)).toBe(false);
      expect(isSameRecording(sped, slowed)).toBe(false);
    });
  });

  // =========================================================================
  // 4. Conflicting ISRCs (Must Hard-Reject)
  // =========================================================================
  describe('4. Conflicting ISRCs (Hard-Reject)', () => {
    it('hard-rejects identical title, artist, duration when ISRCs conflict', () => {
      const trackA = createTrack({
        recording_evidence: { isrc: 'USRC17607839' },
      });
      const trackB = createTrack({
        path: 'C:/b.flac',
        recording_evidence: { isrc: 'GBAYE0601477' },
      });

      expect(isSameRecording(trackA, trackB)).toBe(false);
    });

    it('matches when ISRCs are identical regardless of formatting (hyphens / lowercase)', () => {
      const trackA = createTrack({
        recording_evidence: { isrc: 'US-RC1-76-07839' },
      });
      const trackB = createTrack({
        path: 'C:/b.flac',
        recording_evidence: { isrc: 'usrc17607839' },
      });

      expect(isSameRecording(trackA, trackB)).toBe(true);
    });

    it('never allows matching ISRC to override duration difference > 3.0s', () => {
      const trackA = createTrack({
        duration: 180.0,
        recording_evidence: { isrc: 'USRC17607839' },
      });
      const trackB = createTrack({
        path: 'C:/b.flac',
        duration: 185.0, // 5s difference
        recording_evidence: { isrc: 'USRC17607839' },
      });

      expect(isSameRecording(trackA, trackB)).toBe(false);
    });

    it('never allows matching ISRC to override incompatible version qualifiers', () => {
      const trackA = createTrack({
        title: 'Song',
        recording_evidence: { isrc: 'USRC17607839' },
      });
      const trackB = createTrack({
        path: 'C:/b.flac',
        title: 'Song (Acoustic)',
        recording_evidence: { isrc: 'USRC17607839' },
      });

      expect(isSameRecording(trackA, trackB)).toBe(false);
    });
  });

  // =========================================================================
  // 5. Explicit vs Clean Tri-State Conflict (Must Reject)
  // =========================================================================
  describe('5. Explicit vs Clean Tri-State Conflict', () => {
    it('hard-rejects explicit vs clean via recording_evidence', () => {
      const explicit = createTrack({ recording_evidence: { explicit: true } });
      const clean = createTrack({ path: 'C:/b.flac', recording_evidence: { explicit: false } });

      expect(isSameRecording(explicit, clean)).toBe(false);
    });

    it('hard-rejects explicit vs clean via title qualifier', () => {
      const explicit = createTrack({ title: 'Song (Explicit)' });
      const clean = createTrack({ path: 'C:/b.flac', title: 'Song (Clean)' });

      expect(isSameRecording(explicit, clean)).toBe(false);
    });

    it('hard-rejects explicit vs unknown (tri-state conservative boundary)', () => {
      const explicit = createTrack({ recording_evidence: { explicit: true } });
      const unknown = createTrack({ path: 'C:/b.flac', recording_evidence: {} });

      expect(isSameRecording(explicit, unknown)).toBe(false);
    });

    it('hard-rejects clean vs unknown (tri-state conservative boundary)', () => {
      const clean = createTrack({ recording_evidence: { explicit: false } });
      const unknown = createTrack({ path: 'C:/b.flac', recording_evidence: {} });

      expect(isSameRecording(clean, unknown)).toBe(false);
    });

    it('matches when both are known explicit or both are known clean', () => {
      const exp1 = createTrack({ recording_evidence: { explicit: true } });
      const exp2 = createTrack({ path: 'C:/b.flac', recording_evidence: { explicit: true } });
      expect(isSameRecording(exp1, exp2)).toBe(true);

      const cln1 = createTrack({ recording_evidence: { explicit: false } });
      const cln2 = createTrack({ path: 'C:/b.flac', recording_evidence: { explicit: false } });
      expect(isSameRecording(cln1, cln2)).toBe(true);
    });
  });

  // =========================================================================
  // 6. CJK, Cyrillic, Accented Characters, and Punctuation
  // =========================================================================
  describe('6. CJK, Cyrillic, Accented Characters, and Punctuation', () => {
    it('matches Japanese CJK titles with presentation wrappers', () => {
      const local = createTrack({ title: '夜に駆ける', artist: 'YOASOBI' });
      const yt = createTrack({
        path: 'https://www.youtube.com/watch?v=x8VYWazR5mE',
        format: 'YouTube Direct',
        title: '夜に駆ける (Official Music Video)',
        artist: 'YOASOBI',
      });

      expect(coreTitle(yt)).toBe('夜に駆ける');
      expect(isSameRecording(local, yt)).toBe(true);
    });

    it('matches Cyrillic titles with presentation wrappers', () => {
      const local = createTrack({ title: 'Группа крови', artist: 'Кино' });
      const yt = createTrack({
        path: 'https://www.youtube.com/watch?v=11111111111',
        format: 'YouTube Direct',
        title: 'Группа крови [Official Audio]',
        artist: 'Кино',
      });

      expect(coreTitle(yt)).toBe('группа крови');
      expect(isSameRecording(local, yt)).toBe(true);
    });

    it('matches Chinese CJK titles with presentation wrappers', () => {
      const local = createTrack({ title: '青花瓷', artist: '周杰倫' });
      const yt = createTrack({
        path: 'https://www.youtube.com/watch?v=22222222222',
        format: 'YouTube Direct',
        title: '青花瓷 (Official Audio)',
        artist: '周杰倫',
      });

      expect(isSameRecording(local, yt)).toBe(true);
    });

    it('matches decomposed NFD and precomposed NFC accented characters', () => {
      const nfc = createTrack({ artist: 'Beyoncé', title: 'Halo' });
      const nfd = createTrack({
        path: 'C:/b.flac',
        artist: 'Beyonce\u0301', // Decomposed NFD
        title: 'Halo',
      });

      expect(isSameRecording(nfc, nfd)).toBe(true);
    });

    it('normalizes smart quotes and unicode dashes', () => {
      const smart = createTrack({ title: 'Don’t Stop Believin’ – Remaster' });
      const ascii = createTrack({
        path: 'C:/b.flac',
        title: "Don't Stop Believin' - Remaster",
      });

      expect(normalizeText(smart.title)).toBe(normalizeText(ascii.title));
    });
  });

  // =========================================================================
  // 7. Complex Artist Strings & Probing extractPrimaryArtist Bugs
  // =========================================================================
  describe('7. Complex Artist Strings (featuring, x, &, vs)', () => {
    it('correctly handles standard collaboration formats (feat., ft., &, with, comma)', () => {
      const t1 = createTrack({ artist: 'Calvin Harris feat. Dua Lipa', title: 'One Kiss' });
      const t2 = createTrack({ path: 'C:/b.flac', artist: 'Calvin Harris & Dua Lipa', title: 'One Kiss' });
      const t3 = createTrack({ path: 'C:/c.flac', artist: 'Calvin Harris, Dua Lipa', title: 'One Kiss' });
      const t4 = createTrack({ path: 'C:/d.flac', artist: 'Calvin Harris with Dua Lipa', title: 'One Kiss' });

      expect(extractPrimaryArtist(t1.artist)).toBe('calvin harris');
      expect(extractPrimaryArtist(t2.artist)).toBe('calvin harris');
      expect(extractPrimaryArtist(t3.artist)).toBe('calvin harris');
      expect(extractPrimaryArtist(t4.artist)).toBe('calvin harris');

      expect(isSameRecording(t1, t2)).toBe(true);
      expect(isSameRecording(t1, t3)).toBe(true);
      expect(isSameRecording(t1, t4)).toBe(true);
    });

    // ADVERSARIAL RESOLUTION 1: extractPrimaryArtist preserves artist names with letter x and rejects false positive matches
    it('ADVERSARIAL RESOLUTION 1: confirms no false positive match when artist contains letter x (Foxes vs Fo)', () => {
      const foxes = createTrack({ artist: 'Foxes', title: 'Youth', duration: 200 });
      const fo = createTrack({ path: 'C:/b.flac', artist: 'Fo', title: 'Youth', duration: 200 });

      expect(extractPrimaryArtist('Foxes')).toBe('foxes');
      const falseMatch = isSameRecording(foxes, fo);
      expect(falseMatch).toBe(false); // Resolved: Foxes does not match Fo!
    });

    it('ADVERSARIAL RESOLUTION 2: confirms no false positive match for The xx vs The', () => {
      const theXx = createTrack({ artist: 'The xx', title: 'Intro', duration: 127 });
      const the = createTrack({ path: 'C:/b.flac', artist: 'The', title: 'Intro', duration: 127 });

      expect(extractPrimaryArtist('The xx')).toBe('the xx');
      const falseMatch = isSameRecording(theXx, the);
      expect(falseMatch).toBe(false); // Resolved: The xx does not match The!
    });

    it('ADVERSARIAL RESOLUTION 3: confirms proper preservation of Jimi Hendrix, DMX, Charli XCX', () => {
      expect(extractPrimaryArtist('Jimi Hendrix')).toBe('jimi hendrix');
      expect(extractPrimaryArtist('DMX')).toBe('dmx');
      expect(extractPrimaryArtist('Charli XCX')).toBe('charli xcx');
    });

    // ADVERSARIAL RESOLUTION 2: 'vs' / 'vs.' is parsed as collaboration separator
    it('ADVERSARIAL RESOLUTION 4: confirms successful collaboration matching for "vs" and "vs."', () => {
      const t1 = createTrack({ artist: 'Avicii & Nicky Romero', title: 'I Could Be the One' });
      const t2 = createTrack({ path: 'C:/b.flac', artist: 'Avicii vs Nicky Romero', title: 'I Could Be the One' });
      const t3 = createTrack({ path: 'C:/c.flac', artist: 'Avicii vs. Nicky Romero', title: 'I Could Be the One' });

      expect(extractPrimaryArtist('Avicii vs Nicky Romero')).toBe('avicii');
      expect(extractPrimaryArtist('Avicii vs. Nicky Romero')).toBe('avicii');
      expect(isSameRecording(t1, t2)).toBe(true);
      expect(isSameRecording(t2, t3)).toBe(true);
    });
  });
});
