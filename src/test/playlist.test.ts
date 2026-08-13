import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/types';

describe('Playlist Custom Ordering & Reordering (Issue #30)', () => {
  const mockTracks: Track[] = [
    { id: 1, path: 'C:/music/track1.mp3', title: 'Track 1', artist: 'Artist A', duration: 180, format: 'MP3', lyric_offset: 0 },
    { id: 2, path: 'C:/music/track2.mp3', title: 'Track 2', artist: 'Artist B', duration: 200, format: 'MP3', lyric_offset: 0 },
    { id: 3, path: 'C:/music/track3.mp3', title: 'Track 3', artist: 'Artist C', duration: 220, format: 'MP3', lyric_offset: 0 },
    { id: 4, path: 'C:/music/track4.mp3', title: 'Track 4', artist: 'Artist D', duration: 240, format: 'MP3', lyric_offset: 0 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      tracks: [...mockTracks],
      playlists: [{ id: 42, name: 'My Custom Playlist' }],
      currentPlaylist: { id: 42, name: 'My Custom Playlist' },
    });
  });

  it('reorders playlist tracks and invokes backend reorder_playlist', async () => {
    const { reorderPlaylistTracks } = useStore.getState();

    // Move Track 1 (idx 0) to position 2 (after Track 3)
    await reorderPlaylistTracks(42, 0, 2);

    const updatedTracks = useStore.getState().tracks;
    expect(updatedTracks.map((t) => t.title)).toEqual([
      'Track 2',
      'Track 3',
      'Track 1',
      'Track 4',
    ]);

    expect(invoke).toHaveBeenCalledWith('reorder_playlist', {
      playlistId: 42,
      trackPaths: [
        'C:/music/track2.mp3',
        'C:/music/track3.mp3',
        'C:/music/track1.mp3',
        'C:/music/track4.mp3',
      ],
    });
  });

  it('reorders playlist track from end to beginning', async () => {
    const { reorderPlaylistTracks } = useStore.getState();

    // Move Track 4 (idx 3) to beginning (idx 0)
    await reorderPlaylistTracks(42, 3, 0);

    const updatedTracks = useStore.getState().tracks;
    expect(updatedTracks.map((t) => t.title)).toEqual([
      'Track 4',
      'Track 1',
      'Track 2',
      'Track 3',
    ]);
  });

  it('safely ignores out of bound reorder indices', async () => {
    const { reorderPlaylistTracks } = useStore.getState();

    await reorderPlaylistTracks(42, -1, 2);
    expect(useStore.getState().tracks.map((t) => t.title)).toEqual([
      'Track 1',
      'Track 2',
      'Track 3',
      'Track 4',
    ]);

    await reorderPlaylistTracks(42, 0, 999);
    expect(useStore.getState().tracks.map((t) => t.title)).toEqual([
      'Track 1',
      'Track 2',
      'Track 3',
      'Track 4',
    ]);

    await reorderPlaylistTracks(42, 1, 1);
    expect(useStore.getState().tracks.map((t) => t.title)).toEqual([
      'Track 1',
      'Track 2',
      'Track 3',
      'Track 4',
    ]);
  });
});
