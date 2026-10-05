import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import type { Track } from '../store/types';
import { refreshRestoredLibrary } from '../utils/libraryMaintenance';
const baseline = useStore.getState();
beforeEach(() => { localStorage.clear(); vi.mocked(invoke).mockReset(); useStore.setState(baseline); });
it('removes restored automatic suggestions while preserving and syncing manual queue entries', async () => {
  const manual = { id: 1, path: 'C:/manual.flac', lyric_offset: 0 } as Track;
  const automatic = { ...manual, path: 'tidal:123', is_autoplay: true };
  const sync = vi.fn().mockResolvedValue(undefined);
  useStore.setState({ queue: [manual, automatic], syncBackendQueue: sync });
  vi.mocked(invoke).mockImplementation(async command => command === 'sync_watch_folders' ? undefined : []);
  await refreshRestoredLibrary();
  expect(useStore.getState().queue).toEqual([manual]);
  expect(JSON.parse(localStorage.getItem('aideo_queue')!)).toEqual([manual]);
  expect(sync).toHaveBeenCalledOnce();
  expect(localStorage.getItem('aideo_local_restore_sync')).toBe('pending');
});
it('keeps restore pending and reports library refresh failures', async () => {
  vi.mocked(invoke).mockRejectedValue(new Error('Database unavailable'));
  await expect(refreshRestoredLibrary()).rejects.toThrow('Database unavailable');
  expect(localStorage.getItem('aideo_local_restore_sync')).toBe('pending');
});
