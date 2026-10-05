import { invoke } from '@tauri-apps/api/core';

export interface PathMapping { old_path: string; new_path: string }
export interface LibraryRemap { id: number; mappings: PathMapping[]; roots: PathMapping[]; added_roots?: string[]; removed_roots?: string[] }
export interface RelocationPreview {
  old_root: string; new_root: string; fingerprint: string; mappings: PathMapping[];
  roots: PathMapping[]; unresolved: string[]; conflicts: string[];
}
const pathKey = (path: string) => path.replace(/\//g, '\\').toLowerCase();
function mapped(value: string, mappings: PathMapping[]): string {
  const match = mappings.find(m => pathKey(m.old_path) === pathKey(value));
  if (match) return match.new_path;
  const source = mappings.find(m => value === `local:${pathKey(m.old_path)}`);
  return source ? `local:${pathKey(source.new_path)}` : value;
}
function mappedKey(key: string, mappings: PathMapping[]): string {
  if (key.startsWith('local:')) return key;
  const direct = mapped(key, mappings);
  if (direct !== key) return direct;
  for (const m of mappings) {
    const suffix = `:${m.old_path}`;
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length) + `:${m.new_path}`;
    if (key === `source:local:${pathKey(m.old_path)}`) return `source:local:${pathKey(m.new_path)}`;
  }
  return key;
}
export function remapLibraryReferences(value: unknown, mappings: PathMapping[]): unknown {
  if (typeof value === 'string') return mapped(value, mappings);
  if (Array.isArray(value)) return value.map(v => remapLibraryReferences(v, mappings));
  if (!value || typeof value !== 'object') return value;
  const input = value as Record<string, unknown>;
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(input)) {
    if (key === 'path_hash' && typeof input.path === 'string' && mapped(input.path, mappings) !== input.path) continue;
    const canonicalKey = item && typeof item === 'object' && (item as Record<string, unknown>).recording_id === key;
    const nextKey = canonicalKey ? key : mappedKey(key, mappings);
    if (Object.prototype.hasOwnProperty.call(result, nextKey)) throw new Error(`Relocation key collision: ${nextKey}`);
    // Provider IDs and canonical recording identity survive local path changes.
    const pathField = ['path', 'track_path', 'cover_url', 'source_key'].includes(key) || (key === 'id' && input.provider === 'local');
    result[nextKey] = key === 'recording_id' || (typeof item === 'string' && !pathField)
      ? item : remapLibraryReferences(item, mappings);
  }
  return result;
}
const persistentKeys = [
  'aideo_queue', 'aideo_current_track', 'aideo_play_history', 'aideo_play_counts',
  'aideo_scan_dirs', 'aideo_unliked_tombstones', 'aideo_library_source_choices',
  'aideo_recording_source_preferences', 'aideo_album_session',
];
export async function replayPendingLibraryRelocations(): Promise<LibraryRemap[]> {
  const pending = await invoke<LibraryRemap[]>('pending_library_relocations');
  for (const remap of pending ?? []) {
    if (!Number.isSafeInteger(remap.id) || remap.id <= 0 || !Array.isArray(remap.mappings) || !Array.isArray(remap.roots)
      || [remap.added_roots, remap.removed_roots].some(roots => roots !== undefined && (!Array.isArray(roots) || roots.some(p => typeof p !== 'string')))
      || [...remap.mappings, ...remap.roots].some(m => !m || typeof m.old_path !== 'string' || typeof m.new_path !== 'string')) throw new Error('Invalid relocation journal');
    const writes = persistentKeys.flatMap(key => {
      const raw = localStorage.getItem(key);
      if (raw === null && key !== 'aideo_scan_dirs') return [];
      const mappings = key === 'aideo_scan_dirs' ? remap.roots : remap.mappings;
      let value = remapLibraryReferences(JSON.parse(raw ?? '[]'), mappings);
      if (key === 'aideo_scan_dirs') {
        if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error('Invalid saved library roots');
        value = [...new Set([...value.filter(v => !remap.removed_roots?.some(p => pathKey(p) === pathKey(v))), ...remap.roots.map(m => m.new_path), ...(remap.added_roots ?? [])])];
      }
      return [[key, JSON.stringify(value)]];
    });
    for (const [key, value] of writes) localStorage.setItem(key, value);
    // ponytail: resolved URLs are disposable; rebuild them after relocation rather than persist stale paths.
    localStorage.removeItem('aideo_resolved_paths');
    await invoke('ack_library_relocation', { id: remap.id });
  }
  return pending ?? [];
}
