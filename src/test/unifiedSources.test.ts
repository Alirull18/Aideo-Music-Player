import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { Track } from '../store/types';
import { groupRecordings, rankSources, sourceKey, resolveSource, clearSourceCache, searchSources, applySourcePreference, saveSourceChoice, isLikelySameRecording } from '../utils/unifiedSources';

const track = (format: string, path: string, extra: Partial<Track> = {}): Track => ({
  id: 1, path, title: 'Song', artist: 'Artist', album: 'Album', duration: 180,
  format, lyric_offset: 0, recording_evidence: { isrc: 'USAAA2600001', upc: '0123456789012' },
  catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 }, ...extra,
});

describe('Unified recordings and resolution', () => {
  beforeEach(() => { localStorage.clear(); clearSourceCache(); vi.mocked(invoke).mockReset(); });

  it('combines strong metadata matches, keeping unknown durations and versions separate', () => {
    const tidal = track('Tidal FLAC', '123');
    const qobuz = track('Qobuz FLAC', '123');
    const local = track('FLAC', 'C:/Music/song.flac');
    expect(groupRecordings([tidal, qobuz, local], 'Song')).toHaveLength(1);
    expect(groupRecordings([tidal, qobuz, local], 'Song')[0].source_context?.sources).toHaveLength(3);
    for (const changed of [
      { duration: null }, { title: 'Song (Live)' },
      { recording_evidence: { ...qobuz.recording_evidence, version: 'Remastered 2026' } },
      { artist: 'Cover Artist' }, { duration: 184 },
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
    for (const changed of [{ title: 'Song (Live)' }, { artist: 'Cover Artist' }, { album: 'Other Album' }, { duration: 184 }]) {
      expect(isLikelySameRecording(local, track('Tidal FLAC', '123', changed))).toBe(false);
    }
  });

  it('uses stable, distinct identities for conflicting durations regardless of response order', () => {
    const a = track('Tidal FLAC', '123', { duration: 178.6 });
    const b = track('Qobuz FLAC', '123', { duration: 182.4 });
    const identities = (tracks: Track[]) => groupRecordings(tracks, '').map(t => t.source_context!.recording_id).sort();
    expect(new Set(identities([a, b])).size).toBe(2);
    expect(identities([a, b])).toEqual(identities([b, a]));
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
