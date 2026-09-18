import { describe, it, expect } from 'vitest';
import {
  parseMusicSearchQuery,
  groupRecordings,
  parseVersionDescriptor,
  areVersionsCompatible,
  coreTitle,
} from '../utils/unifiedSources';
import type { Track } from '../store/types';

const baseTrack = (overrides: Partial<Track>): Track => ({
  id: 1,
  title: 'Kill Bill',
  artist: 'SZA',
  album: 'SOS',
  duration: 153,
  format: 'Tidal FLAC',
  path: '12345',
  lyric_offset: 0,
  recording_evidence: { isrc: 'USRC12204068' },
  catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 },
  ...overrides,
});

describe('parseMusicSearchQuery', () => {
  it('parses "Title" by Artist pattern with stray quotes', () => {
    const parsed1 = parseMusicSearchQuery('Kill Bill" by SZA');
    expect(parsed1.cleanQuery).toBe('Kill Bill SZA');
    expect(parsed1.targetTitle).toBe('Kill Bill');
    expect(parsed1.targetArtist).toBe('SZA');
    expect(parsed1.isPianoRequested).toBe(false);

    const parsed2 = parseMusicSearchQuery('"Kill Bill" by SZA');
    expect(parsed2.cleanQuery).toBe('Kill Bill SZA');
    expect(parsed2.targetTitle).toBe('Kill Bill');
    expect(parsed2.targetArtist).toBe('SZA');
  });

  it('parses Title by Artist without quotes', () => {
    const parsed = parseMusicSearchQuery('Kill Bill by SZA');
    expect(parsed.cleanQuery).toBe('Kill Bill SZA');
    expect(parsed.targetTitle).toBe('Kill Bill');
    expect(parsed.targetArtist).toBe('SZA');
  });

  it('parses Stand by Me by Ben E. King on last "by"', () => {
    const parsed = parseMusicSearchQuery('Stand by Me by Ben E. King');
    expect(parsed.targetTitle).toBe('Stand by Me');
    expect(parsed.targetArtist).toBe('Ben E. King');
    expect(parsed.cleanQuery).toBe('Stand by Me Ben E. King');
  });

  it('does not split idioms like "Side by Side" or "Day by Day"', () => {
    const parsed = parseMusicSearchQuery('Side by Side');
    expect(parsed.targetTitle).toBeUndefined();
    expect(parsed.cleanQuery).toBe('Side by Side');
  });

  it('detects explicit version requests', () => {
    const piano = parseMusicSearchQuery('Kill Bill piano cover');
    expect(piano.isPianoRequested).toBe(true);
    expect(piano.isCoverRequested).toBe(true);

    const spedUp = parseMusicSearchQuery('Kill Bill sped up');
    expect(spedUp.isSpedUpRequested).toBe(true);
  });
});

describe('Version Separation & Descriptor', () => {
  it('detects piano covers, sped up, and tribute versions', () => {
    const standard = baseTrack({ title: 'Kill Bill', artist: 'SZA' });
    const piano = baseTrack({ title: 'SZA - Kill Bill - Piano Cover', artist: 'SZA - Piano Covers' });
    const spedUp = baseTrack({ title: 'Kill Bill (made popular by SZA) [sped up version]', artist: 'Party T' });
    const instrumental = baseTrack({ title: 'Kill Bill (Originally Performed by SZA) (Instrumental Version)', artist: 'Tray Tha Studio Rat' });

    const vStd = parseVersionDescriptor(standard);
    const vPiano = parseVersionDescriptor(piano);
    const vSped = parseVersionDescriptor(spedUp);
    const vInst = parseVersionDescriptor(instrumental);

    expect(vStd.isPiano).toBe(false);
    expect(vStd.isSpedOrSlowed).toBe(false);
    expect(vStd.isCoverOrTribute).toBe(false);

    expect(vPiano.isPiano).toBe(true);
    expect(vSped.isSpedOrSlowed).toBe(true);
    expect(vInst.isInstrumental).toBe(true);
    expect(vInst.isCoverOrTribute).toBe(true);

    expect(areVersionsCompatible(vStd, vPiano)).toBe(false);
    expect(areVersionsCompatible(vStd, vSped)).toBe(false);
    expect(areVersionsCompatible(vStd, vInst)).toBe(false);
  });

  it('cleans derivative suffixes in coreTitle', () => {
    expect(coreTitle(baseTrack({ title: 'Kill Bill (Sped Up Version)' }))).toBe('kill bill');
    expect(coreTitle(baseTrack({ title: 'Kill Bill - Piano Cover' }))).toBe('kill bill');
    expect(coreTitle(baseTrack({ title: 'Kill Bill (made popular by SZA)' }))).toBe('kill bill');
  });
});

