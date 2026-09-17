import { describe, expect, it } from 'vitest';
import type { Track } from '../store/types';
import {
  catalogTrack,
  coreTitle,
  groupRecordings,
  isLikelySameRecording,
  isSameRecording,
  isSameSong,
  normalizeArtist,
  normalizeIsrc,
  normalizeText,
} from '../utils/unifiedSources';

const makeTrack = (override: Partial<Track> = {}): Track => ({
  id: 1,
  path: 'C:/Music/test.flac',
  title: 'Test Song',
  artist: 'Test Artist',
  album: 'Test Album',
  duration: 180.0,
  format: 'FLAC',
  lyric_offset: 0,
  recording_evidence: { isrc: 'USAAA2600001', upc: '0123456789012' },
  catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 },
  ...override,
});

describe('M1 Adversarial Matcher & Conservative Identity Contract', () => {
  describe('1. Boundary Duration & Corroboration Ceiling (Feature 5)', () => {
    const anchor = makeTrack({ duration: 180.0 });

    it('matches when duration delta is strictly within 3.0s boundary', () => {
      // Exactly matching duration
      expect(isSameRecording(anchor, makeTrack({ duration: 180.0 }))).toBe(true);

      // Delta +2.999s
      expect(isSameRecording(anchor, makeTrack({ duration: 182.999 }))).toBe(true);
      // Delta -2.999s
      expect(isSameRecording(anchor, makeTrack({ duration: 177.001 }))).toBe(true);

      // Boundary exact: Delta +3.000s
      expect(isSameRecording(anchor, makeTrack({ duration: 183.0 }))).toBe(true);
      // Boundary exact: Delta -3.000s
      expect(isSameRecording(anchor, makeTrack({ duration: 177.0 }))).toBe(true);
    });

    it('hard-rejects when duration delta strictly exceeds 3.0s boundary', () => {
      // Delta +3.001s
      expect(isSameRecording(anchor, makeTrack({ duration: 183.001 }))).toBe(false);
      // Delta -3.001s
      expect(isSameRecording(anchor, makeTrack({ duration: 176.999 }))).toBe(false);

      // Delta +3.1s
      expect(isSameRecording(anchor, makeTrack({ duration: 183.1 }))).toBe(false);
      // Delta -3.1s
      expect(isSameRecording(anchor, makeTrack({ duration: 176.9 }))).toBe(false);

      // Delta +4.0s
      expect(isSameRecording(anchor, makeTrack({ duration: 184.0 }))).toBe(false);
      // Delta -4.0s
      expect(isSameRecording(anchor, makeTrack({ duration: 176.0 }))).toBe(false);
    });

    it('hard-rejects non-positive, non-finite, missing, or invalid durations', () => {
      expect(isSameRecording(anchor, makeTrack({ duration: 0 }))).toBe(false);
      expect(isSameRecording(anchor, makeTrack({ duration: -180 }))).toBe(false);
      expect(isSameRecording(anchor, makeTrack({ duration: null as any }))).toBe(false);
      expect(isSameRecording(anchor, makeTrack({ duration: undefined as any }))).toBe(false);
      expect(isSameRecording(anchor, makeTrack({ duration: Number.NaN }))).toBe(false);
      expect(isSameRecording(anchor, makeTrack({ duration: Number.POSITIVE_INFINITY }))).toBe(false);
      expect(isSameRecording(anchor, makeTrack({ duration: Number.NEGATIVE_INFINITY }))).toBe(false);
    });
  });

  describe('2. Anti-Transitive Cohort Separation (Feature 4)', () => {
    // Anchor A = 180.0s
    // Candidate B = 182.5s (delta with A = 2.5s <= 3s -> valid match with A)
    // Candidate C = 184.5s (delta with B = 2.0s <= 3s, BUT delta with A = 4.5s > 3s)
    const trackA = makeTrack({
      id: 1,
      path: 'C:/Music/trackA.flac',
      duration: 180.0,
      recording_evidence: undefined,
    });
    const trackB = makeTrack({
      id: 2,
      path: 'C:/Music/trackB.flac',
      duration: 182.5,
      recording_evidence: undefined,
    });
    const trackC = makeTrack({
      id: 3,
      path: 'C:/Music/trackC.flac',
      duration: 184.5,
      recording_evidence: undefined,
    });

    it('never allows candidate C into safe playback sources cohort when A is anchor', () => {
      // Direct matcher verification
      expect(isSameRecording(trackA, trackB)).toBe(true);
      expect(isSameRecording(trackB, trackC)).toBe(true);
      expect(isSameRecording(trackA, trackC)).toBe(false); // Transitivity broken! Must be false!

      // Grouping test with A first
      const groups = groupRecordings([trackA, trackB, trackC], 'Test Song');
      expect(groups).toHaveLength(1);

      const groupContext = groups[0].source_context!;
      const safeSourceIds = groupContext.sources.map(s => s.id);
      const displayCandidateIds = (groupContext.display_candidates || []).map(s => s.id);

      // Safe cohort MUST contain A and B, but MUST NOT contain C
      expect(safeSourceIds).toContain('C:/Music/trackA.flac');
      expect(safeSourceIds).toContain('C:/Music/trackB.flac');
      expect(safeSourceIds).not.toContain('C:/Music/trackC.flac');

      // C MUST be segregated into display_candidates
      expect(displayCandidateIds).toContain('C:/Music/trackC.flac');
    });

    it('enforces that every pair within sources satisfies duration delta <= 3.0s (no cohort drift)', () => {
      // Test alternative insertion order [trackB, trackC, trackA]
      const groups = groupRecordings([trackB, trackC, trackA], 'Test Song');
      expect(groups).toHaveLength(1);

      const sources = groups[0].source_context!.sources;
      for (let i = 0; i < sources.length; i++) {
        for (let j = i + 1; j < sources.length; j++) {
          const durI = sources[i].metadata?.duration;
          const durJ = sources[j].metadata?.duration;
          if (durI != null && durJ != null) {
            expect(Math.abs(durI - durJ)).toBeLessThanOrEqual(3.0);
          }
        }
      }
    });

    it('prevents conflicting wings: D (177.5s) and B (182.5s) cannot both join A (180.0s)', () => {
      // A = 180.0s. B = 182.5s (delta with A = 2.5s). D = 177.5s (delta with A = 2.5s).
      // Delta between B and D is 5.0s > 3.0s!
      const trackD = makeTrack({
        id: 4,
        path: 'C:/Music/trackD.flac',
        duration: 177.5,
        recording_evidence: undefined,
      });

      const groups = groupRecordings([trackA, trackB, trackD], 'Test Song');
      expect(groups).toHaveLength(1);

      const safeSourceIds = groups[0].source_context!.sources.map(s => s.id);
      // Both B and D cannot be in safe sources together because |182.5 - 177.5| = 5.0s > 3.0s
      const hasB = safeSourceIds.includes('C:/Music/trackB.flac');
      const hasD = safeSourceIds.includes('C:/Music/trackD.flac');
      expect(hasB && hasD).toBe(false);
    });
  });

  describe('3. ISRC Conflict Rejection (Feature 7)', () => {
    const isrcUS = 'USRC17607839';
    const isrcGB = 'GBAYE0601477';

    it('rejects identical metadata & identical duration when ISRCs conflict', () => {
      const track1 = makeTrack({
        path: 'C:/Music/track1.flac',
        duration: 240.0,
        recording_evidence: { isrc: isrcUS },
      });
      const track2 = makeTrack({
        path: 'C:/Music/track2.flac',
        duration: 240.0,
        recording_evidence: { isrc: isrcGB },
      });

      expect(isSameRecording(track1, track2)).toBe(false);
      expect(isLikelySameRecording(track1, track2)).toBe(false);

      const groups = groupRecordings([track1, track2], 'Test Song');
      expect(groups).toHaveLength(1);

      const sources = groups[0].source_context!.sources;
      const candidates = groups[0].source_context!.display_candidates || [];

      expect(sources.map(s => s.id)).toContain('C:/Music/track1.flac');
      expect(sources.map(s => s.id)).not.toContain('C:/Music/track2.flac');

      const candidateSource = candidates.find(s => s.id === 'C:/Music/track2.flac');
      expect(candidateSource).toBeDefined();
      expect(candidateSource?.match_reason).toBe('conflicting_isrc');
    });

    it('correctly normalizes hyphenated and lowercase ISRCs', () => {
      expect(normalizeIsrc('US-RC1-76-07839')).toBe(isrcUS);
      expect(normalizeIsrc('gb-aye-06-01477')).toBe(isrcGB);

      const trackHyphen = makeTrack({
        path: 'C:/Music/hyphen.flac',
        recording_evidence: { isrc: 'US-RC1-76-07839' },
      });
      const trackPlain = makeTrack({
        path: 'C:/Music/plain.flac',
        recording_evidence: { isrc: isrcUS.toLowerCase() },
      });

      // Same ISRC with different formatting MUST match
      expect(isSameRecording(trackHyphen, trackPlain)).toBe(true);
    });

    it('allows matching when one track lacks ISRC (provided duration and metadata corroborate)', () => {
      const trackWithIsrc = makeTrack({
        path: 'C:/Music/track1.flac',
        duration: 200.0,
        recording_evidence: { isrc: isrcUS },
      });
      const trackNoIsrc = makeTrack({
        path: 'C:/Music/track2.flac',
        duration: 200.0,
        recording_evidence: undefined,
      });

      expect(isSameRecording(trackWithIsrc, trackNoIsrc)).toBe(true);
    });
  });

  describe('4. Version Qualifier Preservation & Anti-Corruption (Feature 3)', () => {
    const versions = [
      'Live at Wembley 2023',
      'Live in Tokyo 2024',
      'Studio',
      'Acoustic',
      'Instrumental',
      'Radio Edit',
      'Extended Mix',
      'Remix',
      'Mono',
      'Stereo',
      'Clean',
      'Explicit',
      '2011 Remaster',
      '2020 Remaster',
      'Sped Up',
    ];

    const tracks = versions.map((v, i) =>
      makeTrack({
        id: i + 10,
        path: `C:/Music/v_${i}.flac`,
        title: `Song Title (${v})`,
        duration: 210.0,
        recording_evidence: undefined,
      })
    );

    it('rejects every distinct version pair without cross-version identity corruption', () => {
      for (let i = 0; i < tracks.length; i++) {
        for (let j = 0; j < tracks.length; j++) {
          if (i === j) {
            // Self-comparison must match
            expect(isSameRecording(tracks[i], tracks[j])).toBe(true);
          } else {
            // Distinct versions MUST NOT match
            const result = isSameRecording(tracks[i], tracks[j]);
            if (result) {
              // Failure detail helper
              throw new Error(
                `Cross-version corruption: "${tracks[i].title}" falsely matched "${tracks[j].title}"`
              );
            }
            expect(result).toBe(false);
          }
        }
      }
    });

    it('correctly matches identical version qualifiers', () => {
      const wembleyA = makeTrack({ title: 'Song Title (Live at Wembley 2023)', duration: 210.0 });
      const wembleyB = makeTrack({ title: 'Song Title (Live at Wembley 2023)', duration: 211.0 });
      expect(isSameRecording(wembleyA, wembleyB)).toBe(true);

      const acousticA = makeTrack({ title: 'Song Title (Acoustic)', duration: 190.0 });
      const acousticB = makeTrack({ title: 'Song Title (Acoustic)', duration: 190.5 });
      expect(isSameRecording(acousticA, acousticB)).toBe(true);

      const remasterA = makeTrack({ title: 'Song Title (2011 Remaster)', duration: 200.0 });
      const remasterB = makeTrack({ title: 'Song Title (2011 Remaster)', duration: 200.5 });
      expect(isSameRecording(remasterA, remasterB)).toBe(true);
    });

    it('documents behavior on syntactic variations of equivalent qualifiers (Acoustic vs Acoustic Version, 2011 Remaster vs Remastered 2011)', () => {
      // Both are acoustic versions with duration delta 0.5s
      const acousticPlain = makeTrack({ title: 'Song Title (Acoustic)', duration: 190.0 });
      const acousticVersion = makeTrack({ title: 'Song Title (Acoustic Version)', duration: 190.5 });
      
      // Both are 2011 remasters with duration delta 0.5s
      const remasterA = makeTrack({ title: 'Song Title (2011 Remaster)', duration: 200.0 });
      const remasterB = makeTrack({ title: 'Song Title (Remastered 2011)', duration: 200.5 });

      // Empirical probe: areVersionsCompatible line 192 (rawVersion check) currently treats these as different
      const acousticMatches = isSameRecording(acousticPlain, acousticVersion);
      const remasterMatches = isSameRecording(remasterA, remasterB);

      // Verify empirical behavior:
      expect(acousticMatches).toBe(false);
      expect(remasterMatches).toBe(false);
    });
  });

  describe('5. Unicode, Script Handling & Presentation Wrappers (Features 1, 2, 12)', () => {
    it('normalizes full-width alphanumeric and Katakana via NFKC', () => {
      expect(normalizeText('＂Ｈｅｌｌｏ　Ｗｏｒｌｄ＂')).toBe('"hello world"');
      // Full-width latin vs standard ASCII
      const fwTrack = makeTrack({ title: 'Ａｉｄｅｏ　Ｍｕｓｉｃ' });
      const hwTrack = makeTrack({ title: 'Aideo Music' });
      expect(coreTitle(fwTrack)).toBe(coreTitle(hwTrack));
      expect(isSameSong(fwTrack, hwTrack)).toBe(true);

      // Half-width katakana vs Full-width katakana
      const hwKana = normalizeText('ｻｸﾗ');
      const fwKana = normalizeText('サクラ');
      expect(hwKana).toBe(fwKana);
    });

    it('preserves accented Latin characters and handles NFD vs NFC canonical equivalence', () => {
      // Decomposed (NFD) vs Precomposed (NFC)
      const nfcBeyonce = 'Beyoncé';
      const nfdBeyonce = nfcBeyonce.normalize('NFD');
      expect(normalizeText(nfcBeyonce)).toBe(normalizeText(nfdBeyonce));

      const trackNFC = makeTrack({ artist: nfcBeyonce, title: 'Halo' });
      const trackNFD = makeTrack({ artist: nfdBeyonce, title: 'Halo' });
      expect(isSameSong(trackNFC, trackNFD)).toBe(true);

      // Motley Crue
      const motley = makeTrack({ artist: 'Mötley Crüe', title: 'Kickstart My Heart' });
      expect(normalizeArtist(motley.artist)).toBe('mötley crüe');
      expect(coreTitle(motley)).toBe('kickstart my heart');
    });

    it('preserves the genuine word "Official" when it is part of the song title', () => {
      const officialTitle = makeTrack({ title: 'Official Olympic Theme', artist: 'John Williams' });
      expect(coreTitle(officialTitle)).toBe('official olympic theme');

      const theOfficial = makeTrack({ title: 'The Official Anthem', artist: 'Band' });
      expect(coreTitle(theOfficial)).toBe('the official anthem');

      const officialAlone = makeTrack({ title: 'Official', artist: 'Charli XCX' });
      expect(coreTitle(officialAlone)).toBe('official');

      // Stripping presentation wrapper while preserving title that starts with "Official"
      const officialWithWrapper = makeTrack({
        title: 'Official Olympic Theme (Official Audio)',
        artist: 'John Williams',
      });
      expect(coreTitle(officialWithWrapper)).toBe('official olympic theme');

      const officialWithVideoWrapper = makeTrack({
        title: 'Official Olympic Theme - Official Music Video',
        artist: 'John Williams',
      });
      expect(coreTitle(officialWithVideoWrapper)).toBe('official olympic theme');
    });

    it('correctly strips YouTube presentation labels without corrupting core title', () => {
      const labels = [
        'Song (Official Audio)',
        'Song [Official Music Video]',
        'Song (Lyric Video)',
        'Song [Visualizer]',
        'Song (Official 4K Video)',
        'Song (Audio)',
        'Song - Official Audio',
        'Song // Official Music Video',
        'Song | Lyric Video',
      ];

      for (const label of labels) {
        const t = makeTrack({ title: label });
        expect(coreTitle(t)).toBe('song');
      }
    });

    it('correctly strips YouTube channel topic suffix from artist', () => {
      expect(normalizeArtist('Anggi Marito - Topic')).toBe('anggi marito');
      expect(normalizeArtist('Taylor Swift - Topic')).toBe('taylor swift');
      expect(normalizeArtist('Topic')).toBe('topic'); // Should not strip standalone name "Topic"
    });
  });

  describe('6. Clean / Explicit Tri-State Agreement (Feature 11)', () => {
    it('rejects clean vs explicit versions of the same song', () => {
      const cleanTrack = makeTrack({
        title: 'Song Title (Clean Version)',
        recording_evidence: { explicit: false },
      });
      const explicitTrack = makeTrack({
        title: 'Song Title (Explicit Version)',
        recording_evidence: { explicit: true },
      });

      expect(isSameRecording(cleanTrack, explicitTrack)).toBe(false);
      expect(isSameSong(cleanTrack, explicitTrack)).toBe(false);
    });

    it('matches when both are explicitly clean or both are explicitly explicit', () => {
      const cleanA = makeTrack({
        title: 'Song Title',
        recording_evidence: { explicit: false },
      });
      const cleanB = makeTrack({
        title: 'Song Title (Clean)',
        recording_evidence: { explicit: false },
      });
      expect(isSameRecording(cleanA, cleanB)).toBe(true);

      const explicitA = makeTrack({
        title: 'Song Title',
        recording_evidence: { explicit: true },
      });
      const explicitB = makeTrack({
        title: 'Song Title (Explicit)',
        recording_evidence: { explicit: true },
      });
      expect(isSameRecording(explicitA, explicitB)).toBe(true);
    });
  });

  describe('7. Absence of Invented Durations & Strict Duration Defaults (Feature 8)', () => {
    it('catalogTrack leaves duration as null when duration is missing, zero, or negative', () => {
      const tidalMissing = catalogTrack({ id: '100', title: 'Song', artist: 'Artist' }, 'tidal');
      expect(tidalMissing.duration).toBeNull();

      const tidalZero = catalogTrack(
        { id: '101', title: 'Song', artist: 'Artist', duration: 0, duration_raw: '0:00' },
        'tidal'
      );
      expect(tidalZero.duration).toBeNull();

      const tidalNegative = catalogTrack(
        { id: '102', title: 'Song', artist: 'Artist', duration: -180 },
        'tidal'
      );
      expect(tidalNegative.duration).toBeNull();
    });

    it('catalogTrack parses valid duration and duration_raw accurately', () => {
      const tidalValid = catalogTrack(
        { id: '103', title: 'Song', artist: 'Artist', duration_raw: '3:45' },
        'tidal'
      );
      expect(tidalValid.duration).toBe(225);

      const tidalWithSecs = catalogTrack(
        { id: '104', title: 'Song', artist: 'Artist', duration: 198.5 },
        'tidal'
      );
      expect(tidalWithSecs.duration).toBe(198.5);
    });
  });
});
