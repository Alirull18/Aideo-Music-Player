import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { Track } from '../store/types';
import { groupRecordings, matchingSources, rankSources, sourceKey, resolveSource, clearSourceCache, searchSources, applySourcePreference, saveSourceChoice, isLikelySameRecording, deduplicateSourcesForDisplay, sourceSearchQuery } from '../utils/unifiedSources';

const track = (format: string, path: string, extra: Partial<Track> = {}): Track => ({
  id: 1, path, title: 'Song', artist: 'Artist', album: 'Album', duration: 180,
  format, lyric_offset: 0, recording_evidence: { isrc: 'USAAA2600001', upc: '0123456789012' },
  catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 }, ...extra,
});

describe('Unified recordings and resolution', () => {
  beforeEach(() => { localStorage.clear(); clearSourceCache(); vi.mocked(invoke).mockReset(); });

  it('combines copies of a song while keeping different artists and versions separate', () => {
    const tidal = track('Tidal FLAC', '123');
    const qobuz = track('Qobuz FLAC', '123');
    const local = track('FLAC', 'C:/Music/song.flac');
    expect(groupRecordings([tidal, qobuz, local], 'Song')).toHaveLength(1);
    expect(groupRecordings([tidal, qobuz, local], 'Song')[0].source_context?.sources).toHaveLength(3);
    for (const changed of [
      { title: 'Song (Live)' },
      { recording_evidence: { ...qobuz.recording_evidence, version: 'Remastered 2026' } },
      { artist: 'Cover Artist' },
    ]) expect(groupRecordings([tidal, { ...qobuz, ...changed }], 'Song')).toHaveLength(2);
    expect(groupRecordings([tidal, { ...qobuz, recording_evidence: undefined }], 'Song')).toHaveLength(1);
  });

  it('keeps provider ID collisions distinct and relevance ahead of quality', () => {
    expect(sourceKey({ provider: 'tidal', id: '123' })).not.toBe(sourceKey({ provider: 'qobuz', id: '123' }));
    const results = groupRecordings([track('FLAC', 'C:/a.flac', { title: 'Different' }), track('YouTube Direct', 'https://www.youtube.com/watch?v=abcdefghijk', { recording_evidence: undefined })], 'Song');
    expect(results[0].title).toBe('Song');
  });

  it('matches metadata-only source alternatives without merging different recordings', () => {
    const local = track('FLAC', 'C:/a.flac', { recording_evidence: undefined });
    expect(isLikelySameRecording(local, track('YouTube Direct', 'https://www.youtube.com/watch?v=abcdefghijk', {
      title: 'Song (Official Audio)', album: null, duration: 182, recording_evidence: undefined,
    }))).toBe(true);
    for (const changed of [{ title: 'Song (Live)' }, { artist: 'Cover Artist' }, { duration: 184 }]) {
      expect(isLikelySameRecording(local, track('Tidal FLAC', '123', changed))).toBe(false);
    }
  });

  it('joins the same song across albums and discovers its sources in every direction', () => {
    const song = { title: 'Tak Segampang Itu', artist: 'Anggi Marito', duration: 231 };
    const copies = [
      track('M4A', 'C:/Music/song.m4a', { ...song, album: 'Tak Segampang Itu', duration: 231.136, recording_evidence: undefined }),
      track('Tidal FLAC', '123', { ...song, album: 'Tak Segampang Itu' }),
      track('Tidal FLAC', '456', { ...song, album: 'Lune', recording_evidence: { isrc: 'USAAA2600001', upc: '0123456789013' } }),
      track('YouTube Direct', 'https://www.youtube.com/watch?v=gR_qbfGkwpc', { ...song, album: null, duration: 232, recording_evidence: undefined }),
    ];
    const expected = ['local:C:/Music/song.m4a', 'tidal:123', 'tidal:456', 'youtube:gR_qbfGkwpc'];
    for (const first of copies) {
      const rows = groupRecordings([first, ...copies.filter(copy => copy !== first)], 'Anggi Marito');
      expect(rows).toHaveLength(1);
      expect(rows[0].source_context!.sources.map(sourceKey).sort()).toEqual(expected);
      expect(matchingSources(first, rows).map(sourceKey).sort()).toEqual(expected);
    }
  });

  it('matches YouTube presentation labels without merging different performances', () => {
    const local = track('FLAC', 'C:/Music/song.flac');
    const web = track('YouTube Direct', 'https://www.youtube.com/watch?v=abcdefghijk', {
      title: 'Artist - Song (Official Music Video)', artist: 'Artist - Topic', album: null, recording_evidence: undefined,
    });
    expect(isLikelySameRecording(local, web)).toBe(true);
    expect(isLikelySameRecording(web, local)).toBe(true);
    for (const title of ['Artist - Song (Live)', 'Artist - Song (Remix)', 'Other Artist - Song']) {
      expect(isLikelySameRecording(local, { ...web, title })).toBe(false);
    }
  });

  it('groups sources within 3s corroboration ceiling and separates >3s differences into distinct recordings', () => {
    const closeA = track('Tidal FLAC', '123', { duration: 179.5 });
    const closeB = track('Qobuz FLAC', '124', { duration: 182.0 });
    const closeRows = groupRecordings([closeA, closeB], '');
    expect(closeRows).toHaveLength(1);
    expect(closeRows[0].source_context!.sources).toHaveLength(2);

    const farA = track('Tidal FLAC', '123', { duration: 178.6 });
    const farB = track('Qobuz FLAC', '125', { duration: 182.4 });
    const farRows = groupRecordings([farA, farB], '');
    expect(farRows).toHaveLength(1);
    // Safe playback cohort contains only the anchor; >3s difference is segregated to display_candidates
    expect(farRows[0].source_context!.sources).toHaveLength(1);
    expect(farRows[0].source_context!.display_candidates).toHaveLength(1);
  });

  it('groups first-search provider responses as they arrive without a saved choice', async () => {
    let finishYoutube!: (value: unknown) => void;
    const local = track('M4A', 'C:/Music/song.m4a', { duration: 231.136, recording_evidence: undefined });
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'search_local_sources') return [local];
      if (cmd === 'search_youtube') return new Promise(resolve => { finishYoutube = resolve; });
      return [
        { id: '123', title: 'Song', artist: 'Artist', duration: 232, recording_evidence: { isrc: 'USAAA2600001' } },
        { id: '456', title: 'Song', artist: 'Artist', duration: 231, recording_evidence: { isrc: 'USAAA2600001' } },
      ];
    });
    const snapshots: Track[][] = [];
    const search = searchSources('Artist', { tidal: true, qobuz: false }, result => snapshots.push(result.tracks));
    await vi.waitFor(() => expect(finishYoutube).toBeTypeOf('function'));
    finishYoutube([{ id: 'abcdefghijk', title: 'Artist - Song (Official Music Video)', artist: 'Artist', duration: 231, duration_raw: '3:51' }]);
    const result = await search;
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].source_context!.sources.map(sourceKey).sort()).toEqual([
      'local:C:/Music/song.m4a', 'tidal:123', 'tidal:456', 'youtube:abcdefghijk',
    ]);
    expect(snapshots.every(rows => rows.length <= 1)).toBe(true);
    expect(localStorage.getItem('aideo_library_source_choices')).toBeNull();

    // Verify conflicting ISRC is segregated into display_candidates
    const tidalTrack = track('Tidal FLAC', '123', { duration: 231, recording_evidence: { isrc: 'USAAA2600001' } });
    const conflicting = track('Tidal FLAC', '789', { duration: 231, recording_evidence: { isrc: 'USAAA2600099' } });
    const grouped = groupRecordings([tidalTrack, conflicting], '');
    expect(grouped).toHaveLength(1);
    const safeSourceIds = grouped[0].source_context!.sources.map(s => s.id);
    expect(safeSourceIds).toContain('123');
    expect(safeSourceIds).not.toContain('789');
    expect(grouped[0].source_context!.display_candidates?.map(s => s.id)).toContain('789');
  });

  it('keeps every provider represented when a song has more copies than the saved-source limit', () => {
    const copies = Array.from({ length: 35 }, (_, i) => track('Tidal FLAC', String(i + 1)));
    const rows = groupRecordings([...copies, track('FLAC', 'C:/Music/song.flac'),
      track('YouTube Direct', 'https://www.youtube.com/watch?v=abcdefghijk')], 'Song');
    expect(rows).toHaveLength(1);
    expect(rows[0].source_context?.sources).toHaveLength(32);
    expect(new Set(rows[0].source_context?.sources.map(source => source.provider))).toEqual(new Set(['local', 'tidal', 'youtube']));
  });

  it('ignores corrupt preferences and persists deliberate library conversion without converting old playlist entries', async () => {
    const legacy = track('Tidal FLAC', '123');
    const unified = groupRecordings([legacy], '')[0];
    for (const bad of ['null', '[]', '{', JSON.stringify({ [unified.source_context!.recording_id]: { mode: 'explicit' } })]) {
      localStorage.setItem('aideo_recording_source_preferences', bad);
      expect(applySourcePreference(unified).source_context?.selection.mode).toBe('auto');
    }
    await saveSourceChoice(legacy, unified.source_context!);
    expect(applySourcePreference({ ...legacy }).source_context?.selection.mode).toBe('auto');
    expect(applySourcePreference({ ...legacy, playlist_entry_id: 12 }).source_context).toBeUndefined();
  });

  it('remembers a discovered source choice when search later obtains stronger recording evidence', async () => {
    const tidal = track('Tidal FLAC', '123');
    const qobuz = track('Qobuz FLAC', '456');
    const unified = groupRecordings([tidal, qobuz], '')[0];
    const context = { ...unified.source_context!, recording_id: 'tidal:123', selection: { mode: 'explicit' as const, source: unified.source_context!.sources[1] } };
    await saveSourceChoice({ ...tidal, source_context: context }, context);
    expect(applySourcePreference(unified).source_context?.selection).toEqual(context.selection);
    expect(applySourcePreference(tidal).source_context).toBeUndefined();
  });

  it('prefers local when it meets the preference and higher available resolution otherwise', () => {
    const local = { provider: 'local' as const, id: 'C:/a.flac', catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } };
    const hires = { provider: 'qobuz' as const, id: '123', catalog_quality: { lossless: true, sample_rate: 96000, bit_depth: 24 } };
    expect(rankSources([local, hires], 'best_available')[0]).toBe(hires);
    expect(rankSources([local, hires], 'standard_lossless')[0]).toBe(local);
    expect(rankSources([local, hires], 'data_saver')[0]).toBe(local);
  });

  it('caches by provider, ID, and requested quality without inferring returned quality', async () => {
    vi.mocked(invoke).mockResolvedValue({ url: 'https://cdn.example/audio', quality: {} });
    await resolveSource({ provider: 'tidal', id: '123' }, 'best_available');
    await resolveSource({ provider: 'tidal', id: '123' }, 'best_available');
    await resolveSource({ provider: 'qobuz', id: '123' }, 'best_available');
    const result = await resolveSource({ provider: 'tidal', id: '123' }, 'data_saver');
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenLastCalledWith('tidal_resolve_source', { trackId: '123', requestedQuality: 'data_saver' });
    expect(result.quality.lossless).toBeUndefined();
  });

  it('publishes completed providers while another is pending and reports partial failure', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'search_local_sources') return [track('FLAC', 'C:/a.flac')];
      if (cmd === 'tidal_search') throw new Error('Disconnected');
      return new Promise(resolve => { finish = resolve; });
    });
    const snapshots: string[][] = [];
    const promise = searchSources('Song', { tidal: true, qobuz: false }, result => snapshots.push(result.tracks.map(t => t.path)));
    await vi.waitFor(() => expect(snapshots.some(paths => paths.includes('C:/a.flac'))).toBe(true));
    finish([]);
    const result = await promise;
    expect(result.errors.tidal).toContain('Disconnected');
    expect(result.pending).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith('qobuz_search', expect.anything());
  });

  describe('deduplicateSourcesForDisplay', () => {
    it('collapses redundant identical releases for the same provider and quality', () => {
      const tidal1 = { provider: 'tidal' as const, id: '101', metadata: { title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', duration: 203 }, catalog_quality: { lossless: true } };
      const tidal2 = { provider: 'tidal' as const, id: '102', metadata: { title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', duration: 203 }, catalog_quality: { lossless: true } };
      const tidal3 = { provider: 'tidal' as const, id: '103', metadata: { title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia (Moonlight Edition)', duration: 203 }, catalog_quality: { lossless: true } };
      const yt1 = { provider: 'youtube' as const, id: 'yt_1', metadata: { title: 'Dua Lipa - Levitating (Official Video)', artist: 'Dua Lipa', duration: 203 }, catalog_quality: { lossless: false } };
      const yt2 = { provider: 'youtube' as const, id: 'yt_2', metadata: { title: 'Dua Lipa - Levitating (Official Video)', artist: 'Dua Lipa', duration: 203 }, catalog_quality: { lossless: false } };

      const deduped = deduplicateSourcesForDisplay([tidal1, tidal2, tidal3, yt1, yt2]);
      expect(deduped).toHaveLength(3);
      expect(deduped.map(s => s.id)).toEqual(['101', '103', 'yt_1']);
    });

    it('always preserves the explicitly selected source even when identical to another candidate', () => {
      const tidal1 = { provider: 'tidal' as const, id: '101', metadata: { title: 'Song', artist: 'Artist', album: 'Album', duration: 180 }, catalog_quality: { lossless: true } };
      const tidal2 = { provider: 'tidal' as const, id: '102', metadata: { title: 'Song', artist: 'Artist', album: 'Album', duration: 180 }, catalog_quality: { lossless: true } };

      const deduped = deduplicateSourcesForDisplay([tidal1, tidal2], { mode: 'explicit', source: tidal2 });
      expect(deduped).toHaveLength(1);
      expect(deduped[0].id).toBe('102');
    });

    it('discovers and links Tidal, YouTube, and Local copies when Tidal has explicit advisory', () => {
      const local = track('FLAC', 'C:/Music/KillBill.flac', { title: 'Kill Bill', artist: 'SZA', duration: 153.8, recording_evidence: undefined });
      const tidal = track('Tidal FLAC', '272719231', { title: 'Kill Bill', artist: 'SZA', duration: 153, recording_evidence: { isrc: 'USRC12204481', explicit: true } });
      const youtube = track('YouTube Direct', 'https://www.youtube.com/watch?v=SQnc1QZ7U9Q', { title: 'Kill Bill', artist: 'SZA', duration: 155, recording_evidence: undefined });

      const grouped = groupRecordings([local, tidal, youtube], 'Kill Bill');
      expect(grouped).toHaveLength(1);

      // Verify from Local perspective
      const fromLocal = matchingSources(local, grouped).map(sourceKey);
      expect(fromLocal).toContain('local:C:/Music/KillBill.flac');
      expect(fromLocal).toContain('tidal:272719231');
      expect(fromLocal).toContain('youtube:SQnc1QZ7U9Q');

      // Verify from Tidal perspective
      const fromTidal = matchingSources(tidal, grouped).map(sourceKey);
      expect(fromTidal).toContain('tidal:272719231');
      expect(fromTidal).toContain('local:C:/Music/KillBill.flac');
      expect(fromTidal).toContain('youtube:SQnc1QZ7U9Q');

      // Verify from YouTube perspective
      const fromYt = matchingSources(youtube, grouped).map(sourceKey);
      expect(fromYt).toContain('youtube:SQnc1QZ7U9Q');
      expect(fromYt).toContain('local:C:/Music/KillBill.flac');
      expect(fromYt).toContain('tidal:272719231');
    });

    it('preserves candidates across sources without mutual all-pairs wipeout when duration deltas vary', () => {
      const local = track('FLAC', 'C:/Music/song.flac', { title: 'Song', artist: 'Artist', duration: 180 });
      const tidal = track('Tidal FLAC', '101', { title: 'Song', artist: 'Artist', duration: 178 });
      const youtube = track('YouTube Direct', 'https://www.youtube.com/watch?v=12345678901', { title: 'Song', artist: 'Artist', duration: 182 });

      const grouped = groupRecordings([local, tidal, youtube], 'Song');
      const sources = matchingSources(local, grouped).map(sourceKey);
      expect(sources).toContain('local:C:/Music/song.flac');
      expect(sources).toContain('tidal:101');
      expect(sources).toContain('youtube:12345678901');
    });

    it('cross-source discovery: Local, Tidal (explicit), and YouTube (>3s duration video intro) mutually discover each other', () => {
      const local = track('FLAC', 'C:/Music/Flowers.flac', { title: 'Flowers', artist: 'Miley Cyrus', duration: 200.4 });
      const tidal = track('Tidal FLAC', '27012345', { title: 'Flowers', artist: 'Miley Cyrus', duration: 200, recording_evidence: { explicit: true } });
      const youtube = track('YouTube Direct', 'https://www.youtube.com/watch?v=G7KNmW9a75Y', { title: 'Miley Cyrus - Flowers (Official Video)', artist: 'Miley Cyrus', duration: 208 });

      const grouped = groupRecordings([local, tidal, youtube], 'Flowers');
      expect(grouped).toHaveLength(1);
      const row = grouped[0];
      const allRowSources = [...(row.source_context?.sources || []), ...(row.source_context?.display_candidates || [])].map(sourceKey);
      expect(allRowSources).toContain('local:C:/Music/Flowers.flac');
      expect(allRowSources).toContain('tidal:27012345');
      expect(allRowSources).toContain('youtube:G7KNmW9a75Y');

      // Local perspective
      const fromLocal = matchingSources(local, grouped).map(sourceKey);
      expect(fromLocal).toContain('local:C:/Music/Flowers.flac');
      expect(fromLocal).toContain('tidal:27012345');
      expect(fromLocal).toContain('youtube:G7KNmW9a75Y');

      // Tidal perspective
      const fromTidal = matchingSources(tidal, grouped).map(sourceKey);
      expect(fromTidal).toContain('local:C:/Music/Flowers.flac');
      expect(fromTidal).toContain('tidal:27012345');
      expect(fromTidal).toContain('youtube:G7KNmW9a75Y');

      // YouTube perspective
      const fromYt = matchingSources(youtube, grouped).map(sourceKey);
      expect(fromYt).toContain('local:C:/Music/Flowers.flac');
      expect(fromYt).toContain('tidal:27012345');
      expect(fromYt).toContain('youtube:G7KNmW9a75Y');
    });

    it('cross-source discovery: aespa - Lemonade across Local, Tidal, and YouTube', () => {
      const local = track('FLAC', 'C:/Music/aespa - Lemonade.flac', { title: 'Lemonade', artist: 'aespa (에스파)', duration: 195 });
      const tidal = track('Tidal FLAC', '34567890', { title: 'LEMONADE', artist: 'aespa', duration: 195 });
      const youtube = track('YouTube Direct', 'https://www.youtube.com/watch?v=lemonade123', {
        title: "aespa 에스파 'Lemonade' MV",
        artist: 'SMTOWN',
        duration: 205,
      });

      const grouped = groupRecordings([local, tidal, youtube], 'aespa lemonade');
      expect(grouped).toHaveLength(1);
      const row = grouped[0];
      const allRowSources = [...(row.source_context?.sources || []), ...(row.source_context?.display_candidates || [])].map(sourceKey);
      expect(allRowSources).toContain('local:C:/Music/aespa - Lemonade.flac');
      expect(allRowSources).toContain('tidal:34567890');
      expect(allRowSources).toContain('youtube:lemonade123');

      // Local perspective
      const fromLocal = matchingSources(local, grouped).map(sourceKey);
      expect(fromLocal).toContain('local:C:/Music/aespa - Lemonade.flac');
      expect(fromLocal).toContain('tidal:34567890');
      expect(fromLocal).toContain('youtube:lemonade123');

      // Tidal perspective
      const fromTidal = matchingSources(tidal, grouped).map(sourceKey);
      expect(fromTidal).toContain('local:C:/Music/aespa - Lemonade.flac');
      expect(fromTidal).toContain('tidal:34567890');
      expect(fromTidal).toContain('youtube:lemonade123');

      // YouTube perspective
      const fromYt = matchingSources(youtube, grouped).map(sourceKey);
      expect(fromYt).toContain('local:C:/Music/aespa - Lemonade.flac');
      expect(fromYt).toContain('tidal:34567890');
      expect(fromYt).toContain('youtube:lemonade123');

      // Search query generated from all 3 perspectives
      expect(sourceSearchQuery(local).toLowerCase()).toBe('aespa lemonade');
      expect(sourceSearchQuery(tidal).toLowerCase()).toBe('aespa lemonade');
      expect(sourceSearchQuery(youtube).toLowerCase()).toBe('aespa lemonade');
    });

    it('matches diverse YouTube video title patterns to clean track title', () => {
      const canonical = track('Tidal FLAC', '34567890', { title: 'LEMONADE', artist: 'aespa', duration: 195 });
      const titles = [
        "aespa 에스파 'Lemonade' MV",
        "aespa 'Lemonade' MV",
        "[MV] aespa - Lemonade",
        "aespa(에스파) 'Lemonade' M/V",
        "aespa - Lemonade (Official Video)",
        "aespa - Lemonade (Official Audio)",
        "aespa 'LEMONADE' Track Video",
      ];

      for (let i = 0; i < titles.length; i++) {
        const id = `lemonade00${i}`;
        const yt = track('YouTube Direct', `https://www.youtube.com/watch?v=${id}`, {
          title: titles[i],
          artist: i % 2 === 0 ? 'SMTOWN' : 'aespa',
          duration: 195,
        });
        const grouped = groupRecordings([canonical, yt], 'aespa lemonade');
        expect(grouped).toHaveLength(1);
        const matches = matchingSources(canonical, grouped).map(sourceKey);
        expect(matches).toContain(`youtube:${id}`);
      }
    });
  });
});

