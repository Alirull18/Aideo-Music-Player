import { StateCreator } from 'zustand';
import { PlayerState, extractDominantColor, LyricsDisplayMode, RecordingSources, PlaybackSource, SourceSelection } from './types';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { cleanSearchQuery, pathsEqual, getVariantPenalty, sortLyricLines } from '../utils';
import { safeGetStorage, safeSetStorage } from '../utils/storage';
import { romanizeText } from '../utils/romanizer';
import { sourceKey } from '../utils/unifiedSources';

export const createMetadataSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  sourceRegistry: (() => {
    try {
      const raw = localStorage.getItem('aideo_library_source_choices');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const registry: Record<string, RecordingSources> = {};
      for (const val of Object.values(parsed)) {
        if (val && typeof val === 'object' && (val as RecordingSources).recording_id) {
          registry[(val as RecordingSources).recording_id] = val as RecordingSources;
        }
      }
      return registry;
    } catch {
      return {};
    }
  })(),

  registerDiscoveredSources: (sourcesInput: RecordingSources | PlaybackSource[], recordingIdParam?: string) => {
    let recordingId = recordingIdParam;
    let newSources: PlaybackSource[] = [];
    let displayCandidates: PlaybackSource[] | undefined;
    let selection: SourceSelection | undefined;

    if (!Array.isArray(sourcesInput)) {
      recordingId = sourcesInput.recording_id;
      newSources = sourcesInput.sources || [];
      displayCandidates = sourcesInput.display_candidates;
      selection = sourcesInput.selection;
    } else {
      newSources = sourcesInput;
    }

    if (!recordingId) {
      if (newSources.length > 0) {
        recordingId = sourceKey(newSources[0]);
      } else {
        return;
      }
    }

    set((state: PlayerState) => {
      const existing = state.sourceRegistry[recordingId!];
      const mergedSources = existing
        ? [...new Map([...existing.sources, ...newSources].map(s => [sourceKey(s), s])).values()].slice(0, 32)
        : newSources.slice(0, 32);

      const mergedCandidates = existing?.display_candidates || displayCandidates
        ? [...new Map([
            ...(existing?.display_candidates || []),
            ...(displayCandidates || []),
          ].map(s => [sourceKey(s), s])).values()].slice(0, 32)
        : undefined;

      const updatedContext: RecordingSources = {
        recording_id: recordingId!,
        sources: mergedSources,
        selection: selection || existing?.selection || { mode: 'auto' },
        ...(mergedCandidates ? { display_candidates: mergedCandidates } : {}),
      };

      const newRegistry = {
        ...state.sourceRegistry,
        [recordingId!]: updatedContext,
      };

      // Reactively update currentTrack if it matches this recording
      let updatedCurrentTrack = state.currentTrack;
      if (state.currentTrack) {
        const ctRecId = state.currentTrack.source_context?.recording_id;
        const matchesCurrent = ctRecId === recordingId
          || (Boolean(state.currentTrack.title) && newSources.some(s => s.metadata?.title === state.currentTrack?.title && s.metadata?.artist === state.currentTrack?.artist));
        if (matchesCurrent) {
          updatedCurrentTrack = {
            ...state.currentTrack,
            source_context: {
              ...(state.currentTrack.source_context || updatedContext),
              sources: mergedSources,
              ...(mergedCandidates ? { display_candidates: mergedCandidates } : {}),
            },
          };
          try {
            localStorage.setItem('aideo_current_track', JSON.stringify(updatedCurrentTrack));
          } catch { /* ignore */ }
        }
      }

      // Reactively update queue items matching this recording
      const updatedQueue = state.queue.map(item => {
        if (item.source_context?.recording_id === recordingId) {
          return {
            ...item,
            source_context: {
              ...item.source_context,
              sources: mergedSources,
              ...(mergedCandidates ? { display_candidates: mergedCandidates } : {}),
            },
          };
        }
        return item;
      });

      // Update matching library tracks that already have source_context
      const updatedTracks = state.tracks.some(t => t.source_context?.recording_id === recordingId)
        ? state.tracks.map(t => t.source_context?.recording_id === recordingId ? {
            ...t,
            source_context: {
              ...t.source_context,
              sources: mergedSources,
              ...(mergedCandidates ? { display_candidates: mergedCandidates } : {}),
            },
          } : t)
        : state.tracks;

      return {
        sourceRegistry: newRegistry,
        currentTrack: updatedCurrentTrack,
        queue: updatedQueue,
        tracks: updatedTracks,
      };
    });
  },

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
      const currentTrack = get().currentTrack;
      const playbackCurrent = get().playback.current_track;
      // Dual-key caching: also cache under playback.current_track if distinct so DesktopLyricBar matches immediately
      if (playbackCurrent && !pathsEqual(playbackCurrent, path)) {
        await invoke('save_lyrics_file', { path: playbackCurrent, content: lrc }).catch(() => {});
      }
      if (currentTrack?.path && !pathsEqual(currentTrack.path, path)) {
        await invoke('save_lyrics_file', { path: currentTrack.path, content: lrc }).catch(() => {});
      }
      const lines: any = await invoke('get_lyrics', { path });
      const trackUrl = (currentTrack as any)?.url;
      const isCurrent = pathsEqual(playbackCurrent, path)
        || pathsEqual(currentTrack?.path, path)
        || (typeof trackUrl === 'string' && trackUrl ? pathsEqual(trackUrl, path) : false);
      if (isCurrent) {
        if (Array.isArray(lines)) set({ lyrics: sortLyricLines(lines), lyricStatus: 'found' });
      }
    } catch (e) { console.error(e); }
  },

  autoFetchLyricsOnline: async (track: any) => {
    if (!track || !track.title) return;
    if (get().appMode === 'local') {
      if (get().lyrics.length === 0) {
        set({ lyricStatus: 'not_found' });
      }
      return;
    }

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
          if (r.source === 'BiniLyrics' || r.source === 'Better Lyrics' || r.source === 'Unison' || r.source === 'Kugou' || hasWordTiming) {
            syncBonus = 0.40;
          } else if (r.synced || raw.includes('[')) {
            syncBonus = 0.15;
          }

          // Provider cascade priority bonus: BiniLyrics / Better Lyrics / Unison (1) > Kugou (2) > QQMusic (3) > LRCLIB (4) > NetEase (5 - last choice)
          let sourceBonus = 0.0;
          if (r.source === 'BiniLyrics' || r.source === 'Better Lyrics' || r.source === 'Unison') sourceBonus = 0.25;
          else if (r.source === 'Kugou') sourceBonus = 0.20;
          else if (r.source === 'QQMusic') sourceBonus = 0.15;
          else if (r.source === 'LRCLIB') sourceBonus = 0.10;
          else if (r.source === 'NetEase') sourceBonus = 0.0;

          const variantPenalty = getVariantPenalty(targetTitle, r.title);
          const rankBonus = Math.max(0, 0.15 - (index * 0.03));
          const score = (titleScore * 0.5) + (artistScore * 0.3) + durationBonus + syncBonus + sourceBonus + rankBonus + variantPenalty;

          return { result: r, score, titleScore };
        });

        // Filter out results that do not match the title at all
        const validMatches = scoredResults.filter(sr => sr.titleScore > 0);

        let bestMatch = null;
        let lrc = '';
        if (validMatches.length > 0) {
          validMatches.sort((a, b) => b.score - a.score);

          for (const match of validMatches) {
            const candidate = match.result;
            let candidateLrc = candidate.raw_lrc ?? '';
            if (!candidateLrc && (candidate.source === 'BiniLyrics' || candidate.source === 'Better Lyrics' || candidate.source === 'Unison')) {
              candidateLrc = await invoke<string>('get_unison_ttml', {
                song: candidate.title,
                artist: candidate.artist || cleanArtist || undefined,
                album: track.album || undefined,
                duration: candidate.duration || track.duration || undefined,
              }).catch(() => '');
            }
            if (!candidateLrc && candidate.source === 'Kugou' && candidate.content_id) {
              candidateLrc = await invoke<string>('get_kugou_krc', { id: candidate.content_id, accesskey: candidate.id }).catch(() => '');
            }
            if (!candidateLrc && candidate.source === 'QQMusic' && candidate.content_id) {
              candidateLrc = await invoke<string>('get_qqmusic_lrc', { mid: candidate.content_id }).catch(() => '');
            }
            if (!candidateLrc && candidate.source === 'NetEase' && candidate.content_id) {
              candidateLrc = await invoke<string>('get_netease_lrc', { id: candidate.content_id }).catch(() => '');
            }

            if (candidateLrc && candidateLrc.trim().length > 0) {
              bestMatch = candidate;
              lrc = candidateLrc;
              break;
            }
          }

          if (!bestMatch && validMatches.length > 0) {
            bestMatch = validMatches[0].result;
          }
        }

        console.log('[lyrics] query=', query, 'results=', results?.length, 'bestMatch=', bestMatch?.title, 'lrc.len=', lrc?.length);

          if (lrc) {
            await get().saveLyrics(track.path, lrc);

            // Explicitly resolve status so it can never get stuck on 'loading'
            // if saveLyrics' internal read-back guard races with a track change.
            const lines: any = await invoke('get_lyrics', { path: track.path }).catch(() => []);
            const currentTrack = get().currentTrack;
            const playbackCurrent = get().playback.current_track;
            const trackUrl = (currentTrack as any)?.url;
            const stillCurrent = pathsEqual(playbackCurrent, track.path)
              || pathsEqual(currentTrack?.path, track.path)
              || (typeof trackUrl === 'string' && trackUrl ? pathsEqual(trackUrl, track.path) : false);
            if (stillCurrent) {
              if (Array.isArray(lines) && lines.length > 0) {
                set({ lyrics: sortLyricLines(lines), lyricStatus: 'found' });
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

      const currentTrack = get().currentTrack;
      const trackUrl = (currentTrack as any)?.url;
      const isCurrent = pathsEqual(get().playback.current_track, trackPath)
        || pathsEqual(currentTrack?.path, trackPath)
        || (typeof trackUrl === 'string' && trackUrl ? pathsEqual(trackUrl, trackPath) : false);
      if (isCurrent) {
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

      const currentTrack = get().currentTrack;
      const trackUrl = (currentTrack as any)?.url;
      const isCurrent = pathsEqual(get().playback.current_track, trackPath)
        || pathsEqual(currentTrack?.path, trackPath)
        || (typeof trackUrl === 'string' && trackUrl ? pathsEqual(trackUrl, trackPath) : false);
      if (isCurrent) {
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
