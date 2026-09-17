import { beforeEach, expect, it } from 'vitest';
import { unifyDiscoveryHub, discoveryTrack } from '../utils/discoveryFeed';
import { catalogTrack, groupRecordings } from '../utils/unifiedSources';
import { mergeTidalIntoHub, tidalResultsToHubTracks } from '../utils/tidalHub';
import type { DiscoveryHubData, Track, YoutubeTrack } from '../store/types';

const web: YoutubeTrack = { id: 'gR_qbfGkwpc', url: 'https://www.youtube.com/watch?v=gR_qbfGkwpc', title: 'Tak Segampang Itu', artist: 'Anggi Marito', duration_raw: '3:52', cover_url: null };
const local: Track = { id: 1, path: 'C:/Music/song.m4a', title: web.title, artist: web.artist, duration: 231, format: 'M4A', lyric_offset: 0 };
const hub = (): DiscoveryHubData => ({ recommendations: [web], global_charts: [], mixed_for_you: [] });

beforeEach(() => localStorage.clear());

it('keeps matching Tidal copies and combines home cards with local and YouTube sources', () => {
  const tidal = tidalResultsToHubTracks([{ id: 123, title: web.title, artist: web.artist, duration: 232 }]);
  const merged = mergeTidalIntoHub(hub(), tidal);
  expect(merged.tidal_hifi).toHaveLength(1);
  const result = unifyDiscoveryHub(merged, [local])!;
  expect(result.recommendations).toHaveLength(1);
  expect(result.tidal_hifi).toEqual([]);
  const song = discoveryTrack(result.recommendations[0]);
  expect(song.source_context?.sources.map(source => source.provider).sort()).toEqual(['local', 'tidal', 'youtube']);
  expect(hub().recommendations[0].source_context).toBeUndefined();
});

it('filters YouTube videos over 20 minutes in fresh search, cached home shelves and mixes', () => {
  const long = { ...web, duration_raw: '20:01' };
  expect(groupRecordings([catalogTrack(long, 'youtube')], '')).toEqual([]);
  const data = { ...hub(), recently_played: [long], recommendations: [long], mixed_for_you: [{ id: 'mix', title: 'Mix', description: '', cover_url: null, tracks: [long, web] }] };
  const result = unifyDiscoveryHub(data, [])!;
  expect(result.recommendations).toEqual([]);
  expect(result.recently_played).toEqual([]);
  expect(result.mixed_for_you[0].tracks).toHaveLength(1);
  expect(groupRecordings([catalogTrack({ ...web, duration_raw: '20:00' }, 'youtube')], '')).toHaveLength(1);
  expect(groupRecordings([{ ...local, duration: 1800 }], '')).toHaveLength(1);
  expect(groupRecordings([catalogTrack({ ...web, title: 'Anggi Marito interview' }, 'youtube')], '')).toEqual([]);
});

it('keeps one card across listening categories without adding unrelated local tracks', () => {
  const result = unifyDiscoveryHub({ ...hub(), recently_played: [web], global_charts: [web] }, [local, { ...local, path: 'C:/other.flac', title: 'Other song' }])!;
  expect(result.recently_played).toHaveLength(1);
  expect(result.recommendations).toEqual([]);
  expect(result.global_charts).toEqual([]);
});

it('preserves local quality metadata when a home shelf contains the same file', () => {
  const lossless = { ...local, catalog_quality: { lossless: true, sample_rate: 96000, bit_depth: 24 } };
  const cached = { ...web, id: 'local_1', url: local.path };
  expect(discoveryTrack(cached).catalog_quality?.lossless).toBeUndefined();
  const result = unifyDiscoveryHub({ ...hub(), recently_played: [cached] }, [lossless])!;
  expect(result.recently_played![0].source_context?.sources.find(source => source.provider === 'local')?.catalog_quality).toEqual(lossless.catalog_quality);
});
