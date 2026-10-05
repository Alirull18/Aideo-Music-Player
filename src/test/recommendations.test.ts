import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import { ListeningObservation, rankRecommendations, sameRecommendationRecording } from '../utils/recommendations';
import type { Track } from '../store/types';

const tracks: Track[] = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, path: `C:/Music/${i}.flac`, title: `Chill Song ${i}`, artist: `Artist ${i}`,
  album: 'Chill', genre: 'ambient', duration: 180, format: 'FLAC', lyric_offset: 0,
}));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset().mockImplementation(async (command, args: any) => {
    if (command === 'get_playlists') return [{ id: 1, name: 'AI Smart Mix - Chill' }];
    if (command === 'log_playback_start') return 1;
    if (command === 'check_files_exist') return [true];
    if (command === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => t.disliked !== 1), reasons: {}, generation: args.request.generation };
    return null;
  });
  useStore.setState({ tracks: tracks.map(t => ({ ...t })), queue: [], playCounts: {}, currentTrack: null,
    currentHistoryId: null, autoplayEnabled: false, sourceQueueManaged: false,
    appMode: 'local', chromecast_connected: false, upnp_connected: false,
    autoFetchLyricsOnline: vi.fn().mockResolvedValue(undefined), updateDiscordPresence: vi.fn(),
  });
});

it('counts confirmed listening but excludes seeks, stalls, pauses and gaps', () => {
  const observation = new ListeningObservation();
  observation.sample(0, 0, true);
  observation.sample(1000, 1, true);
  observation.sample(2000, 100, true);
  observation.sample(3000, 100, true);
  observation.sample(4000, 101, false);
  observation.sample(5000, 102, true);
  observation.sample(6000, 103, true);
  observation.sample(66000, 163, true);
  expect(observation.seconds).toBe(2);
});

it('preserves the Smart Mix sequence when starting playback', async () => {
  await useStore.getState().generateSmartMix('Chill', 'Library History');
  expect(useStore.getState().currentTrack?.path).toBe(tracks[0].path);
  expect(useStore.getState().queue.map(t => t.path)).toEqual(tracks.slice(1).map(t => t.path));
});

it('preserves the dynamic mix sequence when starting playback', async () => {
  await useStore.getState().playDynamicMix('recap');
  expect(useStore.getState().queue.map(t => t.path)).toEqual(tracks.slice(1).map(t => t.path));
});

it('Not interested removes confirmed copies only from the automatic queue', async () => {
  const online: Track = { ...tracks[0], path: '123', format: 'Tidal FLAC' };
  useStore.setState({ queue: [{ ...tracks[0], is_autoplay: true }, { ...online, is_autoplay: true }, { ...tracks[0] }], currentTrack: tracks[0] });
  await useStore.getState().setRecommendationInterest(tracks[0], false);
  expect(useStore.getState().queue.map(t => t.is_autoplay)).toEqual([undefined]);
  expect(useStore.getState().currentTrack?.path).toBe(tracks[0].path);
  expect(useStore.getState().tracks[0].disliked).toBe(1);
});

it('does not change feedback or queues when persistence fails', async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error('disk full'));
  await expect(useStore.getState().setRecommendationInterest(tracks[0], false)).rejects.toThrow('disk full');
  expect(useStore.getState().tracks[0].disliked).not.toBe(1);
});

it('discards a mix that finishes after the user starts another track', async () => {
  let resolveRank!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === 'get_recommendations') return new Promise(resolve => { resolveRank = resolve; });
    if (command === 'log_playback_start') return 1;
    if (command === 'check_files_exist') return [true];
    return args;
  });
  const mix = useStore.getState().playDynamicMix('supermix');
  await useStore.getState().playTrack(tracks[5]);
  resolveRank({ tracks, generation: (vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === 'get_recommendations')![1] as any).request.generation, reasons: {} });
  await mix;
  expect(useStore.getState().currentTrack?.path).toBe(tracks[5].path);
  expect(useStore.getState().queue).toEqual([]);
});

it('does not reward a unified playback start as a qualified listen', async () => {
  const track = { ...tracks[0], source_context: { recording_id: 'local_1', sources: [{ provider: 'local' as const, id: tracks[0].path }], selection: { mode: 'auto' as const } } };
  await useStore.getState().playTrack(track);
  expect(useStore.getState().playCounts).toEqual({});
});

