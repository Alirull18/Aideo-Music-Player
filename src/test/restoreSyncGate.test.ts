import { beforeEach, expect, it, vi } from 'vitest';
import { syncToCloud, syncFromCloud } from '../utils/syncEngine';
import { getSupabaseClient } from '../utils/supabaseClient';
import type { PlayerState } from '../store/types';

vi.mock('../utils/supabaseClient', () => ({ getSupabaseClient: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

it.each([syncToCloud, syncFromCloud])('blocks cloud calls until restored data is reviewed', async sync => {
  localStorage.setItem('aideo_local_restore_sync', 'pending');
  const setPlaybackError = vi.fn();
  await sync(() => ({ setPlaybackError }) as unknown as PlayerState, vi.fn());
  expect(getSupabaseClient).not.toHaveBeenCalled();
  expect(setPlaybackError).toHaveBeenCalledWith(expect.stringContaining('Local backup'));
});
