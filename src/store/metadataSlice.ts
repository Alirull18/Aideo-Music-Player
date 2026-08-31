import { StateCreator } from 'zustand';
import { PlayerState, extractDominantColor, LyricsDisplayMode } from './types';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { cleanSearchQuery, pathsEqual } from '../utils';
import { safeGetStorage, safeSetStorage } from '../utils/storage';
import { romanizeText } from '../utils/romanizer';

export const createMetadataSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  lyrics: [],
  lyricOffset: 0,
  lyricStatus: 'idle',
  lyricsDisplayMode: (safeGetStorage('aideo-lyrics-display-mode', 'karaoke') as LyricsDisplayMode) || 'karaoke',
  coverArt: (() => {
    try {
      const tr = JSON.parse(localStorage.getItem('aideo_current_track') || 'null');
      return tr?.cover_url || null;
    } catch {
      return null;
    }
  })(),
  isTranslating: false,
  showRomaji: safeGetStorage('aideo-show-romaji') === 'true',
  showTranslation: safeGetStorage('aideo-show-translation') === 'true',
  showLyricsHeader: safeGetStorage('aideo-show-lyrics-header') !== 'false',

  setLyricsDisplayMode: (mode: LyricsDisplayMode) => {
    safeSetStorage('aideo-lyrics-display-mode', mode);
    set({ lyricsDisplayMode: mode });
    if (get().desktopLyricsOpen) {
      emit('desktop-lyrics-sync', {
        currentTrack: get().currentTrack,
        playback: get().playback,
        lyrics: get().lyrics,
        lyricOffset: get().lyricOffset,
        showRomaji: get().showRomaji,
        showTranslation: get().showTranslation,
        accentColor: get().accentColor,
        desktopLyricsLocked: get().desktopLyricsLocked,
        lyricsDisplayMode: mode,
      }).catch(() => {});
    }
  },

  setShowRomaji: (val: boolean) => {
    safeSetStorage('aideo-show-romaji', String(val));
    set({ showRomaji: val });
  },
  setShowTranslation: (val: boolean) => {
    safeSetStorage('aideo-show-translation', String(val));
    set({ showTranslation: val });
  },
  setShowLyricsHeader: (val: boolean) => {
    safeSetStorage('aideo-show-lyrics-header', String(val));
    set({ showLyricsHeader: val });
  },
  toggleLyricsHeader: () => {
    const next = !get().showLyricsHeader;
    safeSetStorage('aideo-show-lyrics-header', String(next));
    set({ showLyricsHeader: next });
  },

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
      const results: any[] = await invoke('search_lyrics_online', {
        query,
        title: cleanTitle,
        artist: cleanArtist,
        album: track.album || undefined,
        duration: track.duration || undefined,
      });

      if (results && results.length > 0) {
        // Exclude iTunes results since they do not contain lyrics
        const lyricResults = results.filter(r => r.source !== 'iTunes');

        // Score and rank results based on title, artist, duration matching, sync quality and provider cascade priority
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
          } else if (!targetArtist || targetArtist.trim() === '') {
            artistScore = 0.5;
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

          // Word-sync bonus (BiniLyrics Apple TTML, Better Lyrics TTML, NetEase YRC, Kugou KRC, QQ QRC) vs line sync vs plain text
          let syncBonus = 0.0;
          const raw = r.raw_lrc || '';
          const hasWordTiming = raw.includes('<span') || raw.includes('<tt') || raw.includes('(') || raw.includes('<');
          if (r.source === 'BiniLyrics' || r.source === 'Better Lyrics' || r.source === 'Unison' || r.source === 'NetEase' || r.source === 'Kugou' || hasWordTiming) {
            syncBonus = 0.40;
          } else if (r.synced || raw.includes('[')) {
            syncBonus = 0.15;
          }

          // Provider cascade priority bonus: BiniLyrics / Better Lyrics (1) > NetEase / Kugou (2) > QQMusic (3) > LRCLIB (4)
          let sourceBonus = 0.0;
          if (r.source === 'BiniLyrics' || r.source === 'Better Lyrics' || r.source === 'Unison') sourceBonus = 0.25;
          else if (r.source === 'NetEase' || r.source === 'Kugou') sourceBonus = 0.15;
          else if (r.source === 'QQMusic') sourceBonus = 0.05;

          const rankBonus = Math.max(0, 0.15 - (index * 0.03));
          const score = (titleScore * 0.5) + (artistScore * 0.3) + durationBonus + syncBonus + sourceBonus + rankBonus;

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
          if (!lrc && (bestMatch.source === 'BiniLyrics' || bestMatch.source === 'Better Lyrics' || bestMatch.source === 'Unison')) {
            lrc = await invoke<string>('get_unison_ttml', {
              song: bestMatch.title,
              artist: bestMatch.artist || cleanArtist || undefined,
              album: track.album || undefined,
              duration: bestMatch.duration || track.duration || undefined,
            }).catch(() => '');
          }
          if (!lrc && bestMatch.source === 'Kugou' && bestMatch.content_id) {
            lrc = await invoke<string>('get_kugou_krc', { id: bestMatch.content_id, accesskey: bestMatch.id }).catch(() => '');
          }
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
      const texts = lyrics.map(l => l.text || '');
      let batchResults: [string, string][] = [];
      try {
        batchResults = await invoke<[string, string][]>('translate_lyrics_batch', { lines: texts });
      } catch (err) {
        console.error('Batch translation invoke failed:', err);
      }

      const translated = lyrics.map((l, idx) => {
        if (!l.text) return l;
        const [trans, rom] = batchResults[idx] || ['', ''];
        const localRom = romanizeText(l.text);
        const resolvedRomaji = l.romaji || rom || (localRom !== l.text ? localRom : undefined);
        return {
          ...l,
          translation: trans || l.translation || undefined,
          romaji: resolvedRomaji,
        };
      });

      if (pathsEqual(get().playback.current_track, trackPath)) {
        safeSetStorage('aideo-show-translation', 'true');
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
      const texts = lyrics.map(l => (l.romaji ? '' : (l.text || '')));
      let batchResults: [string, string][] = [];
      try {
        batchResults = await invoke<[string, string][]>('translate_lyrics_batch', { lines: texts });
      } catch (err) {
        console.error('Batch romaji invoke failed:', err);
      }

      const withRomaji = lyrics.map((l, idx) => {
        if (!l.text) return l;
        if (l.romaji) return l;
        const [, rom] = batchResults[idx] || ['', ''];
        const localRom = romanizeText(l.text);
        const resolvedRomaji = rom || (localRom !== l.text ? localRom : undefined);
        return {
          ...l,
          romaji: resolvedRomaji,
        };
      });

      if (pathsEqual(get().playback.current_track, trackPath)) {
        safeSetStorage('aideo-show-romaji', 'true');
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
