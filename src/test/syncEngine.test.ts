import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncToCloud, syncFromCloud } from '../utils/syncEngine';
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

    await syncToCloud();

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

    await syncFromCloud({ likedTracks: true, playlists: false, settings: false, playCounts: false });

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
