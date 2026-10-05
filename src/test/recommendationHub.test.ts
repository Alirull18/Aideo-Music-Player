import { invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import { LatestHubRequest, filterRecommendationHub, rankRecommendationHub, hubTrack } from '../utils/recommendationHub';
import type { DiscoveryHubData, PlayerState, Track } from '../store/types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const song = { id: 'aaaaaaaaaaa', title: 'Song', artist: 'Artist', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', cover_url: null, duration_raw: '3:00' };
describe('Home recommendation context', () => {
  it('uses source-qualified card identities instead of shared temporary track IDs', () => {
    const first: Track = { id: -1, path: song.url, title: 'First', artist: 'Artist', duration: 180, format: 'YouTube Direct', lyric_offset: 0 };
    const second = { ...first, path: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', title: 'Second' };
    expect(hubTrack(first).id).not.toBe(hubTrack(second).id);
    expect(hubTrack(first).id).toBe('youtube:aaaaaaaaaaa');
  });
  it('formats fractional native durations as minutes and seconds', () => {
    const track: Track = { id: 1, path: 'C:/song.flac', title: 'Song', artist: 'Artist', duration: 177.009614512, format: 'FLAC', lyric_offset: 0 };
    expect(hubTrack(track).duration_raw).toBe('2:57');
  });
  it('preserves recording evidence when a native result has no original catalog card', () => {
    const track: Track = { id: 1, path: 'C:/song.flac', title: 'Song', artist: 'Artist', duration: 180, format: 'FLAC', lyric_offset: 0,
      recording_evidence: { isrc: 'AA1234567890', version: 'live' } };
    expect(hubTrack(track).recording_evidence).toEqual(track.recording_evidence);
  });
  it('rejects late results and a changed context even before the next request begins', () => {
    const requests = new LatestHubRequest();
    const old = requests.begin('online');
    expect(requests.current(old, 'local')).toBe(false);
    const latest = requests.begin('local');
    expect(requests.current(old, 'online')).toBe(false);
    expect(requests.current(latest, 'local')).toBe(true);
  });
  it('filters cached shelves, charts and automatic mixes after equivalent feedback', () => {
    const state = { appMode: 'hybrid', recommendationEngine: 'our', tracks: [{ id: 1, path: 'C:\\song.flac', title: 'Song', artist: 'Artist', format: 'FLAC', duration: 180, disliked: 1 }] as Track[] } as unknown as PlayerState;
    const hub: DiscoveryHubData = { recommendations: [song], global_charts: [song], mixed_for_you: [{ id: 'supermix', title: 'Supermix', description: '', cover_url: null, tracks: [song] }] };
    expect(filterRecommendationHub(hub, { ...state, tracks: [] }).recommendations).toHaveLength(1);
    const filtered = filterRecommendationHub(hub, state);
    expect(filtered.recommendations).toEqual([]);
    expect(filtered.global_charts).toEqual([]);
    expect(filtered.mixed_for_you[0].tracks).toEqual([]);
    expect(hub.recommendations).toEqual([song]);
  });
  it('ranks every automatic mix using its surface and preserves manual playlist order', async () => {
    const state = { appMode: 'hybrid', recommendationEngine: 'our', tracks: [] } as unknown as PlayerState;
    vi.mocked(invoke).mockImplementation(async (_command, args: any) => ({ tracks: args.request.candidates.slice(0, 1), generation: args.request.generation, reasons: {} }));
    const mixes = ['supermix', 'spotlight', 'forgotten', 'on_repeat'].map(id => ({ id, title: id, description: '', cover_url: null, tracks: [song] }));
    const hub: DiscoveryHubData = { recommendations: [song], global_charts: [song], mixed_for_you: mixes, playlist_mixes: [mixes[0]] };
    const ranked = await rankRecommendationHub(hub, state, 8);
    const requests = vi.mocked(invoke).mock.calls.map(([, args]) => (args as any).request);
    expect(requests.map(request => request.surface)).toEqual(expect.arrayContaining(['home', 'recent', 'heavy_rotation', 'forgotten_gems', 'supermix', 'spotlight', 'forgotten_favorites', 'on_repeat']));
    expect(requests).toHaveLength(8);
    expect(requests.every(request => request.generation === 8)).toBe(true);
    expect(ranked.playlist_mixes?.[0].tracks).toEqual([song]);
    expect(ranked.global_charts).toEqual([song]);
  });  it('keeps manual playlist choices while excluding disliked songs from offline fallbacks', async () => {
    const local: Track = { id: 1, path: 'C:/song.flac', title: 'Song', artist: 'Artist', format: 'FLAC', duration: 180, lyric_offset: 0, disliked: 1 };
    const state = { appMode: 'local', recommendationEngine: 'our', tracks: [local] } as unknown as PlayerState;
    const manual = { ...song, path: local.path, url: local.path, format: 'FLAC', duration: 180 };
    const hub: DiscoveryHubData = { recommendations: [manual], global_charts: [], mixed_for_you: [], playlist_mixes: [{ id: 'manual', title: 'My playlist', description: '', cover_url: null, tracks: [manual] }] };
    vi.mocked(invoke).mockRejectedValue(new Error('offline'));
    const ranked = await rankRecommendationHub(hub, state, 9);
    expect(ranked.recommendations).toEqual([]);
    expect(ranked.playlist_mixes?.[0].tracks).toEqual([manual]);
  });  it('retains equivalent source choices when native ranking returns one copy and keeps uncertain copies separate', async () => {
    const local: Track = { id: 1, path: 'C:/song.flac', title: 'Song', artist: 'Artist', format: 'FLAC', duration: 180, lyric_offset: 0 };
    const uncertain: Track = { ...local, id: 2, path: 'C:/uncertain.flac', duration: 220 };
    const state = { appMode: 'hybrid', recommendationEngine: 'our', tracks: [local, uncertain] } as unknown as PlayerState;
    vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
      const chosen = args.request.candidates.find((track: Track) => track.path === local.path);
      return { tracks: [{ ...chosen, source_context: undefined }], generation: args.request.generation, reasons: {} };
    });
    const ranked = await rankRecommendationHub({ recommendations: [song], global_charts: [], mixed_for_you: [] }, state, 10);
    expect(ranked.recommendations[0].source_context?.sources.map(source => source.provider).sort()).toEqual(['local', 'youtube']);
    expect(ranked.recommendations[0].source_context?.sources.some(source => source.id === uncertain.path)).toBe(false);
    const request = (vi.mocked(invoke).mock.calls[vi.mocked(invoke).mock.calls.length - 1]?.[1] as any).request;
    expect(request.candidates.some((track: Track) => track.path === uncertain.path)).toBe(true);
  });
  it('creates automatic mixes from local evidence when provider retrieval has no mixes', async () => {
    const local: Track = { id: 1, path: 'C:/song.flac', title: 'Song', artist: 'Artist', format: 'FLAC', duration: 180, lyric_offset: 0, loved: 1 };
    const state = { appMode: 'local', recommendationEngine: 'our', tracks: [local], playCounts: {} } as unknown as PlayerState;
    vi.mocked(invoke).mockImplementation(async (_command, args: any) => ({ tracks: args.request.candidates, generation: args.request.generation, reasons: {} }));
    const ranked = await rankRecommendationHub({ recommendations: [], global_charts: [], mixed_for_you: [] }, state, 11);
    expect(ranked.mixed_for_you.map(mix => mix.id)).toEqual(['supermix', 'on_repeat', 'forgotten', 'spotlight']);
    expect(ranked.mixed_for_you.every(mix => mix.tracks[0].path === local.path)).toBe(true);
  });
  it('leaves objective mixes empty when their evidence query fails', async () => {
    const local: Track = { id: 1, path: 'C:/song.flac', title: 'Song', artist: 'Artist', format: 'FLAC', duration: 180, lyric_offset: 0 };
    const state = { appMode: 'local', recommendationEngine: 'our', tracks: [local] } as unknown as PlayerState;
    vi.mocked(invoke).mockRejectedValue(new Error('unavailable'));
    const ranked = await rankRecommendationHub({ recommendations: [], global_charts: [], heavy_rotation: [{ ...song, path: local.path, url: local.path, format: 'FLAC' }], mixed_for_you: [{ id: 'on_repeat', title: 'On repeat', description: '', cover_url: null, tracks: [song] }] }, state, 12);
    expect(ranked.mixed_for_you[0].tracks).toEqual([]);
  });
  it('keeps different recordings with the same numeric ID in different providers', async () => {
    const tidal: Track = { id: 1, path: '123', title: 'Tidal Song', artist: 'Artist One', format: 'Tidal FLAC', duration: 180, lyric_offset: 0 };
    const state = { appMode: 'hybrid', recommendationEngine: 'our', tracks: [tidal] } as unknown as PlayerState;
    const qobuz = { ...song, id: 'qobuz-123', path: '123', url: '123', title: 'Qobuz Song', artist: 'Artist Two', format: 'Qobuz FLAC', duration: 200 };
    vi.mocked(invoke).mockImplementation(async (_command, args: any) => ({ tracks: args.request.candidates, generation: args.request.generation, reasons: {} }));
    const ranked = await rankRecommendationHub({ recommendations: [qobuz], global_charts: [], mixed_for_you: [] }, state, 11);
    expect(ranked.recommendations.map(track => [track.title, track.format])).toEqual(expect.arrayContaining([['Tidal Song', 'Tidal FLAC'], ['Qobuz Song', 'Qobuz FLAC']]));
    expect(ranked.recommendations).toHaveLength(2);
  });});