describe('Search Result Relevance & Ranking', () => {
  it('prioritizes official track over piano covers, tributes, sped up, and unrelated tracks', () => {
    const official = baseTrack({
      id: 1,
      title: 'Kill Bill',
      artist: 'SZA',
      album: 'SOS',
      format: 'Tidal FLAC',
      path: '1001',
    });

    const pianoCover = baseTrack({
      id: 2,
      title: 'SZA - Kill Bill - Piano Cover',
      artist: 'SZA - Piano Covers',
      album: 'SZA - Kill Bill - Piano Cover',
      format: 'Tidal FLAC',
      path: '1002',
    });

    const unrelated = baseTrack({
      id: 3,
      title: 'Stoned by kill bill',
      artist: 'KillBill / Night shift by kill bill',
      album: 'Night Shift',
      format: 'Tidal FLAC',
      path: '1003',
    });

    const instrumental = baseTrack({
      id: 4,
      title: 'Kill Bill (Originally Performed by SZA) (Instrumental Version)',
      artist: 'Tray Tha Studio Rat',
      album: 'Tributes',
      format: 'Tidal FLAC',
      path: '1004',
    });

    const spedUp = baseTrack({
      id: 5,
      title: 'Kill Bill (made popular by SZA) [sped up version]',
      artist: 'Party T',
      album: 'Sped Up Hits',
      format: 'Tidal FLAC',
      path: '1005',
    });

    // Provide them in reverse order to verify ranking pulls official to the top
    const all = [pianoCover, unrelated, instrumental, spedUp, official];
    const ranked = groupRecordings(all, 'Kill Bill" by SZA');

    expect(ranked[0].title).toBe('Kill Bill');
    expect(ranked[0].artist).toBe('SZA');
    expect(ranked[0].source_context?.sources[0].id).toBe('1001');

    // Official track must NOT contain the piano cover or sped up copy in its sources
    const officialSources = ranked[0].source_context?.sources.map(s => s.id) || [];
    expect(officialSources).toContain('1001');
    expect(officialSources).not.toContain('1002');
    expect(officialSources).not.toContain('1005');
  });

  it('prioritizes requested version when user explicitly searches for it', () => {
    const official = baseTrack({
      id: 1,
      title: 'Kill Bill',
      artist: 'SZA',
      path: '1001',
    });

    const pianoCover = baseTrack({
      id: 2,
      title: 'SZA - Kill Bill - Piano Cover',
      artist: 'SZA - Piano Covers',
      path: '1002',
    });

    const ranked = groupRecordings([official, pianoCover], 'Kill Bill piano cover');
    expect(ranked[0].title).toContain('Piano Cover');
  });

  it('detects sped-up versions from Tidal catalog evidence and album title', () => {
    const officialTidal = baseTrack({
      id: 1,
      title: 'Kill Bill',
      artist: 'SZA',
      album: 'SOS',
      duration: 153,
      path: '264214532',
      recording_evidence: { isrc: 'USRC12204068', version: null },
    });

    // Tidal track that received version in title from format_catalog_title
    const tidalSpedUpFormatted = baseTrack({
      id: 2,
      title: 'Kill Bill (Sped Up Version)',
      artist: 'SZA',
      album: 'Kill Bill (Sped Up Version)',
      duration: 145,
      path: '268294972',
      recording_evidence: { isrc: 'USRC12300071', version: 'Sped Up Version' },
    });

    // Tidal track that only had the qualifier in album title
    const tidalSpedUpAlbumOnly = baseTrack({
      id: 3,
      title: 'Kill Bill',
      artist: 'SZA',
      album: 'Kill Bill (Sped Up Version)',
      duration: 145,
      path: '268294973',
      recording_evidence: { isrc: 'USRC12300072' },
    });

    const vOfficial = parseVersionDescriptor(officialTidal);
    const vSpedUp1 = parseVersionDescriptor(tidalSpedUpFormatted);
    const vSpedUp2 = parseVersionDescriptor(tidalSpedUpAlbumOnly);

    expect(vOfficial.isSpedOrSlowed).toBe(false);
    expect(vSpedUp1.isSpedOrSlowed).toBe(true);
    expect(vSpedUp2.isSpedOrSlowed).toBe(true);

    expect(areVersionsCompatible(vOfficial, vSpedUp1)).toBe(false);
    expect(areVersionsCompatible(vOfficial, vSpedUp2)).toBe(false);

    // Grouping with Tidal sped up at the start must still rank official SOS track at #1
    const ranked = groupRecordings([tidalSpedUpFormatted, tidalSpedUpAlbumOnly, officialTidal], 'Kill Bill" by SZA');
    expect(ranked[0].title).toBe('Kill Bill');
    expect(ranked[0].album).toBe('SOS');
    expect(ranked[0].path).toBe('264214532');

    // Official track must not contain the sped-up Tidal sources
    const officialSources = ranked[0].source_context?.sources.map(s => s.id) || [];
    expect(officialSources).toContain('264214532');
    expect(officialSources).not.toContain('268294972');
    expect(officialSources).not.toContain('268294973');
  });
});
