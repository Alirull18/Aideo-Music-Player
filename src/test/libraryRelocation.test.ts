import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { remapLibraryReferences, replayPendingLibraryRelocations } from '../utils/libraryRelocation';

beforeEach(() => { localStorage.clear(); vi.mocked(invoke).mockReset(); });
const mappings = [{ old_path: 'C:\\Music\\Disc 1\\歌曲.flac', new_path: 'D:\\Moved\\Disc 1\\歌曲.flac' }];
it('remaps local nested sources and path counts while preserving identities and providers', () => {
  const value = { path: mappings[0].old_path, path_hash: 'old', playlist_entry_id: 7, source_context: { recording_id: 'canonical', sources: [{ provider: 'local', id: mappings[0].old_path }, { provider: 'tidal', id: '123' }], selection: { mode: 'explicit', source: { provider: 'local', id: mappings[0].old_path } } } };
  const result = remapLibraryReferences(value, mappings) as typeof value;
  expect(result.path).toBe(mappings[0].new_path);
  expect(result.path_hash).toBeUndefined();
  expect(result.source_context.recording_id).toBe('canonical');
  expect(result.source_context.sources[0].id).toBe(mappings[0].new_path);
  expect(result.source_context.sources[1].id).toBe('123');
  expect(result.playlist_entry_id).toBe(7);
  expect(remapLibraryReferences({ title: mappings[0].old_path }, mappings)).toEqual({ title: mappings[0].old_path });
  const recordingKey = `local:${mappings[0].old_path}`;
  const registry = remapLibraryReferences({ [recordingKey]: { ...value.source_context, recording_id: recordingKey } }, mappings) as Record<string, typeof value.source_context>;
  expect(registry[recordingKey].recording_id).toBe(recordingKey);
  expect(registry[recordingKey].sources[0].id).toBe(mappings[0].new_path);
  expect(remapLibraryReferences('C:\\Music2\\song.flac', mappings)).toBe('C:\\Music2\\song.flac');
});
it('replays all saved references idempotently and acknowledges only after successful writes', async () => {
  const pending = [{ id: 1, mappings, roots: [{ old_path: 'C:\\Music', new_path: 'D:\\Moved' }] }];
  vi.mocked(invoke).mockResolvedValue(pending);
  localStorage.setItem('aideo_queue', JSON.stringify([{ path: mappings[0].old_path }]));
  localStorage.setItem('aideo_play_counts', JSON.stringify({ [mappings[0].old_path]: 3 }));
  localStorage.setItem('aideo_scan_dirs', JSON.stringify(['C:\\Music']));
  const write = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'aideo_play_counts') throw new Error('disk full');
    write.call(this, key, value);
  });
  await expect(replayPendingLibraryRelocations()).rejects.toThrow('disk full');
  expect(invoke).not.toHaveBeenCalledWith('ack_library_relocation', expect.anything());
  expect(JSON.parse(localStorage.getItem('aideo_queue')!)[0].path).toBe(mappings[0].new_path);
  expect(JSON.parse(localStorage.getItem('aideo_play_counts')!)).toEqual({ [mappings[0].old_path]: 3 });
  spy.mockRestore();
  await replayPendingLibraryRelocations(); await replayPendingLibraryRelocations();
  expect(JSON.parse(localStorage.getItem('aideo_queue')!)[0].path).toBe(mappings[0].new_path);
  expect(JSON.parse(localStorage.getItem('aideo_play_counts')!)).toEqual({ [mappings[0].new_path]: 3 });
  expect(JSON.parse(localStorage.getItem('aideo_scan_dirs')!)).toEqual(['D:\\Moved']);
  expect(invoke).toHaveBeenCalledWith('ack_library_relocation', { id: 1 });
});
it('fails closed on count key collisions and malformed persistent references', async () => {
  vi.mocked(invoke).mockResolvedValue([{ id: 1, mappings, roots: [] }]);
  localStorage.setItem('aideo_play_counts', JSON.stringify({ [mappings[0].old_path]: 3, [mappings[0].new_path]: 5 }));
  await expect(replayPendingLibraryRelocations()).rejects.toThrow('collision');
  expect(invoke).not.toHaveBeenCalledWith('ack_library_relocation', expect.anything());
});
it('keeps unresolved original roots alongside the destination and removes only the added root on Undo', async () => {
  localStorage.setItem('aideo_scan_dirs', JSON.stringify(['C:\\Music', 'Z:\\Other']));
  vi.mocked(invoke).mockResolvedValueOnce([{ id: 1, mappings, roots: [], added_roots: ['D:\\Moved'], removed_roots: [] }]);
  await replayPendingLibraryRelocations();
  expect(JSON.parse(localStorage.getItem('aideo_scan_dirs')!)).toEqual(['C:\\Music', 'Z:\\Other', 'D:\\Moved']);
  vi.mocked(invoke).mockResolvedValueOnce([{ id: 2, mappings: mappings.map(m => ({ old_path: m.new_path, new_path: m.old_path })), roots: [], removed_roots: ['D:\\Moved'], added_roots: [] }]);
  await replayPendingLibraryRelocations();
  expect(JSON.parse(localStorage.getItem('aideo_scan_dirs')!)).toEqual(['C:\\Music', 'Z:\\Other']);
});
