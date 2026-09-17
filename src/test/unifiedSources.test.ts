import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { Track } from '../store/types';
import { groupRecordings, matchingSources, rankSources, sourceKey, resolveSource, clearSourceCache, searchSources, applySourcePreference, saveSourceChoice, isLikelySameRecording } from '../utils/unifiedSources';

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
});
