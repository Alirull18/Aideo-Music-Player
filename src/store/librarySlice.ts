import { StateCreator } from 'zustand';
import { PlayerState, Track } from './types';
import { invoke } from '@tauri-apps/api/core';
import { extractDominantColor } from './types';

export const createLibrarySlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  tracks: [],
  currentTrackIndex: -1,
  shuffle: false,
  playHistory: JSON.parse(localStorage.getItem('aideo_play_history') || '[]'),
  playCounts: JSON.parse(localStorage.getItem('aideo_play_counts') || '{}'),
  scanDirs: JSON.parse(localStorage.getItem('aideo_scan_dirs') || '[]'),
  scanStatus: '',
  playlists: [],
  currentPlaylist: null,

  addScanDir: (dir: string) => {
    const newDirs = Array.from(new Set([...get().scanDirs, dir]));
    localStorage.setItem('aideo_scan_dirs', JSON.stringify(newDirs));
    set({ scanDirs: newDirs });
  },

  removeScanDir: (dir: string) => {
    const newDirs = get().scanDirs.filter(d => d !== dir);
    localStorage.setItem('aideo_scan_dirs', JSON.stringify(newDirs));
    set({ scanDirs: newDirs });
  },

  scanLibrary: async () => {
    const dirs = get().scanDirs;
    if (dirs.length === 0) { set({ scanStatus: 'Add a folder first' }); return; }
    set({ scanStatus: 'Scanning...' });
    try {
      const count: number = await invoke('scan_and_save', { dirs });
      await get().loadLibrary();
      set({ scanStatus: `Found ${count} tracks` });
    } catch (e: any) { set({ scanStatus: 'Scan failed: ' + e }); }
  },

  loadLibrary: async () => {
    try {
      const tracks: Track[] = await invoke('get_library');
      set({ tracks });
    } catch (e) { console.error('loadLibrary:', e); }
  },

  playTrack: async (track: Track, isHistory?: boolean) => {
    if (!track) return;
    try {
      const index = get().tracks.findIndex(t => t.path === track.path);
      const prevTrack = get().playback.current_track;
      const history = prevTrack && !isHistory ? [...get().playHistory, prevTrack].slice(-50) : get().playHistory;
      localStorage.setItem('aideo_play_history', JSON.stringify(history));

      const counts = { ...get().playCounts };
      counts[track.path] = (counts[track.path] || 0) + 1;
      localStorage.setItem('aideo_play_counts', JSON.stringify(counts));

      set({
        currentTrackIndex: index,
        playHistory: history,
        playCounts: counts,
        lyricOffset: track.lyric_offset || 0,
        lyrics: [],
        lyricStatus: 'loading',
        coverArt: null,
        accentColor: '#8b5cf6',
        scrobbledCurrent: false,
        playback: { ...get().playback, current_track: track.path, status: 'Playing', position_secs: 0, last_skip_time: Date.now() },
      });

      await invoke('play_track', { path: track.path });

      invoke('update_media_metadata', {
        title: track.title || track.path.split(/[\\/]/).pop(),
        artist: track.artist || 'Unknown Artist',
        coverUrl: null,
        duration: track.duration || 0,
      }).catch(() => { });

      invoke('get_cover_art', { path: track.path }).then(async (art: any) => {
        if (get().playback.current_track !== track.path) return;
        if (art && typeof art === 'string') {
          set({ coverArt: art });
          try {
            const color = await extractDominantColor(art);
            set({ accentColor: color });
          } catch (_) { }
          invoke('update_media_metadata', {
            title: track.title || track.path.split(/[\\/]/).pop(),
            artist: track.artist || 'Unknown Artist',
            coverUrl: art,
            duration: track.duration || 0,
          }).catch(() => { });
        } else {
          set({ coverArt: null, accentColor: '#8b5cf6' });
        }
      }).catch(() => {
        if (get().playback.current_track === track.path) {
          set({ coverArt: null, accentColor: '#8b5cf6' });
        }
      });

      invoke('get_lyrics', { path: track.path }).then((lrc: any) => {
        if (get().playback.current_track !== track.path) return;
        if (Array.isArray(lrc) && lrc.length > 0) {
          set({ lyrics: lrc, lyricStatus: 'found' });
        } else {
          set({ lyrics: [], lyricStatus: 'not_found' });
        }
      }).catch(() => {
        if (get().playback.current_track === track.path) set({ lyricStatus: 'not_found' });
      });

    } catch (e) {
      console.error('playTrack error:', e);
    }

    const state = get();
    // Only auto-queue from library if the user's manual queue is empty
    if (state.queue.length === 0 && state.tracks.length > 0 && state.currentTrackIndex >= 0) {
      let nextIndex = state.shuffle
        ? Math.floor(Math.random() * state.tracks.length)
        : (state.currentTrackIndex + 1) % state.tracks.length;
      try { await invoke('add_to_queue', { path: state.tracks[nextIndex].path }); } catch (e) { }
    }
    get().updateDiscordPresence();
  },

  handleTrackTransition: async (path: string) => {
    const state = get();
    const index = state.tracks.findIndex(t => t.path === path);
    const track = index !== -1 ? state.tracks[index] : null;

    const prevTrackStr = state.playback.current_track;
    const history = prevTrackStr ? [...state.playHistory, prevTrackStr].slice(-50) : state.playHistory;
    localStorage.setItem('aideo_play_history', JSON.stringify(history));

    const counts = { ...state.playCounts };
    counts[path] = (counts[path] || 0) + 1;
    localStorage.setItem('aideo_play_counts', JSON.stringify(counts));

    set({
      currentTrackIndex: index,
      playHistory: history,
      playCounts: counts,
      lyricOffset: track?.lyric_offset || 0,
      lyrics: [],
      lyricStatus: 'loading',
      coverArt: null,
      accentColor: '#8b5cf6',
      scrobbledCurrent: false,
      playback: { ...state.playback, current_track: path, status: 'Playing', position_secs: 0, last_skip_time: Date.now() },
    });
    get().updateDiscordPresence();

    invoke('update_media_metadata', {
      title: track?.title || path.split(/[\\/]/).pop(),
      artist: track?.artist || 'Unknown Artist',
      coverUrl: null,
      duration: track?.duration || 0,
    }).catch(() => { });

    invoke('get_cover_art', { path }).then(async (art: any) => {
      if (get().playback.current_track !== path) return;
      if (art && typeof art === 'string') {
        set({ coverArt: art });
        try {
          const color = await extractDominantColor(art);
          set({ accentColor: color });
        } catch (_) { }
        invoke('update_media_metadata', {
          title: track?.title || path.split(/[\\/]/).pop(),
          artist: track?.artist || 'Unknown Artist',
          coverUrl: art,
          duration: track?.duration || 0,
        }).catch(() => { });
      } else {
        set({ coverArt: null, accentColor: '#8b5cf6' });
      }
    }).catch(() => {
      if (get().playback.current_track === path) {
        set({ coverArt: null, accentColor: '#8b5cf6' });
      }
    });

    invoke('get_lyrics', { path }).then((lrc: any) => {
      if (get().playback.current_track !== path) return;
      if (Array.isArray(lrc) && lrc.length > 0) {
        set({ lyrics: lrc, lyricStatus: 'found' });
      } else {
        set({ lyrics: [], lyricStatus: 'not_found' });
      }
    }).catch(() => {
      if (get().playback.current_track === path) set({ lyricStatus: 'not_found' });
    });

    const newState = get();
    await newState.fetchQueue();
    if (newState.queue.length === 0) {
      let nextIndex = newState.shuffle
        ? Math.floor(Math.random() * newState.tracks.length)
        : (newState.currentTrackIndex + 1) % newState.tracks.length;
      try { await invoke('add_to_queue', { path: newState.tracks[nextIndex].path }); } catch (e) { }
    }
  },

  playNext: async () => {
    const { tracks, currentTrackIndex, shuffle, queue, playFromQueue, playTrack } = get();
    
    // Manual queue priority
    if (queue.length > 0) {
       await playFromQueue(0);
       return;
    }

    if (tracks.length === 0) return;
    let nextIndex = shuffle
      ? Math.floor(Math.random() * tracks.length)
      : (currentTrackIndex + 1) % tracks.length;
    await playTrack(tracks[nextIndex]);
  },

  playPrev: async () => {
    const { tracks, currentTrackIndex, playHistory } = get();
    if (tracks.length === 0) return;
    
    // If we have history, pop the last track and play it
    if (playHistory.length > 0) {
      const newHistory = [...playHistory];
      const lastPath = newHistory.pop()!;
      const t = tracks.find(x => x.path === lastPath);
      if (t) {
        set({ playHistory: newHistory });
        await get().playTrack(t, true);
        return;
      }
    }
    
    // Fallback if no history
    const prevIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
    await get().playTrack(tracks[prevIndex]);
  },

  toggleShuffle: () => set(s => ({ shuffle: !s.shuffle })),

  fetchPlaylists: async () => {
    try {
      const playlists = await invoke<any[]>('get_playlists');
      set({ playlists });
    } catch (e) { console.error(e); }
  },

  createPlaylist: async (name: string) => {
    try {
      await invoke('create_playlist', { name });
      await get().fetchPlaylists();
    } catch (e) { console.error(e); }
  },

  deletePlaylist: async (id: number) => {
    try {
      await invoke('delete_playlist', { id });
      await get().fetchPlaylists();
      if (get().currentPlaylist?.id === id) {
        set({ currentPlaylist: null });
        await get().loadLibrary();
      }
    } catch (e) { console.error(e); }
  },

  addToPlaylist: async (playlistId: number, trackPath: string) => {
    try {
      await invoke('add_to_playlist', { playlistId, path: trackPath });
      if (get().currentPlaylist?.id === playlistId) {
        await get().loadPlaylistTracks(playlistId);
      }
    } catch (e) { console.error(e); }
  },

  removeFromPlaylist: async (playlistId: number, trackPath: string) => {
    try {
      await invoke('remove_from_playlist', { playlistId, path: trackPath });
      if (get().currentPlaylist?.id === playlistId) {
        await get().loadPlaylistTracks(playlistId);
      }
    } catch (e) { console.error(e); }
  },

  loadPlaylistTracks: async (id: number) => {
    try {
      const tracks = await invoke<Track[]>('get_playlist_tracks', { playlistId: id });
      set({ tracks, currentPlaylist: get().playlists.find(p => p.id === id) || null });
    } catch (e) { console.error(e); }
  },

  matchMetadata: async (track: Track) => {
    try {
      set({ scanStatus: `Matching ${track.title || 'track'}...` });
      
      let searchTitle = track.title || '';
      let searchArtist = track.artist || '';
      
      // Smart parsing for YouTube downloads
      if (searchArtist === 'YouTube Audio' && searchTitle.includes(' - ')) {
        const parts = searchTitle.split(' - ');
        searchArtist = parts[0].trim();
        searchTitle = parts.slice(1).join(' - ').trim();
      } else if (searchArtist === 'YouTube Audio') {
        searchArtist = '';
      }
      
      const res: any = await invoke('mbz_search_recording', { title: searchTitle, artist: searchArtist });
      const recording = res.recordings?.[0];
      if (!recording) {
        set({ scanStatus: 'No match found on MusicBrainz.' });
        return null;
      }

      const info = {
        title: recording.title,
        artist: recording['artist-credit']?.[0]?.name,
        album: recording.releases?.[0]?.title,
        release_id: recording.releases?.[0]?.id,
      };

      set({ scanStatus: `Match found: ${info.title}` });
      return info;
    } catch (e) { 
      console.error('matchMetadata error:', e); 
      set({ scanStatus: 'Match failed: ' + e });
      return null;
    }
  },

  playDynamicMix: async (mixType: 'supermix' | 'recap' | 'discovery' | 'chill') => {
    const tracks = get().tracks;
    if (tracks.length === 0) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Your library is empty. Add a music folder first.', type: 'warning' } }));
      return;
    }

    const counts = get().playCounts;
    let selectedTracks: Track[] = [];

    if (mixType === 'recap') {
      // Top played tracks descending
      selectedTracks = [...tracks]
        .filter(t => (counts[t.path] || 0) > 0)
        .sort((a, b) => (counts[b.path] || 0) - (counts[a.path] || 0))
        .slice(0, 20);
      
      // Fallback if no songs played yet, pick random
      if (selectedTracks.length === 0) {
        selectedTracks = [...tracks].sort(() => 0.5 - Math.random()).slice(0, 20);
      }
    } else if (mixType === 'supermix') {
      // Top 10 + 15 random other tracks from the library
      const topTracks = [...tracks]
        .filter(t => (counts[t.path] || 0) > 0)
        .sort((a, b) => (counts[b.path] || 0) - (counts[a.path] || 0))
        .slice(0, 10);
      
      const rest = tracks.filter(t => !topTracks.some(tt => tt.path === t.path));
      const randomRest = [...rest].sort(() => 0.5 - Math.random()).slice(0, 15);
      selectedTracks = [...topTracks, ...randomRest];
      
      if (selectedTracks.length === 0) {
        selectedTracks = [...tracks].sort(() => 0.5 - Math.random()).slice(0, 25);
      }
    } else if (mixType === 'discovery') {
      // Never or least played tracks
      const unplayed = tracks.filter(t => (counts[t.path] || 0) === 0);
      if (unplayed.length > 0) {
        selectedTracks = [...unplayed].sort(() => 0.5 - Math.random()).slice(0, 20);
      } else {
        selectedTracks = [...tracks]
          .sort((a, b) => (counts[a.path] || 0) - (counts[b.path] || 0))
          .slice(0, 20);
      }
    } else if (mixType === 'chill') {
      const hrs = new Date().getHours();
      let keywords: string[] = [];
      if (hrs >= 5 && hrs < 12) {
        keywords = ['upbeat', 'energy', 'morning', 'sunrise', 'wake', 'start', 'pop', 'dance', 'bright', 'sun', 'happy'];
      } else if (hrs >= 12 && hrs < 17) {
        keywords = ['focus', 'study', 'work', 'productive', 'beats', 'flow', 'ambient', 'instrumental', 'jazz', 'coding', 'lofi', 'lo-fi', 'classical'];
      } else {
        keywords = ['chill', 'relax', 'acoustic', 'sleep', 'night', 'dark', 'slow', 'blues', 'moon', 'dream', 'unwind', 'mood'];
      }

      let matches = tracks.filter(t => {
        const title = (t.title || '').toLowerCase();
        const artist = (t.artist || '').toLowerCase();
        return keywords.some(k => title.includes(k) || artist.includes(k));
      });
      
      if (matches.length < 5) {
        matches = tracks;
      }
      selectedTracks = [...matches].sort(() => 0.5 - Math.random()).slice(0, 20);
    }

    if (selectedTracks.length === 0) return;

    set({ queue: selectedTracks });
    localStorage.setItem('aideo_queue', JSON.stringify(selectedTracks));
    
    await get().playTrack(selectedTracks[0]);

    let mixName = 'Chill Mix';
    if (mixType === 'supermix') mixName = 'My Supermix';
    else if (mixType === 'recap') mixName = 'Aideo Recap Mix';
    else if (mixType === 'discovery') mixName = 'Discovery Mix';
    else if (mixType === 'chill') {
      const hrs = new Date().getHours();
      if (hrs >= 5 && hrs < 12) mixName = 'Sunrise Energy Mix';
      else if (hrs >= 12 && hrs < 17) mixName = 'Productive Focus Mix';
      else mixName = 'Chill & Unwind Mix';
    }
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Playing ${mixName}!`, type: 'success' } }));
  },
});
