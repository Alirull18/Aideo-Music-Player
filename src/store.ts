import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Track {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  duration: number | null;
  format: string | null;
}

export interface LyricLine {
  time_secs: number;
  text: string;
  romaji?: string;
  translation?: string;
}

export interface EQState {
  bands: [number, number, number, number, number, number, number, number, number, number];
  enabled: boolean;
  speed: number;
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
  coverArt: string | null;
  accentColor: string;       // dynamic colour extracted from art
  showProMode: boolean;
  eq: EQState;

  devices: string[];
  currentDevice: string | null;
  scanDir: string;
  scanStatus: string;
  isTranslating: boolean;
  showRomaji: boolean;
  isTransitioning: boolean;

  // actions
  setView: (view: 'library' | 'nowplaying') => void;
  setScanDir: (dir: string) => void;
  scanLibrary: () => Promise<void>;
  loadLibrary: () => Promise<void>;
  playTrack: (track: Track) => Promise<void>;
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
  resetProMode: () => void;
  setEQ: (eq: Partial<EQState>) => Promise<void>;
  toggleExclusive: () => Promise<void>;
  fetchDevices: () => Promise<void>;
  setAudioDevice: (name: string) => Promise<void>;
  adjustLyricOffset: (ms: number) => void;
  saveLyrics: (path: string, lrc: string) => Promise<void>;
  translateLyrics: () => Promise<void>;
  getRomaji: () => Promise<void>;
  setShowRomaji: (val: boolean) => void;
}

/** Pull a dominant colour from a base64 data-URL image using a canvas. */
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
      // Boost saturation so it looks vivid, not muddy
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
  coverArt: null,
  accentColor: '#8b5cf6',
  showProMode: false,
  eq: { bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], enabled: false, speed: 1.0 },
  devices: [],
  currentDevice: null,
  scanDir: '',
  scanStatus: '',
  isTranslating: false,
  showRomaji: true,
  isTransitioning: false,

  setView: (view) => set({ view }),
  setScanDir: (dir) => set({ scanDir: dir }),
  setShowRomaji: (val) => set({ showRomaji: val }),

  scanLibrary: async () => {
    const dir = get().scanDir;
    if (!dir) { set({ scanStatus: 'Pick a folder first' }); return; }
    set({ scanStatus: 'Scanning...' });
    try {
      // Backend command is scan_and_save, args: dir
      const count: number = await invoke('scan_and_save', { dir });
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
    try {
      const index = get().tracks.findIndex(t => t.path === track.path);
      set({
        currentTrackIndex: index,
        lyricOffset: 0,
        lyrics: [],
        coverArt: null,
        accentColor: '#8b5cf6',
        playback: { ...get().playback, current_track: track.path, status: 'Playing', position_secs: 0 },
      });

      // Send play command to backend
      await invoke('play_track', { path: track.path });

      // Fetch cover art asynchronously – backend returns full data-URL string
      invoke('get_cover_art', { path: track.path }).then(async (art: any) => {
        if (art && typeof art === 'string') {
          set({ coverArt: art });
          // Extract accent colour from the art
          try {
            const color = await extractDominantColor(art);
            set({ accentColor: color });
          } catch (_) {}
        }
      }).catch(() => {});

      // Fetch lyrics asynchronously
      invoke('get_lyrics', { path: track.path }).then((lrc: any) => {
        if (Array.isArray(lrc) && lrc.length > 0) set({ lyrics: lrc });
      }).catch(() => {});

    } catch (e) {
      console.error('playTrack:', e);
    } finally {
      set({ isTransitioning: false });
    }
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

  pauseTrack: async () => { try { await invoke('pause_track'); } catch (e) { console.error(e); } },
  resumeTrack: async () => { try { await invoke('resume_track'); } catch (e) { console.error(e); } },
  stopTrack: async () => {
    try { await invoke('stop_track'); } catch (e) { console.error(e); }
    set({ isTransitioning: false, playback: { ...get().playback, status: 'Stopped' } });
  },

  // Backend command name is set_volume, param name is volume (NOT vol)
  setVolume: async (vol) => {
    try { await invoke('set_volume', { volume: vol }); } catch (e) { console.error(e); }
    set(s => ({ playback: { ...s.playback, volume: vol } }));
  },

  seek: async (secs) => {
    try { await invoke('seek_track', { secs }); } catch (e) { console.error(e); }
  },

  pollStatus: async () => {
    try {
      const status: any = await invoke('get_playback_status');
      const prevStatus = get().playback.status;
      set(s => ({ playback: { ...s.playback, ...status } }));
      // Auto-next when track naturally ends
      if (status.status === 'Stopped' && prevStatus === 'Playing' && !get().isTransitioning && get().currentTrackIndex !== -1) {
        get().playNext();
      }
    } catch (e) { console.error('pollStatus:', e); }
  },

  toggleProMode: () => set(s => ({ showProMode: !s.showProMode })),
  resetProMode: async () => {
    const def: EQState = { bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], enabled: false, speed: 1.0 };
    set({ eq: def });
    try { await invoke('set_eq_state', { state: def }); } catch (e) { console.error(e); }
  },
  setEQ: async (newEQ) => {
    const full = { ...get().eq, ...newEQ } as EQState;
    set({ eq: full });
    try { await invoke('set_eq_state', { state: full }); } catch (e) { console.error(e); }
  },

  toggleExclusive: async () => {
    try {
      const res: boolean = await invoke('toggle_exclusive_mode');
      if (res) await get().setEQ({ enabled: false });
      set(s => ({ playback: { ...s.playback, exclusive: res } }));
    } catch (e) { console.error(e); }
  },

  // No get_current_device command exists – just list devices, default to null
  fetchDevices: async () => {
    try {
      const ds: string[] = await invoke('get_audio_devices');
      set({ devices: ds });
    } catch (e) { console.error(e); }
  },

  setAudioDevice: async (name) => {
    try { await invoke('set_audio_device', { name }); set({ currentDevice: name }); } catch (e) { console.error(e); }
  },

  adjustLyricOffset: (ms) => set(s => ({ lyricOffset: s.lyricOffset + ms })),

  // Backend command: save_lyrics_file(path, content)
  saveLyrics: async (path, lrc) => {
    try {
      await invoke('save_lyrics_file', { path, content: lrc });
      const lines: any = await invoke('get_lyrics', { path });
      if (Array.isArray(lines)) set({ lyrics: lines });
    } catch (e) { console.error(e); }
  },

  // Backend has translate_lyric_line(text) per-line; we do a best-effort full translation
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

  // Fetch only romaji/transliteration without translation
  getRomaji: async () => {
    const { lyrics } = get();
    if (lyrics.length === 0) return;
    set({ isTranslating: true });
    try {
      const withRomaji = await Promise.all(
        lyrics.map(async (l) => {
          if (!l.text || l.romaji) return l; // skip if already has romaji
          try {
            const [, romaji]: [string, string] = await invoke('translate_lyric_line', { text: l.text });
            return { ...l, romaji: romaji || undefined };
          } catch { return l; }
        })
      );
      set({ lyrics: withRomaji });
    } catch (e) { console.error(e); } finally { set({ isTranslating: false }); }
  },
}));
