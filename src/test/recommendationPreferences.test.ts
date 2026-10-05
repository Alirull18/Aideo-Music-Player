import { describe, it, expect, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { invalidateRecommendationPreferences, recommendationPreferenceRevision, searchExcludedRecordings, rankRecommendations, type ExcludedRecording } from '../utils/recommendations';
import type { PlayerState, Track } from '../store/types';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
describe('recommendation preferences', () => {
  it('searches canonical title, version and provider references together', () => {
    const recordings = [{ recording_id: 'a', track: { title: 'Song', artist: 'Artist' } as Track, version: 'Live Paris', sources: ['tidal:123', 'qobuz:456'] }] satisfies ExcludedRecording[];
    expect(searchExcludedRecordings(recordings, 'PARIS qobuz:456')).toHaveLength(1);
    expect(searchExcludedRecordings(recordings, 'qobuz:123')).toEqual([]);
  });
  it('rejects an in-flight rank after successful preference invalidation', async () => {
    let finish!: (v: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = rankRecommendations({} as PlayerState, [], 'home');
    const before = recommendationPreferenceRevision();
    invalidateRecommendationPreferences();
    expect(recommendationPreferenceRevision()).toBe(before + 1);
    finish({ generation: 0, tracks: [], reasons: {} });
    await expect(pending).rejects.toThrow('superseded');
  });
});
