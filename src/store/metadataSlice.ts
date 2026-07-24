import { StateCreator } from 'zustand';
import { PlayerState, extractDominantColor } from './types';
import { invoke } from '@tauri-apps/api/core';
import { cleanSearchQuery, pathsEqual } from '../utils';

export const createMetadataSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  lyrics: [],
  lyricOffset: 0,
  lyricStatus: 'idle',
  coverArt: null,
  isTranslating: false,
  showRomaji: true,
  showTranslation: true,

  setShowRomaji: (val: boolean) => set({ showRomaji: val }),
  setShowTranslation: (val: boolean) => set({ showTranslation: val }),

  adjustLyricOffset: (ms: number) => {
    const newOffset = get().lyricOffset + ms;
    set({ lyricOffset: newOffset });
    const path = get().playback.current_track;
    if (path) {
      invoke('update_track_offset', { path, offset: newOffset }).catch(() => { });
      set(s => ({
        tracks: s.tracks.map(t => pathsEqual(t.path, path) ? { ...t, lyric_offset: newOffset } : t)
      }));
    }
  },

  setLyricOffset: (ms: number) => {
    set({ lyricOffset: ms });
    const path = get().playback.current_track;
    if (path) {
      invoke('update_track_offset', { path, offset: ms }).catch(() => { });
      set(s => ({
        tracks: s.tracks.map(t => pathsEqual(t.path, path) ? { ...t, lyric_offset: ms } : t)
      }));
    }
  },

  saveLyrics: async (path: string, lrc: string) => {
    try {
      await invoke('save_lyrics_file', { path, content: lrc });
      const lines: any = await invoke('get_lyrics', { path });
      if (pathsEqual(get().playback.current_track, path)) {
        if (Array.isArray(lines)) set({ lyrics: lines, lyricStatus: 'found' });
      }
    } catch (e) { console.error(e); }
  },

  autoFetchLyricsOnline: async (track: any) => {
    if (!track || !track.title) return;

    const { artist: cleanArtist, title: cleanTitle } = cleanSearchQuery(track.artist, track.title);

    if (!cleanTitle) return;

    set({ lyricStatus: 'loading' });
    try {
      const query = `${cleanArtist} ${cleanTitle}`.trim();
      const results: any[] = await invoke('search_lyrics_online', { query });

      if (results && results.length > 0) {
        // Exclude iTunes results since they do not contain lyrics
        const lyricResults = results.filter(r => r.source !== 'iTunes');

        // Score and rank results based on title, artist and duration matching (identical to LyricsPanel.tsx)
        const targetTitle = cleanTitle || track.title || '';
        const targetArtist = cleanArtist || track.artist || '';
        const targetDuration = track.duration;

        const scoredResults = lyricResults.map((r, index) => {
          const clean = (s: string) => s.toLowerCase()
            .replace(/[()\[\]\-\s_]+/g, '')
            .replace(/[^\p{L}\p{N}]/gu, '');

          const pTitle = clean(targetTitle);
          const rTitle = clean(r.title);

          let titleScore = 0;
          if (pTitle === rTitle) {
            titleScore = 1.0;
          } else if (pTitle.includes(rTitle) || rTitle.includes(pTitle)) {
            titleScore = 0.6;
          }

          const pArtist = clean(targetArtist);
          const rArtist = clean(r.artist);
          let artistScore = 0;
          if (pArtist && rArtist) {
            if (pArtist === rArtist || rArtist.includes(pArtist) || pArtist.includes(rArtist)) {
              artistScore = 1.0;
            }
          }

          let durationBonus = 0;
          if (targetDuration && r.duration) {
            const diff = Math.abs(targetDuration - r.duration);
            if (diff <= 3) {
              durationBonus = 0.5;
            } else if (diff <= 15) {
              durationBonus = 0.2;
            } else if (diff > 60) {
              durationBonus = -0.3;
            }
          }

          const syncBonus = r.raw_lrc || r.source !== 'iTunes' ? 0.2 : 0.0;
          const rankBonus = Math.max(0, 0.15 - (index * 0.03));
          const score = (titleScore * 0.5) + (artistScore * 0.3) + durationBonus + syncBonus + rankBonus;

          return { result: r, score, titleScore };
        });

        // Filter out results that do not match the title at all
        const validMatches = scoredResults.filter(sr => sr.titleScore > 0);

        let bestMatch = null;
        if (validMatches.length > 0) {
          validMatches.sort((a, b) => b.score - a.score);
          bestMatch = validMatches[0].result;
        }

        if (bestMatch) {
          let lrc = bestMatch.raw_lrc ?? '';
          if (!lrc && bestMatch.source === 'NetEase' && bestMatch.content_id) {
            lrc = await invoke<string>('get_netease_lrc', { id: bestMatch.content_id }).catch(() => '');
          }
          if (!lrc && bestMatch.source === 'QQMusic' && bestMatch.content_id) {
            lrc = await invoke<string>('get_qqmusic_lrc', { mid: bestMatch.content_id }).catch(() => '');
          }

          console.log('[lyrics] query=', query, 'results=', results?.length, 'bestMatch=', bestMatch?.title, 'lrc.len=', lrc?.length);

          if (lrc) {
            await get().saveLyrics(track.path, lrc);

            // Explicitly resolve status so it can never get stuck on 'loading'
            // if saveLyrics' internal read-back guard races with a track change.
            const lines: any = await invoke('get_lyrics', { path: track.path }).catch(() => []);
            const stillCurrent = pathsEqual(get().playback.current_track, track.path);
            if (stillCurrent) {
              if (Array.isArray(lines) && lines.length > 0) {
                set({ lyrics: lines, lyricStatus: 'found' });
              } else {
                set({ lyricStatus: 'not_found' });
              }
            }

            if (track.duration && bestMatch.duration) {
              const diffSec = track.duration - bestMatch.duration;
              if (diffSec > 2 && diffSec < 120) {
                const calculatedMs = Math.round(diffSec * 10) * 100;
                get().adjustLyricOffset(calculatedMs);
                window.dispatchEvent(new CustomEvent('ui-toast', { 
                  detail: { message: `✨ Sync: Adjusted lyric offset by +${(calculatedMs/1000).toFixed(1)}s to match video length`, type: 'info' } 
                }));
              }
            }
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
      const trackPath = playback.current_track;
      const translated = await Promise.all(
        lyrics.map(async (l) => {
          if (!l.text) return l;
          try {
            const [translation, romaji]: [string, string] = await invoke('translate_lyric_line', { text: l.text });
            return { ...l, translation: translation || undefined, romaji: romaji || undefined };
          } catch { return l; }
        })
      );
      if (pathsEqual(get().playback.current_track, trackPath)) {
        set({ lyrics: translated, showTranslation: true });
      }
    } catch (e) { console.error(e); } finally { set({ isTranslating: false }); }
  },

  getRomaji: async () => {
    const { lyrics, playback } = get();
    if (lyrics.length === 0) return;
    set({ isTranslating: true });
    try {
      const trackPath = playback.current_track;
      const withRomaji = await Promise.all(
        lyrics.map(async (l) => {
          if (!l.text || l.romaji) return l;
          try {
            const [, romaji]: [string, string] = await invoke('translate_lyric_line', { text: l.text });
            return { ...l, romaji: romaji || undefined };
          } catch { return l; }
        })
      );
      if (pathsEqual(get().playback.current_track, trackPath)) {
        set({ lyrics: withRomaji, showRomaji: true });
      }
    } catch (e) { console.error(e); } finally { set({ isTranslating: false }); }
  },

  applyOnlineCover: async (path: string, url: string) => {
    try {
      await invoke('apply_online_cover', { path, url });
      if (pathsEqual(get().playback.current_track, path)) {
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
