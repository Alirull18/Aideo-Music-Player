import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createLibrarySlice } from '../store/librarySlice';

const track = (path: string, extra = {}) => ({ id: 0, path, title: path, artist: 'A', album: 'B', format: 'FLAC', duration: 100, lyric_offset: 0, ...extra });
const library = [track('C:/music/1.flac'), track('C:/music/2.flac'), track('C:/music/3.flac')];
const playlist = [{ ...track('C:/music/3.flac'), playlist_entry_id: 11 }, { ...track('C:/music/1.flac'), playlist_entry_id: 12 }];

function fixture(extra: any = {}) {
  let state: any;
  const set = (update: any) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
  state = {
    ...createLibrarySlice(set as any, (() => state) as any, {} as any),
    playlists: [{ id: 5, name: 'Road trip' }],
    currentTrack: null, queue: [], coverArt: null,
    fetchSmartPlaylists: vi.fn(async () => {}),
    ...extra,
  };
  return () => state;
}

function mockBackend(dbDirs: string[]) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'get_library': return library;
      case 'get_unified_favorites': return [];
      case 'get_playlist_tracks': return playlist;
      case 'get_library_directories': return dbDirs;
      default: return null;
    }
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});

describe('library refresh with an open playlist', () => {
  it('keeps the playlist as the play context instead of replacing it with the whole library', async () => {
    mockBackend([]);
    const get = fixture();
    await get().loadPlaylistTracks(5);
    await get().loadLibrary();

    expect(get().currentPlaylist?.id).toBe(5);
    expect(get().tracks.map((t: any) => t.playlist_entry_id)).toEqual([11, 12]);
  });

  it('loads the whole library when no playlist is open', async () => {
    mockBackend([]);
    const get = fixture();
    await get().loadLibrary();
    expect(get().tracks.map((t: any) => t.path)).toEqual(library.map(t => t.path));
  });

  it('updates queued track tags without replacing an unchanged queue', async () => {
    mockBackend([]);
    const queue = [track('C:/music/2.flac')];
    const get = fixture({ queue });
    await get().loadLibrary();
    expect(get().queue).toBe(queue);
  });
});

describe('library folder source of truth', () => {
  it('adopts the database folders when the WebView cache is empty', async () => {
    mockBackend(['D:/Music']);
    const get = fixture({ scanDirs: [] });
    await get().loadLibrary();

    expect(get().scanDirs).toEqual(['D:/Music']);
    expect(JSON.parse(localStorage.getItem('aideo_scan_dirs') || '[]')).toEqual(['D:/Music']);
    expect(invoke).toHaveBeenCalledWith('sync_watch_folders', { dirs: ['D:/Music'] });
    expect(invoke).not.toHaveBeenCalledWith('sync_watch_folders', { dirs: [] });
  });

  it('seeds an empty database from legacy cached folders', async () => {
    mockBackend([]);
    const get = fixture({ scanDirs: ['C:/Legacy'] });
    await get().loadLibrary();
    expect(invoke).toHaveBeenCalledWith('sync_watch_folders', { dirs: ['C:/Legacy'] });
  });
});
