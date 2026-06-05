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
    let artist = track.artist === 'Unknown' || track.artist === 'Online Stream' || track.artist === '—' ? '' : track.artist;
    let title = track.title;
    if (!title || title.startsWith('http://') || title.startsWith('https://')) return;

    // Remove file extension if present
    title = title.replace(/\.(mp3|flac|m4a|wav|ogg|aac|wma)$/i, '');

    // Step 1: Pre-clean leading square brackets and parentheses (common channel names / tags)
    title = title.replace(/^(\s*[\[\(].*?[\]\)]\s*)+/g, '').trim();

    // Step 2: If artist is empty/generic, try to split title by hyphen to infer artist and title
    if (!artist) {
      const hyphenMatch = title.match(/\s*[-—~:]\s*/);
      if (hyphenMatch) {
        const parts = title.split(/\s*[-—~:]\s*/);
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      }
    }

    // Step 3: Clean up common video/channel suffixes and bracketed tags from artist and title
    const cleanTags = (s: string) => {
      return s
        // Remove brackets containing video production keywords
        .replace(/\s*[([].*?(official|lyrics|video|audio|hq|hd|edit|remix|version|distribution|cover|stage|live|choreo|studio|performance|show|sub|eng|rom|han|fancam|karaoke|instrumental|inst|ver|clip|mv|m\/v).*?[\])]/gi, '')
        // Remove trailing "from ... studio" structures
        .replace(/\s+from\s+.*studio$/i, '')
        // Remove trailing keywords at the end of the string
        .replace(/\s+(official|lyrics|video|mv|lrc|distribution|cover|stage|live|choreo|performance|show|sub|raw|hd|hq)$/i, '')
        .trim();
    };

    let cleanTitle = cleanTags(title);
    let cleanArtist = cleanTags(artist).replace(/\s*-\s*topic$/i, '').trim();

    if (!cleanTitle) return;

    set({ lyricStatus: 'loading' });
    try {
      const query = `${cleanArtist} ${cleanTitle}`.trim();
      const results: any[] = await invoke('search_lyrics_online', { query });

      if (results && results.length > 0) {
        // Exclude iTunes results since they do not contain lyrics
        const lyricResults = results.filter(r => r.source !== 'iTunes');

        // Score and rank results based on title and artist matching
        const scoredResults = lyricResults.map(r => {
          const clean = (s: string) => s.toLowerCase()
            .replace(/[()\[\]\-\s_]+/g, '')
            .replace(/[^\p{L}\p{N}]/gu, '');

          const pTitle = clean(cleanTitle);
          const rTitle = clean(r.title);

          let titleScore = 0;
          if (pTitle === rTitle) {
            titleScore = 1.0;
          } else if (pTitle.includes(rTitle) || rTitle.includes(pTitle)) {
            titleScore = 0.7;
          }

          const pArtist = cleanArtist.toLowerCase().trim();
          const rArtist = r.artist.toLowerCase().trim();
          let artistScore = 0;
          if (pArtist && rArtist) {
            if (pArtist === rArtist || rArtist.includes(pArtist) || pArtist.includes(rArtist)) {
              artistScore = 1.0;
            }
          }

          const syncBonus = r.synced && r.raw_lrc ? 0.3 : 0.0;
          const totalScore = (titleScore * 0.7) + (artistScore * 0.3) + syncBonus;

          return { result: r, score: totalScore, titleScore };
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

          if (lrc) {
            await get().saveLyrics(track.path, lrc);

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
