import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Track {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  duration: number | null;
  format: string | null;
  lyric_offset: number;
}

export interface Playlist {
  id: number;
  name: string;
}

export interface LyricLine {
  time_secs: number;
  text: string;
  romaji?: string;
  translation?: string;
}

export interface DSPState {
  width: number;
  enabled: boolean;
}

interface PlayerState {
  view: 'library' | 'nowplaying';
  tracks: Track[];
  currentTrackIndex: number;
  shuffle: boolean;

  playback: {
    status: 'Playing' | 'Paused' | 'Stopped';
    current_track: string | null;
    position_secs: number;
    volume: number;
    exclusive: boolean;
  };

  lyrics: LyricLine[];
  lyricOffset: number;
  lyricStatus: 'idle' | 'loading' | 'found' | 'not_found';
  coverArt: string | null;
  accentColor: string;
  showProMode: boolean;
  showControlCenter: boolean;
  showSettings: boolean;
  dsp: DSPState;

  devices: string[];
  currentDevice: string | null;
  scanDirs: string[];
  scanStatus: string;
  isTranslating: boolean;
  showRomaji: boolean;
  isTransitioning: boolean;
  scrobbleEnabled: boolean;
  lastfmSessionKey: string | null;
  lastfmToken: string | null;
  scrobbledCurrent: boolean;
  lastScrobble: { artist: string; track: string } | null;
  scrobbleThreshold: number;

  playlists: Playlist[];
  currentPlaylist: Playlist | null;

  playbackError: string | null;
  playbackSuccess: string | null;

  customPrompt: {
    open: boolean;
    title: string;
    placeholder: string;
    initialValue?: string;
    actionLabel: string;
    onSubmit: (val: string) => void;
  };

  // actions
  setCustomPrompt: (prompt: Partial<PlayerState['customPrompt']>) => void;
  setPlaybackError: (err: string | null) => void;
  setPlaybackSuccess: (msg: string | null) => void;
  setView: (view: 'library' | 'nowplaying') => void;
  addScanDir: (dir: string) => void;
  removeScanDir: (dir: string) => void;
  setScrobbleThreshold: (val: number) => void;
  toggleSettings: () => void;
  toggleScrobble: () => void;
  setLastFmSession: (key: string | null) => void;
  setShowRomaji: (val: boolean) => void;
  scanLibrary: () => Promise<void>;
  loadLibrary: () => Promise<void>;
  playTrack: (track: Track) => Promise<void>;
  handleTrackTransition: (path: string) => Promise<void>;
  playNext: () => Promise<void>;
  playPrev: () => Promise<void>;
  toggleShuffle: () => void;
  pauseTrack: () => Promise<void>;
  resumeTrack: () => Promise<void>;
  stopTrack: () => Promise<void>;
  setVolume: (vol: number) => Promise<void>;
  seek: (secs: number) => Promise<void>;
  pollStatus: () => Promise<void>;
  toggleProMode: () => void;
  toggleControlCenter: () => void;
  resetProMode: () => void;
  setDSP: (dsp: Partial<DSPState>) => Promise<void>;
  toggleExclusive: () => Promise<void>;
  fetchDevices: () => Promise<void>;
  setAudioDevice: (name: string) => Promise<void>;
  adjustLyricOffset: (ms: number) => void;
  saveLyrics: (path: string, lrc: string) => Promise<void>;
  translateLyrics: () => Promise<void>;
  getRomaji: () => Promise<void>;
  applyOnlineCover: (path: string, url: string) => Promise<void>;

  fetchPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  addToPlaylist: (playlistId: number, trackPath: string) => Promise<void>;
  removeFromPlaylist: (playlistId: number, trackPath: string) => Promise<void>;
  loadPlaylistTracks: (playlistId: number) => Promise<void>;
}

