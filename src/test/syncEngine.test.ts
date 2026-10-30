import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncToCloud, syncFromCloud, isAddonSourcePath } from '../utils/syncEngine';
import { useStore } from '../store';
import * as supabaseClientModule from '../utils/supabaseClient';
import { invoke } from '@tauri-apps/api/core';

describe('syncEngine non-destructive sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncToCloud should upsert liked tracks without deleting missing tracks', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'liked_tracks') {
          return {
            upsert: upsertMock,
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null })
              })
            }),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          };
        }
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          select: vi.fn().mockResolvedValue({ data: [], error: null })
        };
      })
    };

    vi.spyOn(supabaseClientModule, 'getSupabaseClient').mockReturnValue(mockSupabase as any);

    useStore.setState({
      user: { id: 'test-user-123' } as any,
      tracks: [
        { id: 1, path: 'C:\\Music\\Track1.mp3', title: 'Track 1', artist: 'Artist 1', loved: 1, format: 'MP3' } as any,
        { id: 2, path: 'C:\\Music\\Track2.mp3', title: 'Track 2', artist: 'Artist 2', loved: 0, format: 'MP3' } as any
      ]
    });

    await syncToCloud(useStore.getState, useStore.setState);

    expect(upsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: 'test-user-123',
          track_path: 'C:\\Music\\Track1.mp3',
          title: 'Track 1'
        })
      ]),
      { onConflict: 'user_id,track_path' }
    );
  });

  it('syncToCloud restores the cloud playlist and reports failure when the replacement insert fails', async () => {
    const oldRows = [{ playlist_id: 9, track_path: 'old.mp3', position: 0, title: 'Old', artist: 'A' }];
    const inserts: any[][] = [];
    const insertMock = vi.fn(async (rows: any[]) => {
      inserts.push(rows);
      return inserts.length === 1 ? { error: { message: 'boom' } } : { error: null };
    });
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'playlists') {
          return { upsert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 9 }], error: null }) }) };
        }
        if (table === 'playlist_tracks') {
          return {
            select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: oldRows, error: null }) }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
            insert: insertMock,
          };
        }
        return { upsert: vi.fn().mockResolvedValue({ error: null }), insert: vi.fn().mockResolvedValue({ error: null }) };
      }),
    };
    vi.spyOn(supabaseClientModule, 'getSupabaseClient').mockReturnValue(mockSupabase as any);
    (invoke as any).mockImplementation(async (cmd: string) =>
      cmd === 'get_playlist_tracks' ? [{ path: 'new.mp3', title: 'New', artist: 'B' }] : []);
    const setPlaybackError = vi.fn();
    const setPlaybackSuccess = vi.fn();
    useStore.setState({
      user: { id: 'u1' } as any,
      tracks: [],
      playlists: [{ id: 1, name: 'Mix' } as any],
      setPlaybackError,
      setPlaybackSuccess,
    } as any);

    await syncToCloud(useStore.getState, useStore.setState);

    expect(inserts[1]).toEqual(oldRows);
    expect(setPlaybackError).toHaveBeenCalledWith(expect.stringContaining('playlist'));
    expect(setPlaybackSuccess).not.toHaveBeenCalled();
  });

  it('recognises addon source ids but not local or URL paths', () => {
    expect(isAddonSourcePath('com.example.addon:track-1')).toBe(true);
    expect(isAddonSourcePath('C:\\Music\\a.flac')).toBe(false);
    expect(isAddonSourcePath('c:/music/a.flac')).toBe(false);
    expect(isAddonSourcePath('https://cdn.example/a.mp3')).toBe(false);
    expect(isAddonSourcePath('/home/u/music.mp3')).toBe(false);
    expect(isAddonSourcePath(undefined)).toBe(false);
  });

  it('syncToCloud does not push addon tracks (cloud table cannot store their source context)', async () => {
    const inserts: any[][] = [];
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'playlists') {
          return { upsert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 9 }], error: null }) }) };
        }
        if (table === 'playlist_tracks') {
          return {
            select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
            insert: vi.fn(async (rows: any[]) => { inserts.push(rows); return { error: null }; }),
          };
        }
        return { upsert: vi.fn().mockResolvedValue({ error: null }), insert: vi.fn().mockResolvedValue({ error: null }) };
      }),
    };
    vi.spyOn(supabaseClientModule, 'getSupabaseClient').mockReturnValue(mockSupabase as any);
    (invoke as any).mockImplementation(async (cmd: string) => cmd === 'get_playlist_tracks' ? [
      { path: 'C:\\Music\\local.flac', title: 'Local', artist: 'A' },
      { path: 'com.x.y:42', title: 'Addon', artist: 'B', source_context: { recording_id: 'r', sources: [] } },
    ] : []);
    useStore.setState({ user: { id: 'u1' } as any, tracks: [], playlists: [{ id: 1, name: 'Mix' } as any] } as any);

    await syncToCloud(useStore.getState, useStore.setState);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].map(r => r.track_path)).toEqual(['C:\\Music\\local.flac']);
  });

  it('syncFromCloud should restore cloud liked tracks without unloving local tracks', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'liked_tracks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                {
                  user_id: 'test-user-123',
                  track_path: 'C:\\Music\\CloudLiked.mp3',
                  title: 'Cloud Track',
                  artist: 'Cloud Artist',
                  album: 'Cloud Album',
                  duration: 180,
                  format: 'MP3',
                  cover_url: ''
                }
              ],
              error: null
            })
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
        };
      })
    };

    vi.spyOn(supabaseClientModule, 'getSupabaseClient').mockReturnValue(mockSupabase as any);

    useStore.setState({
      user: { id: 'test-user-123' } as any,
      tracks: [
        { id: 1, path: 'C:\\Music\\LocalOfflineLiked.mp3', title: 'Local Offline Track', artist: 'Local Artist', loved: 1, format: 'MP3' } as any
      ]
    });

    await syncFromCloud(useStore.getState, useStore.setState, { likedTracks: true, playlists: false, settings: false, playCounts: false });

    // Should invoke toggle_love_track with loved: true for CloudLiked.mp3
    expect(invoke).toHaveBeenCalledWith(
      'toggle_love_track',
      expect.objectContaining({
        path: 'C:\\Music\\CloudLiked.mp3',
        loved: true
      })
    );

    // Should NOT have called toggle_love_track with loved: false for LocalOfflineLiked.mp3
    expect(invoke).not.toHaveBeenCalledWith(
      'toggle_love_track',
      expect.objectContaining({
        path: 'C:\\Music\\LocalOfflineLiked.mp3',
        loved: false
      })
    );
  });
});
