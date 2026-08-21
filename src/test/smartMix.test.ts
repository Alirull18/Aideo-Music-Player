import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/types';

describe('AI Smart Mix Generator Duplicate Handling & Synchronization', () => {
  const mockTracks: Track[] = [
    { id: 1, path: 'C:/music/rock_anthem.mp3', title: 'Rock Anthem', artist: 'Band A', album: 'Album A', duration: 200, format: 'MP3', lyric_offset: 0 },
    { id: 2, path: 'C:/music/chill_vibes.mp3', title: 'Chill Vibes', artist: 'Band B', album: 'Album B', duration: 180, format: 'MP3', lyric_offset: 0 },
    { id: 3, path: 'C:/music/energy_boost.flac', title: 'Energy Boost', artist: 'Band C', album: 'Album C', duration: 220, format: 'FLAC', lyric_offset: 0 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      tracks: [...mockTracks],
      playlists: [],
      queue: [],
      currentTrack: null,
      view: 'library',
      playCounts: {},
      lastfmTopArtists: [],
      listenbrainzRecent: [],
    });
  });

  it('deletes existing playlist with identical mood name before creating new one', async () => {
    const existingPlaylistId = 77;
    const mood = 'energetic';
    const playlistName = `AI Smart Mix - ${mood}`;

    let storedPlaylists = [{ id: existingPlaylistId, name: playlistName }];

    // Mock invoke behavior
    (invoke as any).mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'get_playlists') {
        return Promise.resolve(storedPlaylists);
      }
      if (cmd === 'delete_playlist') {
        storedPlaylists = storedPlaylists.filter((p) => p.id !== args.id);
        return Promise.resolve(null);
      }
      if (cmd === 'create_playlist') {
        const newId = 88;
        storedPlaylists = [...storedPlaylists, { id: newId, name: args.name }];
        return Promise.resolve(newId);
      }
      return Promise.resolve(null);
    });

    const { generateSmartMix } = useStore.getState();
    await generateSmartMix(mood, 'history');

    // 1. Verify delete_playlist was called for the existing playlist ID before creating
    expect(invoke).toHaveBeenCalledWith('delete_playlist', { id: existingPlaylistId });

    // 2. Verify create_playlist was called with the target playlist name
    expect(invoke).toHaveBeenCalledWith('create_playlist', { name: playlistName });

    // 3. Verify add_to_playlist was called with the recreated playlist ID (88)
    expect(invoke).toHaveBeenCalledWith('add_to_playlist', expect.objectContaining({
      playlistId: 88,
    }));

    // 4. Verify view is switched to nowplaying
    expect(useStore.getState().view).toBe('nowplaying');
  });

  it('creates and populates new playlist cleanly when no prior playlist exists', async () => {
    const mood = 'chill';
    const playlistName = `AI Smart Mix - ${mood}`;
    let storedPlaylists: { id: number; name: string }[] = [];

    (invoke as any).mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'get_playlists') {
        return Promise.resolve(storedPlaylists);
      }
      if (cmd === 'create_playlist') {
        const newId = 99;
        storedPlaylists = [{ id: newId, name: args.name }];
        return Promise.resolve(newId);
      }
      return Promise.resolve(null);
    });

    const { generateSmartMix } = useStore.getState();
    await generateSmartMix(mood, 'history');

    // 1. Verify delete_playlist was NOT called
    expect(invoke).not.toHaveBeenCalledWith('delete_playlist', expect.anything());

    // 2. Verify create_playlist was called
    expect(invoke).toHaveBeenCalledWith('create_playlist', { name: playlistName });

    // 3. Verify add_to_playlist was called with new playlist ID
    expect(invoke).toHaveBeenCalledWith('add_to_playlist', expect.objectContaining({
      playlistId: 99,
    }));
  });

  it('handles empty library safely with toast notification', async () => {
    useStore.setState({ tracks: [] });
    const toastSpy = vi.fn();
    window.addEventListener('ui-toast', toastSpy);

    const { generateSmartMix } = useStore.getState();
    await generateSmartMix('focus', 'history');

    expect(invoke).not.toHaveBeenCalledWith('create_playlist', expect.anything());
    expect(toastSpy).toHaveBeenCalled();
    window.removeEventListener('ui-toast', toastSpy);
  });
});