function extractDominantColor(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 10; canvas.height = 10;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve('#8b5cf6'); return; }
      ctx.drawImage(img, 0, 0, 10, 10);
      const data = ctx.getImageData(0, 0, 10, 10).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
      }
      r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lightness = (max + min) / 510;
      if (lightness > 0.85 || lightness < 0.1) { resolve('#8b5cf6'); return; }
      resolve(`rgb(${r},${g},${b})`);
    };
    img.onerror = () => resolve('#8b5cf6');
    img.src = dataUrl;
  });
}

export const useStore = create<PlayerState>((set, get) => ({
  view: 'library',
  tracks: [],
  currentTrackIndex: -1,
  shuffle: false,
  playback: { status: 'Stopped', current_track: null, position_secs: 0, volume: 1.0, exclusive: false },
  lyrics: [],
  lyricOffset: 0,
  lyricStatus: 'idle',
  coverArt: null,
  accentColor: '#8b5cf6',
  showProMode: false,
  showControlCenter: false,
  showSettings: false,
  dsp: { width: 1.0, enabled: false },
  devices: [],
  currentDevice: null,
  scanDirs: JSON.parse(localStorage.getItem('aideo_scan_dirs') || '[]'),
  scanStatus: '',
  isTranslating: false,
  showRomaji: true,
  isTransitioning: false,
  scrobbleEnabled: localStorage.getItem('lastfm_session') ? true : false,
  lastfmSessionKey: localStorage.getItem('lastfm_session') || null,
  lastfmToken: null,
  scrobbledCurrent: false,
  lastScrobble: null as { artist: string, track: string } | null,
  scrobbleThreshold: parseInt(localStorage.getItem('lastfm_threshold') || '50'),
  playlists: [],
  currentPlaylist: null,

  playbackError: null,
  playbackSuccess: null,

  customPrompt: {
    open: false,
    title: '',
    placeholder: '',
    initialValue: '',
    actionLabel: '',
    onSubmit: () => {}
  },

  setCustomPrompt: (prompt) => set(s => ({
    customPrompt: { ...s.customPrompt, ...prompt }
  })),

  setPlaybackError: (err) => {
    set({ playbackError: err });
    if (err) setTimeout(() => get().setPlaybackError(null), 5000);
  },
  setPlaybackSuccess: (msg) => {
    set({ playbackSuccess: msg });
    if (msg) setTimeout(() => get().setPlaybackSuccess(null), 4000);
  },

  setView: (view) => set({ view }),
  addScanDir: (dir) => {
    const newDirs = Array.from(new Set([...get().scanDirs, dir]));
    localStorage.setItem('aideo_scan_dirs', JSON.stringify(newDirs));
    set({ scanDirs: newDirs });
  },
  removeScanDir: (dir) => {
    const newDirs = get().scanDirs.filter(d => d !== dir);
    localStorage.setItem('aideo_scan_dirs', JSON.stringify(newDirs));
    set({ scanDirs: newDirs });
  },
  setScrobbleThreshold: (val: number) => {
    localStorage.setItem('lastfm_threshold', val.toString());
    set({ scrobbleThreshold: val });
  },
  toggleSettings: () => set(s => ({ showSettings: !s.showSettings })),
  toggleScrobble: () => set(s => {
    if (s.scrobbleEnabled) {
      localStorage.removeItem('lastfm_session');
      return { scrobbleEnabled: false, lastfmSessionKey: null };
    }
    return { scrobbleEnabled: true };
  }),
  setLastFmSession: (key) => {
    if (key) localStorage.setItem('lastfm_session', key);
    else localStorage.removeItem('lastfm_session');
    set({ lastfmSessionKey: key, scrobbleEnabled: !!key });
  },
  setShowRomaji: (val) => set({ showRomaji: val }),

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

  playTrack: async (track) => {
    if (!track) return;
    try {
      const index = get().tracks.findIndex(t => t.path === track.path);
      set({
        currentTrackIndex: index,
        lyricOffset: track.lyric_offset || 0,
        lyrics: [],
        lyricStatus: 'loading',
        coverArt: null,
        accentColor: '#8b5cf6',
        scrobbledCurrent: false,
        playback: { ...get().playback, current_track: track.path, status: 'Playing', position_secs: 0 },
      });

      await invoke('play_track', { path: track.path });
      
      invoke('update_media_metadata', {
        title: track.title || track.path.split(/[\\/]/).pop(),
        artist: track.artist || 'Unknown Artist',
        coverUrl: null,
        duration: track.duration || 0,
      }).catch(() => {});

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
          }).catch(() => {});
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
    } finally {
      set({ isTransitioning: false });
    }

    const state = get();
    if (state.tracks.length > 0 && state.currentTrackIndex >= 0) {
      let nextIndex = state.shuffle
        ? Math.floor(Math.random() * state.tracks.length)
        : (state.currentTrackIndex + 1) % state.tracks.length;
      try { await invoke('queue_next', { path: state.tracks[nextIndex].path }); } catch (e) { }
    }
  },

  handleTrackTransition: async (path: string) => {
    const state = get();
    const index = state.tracks.findIndex(t => t.path === path);
    if (index === -1) return;
    const track = state.tracks[index];

    set({
      currentTrackIndex: index,
      lyricOffset: track.lyric_offset || 0, // LOAD SAVED OFFSET
      lyrics: [],
      lyricStatus: 'loading',
      coverArt: null,
      accentColor: '#8b5cf6',
      scrobbledCurrent: false,
      isTransitioning: false,
      playback: { ...state.playback, current_track: path, status: 'Playing', position_secs: 0 },
    });

    invoke('update_media_metadata', {
      title: track.title || path.split(/[\\/]/).pop(),
      artist: track.artist || 'Unknown Artist',
      coverUrl: null,
      duration: track.duration || 0,
    }).catch(() => {});

    invoke('get_cover_art', { path }).then(async (art: any) => {
      if (get().playback.current_track !== path) return;
      if (art && typeof art === 'string') {
        set({ coverArt: art });
        try {
          const color = await extractDominantColor(art);
          set({ accentColor: color });
        } catch (_) { }
        invoke('update_media_metadata', {
          title: track.title || path.split(/[\\/]/).pop(),
          artist: track.artist || 'Unknown Artist',
          coverUrl: art,
          duration: track.duration || 0,
        }).catch(() => {});
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
    let nextIndex = newState.shuffle
      ? Math.floor(Math.random() * newState.tracks.length)
      : (newState.currentTrackIndex + 1) % newState.tracks.length;
    try { await invoke('queue_next', { path: newState.tracks[nextIndex].path }); } catch (e) { }
  },

  playNext: async () => {
    const { tracks, currentTrackIndex, shuffle, isTransitioning } = get();
    if (tracks.length === 0 || isTransitioning) return;
    set({ isTransitioning: true });
    let nextIndex = shuffle
      ? Math.floor(Math.random() * tracks.length)
      : (currentTrackIndex + 1) % tracks.length;
    await get().playTrack(tracks[nextIndex]);
  },

  playPrev: async () => {
    const { tracks, currentTrackIndex } = get();
    if (tracks.length === 0) return;
    const prevIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
    await get().playTrack(tracks[prevIndex]);
  },

  toggleShuffle: () => set(s => ({ shuffle: !s.shuffle })),

  pauseTrack: async () => { 
    try { 
      await invoke('pause_track'); 
      await invoke('update_media_playback', { playing: false });
      set(s => ({ playback: { ...s.playback, status: 'Paused' } }));
    } catch (e) { console.error(e); } 
  },
  resumeTrack: async () => { 
    try { 
      await invoke('resume_track'); 
      await invoke('update_media_playback', { playing: true });
      set(s => ({ playback: { ...s.playback, status: 'Playing' } }));
    } catch (e) { console.error(e); } 
  },
  stopTrack: async () => {
    try { 
      await invoke('stop_track'); 
      set({ 
        isTransitioning: false, 
        playback: { ...get().playback, status: 'Stopped', current_track: null, position_secs: 0 },
        coverArt: null,
        accentColor: '#8b5cf6',
        lyrics: [],
        lyricStatus: 'idle'
      });
    } catch (e) { console.error(e); }
  },

  setVolume: async (vol) => {
    try { 
      await invoke('set_volume', { volume: vol }); 
      set(s => ({ playback: { ...s.playback, volume: vol } }));
    } catch (e) { console.error(e); }
  },

  seek: async (secs) => {
    try { await invoke('seek_track', { secs }); } catch (e) { console.error(e); }
  },

  pollStatus: async () => {
    try {
      const status: any = await invoke('get_playback_status');
      if (!status) return;

      const prevTrack = get().playback.current_track;
      const newTrack = status.current_track;

      // Detect if the backend switched tracks (gapless transition)
      if (newTrack && newTrack !== prevTrack) {
        // The backend changed tracks — trigger a full metadata reload
        get().handleTrackTransition(newTrack);
        return; // Don't overwrite state; handleTrackTransition will set it
      }

      set(s => ({ playback: { ...s.playback, ...status } }));

      // If playback stopped and we still have art, clear it
      if (!status.current_track && get().coverArt) {
        set({ coverArt: null, accentColor: '#8b5cf6', lyrics: [], lyricStatus: 'idle' });
      }

      // Auto Scrobble at threshold% or 4 minutes
      const { current_track, position_secs } = status;
      const { scrobbleEnabled, lastfmSessionKey, scrobbledCurrent, tracks, scrobbleThreshold } = get();
      if (scrobbleEnabled && lastfmSessionKey && !scrobbledCurrent && current_track && status.status === 'Playing') {
        const tr = tracks.find(t => t.path === current_track);
        if (tr && tr.artist && tr.title) {
          const dur = tr.duration || 200;
          const thresholdSecs = (scrobbleThreshold / 100) * dur;
          if (position_secs > thresholdSecs || position_secs > 240) {
            set({ scrobbledCurrent: true });
            const ts = Math.floor(Date.now() / 1000) - Math.floor(position_secs);
            invoke('lastfm_scrobble', { artist: tr.artist, track: tr.title, timestamp: ts, sessionKey: lastfmSessionKey })
              .then(() => {
                set({ lastScrobble: { artist: tr.artist ?? 'Unknown', track: tr.title ?? 'Unknown' } });
                setTimeout(() => set({ lastScrobble: null }), 5000);
              })
              .catch((e: any) => {
                const msg = String(e);
                console.error('Scrobble error:', msg);
                set({ lastScrobble: { artist: '⚠️ Scrobble Failed', track: msg } });
                setTimeout(() => set({ lastScrobble: null }), 8000);
              });
          }
        }
      }

    } catch (e) { }
  },

  toggleProMode: () => set(s => ({ showProMode: !s.showProMode })),
  toggleControlCenter: () => set(s => ({ showControlCenter: !s.showControlCenter })),
  resetProMode: async () => {
    const def: DSPState = { width: 1.0, enabled: false };
    set({ dsp: def });
    try { await invoke('set_dsp_state', { dsp: def }); } catch (e) { console.error(e); }
  },
  setDSP: async (newDSP) => {
    const full = { ...get().dsp, ...newDSP } as DSPState;
    set({ dsp: full });
    try { await invoke('set_dsp_state', { dsp: full }); } catch (e) { console.error(e); }
  },

  toggleExclusive: async () => {
    try {
      const res: boolean = await invoke('toggle_exclusive_mode');
      if (res) await get().setDSP({ enabled: false });
      set(s => ({ playback: { ...s.playback, exclusive: res } }));
    } catch (e) { console.error(e); }
  },

  fetchDevices: async () => {
    try {
      const ds: string[] = await invoke('get_audio_devices');
      set({ devices: ds });
    } catch (e) { console.error(e); }
  },

  setAudioDevice: async (name) => {
    try { await invoke('set_audio_device', { name }); set({ currentDevice: name }); } catch (e) { console.error(e); }
  },

  adjustLyricOffset: (ms) => {
    const newOffset = get().lyricOffset + ms;
    set({ lyricOffset: newOffset });
    // PERSIST TO DATABASE
    const path = get().playback.current_track;
    if (path) {
      invoke('update_track_offset', { path, offset: newOffset }).catch(() => {});
      // Update local tracks state too so it's remembered during this session without reload
      set(s => ({
        tracks: s.tracks.map(t => t.path === path ? { ...t, lyric_offset: newOffset } : t)
      }));
    }
  },

  saveLyrics: async (path, lrc) => {
    try {
      await invoke('save_lyrics_file', { path, content: lrc });
      const lines: any = await invoke('get_lyrics', { path });
      if (Array.isArray(lines)) set({ lyrics: lines, lyricStatus: 'found' });
    } catch (e) { console.error(e); }
  },

  translateLyrics: async () => {
    const { lyrics, playback } = get();
    if (!playback.current_track || lyrics.length === 0) return;
    set({ isTranslating: true });
    try {
      const translated = await Promise.all(
        lyrics.map(async (l) => {
          if (!l.text) return l;
          try {
            const [translation, romaji]: [string, string] = await invoke('translate_lyric_line', { text: l.text });
            return { ...l, translation: translation || undefined, romaji: romaji || undefined };
          } catch { return l; }
        })
      );
      set({ lyrics: translated });
    } catch (e) { console.error(e); } finally { set({ isTranslating: false }); }
  },

  getRomaji: async () => {
    const { lyrics } = get();
    if (lyrics.length === 0) return;
    set({ isTranslating: true });
    try {
      const withRomaji = await Promise.all(
        lyrics.map(async (l) => {
          if (!l.text || l.romaji) return l;
          try {
            const [, romaji]: [string, string] = await invoke('translate_lyric_line', { text: l.text });
            return { ...l, romaji: romaji || undefined };
          } catch { return l; }
        })
      );
      set({ lyrics: withRomaji });
    } catch (e) { console.error(e); } finally { set({ isTranslating: false }); }
  },

  applyOnlineCover: async (path, url) => {
    try {
      await invoke('apply_online_cover', { path, url });
      if (get().playback.current_track === path) {
        invoke('get_cover_art', { path }).then(async (art: any) => {
          if (art && typeof art === 'string') {
            set({ coverArt: art });
            try {
              const color = await extractDominantColor(art);
              set({ accentColor: color });
            } catch (_) { }
          }
        }).catch(() => { });
      }
    } catch (e) { console.error(e); }
  },

  fetchPlaylists: async () => {
    try {
      const playlists: Playlist[] = await invoke('get_playlists');
      set({ playlists });
    } catch (e) { console.error(e); }
  },
  createPlaylist: async (name) => {
    try {
      await invoke('create_playlist', { name });
      await get().fetchPlaylists();
    } catch (e) { console.error(e); }
  },
  deletePlaylist: async (id) => {
    try {
      await invoke('delete_playlist', { id });
      await get().fetchPlaylists();
      if (get().currentPlaylist?.id === id) {
        set({ currentPlaylist: null });
        await get().loadLibrary();
      }
    } catch (e) { console.error(e); }
  },
  addToPlaylist: async (playlistId, trackPath) => {
    try {
      await invoke('add_to_playlist', { playlistId, path: trackPath });
      // If we are currently viewing this playlist, refresh the tracks
      if (get().currentPlaylist?.id === playlistId) {
        await get().loadPlaylistTracks(playlistId);
      }
    } catch (e) { console.error(e); }
  },
  removeFromPlaylist: async (playlistId, trackPath) => {
    try {
      await invoke('remove_from_playlist', { playlistId, path: trackPath });
      if (get().currentPlaylist?.id === playlistId) {
        await get().loadPlaylistTracks(playlistId);
      }
    } catch (e) { console.error(e); }
  },
  loadPlaylistTracks: async (playlistId) => {
    try {
      const tracks: Track[] = await invoke('get_playlist_tracks', { playlistId });
      const playlist = get().playlists.find(p => p.id === playlistId) || null;
      set({ tracks, currentPlaylist: playlist });
    } catch (e) { console.error(e); }
  },
}));
