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

  setShowRomaji: (val: boolean) => set({ showRomaji: val }),

  adjustLyricOffset: (ms: number) => {
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

  saveLyrics: async (path: string, lrc: string) => {
    try {
      await invoke('save_lyrics_file', { path, content: lrc });
      const lines: any = await invoke('get_lyrics', { path });
      if (Array.isArray(lines)) set({ lyrics: lines, lyricStatus: 'found' });
    } catch (e) { console.error(e); }
  },

  autoFetchLyricsOnline: async (track: any) => {
    if (!track || !track.title) return;

    // Ignore default fallback titles / artists to avoid garbage search results
    const artist = track.artist === 'Unknown' || track.artist === 'Online Stream' || track.artist === '—' ? '' : track.artist;
    const title = track.title;
    if (!title || title.startsWith('http://') || title.startsWith('https://')) return;

    // Clean title and artist to maximize online search match rates
    let cleanTitle = title.replace(/\.(mp3|flac|m4a|wav|ogg|aac|wma)$/i, '');
    cleanTitle = cleanTitle.replace(/\s*[([].*?(official|lyrics|video|audio|hq|hd|edit|remix|version).*?[\])]/gi, '').trim();
    
    let cleanArtist = artist.replace(/\s*-\s*topic$/i, '').trim();

    if (!cleanTitle) return;

    set({ lyricStatus: 'loading' });
    try {
      const query = `${cleanArtist} ${cleanTitle}`.trim();
      const results: any[] = await invoke('search_lyrics_online', { query });

      if (results && results.length > 0) {
        // Exclude iTunes results since they do not contain lyrics
        const lyricResults = results.filter(r => r.source !== 'iTunes');

        // Find the best match: prefer synced lyrics from LRCLIB first, then others
        let bestMatch = lyricResults.find(r => r.synced && r.raw_lrc);
        if (!bestMatch) bestMatch = lyricResults.find(r => r.source === 'LRCLIB' && r.raw_lrc);
        if (!bestMatch) bestMatch = lyricResults.find(r => r.source === 'NetEase' || r.source === 'QQMusic');
        if (!bestMatch) bestMatch = lyricResults[0];

        if (bestMatch) {
          let lrc = bestMatch.raw_lrc ?? '';
          if (!lrc && bestMatch.source === 'NetEase' && bestMatch.content_id) {
            lrc = await invoke<string>('get_netease_lrc', { id: bestMatch.content_id }).catch(() => '');
          }
          if (!lrc && bestMatch.source === 'QQMusic' && bestMatch.content_id) {
            lrc = await invoke<string>('get_qqmusic_lrc', { mid: bestMatch.content_id }).catch(() => '');
          }

          if (lrc) {
            await get().saveLyrics(track.path, lrc);
            return;
          }
        }
      }
      set({ lyricStatus: 'not_found' });
    } catch (e) {
      console.error('Auto lyric fetch failed:', e);
      set({ lyricStatus: 'not_found' });
    }
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

  applyOnlineCover: async (path: string, url: string) => {
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
