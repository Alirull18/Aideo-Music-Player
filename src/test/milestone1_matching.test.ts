import { describe, it, expect } from 'vitest';
import {
  isSameRecording,
  groupRecordings,
  normalizeText,
  normalizeArtist,
  extractPrimaryArtist,
  cleanPlaybackSource,
  cleanSourceContext,
  sourceKey,
  catalogTrack,
} from '../utils/unifiedSources';
import type { Track, RecordingSources, PlaybackSource } from '../store/types';

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

describe('Milestone 1: Recording Identity & Conservative Matching Contract (Features 1-12)', () => {
  // Feature 1: Pure Matcher & Anti-Transitive Cohort Safety
  describe('Feature 1: Pure Matcher Contract & Anti-Transitive Cohort Safety', () => {
    it('isSameRecording is pure and symmetric', () => {
      const a = createTrack({ title: 'Song', artist: 'Artist', duration: 180 });
      const b = createTrack({ title: 'Song', artist: 'Artist', duration: 182, path: 'C:/Music/b.flac' });
      expect(isSameRecording(a, b)).toBe(true);
      expect(isSameRecording(b, a)).toBe(true);
    });

    it('prevents transitive bridging where A matches B, B matches C, but A and C exceed duration ceiling', () => {
      // Anchor A: 180s
      // Candidate B: 182s (diff from A = 2s <= 3s -> valid)
      // Candidate C: 184.5s (diff from B = 2.5s <= 3s, BUT diff from A = 4.5s > 3s -> invalid!)
      const trackA = createTrack({ id: 1, path: 'C:/Music/a.flac', duration: 180 });
      const trackB = createTrack({ id: 2, path: 'C:/Music/b.flac', duration: 182 });
      const trackC = createTrack({ id: 3, path: 'C:/Music/c.flac', duration: 184.5 });

      expect(isSameRecording(trackA, trackB)).toBe(true);
      expect(isSameRecording(trackB, trackC)).toBe(true);
      expect(isSameRecording(trackA, trackC)).toBe(false);

      const rows = groupRecordings([trackA, trackB, trackC], 'Song');
      expect(rows).toHaveLength(1);
      const row = rows[0];
      const context = row.source_context!;

      // trackA and trackB are in safe playback cohort
      expect(context.sources).toHaveLength(2);
      expect(context.sources.some(s => s.id === 'C:/Music/a.flac')).toBe(true);
      expect(context.sources.some(s => s.id === 'C:/Music/b.flac')).toBe(true);

      // trackC must NOT bridge into sources; it must be in display_candidates
      expect(context.sources.some(s => s.id === 'C:/Music/c.flac')).toBe(false);
      expect(context.display_candidates).toBeDefined();
      expect(context.display_candidates?.some(s => s.id === 'C:/Music/c.flac')).toBe(true);
      const cand = context.display_candidates?.find(s => s.id === 'C:/Music/c.flac');
      expect(cand?.match_assessment).toBe('candidate');
      expect(cand?.match_reason).toBe('duration_discrepancy');
    });
  });

  // Feature 2: Unicode NFKC Normalization & Presentation Wrapper Stripping
  describe('Feature 2: Unicode NFKC Normalization & Presentation Wrapper Stripping', () => {
    it('normalizes Unicode NFKC, smart quotes, and dashes', () => {
      const fullwidth = normalizeText('Ｓｏｎｇ　Ｎａｍｅ');
      expect(fullwidth).toBe('song name');

      const smartQuotes = normalizeText('‘Single’ and “Double”');
      expect(smartQuotes).toBe("'single' and \"double\"");

      const dashes = normalizeText('Song – With — Various − Dashes');
      expect(dashes).toBe('song - with - various - dashes');
    });

    it('strips common presentation wrappers without altering core identity', () => {
      const local = createTrack({ title: 'Midnight City' });
      const yt1 = createTrack({ title: 'Midnight City (Official Audio)', format: 'YouTube Direct', path: 'https://www.youtube.com/watch?v=11111111111' });
      const yt2 = createTrack({ title: 'Midnight City [Official Music Video]', format: 'YouTube Direct', path: 'https://www.youtube.com/watch?v=22222222222' });
      const yt3 = createTrack({ title: 'Midnight City (Lyric Video)', format: 'YouTube Direct', path: 'https://www.youtube.com/watch?v=33333333333' });
      const yt4 = createTrack({ title: 'Midnight City [Visualizer 4K]', format: 'YouTube Direct', path: 'https://www.youtube.com/watch?v=44444444444' });

      expect(isSameRecording(local, yt1)).toBe(true);
      expect(isSameRecording(local, yt2)).toBe(true);
      expect(isSameRecording(local, yt3)).toBe(true);
      expect(isSameRecording(local, yt4)).toBe(true);
    });

    it('preserves legitimate words that resemble wrappers inside title', () => {
      const song1 = createTrack({ title: 'Video Killed the Radio Star' });
      const song2 = createTrack({ title: 'Radio Star' });
      expect(isSameRecording(song1, song2)).toBe(false);
    });

    it('strips movie and soundtrack context wrappers cleanly', () => {
      const ost1 = createTrack({ title: 'See You Again (From "Furious 7" Soundtrack)' });
      const ost2 = createTrack({ title: 'See You Again' });
      expect(isSameRecording(ost1, ost2)).toBe(true);
    });
  });

  // Feature 3: Version Qualifier Preservation
  describe('Feature 3: Version Qualifier Preservation', () => {
    it('rejects substitution between Live concert venues and years', () => {
      const liveWembley = createTrack({ title: 'Hotel California (Live at Wembley)' });
      const liveBudokan = createTrack({ title: 'Hotel California (Live at Budokan)' });
      const live1994 = createTrack({ title: 'Hotel California (Live 1994)' });
      const live2024 = createTrack({ title: 'Hotel California (Live 2024)' });

      expect(isSameRecording(liveWembley, liveBudokan)).toBe(false);
      expect(isSameRecording(live1994, live2024)).toBe(false);
    });

    it('rejects substitution between Studio and Live / Acoustic / Instrumental versions', () => {
      const studio = createTrack({ title: 'Everlong' });
      const acoustic = createTrack({ title: 'Everlong (Acoustic)' });
      const live = createTrack({ title: 'Everlong (Live)' });
      const instrumental = createTrack({ title: 'Everlong (Instrumental)' });

      expect(isSameRecording(studio, acoustic)).toBe(false);
      expect(isSameRecording(studio, live)).toBe(false);
      expect(isSameRecording(studio, instrumental)).toBe(false);
      expect(isSameRecording(acoustic, live)).toBe(false);
    });

    it('rejects substitution between Original and specific Remixes', () => {
      const orig = createTrack({ title: 'Levitating' });
      const remix1 = createTrack({ title: 'Levitating (DaBaby Remix)' });
      const remix2 = createTrack({ title: 'Levitating (Blessed Madonna Remix)' });

      expect(isSameRecording(orig, remix1)).toBe(false);
      expect(isSameRecording(remix1, remix2)).toBe(false);
    });

    it('rejects substitution between Radio Edit, Extended Mix, and Club Mix', () => {
      const radio = createTrack({ title: 'One More Time (Radio Edit)' });
      const extended = createTrack({ title: 'One More Time (Extended Mix)' });
      const club = createTrack({ title: 'One More Time (Club Mix)' });

      expect(isSameRecording(radio, extended)).toBe(false);
      expect(isSameRecording(extended, club)).toBe(false);
    });

    it('rejects substitution between Remaster years', () => {
      const remaster1999 = createTrack({ title: 'Yesterday (1999 Remaster)' });
      const remaster2009 = createTrack({ title: 'Yesterday (2009 Remaster)' });

      expect(isSameRecording(remaster1999, remaster2009)).toBe(false);
    });

    it('rejects substitution between Mono and Stereo mixes', () => {
      const mono = createTrack({ title: 'Love Me Do (Mono)' });
      const stereo = createTrack({ title: 'Love Me Do (Stereo)' });

      expect(isSameRecording(mono, stereo)).toBe(false);
    });

    it('rejects substitution between Sped Up and Slowed editions', () => {
      const sped = createTrack({ title: 'Song (Sped Up)' });
      const slowed = createTrack({ title: 'Song (Slowed + Reverb)' });

      expect(isSameRecording(sped, slowed)).toBe(false);
    });
  });

  // Feature 4: Clean vs Explicit Tri-State Matching
  describe('Feature 4: Clean vs Explicit Tri-State Matching', () => {
    it('strictly separates explicit from clean versions', () => {
      const explicitTrack = createTrack({
        title: 'Industry Baby (Explicit)',
        recording_evidence: { explicit: true },
      });
      const cleanTrack = createTrack({
        title: 'Industry Baby (Clean)',
        recording_evidence: { explicit: false },
      });

      expect(isSameRecording(explicitTrack, cleanTrack)).toBe(false);
    });

    it('treats unknown explicit state conservatively against known explicit state', () => {
      const explicitTrack = createTrack({
        title: 'Rap Song',
        recording_evidence: { explicit: true },
      });
      const unknownTrack = createTrack({
        title: 'Rap Song',
        recording_evidence: {},
      });

      // Tri-state: unknown cannot automatically substitute for a known explicit recording
      expect(isSameRecording(explicitTrack, unknownTrack)).toBe(false);
    });

    it('allows matching when explicit states are identical', () => {
      const explicitA = createTrack({ title: 'Rap Song', recording_evidence: { explicit: true } });
      const explicitB = createTrack({ title: 'Rap Song', recording_evidence: { explicit: true }, path: 'C:/b.flac' });
      expect(isSameRecording(explicitA, explicitB)).toBe(true);

      const cleanA = createTrack({ title: 'Pop Song', recording_evidence: { explicit: false } });
      const cleanB = createTrack({ title: 'Pop Song', recording_evidence: { explicit: false }, path: 'C:/b.flac' });
      expect(isSameRecording(cleanA, cleanB)).toBe(true);
    });
  });

  // Feature 5: Strict 3.0-Second Duration Difference Ceiling
  describe('Feature 5: Strict 3.0-Second Duration Difference Ceiling', () => {
    it('accepts duration differences within 3.0 seconds', () => {
      const base = createTrack({ duration: 180.0 });
      const plus3 = createTrack({ duration: 183.0, path: 'C:/plus3.flac' });
      const minus3 = createTrack({ duration: 177.0, path: 'C:/minus3.flac' });

      expect(isSameRecording(base, plus3)).toBe(true);
      expect(isSameRecording(base, minus3)).toBe(true);
    });

    it('rejects duration differences greater than 3.0 seconds', () => {
      const base = createTrack({ duration: 180.0 });
      const plus3point1 = createTrack({ duration: 183.1, path: 'C:/plus.flac' });
      const minus3point1 = createTrack({ duration: 176.9, path: 'C:/minus.flac' });

      expect(isSameRecording(base, plus3point1)).toBe(false);
      expect(isSameRecording(base, minus3point1)).toBe(false);
    });

    it('rejects matching when duration is missing or non-positive on either side', () => {
      const normal = createTrack({ duration: 180 });
      const noDuration = createTrack({ duration: null as any });
      const zeroDuration = createTrack({ duration: 0 });
      const nanDuration = createTrack({ duration: NaN });

      expect(isSameRecording(normal, noDuration)).toBe(false);
      expect(isSameRecording(normal, zeroDuration)).toBe(false);
      expect(isSameRecording(normal, nanDuration)).toBe(false);
    });
  });

  // Feature 6: Real Duration Integrity (No Invented Durations)
  describe('Feature 6: Real Duration Integrity (No Invented Durations)', () => {
    it('catalogTrack leaves duration null and duration_raw as provided when duration is missing', () => {
      const catalog = catalogTrack({ id: '999', title: 'Unknown Length', artist: 'Artist' }, 'tidal');
      expect(catalog.duration).toBeNull();
      expect(catalog.duration_raw).toBeUndefined();
    });

    it('catalogTrack parses valid MM:SS duration_raw string accurately', () => {
      const catalog = catalogTrack({ id: '999', title: 'Parsed', artist: 'Artist', duration_raw: '3:45' }, 'tidal');
      expect(catalog.duration).toBe(225);
    });
  });

  // Feature 7: Primary Artist & Featured Artist Separation
  describe('Feature 7: Primary Artist & Featured Artist Separation', () => {
    it('extracts primary artist from various featured artist syntaxes', () => {
      expect(extractPrimaryArtist('Dua Lipa feat. DaBaby')).toBe('dua lipa');
      expect(extractPrimaryArtist('Dua Lipa ft. DaBaby')).toBe('dua lipa');
      expect(extractPrimaryArtist('Dua Lipa featuring DaBaby')).toBe('dua lipa');
      expect(extractPrimaryArtist('Calvin Harris & Dua Lipa')).toBe('calvin harris');
      expect(extractPrimaryArtist('Marshmello, Khalid')).toBe('marshmello');
      expect(extractPrimaryArtist('Jack Ü with Justin Bieber')).toBe('jack ü');
    });

    it('preserves intact artist names containing letter x without word boundary', () => {
      expect(extractPrimaryArtist('Foxes')).toBe('foxes');
      expect(extractPrimaryArtist('The xx')).toBe('the xx');
      expect(extractPrimaryArtist('DMX')).toBe('dmx');
      expect(extractPrimaryArtist('Charli XCX')).toBe('charli xcx');
      expect(extractPrimaryArtist('Jimi Hendrix')).toBe('jimi hendrix');
      expect(extractPrimaryArtist('Phoenix')).toBe('phoenix');
      expect(extractPrimaryArtist('X Ambassadors')).toBe('x ambassadors');
      expect(extractPrimaryArtist('INXS')).toBe('inxs');
      expect(extractPrimaryArtist('Lil Nas X')).toBe('lil nas x');
      expect(extractPrimaryArtist('Symphony X')).toBe('symphony x');
    });

    it('correctly splits genuine collaboration delimiters (x, vs, vs., &, with, feat.)', () => {
      expect(extractPrimaryArtist('David Guetta x Bebe Rexha')).toBe('david guetta');
      expect(extractPrimaryArtist('Avicii vs Nicky Romero')).toBe('avicii');
      expect(extractPrimaryArtist('Avicii vs. Nicky Romero')).toBe('avicii');
      expect(extractPrimaryArtist('Galantis & Hook N Sling')).toBe('galantis');
      expect(extractPrimaryArtist('Jack Ü with Justin Bieber')).toBe('jack ü');
      expect(extractPrimaryArtist('A x B')).toBe('a');
      expect(extractPrimaryArtist('A vs B')).toBe('a');
      expect(extractPrimaryArtist('A vs. B')).toBe('a');
    });

    it('strips - Topic from YouTube artist channel names', () => {
      expect(normalizeArtist('Queen - Topic')).toBe('queen');
      expect(normalizeArtist('The Beatles - Topic')).toBe('the beatles');
    });

    it('matches when primary artist agrees despite featured artist placement in title or artist', () => {
      const t1 = createTrack({ title: 'One Kiss (feat. Dua Lipa)', artist: 'Calvin Harris' });
      const t2 = createTrack({ title: 'One Kiss', artist: 'Calvin Harris & Dua Lipa', path: 'C:/t2.flac' });
      expect(isSameRecording(t1, t2)).toBe(true);
    });

    it('rejects completely different primary artists even with identical titles and durations', () => {
      const t1 = createTrack({ title: 'Hallelujah', artist: 'Leonard Cohen', duration: 279 });
      const t2 = createTrack({ title: 'Hallelujah', artist: 'Jeff Buckley', duration: 279, path: 'C:/buckley.flac' });
      expect(isSameRecording(t1, t2)).toBe(false);
    });

    it('rejects false-positive recording matches between full artist names with x and truncated prefixes', () => {
      const foxes = createTrack({ artist: 'Foxes', title: 'Youth', duration: 200 });
      const fo = createTrack({ artist: 'Fo', title: 'Youth', duration: 200, path: 'C:/fo.flac' });
      expect(isSameRecording(foxes, fo)).toBe(false);

      const theXx = createTrack({ artist: 'The xx', title: 'Intro', duration: 127 });
      const the = createTrack({ artist: 'The', title: 'Intro', duration: 127, path: 'C:/the.flac' });
      expect(isSameRecording(theXx, the)).toBe(false);

      const dmx = createTrack({ artist: 'DMX', title: 'Party Up', duration: 270 });
      const dm = createTrack({ artist: 'DM', title: 'Party Up', duration: 270, path: 'C:/dm.flac' });
      expect(isSameRecording(dmx, dm)).toBe(false);

      const hendrix = createTrack({ artist: 'Jimi Hendrix', title: 'Purple Haze', duration: 170 });
      const hendri = createTrack({ artist: 'Jimi Hendri', title: 'Purple Haze', duration: 170, path: 'C:/hendri.flac' });
      expect(isSameRecording(hendrix, hendri)).toBe(false);
    });

    it('matches genuine collaboration releases across different credit formats (vs vs vs. vs &)', () => {
      const t1 = createTrack({ artist: 'Avicii & Nicky Romero', title: 'I Could Be the One', duration: 208 });
      const t2 = createTrack({ artist: 'Avicii vs Nicky Romero', title: 'I Could Be the One', duration: 208, path: 'C:/t2.flac' });
      const t3 = createTrack({ artist: 'Avicii vs. Nicky Romero', title: 'I Could Be the One', duration: 208, path: 'C:/t3.flac' });

      expect(isSameRecording(t1, t2)).toBe(true);
      expect(isSameRecording(t2, t3)).toBe(true);

      const dg1 = createTrack({ artist: 'David Guetta x Bebe Rexha', title: "I'm Good", duration: 175 });
      const dg2 = createTrack({ artist: 'David Guetta & Bebe Rexha', title: "I'm Good", duration: 175, path: 'C:/dg2.flac' });
      expect(isSameRecording(dg1, dg2)).toBe(true);
    });
  });

  // Feature 8: Conflicting ISRC Rejection
  describe('Feature 8: Conflicting ISRC Rejection', () => {
    it('rejects automatic equivalence when valid ISRCs conflict', () => {
      const t1 = createTrack({
        recording_evidence: { isrc: 'USRC17607839' },
      });
      const t2 = createTrack({
        path: 'C:/t2.flac',
        recording_evidence: { isrc: 'GBAYE0601477' },
      });

      expect(isSameRecording(t1, t2)).toBe(false);
    });

    it('allows match when ISRCs are identical', () => {
      const t1 = createTrack({ recording_evidence: { isrc: 'USRC17607839' } });
      const t2 = createTrack({ path: 'C:/t2.flac', recording_evidence: { isrc: 'USRC17607839' } });
      expect(isSameRecording(t1, t2)).toBe(true);
    });

    it('ignores invalid or malformed ISRC strings without falsely rejecting', () => {
      const t1 = createTrack({ recording_evidence: { isrc: 'INVALID_ISRC' } });
      const t2 = createTrack({ path: 'C:/t2.flac', recording_evidence: { isrc: 'ANOTHER_INVALID' } });
      expect(isSameRecording(t1, t2)).toBe(true);
    });
  });

  // Feature 9: Display Candidates vs Safe Playback Cohort
  describe('Feature 9: Display Candidates vs Safe Playback Cohort', () => {
    it('places unverified or duration-divergent tracks in display_candidates, not sources', () => {
      const studio = createTrack({ id: 1, path: 'C:/studio.flac', duration: 180, format: 'FLAC' });
      const video = createTrack({
        id: -1,
        path: 'https://www.youtube.com/watch?v=vid12345678',
        duration: 220, // 40s difference (video intro/outro)
        format: 'YouTube Direct',
      });

      const rows = groupRecordings([studio, video], 'Song');
      expect(rows).toHaveLength(1);
      const context = rows[0].source_context!;

      // sources only contains the studio track
      expect(context.sources).toHaveLength(1);
      expect(context.sources[0].provider).toBe('local');

      // display_candidates contains the video track
      expect(context.display_candidates).toBeDefined();
      expect(context.display_candidates).toHaveLength(1);
      expect(context.display_candidates![0].provider).toBe('youtube');
      expect(context.display_candidates![0].match_assessment).toBe('candidate');
      expect(context.display_candidates![0].match_reason).toBe('duration_discrepancy');
    });
  });

  // Feature 10: Non-Interrupting Discovery Enrichment Contract
  describe('Feature 10: Non-Interrupting Discovery Enrichment Contract', () => {
    it('cleanPlaybackSource strips frontend-only evaluation and evidence fields', () => {
      const dirtySource: PlaybackSource = {
        provider: 'local',
        id: 'C:/song.flac',
        catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16, codec: 'FLAC' },
        metadata: {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          duration: 180,
          duration_raw: '3:00',
          cover_url: 'https://example.com/cover.jpg',
          track_number: 1,
          disc_number: 1,
        },
        recording_evidence: { isrc: 'US1234567890', upc: '012345678901', version: 'Studio' },
        match_assessment: 'equivalent',
        match_reason: 'exact_match',
      };

      const cleaned = cleanPlaybackSource(dirtySource);
      expect(cleaned.provider).toBe('local');
      expect(cleaned.id).toBe('C:/song.flac');
      expect(cleaned.catalog_quality).toEqual({ lossless: true, sample_rate: 44100, bit_depth: 16, codec: 'FLAC' });
      expect(cleaned.metadata).toEqual({
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        duration: 180,
        duration_raw: '3:00',
        cover_url: 'https://example.com/cover.jpg',
        track_number: 1,
        disc_number: 1,
      });
      expect((cleaned as any).recording_evidence).toBeUndefined();
      expect((cleaned as any).match_assessment).toBeUndefined();
      expect((cleaned as any).match_reason).toBeUndefined();
      expect(Object.keys(cleaned).sort()).toEqual(['catalog_quality', 'id', 'metadata', 'provider']);
    });

    it('cleanSourceContext strips frontend-only display fields and sanitizes nested PlaybackSource items for Rust serde', () => {
      const dirtySource: PlaybackSource = {
        provider: 'local',
        id: 'C:/song.flac',
        catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16, codec: 'FLAC' },
        metadata: {
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          duration: 180,
          duration_raw: '3:00',
          cover_url: 'https://example.com/cover.jpg',
          track_number: 1,
          disc_number: 1,
        },
        recording_evidence: { isrc: 'US1234567890', upc: '012345678901', version: 'Studio' },
        match_assessment: 'equivalent',
        match_reason: 'exact_match',
      };

      const dirtyExplicitSource: PlaybackSource = {
        provider: 'tidal',
        id: '12345',
        catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16, codec: 'FLAC' },
        recording_evidence: { isrc: 'US1234567890' },
        match_assessment: 'equivalent',
        match_reason: 'user_selected',
      };

      const dirtyContext: RecordingSources = {
        recording_id: 'rec_123',
        sources: [dirtySource],
        selection: { mode: 'explicit', source: dirtyExplicitSource },
        display_candidates: [{ provider: 'youtube', id: 'yt_12345678', match_assessment: 'candidate', match_reason: 'duration_discrepancy' }],
        match_version: 1,
      };

      const cleaned = cleanSourceContext(dirtyContext);

      // Top-level schema assertions
      expect(cleaned.recording_id).toBe('rec_123');
      expect((cleaned as any).display_candidates).toBeUndefined();
      expect((cleaned as any).match_version).toBeUndefined();

      // Nested sources sanitization assertions
      expect(cleaned.sources.length).toBeGreaterThanOrEqual(1);
      const cleanSource = cleaned.sources[0];
      expect(cleanSource.provider).toBe('local');
      expect(cleanSource.id).toBe('C:/song.flac');
      expect(cleanSource.catalog_quality).toEqual({ lossless: true, sample_rate: 44100, bit_depth: 16, codec: 'FLAC' });
      expect(cleanSource.metadata).toBeDefined();
      expect((cleanSource as any).recording_evidence).toBeUndefined();
      expect((cleanSource as any).match_assessment).toBeUndefined();
      expect((cleanSource as any).match_reason).toBeUndefined();

      // Selection sanitization assertions
      expect(cleaned.selection.mode).toBe('explicit');
      if (cleaned.selection.mode === 'explicit') {
        expect(cleaned.selection.source.provider).toBe('tidal');
        expect(cleaned.selection.source.id).toBe('12345');
        expect((cleaned.selection.source as any).recording_evidence).toBeUndefined();
        expect((cleaned.selection.source as any).match_assessment).toBeUndefined();
        expect((cleaned.selection.source as any).match_reason).toBeUndefined();
      }

      // Explicit source included in sources for Rust RecordingSources::to_json validation
      expect(cleaned.sources.some(s => s.provider === 'tidal' && s.id === '12345')).toBe(true);

      // Verify exact JSON keys allowed by Rust #[serde(deny_unknown_fields)]
      const json = JSON.parse(JSON.stringify(cleaned));
      expect(Object.keys(json).sort()).toEqual(['recording_id', 'selection', 'sources'].sort());
      for (const s of json.sources) {
        const sourceKeys = Object.keys(s);
        for (const k of sourceKeys) {
          expect(['provider', 'id', 'catalog_quality', 'metadata']).toContain(k);
        }
      }

      // Strict serialization check: no frontend-only fields in JSON string
      const serialized = JSON.stringify(cleaned);
      expect(serialized).not.toMatch(/"match_assessment"|"match_reason"|"recording_evidence"|"display_candidates"|"match_version"/);
    });

    it('cleanSourceContext handles auto selection mode and empty sources gracefully', () => {
      const autoContext: RecordingSources = {
        recording_id: 'rec_auto',
        sources: [],
        selection: { mode: 'auto' },
      };
      const cleaned = cleanSourceContext(autoContext);
      expect(cleaned.recording_id).toBe('rec_auto');
      expect(cleaned.sources).toEqual([]);
      expect(cleaned.selection).toEqual({ mode: 'auto' });
    });
  });

  // Feature 11: Real-World Test Fixture (Anggi Marito - "Tak Segampang Itu")
  describe('Feature 11: Real-World Fixture (Anggi Marito - "Tak Segampang Itu")', () => {
    const artist = 'Anggi Marito';
    const studio = createTrack({
      title: 'Tak Segampang Itu',
      artist,
      duration: 232, // 3:52
      path: 'C:/Music/Tak Segampang Itu.flac',
    });
    const acoustic = createTrack({
      title: 'Tak Segampang Itu (Acoustic)',
      artist,
      duration: 225, // 3:45
      path: 'https://www.youtube.com/watch?v=acoustic111',
      format: 'YouTube Direct',
    });
    const live = createTrack({
      title: 'Tak Segampang Itu (Live at Dahsyat)',
      artist,
      duration: 250, // 4:10
      path: 'https://www.youtube.com/watch?v=live1111111',
      format: 'YouTube Direct',
    });
    const mv = createTrack({
      title: 'Tak Segampang Itu (Official Music Video)',
      artist,
      duration: 275, // 4:35 with dialogue intro
      path: 'https://www.youtube.com/watch?v=mv111111111',
      format: 'YouTube Direct',
    });

    it('rejects automatic equivalence between Studio, Acoustic, and Live renditions', () => {
      expect(isSameRecording(studio, acoustic)).toBe(false);
      expect(isSameRecording(studio, live)).toBe(false);
      expect(isSameRecording(acoustic, live)).toBe(false);
    });

    it('groups studio and MV into a single song row with MV in display_candidates due to duration discrepancy', () => {
      const rows = groupRecordings([studio, mv], 'Tak Segampang Itu');
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.source_context?.sources).toHaveLength(1);
      expect(row.source_context?.sources[0].provider).toBe('local');
      expect(row.source_context?.display_candidates).toHaveLength(1);
      expect(row.source_context?.display_candidates![0].provider).toBe('youtube');
      expect(row.source_context?.display_candidates![0].match_reason).toBe('duration_discrepancy');
    });

    it('separates acoustic and live editions into distinct song rows', () => {
      const rows = groupRecordings([studio, acoustic, live], 'Tak Segampang Itu');
      // Studio, Acoustic, and Live have distinct version qualifiers so they form 3 separate song rows
      expect(rows.length).toBe(3);
    });
  });

  // Feature 12: Source Key & Context Validation
  describe('Feature 12: Source Key & Context Validation', () => {
    it('sourceKey creates deterministic provider:id string', () => {
      const localSource: PlaybackSource = { provider: 'local', id: 'C:/Music/test.flac' };
      const tidalSource: PlaybackSource = { provider: 'tidal', id: '12345678' };
      const ytSource: PlaybackSource = { provider: 'youtube', id: 'abcdefghijk' };

      expect(sourceKey(localSource)).toBe('local:C:/Music/test.flac');
      expect(sourceKey(tidalSource)).toBe('tidal:12345678');
      expect(sourceKey(ytSource)).toBe('youtube:abcdefghijk');
    });
  });
});
