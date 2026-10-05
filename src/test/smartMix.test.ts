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
      appMode: 'local',
      recommendationEngine: 'our',
      autoplayEnabled: false,
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

  it('saves an existing generated playlist atomically and retains its ID', async () => {
    const playlistName = 'AI Smart Mix - energetic';
    const storedPlaylists = [{ id: 77, name: playlistName }];
    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_recommendations') return { tracks: mockTracks, generation: args.request.generation, reasons: {} };
      if (cmd === 'save_generated_playlist') return 77;
      if (cmd === 'get_playlists') return storedPlaylists;
      return null;
    });
    await useStore.getState().generateSmartMix('energetic', 'history');
    expect(invoke).toHaveBeenCalledWith('save_generated_playlist', { name: playlistName, paths: mockTracks.map(t => t.path) });
    expect(invoke).not.toHaveBeenCalledWith('delete_playlist', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('create_playlist', expect.anything());
    expect(useStore.getState().playlists).toEqual(storedPlaylists);
    expect(useStore.getState().view).toBe('nowplaying');
  });

  it('saves a new generated playlist in one backend call', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_recommendations') return { tracks: mockTracks, generation: args.request.generation, reasons: {} };
      if (cmd === 'save_generated_playlist') return 99;
      if (cmd === 'get_playlists') return [{ id: 99, name: 'AI Smart Mix - chill' }];
      return null;
    });
    await useStore.getState().generateSmartMix('chill', 'history');
    expect(invoke).toHaveBeenCalledWith('save_generated_playlist', { name: 'AI Smart Mix - chill', paths: mockTracks.map(t => t.path) });
    expect(invoke).not.toHaveBeenCalledWith('add_to_playlist', expect.anything());
  });

  it('preserves the old playlist, queue and playback when atomic saving fails', async () => {
    const playlists = [{ id: 77, name: 'AI Smart Mix - energetic' }];
    const queue = [mockTracks[1]];
    const currentTrack = mockTracks[2];
    useStore.setState({ playlists, queue, currentTrack });
    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_recommendations') return { tracks: mockTracks, generation: args.request.generation, reasons: {} };
      if (cmd === 'save_generated_playlist') throw new Error('Database write failed');
      return null;
    });
    await useStore.getState().generateSmartMix('energetic', 'history');
    expect(useStore.getState().playlists).toEqual(playlists);
    expect(useStore.getState().queue).toEqual(queue);
    expect(useStore.getState().currentTrack).toEqual(currentTrack);
    expect(invoke).not.toHaveBeenCalledWith('clear_queue');
    expect(invoke).not.toHaveBeenCalledWith('play_track', expect.anything());
    expect(invoke).not.toHaveBeenCalledWith('delete_playlist', expect.anything());
  });

  it('handles empty library safely with toast notification', async () => {
    useStore.setState({ tracks: [] });
    const toastSpy = vi.fn();
    window.addEventListener('ui-toast', toastSpy);

    const { generateSmartMix } = useStore.getState();
    await generateSmartMix('focus', 'history');

    expect(invoke).not.toHaveBeenCalledWith('save_generated_playlist', expect.anything());
    expect(toastSpy).toHaveBeenCalled();
    window.removeEventListener('ui-toast', toastSpy);
  });
});