it('detaches the old history row before a newer playback transition starts', async () => {
  let finishOld!: () => void;
  useStore.setState({ currentHistoryId: 41 });
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === 'log_playback_end' && args.historyId === 41) return new Promise<void>(resolve => { finishOld = resolve; });
    if (command === 'log_playback_start') return 42;
    return null;
  });
  const first = useStore.getState().recordPlaybackTransition(tracks[0]);
  expect(useStore.getState().currentHistoryId).toBeNull();
  await useStore.getState().recordPlaybackTransition(tracks[1]);
  finishOld();
  await first;
  expect(useStore.getState().currentHistoryId).toBe(42);
  const starts = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'log_playback_start');
  expect(starts).toHaveLength(1);
  expect(starts[0][1]).toMatchObject({ path: tracks[1].path });
});

it('closes a late history insert without replacing the active observation', async () => {
  let insertOld!: (id: number) => void;
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === 'log_playback_start') return args.path === tracks[0].path ? new Promise<number>(resolve => { insertOld = resolve; }) : 52;
    return null;
  });
  const first = useStore.getState().recordPlaybackTransition(tracks[0]);
  await useStore.getState().recordPlaybackTransition(tracks[1]);
  insertOld(51);
  await first;
  expect(useStore.getState().currentHistoryId).toBe(52);
  expect(invoke).toHaveBeenCalledWith('log_playback_end', expect.objectContaining({ historyId: 51, durationPlayed: 0, endReason: 'error' }));
});

it('keeps provider evidence and recommendation reasons separate for identical catalog IDs', async () => {
  const tidal = { ...tracks[0], path: '123', format: 'Tidal FLAC', recording_evidence: { isrc: 'USAAA1111111' } };
  const qobuz = { ...tracks[1], path: '123', format: 'Qobuz FLAC', recording_evidence: { isrc: 'USBBB2222222' } };
  useStore.setState({ appMode: 'hybrid', recommendationEngine: 'our' });
  let request: any;
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    request = args.request;
    return { tracks: [tidal, qobuz], generation: 0, reasons: { 'tidal:123': 'Tidal reason', 'qobuz:123': 'Qobuz reason' } };
  });
  const selected = await rankRecommendations(useStore.getState(), [tidal, qobuz], 'home');
  expect(request.recording_evidence['tidal:123']).toEqual(tidal.recording_evidence);
  expect(request.recording_evidence['qobuz:123']).toEqual(qobuz.recording_evidence);
  expect(selected.map(track => track.recommendation_reason)).toEqual(['Tidal reason', 'Qobuz reason']);
});

it('uses normalized evidence moods for the visible Smart Mix labels', async () => {
  await useStore.getState().generateSmartMix('Melancholic', 'Library History');
  expect(invoke).toHaveBeenCalledWith('get_recommendations', expect.objectContaining({ request: expect.objectContaining({ mood: 'sad' }) }));
});

it('applies changed provider policy to automatic queue entries and preserves manual choices', () => {
  const tidal = { ...tracks[0], path: '123', format: 'Tidal FLAC', is_autoplay: true };
  const local = { ...tracks[1], is_generated_mix: true };
  useStore.setState({ appMode: 'hybrid', recommendationEngine: 'our', queue: [tidal, { ...tidal, is_autoplay: undefined }, local], currentTrack: tidal });
  useStore.getState().setRecommendationEngine('youtube');
  expect(useStore.getState().queue).toEqual([{ ...tidal, is_autoplay: undefined }, local]);
  expect(useStore.getState().currentTrack).toBe(tidal);
});

it('keeps different remaster years and live venues separate for feedback', () => {
  const first = { ...tracks[0], title: 'Song (Live at venue A)' };
  const second = { ...tracks[1], artist: first.artist, title: 'Song (Live at venue B)' };
  expect(sameRecommendationRecording(first, second)).toBe(false);
  expect(sameRecommendationRecording({ ...first, title: 'Song (Remastered 2011)' }, { ...second, title: 'Song (Remastered 2020)' })).toBe(false);
});

it('clears frontend exclusion on confirmed copies when favoriting again', async () => {
  const excluded = { ...tracks[0], disliked: 1, loved: 0 };
  const copy = { ...excluded, id: 8, path: '123', format: 'Tidal FLAC' };
  useStore.setState({ tracks: [excluded, copy], currentTrack: copy, queue: [copy] });
  await useStore.getState().toggleLoveTrack(excluded.path);
  expect(useStore.getState().tracks.map(track => track.disliked)).toEqual([0, 0]);
  expect(useStore.getState().currentTrack?.disliked).toBe(0);
});
