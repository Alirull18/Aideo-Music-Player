import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/types';

describe('Adversarial Stress Test: AI Smart Mix Generator (generateSmartMix)', () => {
  const mockTracks: Track[] = [
    { id: 1, path: 'C:/music/rock_1.mp3', title: 'Hard Rock Energy', artist: 'Band Rock', album: 'Album 1', duration: 200, format: 'MP3', lyric_offset: 0 },
    { id: 2, path: 'C:/music/chill_1.mp3', title: 'Relaxing Lo-Fi Calm', artist: 'Lofi Girl', album: 'Chill Beats', duration: 180, format: 'MP3', lyric_offset: 0 },
    { id: 3, path: 'C:/music/focus_1.flac', title: 'Deep Focus Coding Instrumental', artist: 'Synth C', album: 'Focus Lab', duration: 220, format: 'FLAC', lyric_offset: 0 },
    { id: 4, path: 'C:/music/happy_1.mp3', title: 'Summer Sun Joy Smile', artist: 'Pop Star', album: 'Happy Days', duration: 190, format: 'MP3', lyric_offset: 0 },
    { id: 5, path: 'C:/music/sad_1.mp3', title: 'Tears In Autumn Rain', artist: 'Melancholy Poet', album: 'Sadness', duration: 240, format: 'MP3', lyric_offset: 0 },
    { id: 6, path: 'C:/music/generic_1.mp3', title: 'Abstract Track 1', artist: 'Unknown', album: 'Unknown', duration: 150, format: 'MP3', lyric_offset: 0 },
    { id: 7, path: 'C:/music/generic_2.mp3', title: 'Abstract Track 2', artist: 'Unknown', album: 'Unknown', duration: 160, format: 'MP3', lyric_offset: 0 },
  ];

  let playlistDb: { id: number; name: string }[] = [];
  let playlistTracksDb: { playlistId: number; path: string }[] = [];
  let nextPlaylistId = 100;

  beforeEach(() => {
    vi.clearAllMocks();
    playlistDb = [];
    playlistTracksDb = [];
    nextPlaylistId = 100;

    (invoke as any).mockImplementation((cmd: string, args?: any) => {
      if (cmd === 'get_playlists') {
        return Promise.resolve([...playlistDb]);
      }
      if (cmd === 'create_playlist') {
        const id = nextPlaylistId++;
        // Emulate SQLite UNIQUE constraint on playlists.name
        if (playlistDb.some(p => p.name === args.name)) {
          return Promise.reject(new Error(`UNIQUE constraint failed: playlists.name for "${args.name}"`));
        }
        playlistDb.push({ id, name: args.name });
        return Promise.resolve(id);
      }
      if (cmd === 'delete_playlist') {
        playlistDb = playlistDb.filter(p => p.id !== args.id);
        playlistTracksDb = playlistTracksDb.filter(pt => pt.playlistId !== args.id);
        return Promise.resolve(null);
      }
      if (cmd === 'add_to_playlist') {
        playlistTracksDb.push({ playlistId: args.playlistId, path: args.path });
        return Promise.resolve(null);
      }
      if (cmd === 'clear_queue' || cmd === 'add_to_queue_bulk' || cmd === 'play_track' || cmd === 'get_smart_playlists') {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    useStore.setState({
      tracks: [...mockTracks],
      playlists: [],
      queue: [],
      currentTrack: null,
      view: 'library',
      playCounts: { 'C:/music/rock_1.mp3': 50, 'C:/music/chill_1.mp3': 10 },
      lastfmTopArtists: [{ name: 'Band Rock' }],
      listenbrainzRecent: [{ track_metadata: { artist_name: 'Synth C' } }],
    });
  });

  it('Scenario 1: Repeated calls with the exact same mood succeeds without SQLite UNIQUE collision', async () => {
    const { generateSmartMix } = useStore.getState();

    // 1st generation
    await generateSmartMix('energetic', 'history');
    expect(playlistDb).toHaveLength(1);
    expect(playlistDb[0].name).toBe('AI Smart Mix - energetic');
    const firstId = playlistDb[0].id;
    expect(playlistTracksDb.filter(pt => pt.playlistId === firstId).length).toBeGreaterThan(0);

    // 2nd generation (same mood)
    await generateSmartMix('energetic', 'history');
    expect(playlistDb).toHaveLength(1);
    expect(playlistDb[0].name).toBe('AI Smart Mix - energetic');
    const secondId = playlistDb[0].id;
    expect(secondId).not.toBe(firstId); // Recreated with new ID
    expect(playlistTracksDb.filter(pt => pt.playlistId === secondId).length).toBeGreaterThan(0);

    // 3rd generation (same mood)
    await generateSmartMix('energetic', 'history');
    expect(playlistDb).toHaveLength(1);
    expect(playlistDb[0].name).toBe('AI Smart Mix - energetic');
    const thirdId = playlistDb[0].id;
    expect(thirdId).not.toBe(secondId);
    expect(playlistTracksDb.filter(pt => pt.playlistId === thirdId).length).toBeGreaterThan(0);
  });

  it('Scenario 2: Interleaved generation of different moods preserves unrelated playlists', async () => {
    const { generateSmartMix } = useStore.getState();

    // Create a user playlist first
    playlistDb.push({ id: 1, name: 'My Favorites' });

    // Generate Energetic
    await generateSmartMix('energetic', 'history');
    expect(playlistDb.map(p => p.name)).toEqual(['My Favorites', 'AI Smart Mix - energetic']);

    // Generate Chill
    await generateSmartMix('chill', 'history');
    expect(playlistDb.map(p => p.name)).toEqual(['My Favorites', 'AI Smart Mix - energetic', 'AI Smart Mix - chill']);

    // Regenerate Energetic
    await generateSmartMix('energetic', 'history');
    expect(playlistDb.map(p => p.name)).toEqual(['My Favorites', 'AI Smart Mix - chill', 'AI Smart Mix - energetic']);
  });

  it('Scenario 3: Fallback behavior when fewer than 5 tracks match mood keywords', async () => {
    // Only 1 sad track exists in mockTracks
    const { generateSmartMix } = useStore.getState();
    await generateSmartMix('melancholic', 'history');

    expect(playlistDb.some(p => p.name === 'AI Smart Mix - melancholic')).toBe(true);
    const melancholicPl = playlistDb.find(p => p.name === 'AI Smart Mix - melancholic')!;
    const tracksInMix = playlistTracksDb.filter(pt => pt.playlistId === melancholicPl.id);
    // Because fallback triggers (moodTracks < 5 -> moodTracks = [...tracks]), all 7 tracks are included
    expect(tracksInMix.length).toBe(7);
  });

  it('Scenario 4: Re-ranking works with Last.fm and ListenBrainz trend sources', async () => {
    const { generateSmartMix } = useStore.getState();

    // Last.fm trend source
    await generateSmartMix('focus', 'last.fm');
    expect(playlistDb.some(p => p.name === 'AI Smart Mix - focus')).toBe(true);

    // ListenBrainz trend source
    await generateSmartMix('focus', 'listenbrainz');
    expect(playlistDb.some(p => p.name === 'AI Smart Mix - focus')).toBe(true);
  });
});
