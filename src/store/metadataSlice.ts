import { StateCreator } from 'zustand';
import { PlayerState, extractDominantColor } from './types';
import { invoke } from '@tauri-apps/api/core';

export const createMetadataSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  lyrics: [],
  lyricOffset: 0,
  lyricStatus: 'idle',
  coverArt: null,
  isTranslating: false,
  showRomaji: true,

  setShowRomaji: (val) => set({ showRomaji: val }),

  adjustLyricOffset: (ms) => {
    const newOffset = get().lyricOffset + ms;
    set({ lyricOffset: newOffset });
    const path = get().playback.current_track;
    if (path) {
      invoke('update_track_offset', { path, offset: newOffset }).catch(() => { });
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
});
