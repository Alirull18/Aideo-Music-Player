import { sortAlbumTracks } from '../utils/albumUtils';
import { streamCacheKey, applySourcePreference, cleanSourceContext, isLocalUnifiedTrack, bounded } from '../utils/unifiedSources';
import { manageSourceQueue, cancelSourcePlayback, playbackRequest, playUnifiedTrack } from './sourcePlayback';
import { StateCreator } from 'zustand';
import { PlayerState, Track } from './types';
import { invoke } from '@tauri-apps/api/core';
import { extractDominantColor } from './types';
import { pathsEqual, baseName, parseDuration, parseStreamMetadata, rememberResolvedPath, resolvedPathMap, trackIdToStreamUrl, setOnlineTrackCache, isStreamTrack, isGenericStreamTitle, isGenericStreamArtist, sortLyricLines } from '../utils';
import { chainQueueOperation } from './playbackSlice';
import { safeSetStorage, safeRemoveStorage } from '../utils/storage';
import { pickShuffleIndex, markShufflePlayed } from '../utils/shuffle';
import { notifyTidalAuthFailure } from './tidalSlice';
import { notifyQobuzAuthFailure } from './qobuzSlice';
import { scheduleOsTrackNotification, cancelOsTrackNotification } from '../utils/notifications';
import { feedbackContext, sameRecommendationRecording, rankRecommendations, recommendationAllowed, filterAutomaticQueue, startListening, finishListening, markListeningEnd, invalidateRecommendationPreferences } from '../utils/recommendations';

let isTransitioning = false;
let isSkipping = false;
let autoplayReqSeq = 0;
let localAttemptSequence = 0;
let historyTransitionSequence = 0;
let mixRequestSequence = 0;

let metadataFetchSeq = 0;

const fetchTrackMetadataAndLyrics = async (
  track: Track,
  set: any,
  get: any,
  isOnline: boolean
) => {
  const seq = ++metadataFetchSeq;
  const path = track.path;
  const isCurrent = () => seq === metadataFetchSeq && (pathsEqual(get().playback.current_track, path) || pathsEqual(get().currentTrack?.path, path));

  if (track.cover_url) {
    if (track.cover_url.startsWith('http://') || track.cover_url.startsWith('https://')) {
      invoke('get_cover_art', { path: track.cover_url }).then(async (art: any) => {
        if (!isCurrent()) return;
        if (art && typeof art === 'string') {
          set({ coverArt: art });
          try {
            const color = await extractDominantColor(art);
            if (isCurrent()) set({ accentColor: color });
          } catch (_) {}
          invoke('update_media_metadata', {
            title: track.title || path.split(/[\\/]/).pop(),
            artist: track.artist || 'Unknown Artist',
            album: track.album || '',
            coverUrl: art,
            duration: track.duration || 0,
          }).catch(() => {});
        } else {
          // Fallback to local cover if online retrieval returned null/empty and it is a local path
          if (!path.startsWith('http://') && !path.startsWith('https://')) {
            invoke('get_cover_art', { path }).then(async (localArt: any) => {
              if (!isCurrent()) return;
              if (localArt && typeof localArt === 'string') {
                set({ coverArt: localArt });
                try {
                  const color = await extractDominantColor(localArt);
                  if (isCurrent()) set({ accentColor: color });
                } catch (_) {}
                invoke('update_media_metadata', {
                  title: track.title || path.split(/[\\/]/).pop(),
                  artist: track.artist || 'Unknown Artist',
                  album: track.album || '',
                  coverUrl: localArt,
                  duration: track.duration || 0,
                }).catch(() => {});
              }
            }).catch(() => {});
          }
        }
      }).catch(() => {
        // Fallback to local cover on connection failure/error
        if (!path.startsWith('http://') && !path.startsWith('https://')) {
          invoke('get_cover_art', { path }).then(async (localArt: any) => {
            if (!isCurrent()) return;
            if (localArt && typeof localArt === 'string') {
              set({ coverArt: localArt });
              try {
                const color = await extractDominantColor(localArt);
                if (isCurrent()) set({ accentColor: color });
              } catch (_) {}
              invoke('update_media_metadata', {
                title: track.title || path.split(/[\\/]/).pop(),
                artist: track.artist || 'Unknown Artist',
                album: track.album || '',
                coverUrl: localArt,
                duration: track.duration || 0,
              }).catch(() => {});
            }
          }).catch(() => {});
        }
      });
    } else {
      extractDominantColor(track.cover_url).then((color) => {
        if (isCurrent()) set({ accentColor: color });
      }).catch(() => {});
    }
  }

  invoke('update_media_metadata', {
    title: track.title || path.split(/[\\/]/).pop(),
    artist: track.artist || 'Unknown Artist',
    album: track.album || '',
    coverUrl: track.cover_url || get().coverArt || null,
    duration: track.duration || 0,
  }).catch(() => { });

  if (isCurrent()) {
    get().updateDiscordPresence();
  }

  if (!isOnline && !track.cover_url) {
    invoke('get_cover_art', { path }).then(async (art: any) => {
      if (!isCurrent()) return;
      if (art && typeof art === 'string') {
        set({ coverArt: art });
        try {
          const color = await extractDominantColor(art);
          if (isCurrent()) set({ accentColor: color });
        } catch (_) { }
        invoke('update_media_metadata', {
          title: track.title || path.split(/[\\/]/).pop(),
          artist: track.artist || 'Unknown Artist',
          album: track.album || '',
          coverUrl: art,
          duration: track.duration || 0,
        }).catch(() => { });
      } else {
        set({ coverArt: null, accentColor: '#8b5cf6' });
      }
    }).catch(() => {
      if (isCurrent()) {
        set({ coverArt: null, accentColor: '#8b5cf6' });
      }
    });
  }

  invoke('get_lyrics', { path }).then((lrc: any) => {
    if (!isCurrent()) return;
    if (Array.isArray(lrc) && lrc.length > 0) {
      set({ lyrics: sortLyricLines(lrc), lyricStatus: 'found' });
      const hasWordSync = lrc.some((l: any) => l.words && l.words.length > 0);
      if (!hasWordSync && isCurrent()) {
        get().autoFetchLyricsOnline(track);
      }
    } else {
      if (isCurrent()) get().autoFetchLyricsOnline(track);
    }
  }).catch(() => {
    if (isCurrent()) get().autoFetchLyricsOnline(track);
  });
};

export const createLibrarySlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  tracks: [],
  currentTrackIndex: -1,
  currentTrack: (() => {
    try {
      let saved = JSON.parse(localStorage.getItem('aideo_current_track') || 'null');
      if (saved) {
        if (saved.title === 'Web Audio Stream' || saved.artist === 'Web Stream') {
          const history: any[] = JSON.parse(localStorage.getItem('aideo_play_history') || '[]');
          const realTrack = history.slice().reverse().find(t => t && typeof t === 'object' && t.title && t.title !== 'Web Audio Stream' && t.artist !== 'Web Stream');
          if (realTrack) {
            saved = realTrack;
          }
        }

        const isYt = saved.path && (saved.path.includes('youtube.com') || saved.path.includes('youtu.be') || saved.path.includes('googlevideo.com'));
        if (isYt && (!saved.format || saved.format.toUpperCase() === 'URL')) {
          saved.format = 'YouTube Direct';
        }

        if (saved.path && (saved.format === 'URL' || !saved.duration || !saved.cover_url)) {
          const meta = parseStreamMetadata(saved.path);
          if (meta.title && !isGenericStreamTitle(meta.title) && isGenericStreamTitle(saved.title)) {
            saved.title = meta.title;
          }
          if (meta.artist && !isGenericStreamArtist(meta.artist) && (isGenericStreamArtist(saved.artist) || !saved.artist)) {
            saved.artist = meta.artist;
          }
          if (!saved.duration && meta.duration) {
            saved.duration = meta.duration;
          }
          if (!saved.cover_url && meta.cover_url) {
            saved.cover_url = meta.cover_url;
          }
          if ((!saved.format || saved.format === 'URL') && meta.format) {
            saved.format = meta.format;
          }
        }

        localStorage.setItem('aideo_current_track', JSON.stringify(saved));
        return saved;
      }
      return null;
    } catch {
      return null;
    }
  })(),
  shuffle: false,
  repeat: (localStorage.getItem('aideo_repeat') as 'none' | 'all' | 'one') || 'none',
  currentHistoryId: null,
  autoplayEnabled: localStorage.getItem('aideo_autoplay') !== 'false',
  resumePosition: (() => {
    try {
      const savedTrack = localStorage.getItem('aideo_current_track');
      if (!savedTrack) return 0;
      const pos = parseInt(localStorage.getItem('aideo_resume_position') || '0');
      const tr = JSON.parse(savedTrack);
      // Only meaningful if the position is at least 30s into a track with room left to play
      if (!isNaN(pos) && pos >= 30 && (!tr.duration || pos < tr.duration - 10)) return pos;
      return 0;
    } catch {
      return 0;
    }
  })(),
  autoplayDiscoveryLevel: (localStorage.getItem('aideo_autoplay_discovery_level') as 'familiarity' | 'balanced' | 'discovery') || 'balanced',
  recommendationEngine: (() => {
    const saved = localStorage.getItem('aideo_recommendation_engine');
    return (saved === 'youtube' || saved === 'tidal' || saved === 'our') ? saved : 'our';
  })(),
  autoplaySeedTrack: null,
  autoplaySessionHistory: [],
  recentlyClearedAutoplayPaths: [],
  cacheSizeLimit: (() => {
    const val = localStorage.getItem('aideo_cache_size_limit');
    return val ? Number(val) : 5.0;
  })(),
  playHistory: (() => {
    try {
      const raw = JSON.parse(localStorage.getItem('aideo_play_history') || '[]');
      return raw.map((item: any) => {
        if (typeof item === 'string') {
          const isOnline = item.startsWith('http://') || item.startsWith('https://');
          const meta = isOnline ? parseStreamMetadata(item) : { title: baseName(item), artist: '—', album: '' };
          return {
            id: -9999,
            path: item,
            title: meta.title,
            artist: meta.artist,
            duration: null,
            format: isOnline ? 'URL' : 'MP3/FLAC',
            lyric_offset: 0
          } as Track;
        }
        if (item && typeof item === 'object') {
          if (item.title === 'Watch (youtube.com)') {
            item.title = 'Web Audio Stream';
            item.artist = 'Web Stream';
          }
        }
        return item;
      });
    } catch (e) {
      return [];
    }
  })(),
  playCounts: JSON.parse(localStorage.getItem('aideo_play_counts') || '{}'),
  scanDirs: JSON.parse(localStorage.getItem('aideo_scan_dirs') || '[]'),
  scanStatus: '',
  librarySearchQuery: '',
  setLibrarySearchQuery: (query: string) => set({ librarySearchQuery: query }),
  playlists: [],
  currentPlaylist: null,
  cachedCloudHashes: [],

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
    if (localStorage.getItem('aideo_local_restore_sync') === 'restoring') throw new Error('Library maintenance is in progress');
    const dirs = get().scanDirs;
    if (dirs.length === 0) { set({ scanStatus: 'Add a folder first' }); return; }
    set({ scanStatus: 'Scanning...' });
    try {
      const existence: boolean[] = await invoke('check_files_exist', { paths: dirs });
      const missingDirs: string[] = [];
      dirs.forEach((dir, idx) => {
        if (!existence[idx]) {
          missingDirs.push(dir);
        }
      });

      if (missingDirs.length > 0) {
        missingDirs.forEach(dir => {
          window.dispatchEvent(new CustomEvent('ui-toast', { 
            detail: { message: `Folder not found: ${dir}. Please re-add it.`, type: 'warning' } 
          }));
        });
      }

      const count: number = await invoke('scan_and_save', { dirs });
      await get().loadLibrary();
      set({ scanStatus: `Found ${count} tracks` });
      invoke('sync_watch_folders', { dirs }).catch(console.error);
    } catch (e: any) { set({ scanStatus: 'Scan failed: ' + e }); }
  },

  loadLibrary: async () => {
    try {
      const library: Track[] = await invoke('get_library');
      const saved: Track[] = await invoke<Track[]>('get_unified_favorites').catch(() => [] as Track[]);
      const tracks = [...library.map(applySourcePreference), ...(saved || []).map(applySourcePreference)];
      set({ tracks });
      invoke('sync_watch_folders', { dirs: get().scanDirs }).catch(console.error);
      get().fetchSmartPlaylists().catch(console.error);

      // Synchronize currently playing track tags instantly
      const current = get().currentTrack;
      if (current && !current.source_context) {
        const updatedTrack = tracks.find(t => pathsEqual(t.path, current.path));
        if (updatedTrack) {
          set({ currentTrack: updatedTrack });
        }
      }
      if (current && !get().coverArt && !current.cover_url && current.path && !current.path.startsWith('http://') && !current.path.startsWith('https://')) {
        invoke<string | null>('get_cover_art', { path: current.path }).then(async (art) => {
          if (art && typeof art === 'string') {
            set({ coverArt: art });
            try {
              const color = await extractDominantColor(art);
              set({ accentColor: color });
            } catch (_) {}
          }
        }).catch(() => {});
      }

      // Synchronize queued tracks tags instantly
      const currentQueue = get().queue;
      if (currentQueue.length > 0) {
        const updatedQueue = currentQueue.map(q => {
          if (q.source_context) return q;
          const matched = tracks.find(t => pathsEqual(t.path, q.path));
          return matched ? { ...q, title: matched.title, artist: matched.artist, album: matched.album } : q;
        });
        set({ queue: updatedQueue });
      }
    } catch (e) { console.error('loadLibrary:', e); }
  },

  deleteTrack: async (trackPath: string) => {
    try {
      await invoke('delete_track', { path: trackPath });
      set((state) => ({
        tracks: state.tracks.filter((t) => !pathsEqual(t.path, trackPath)),
        queue: state.queue.filter((t) => !pathsEqual(t.path, trackPath)),
      }));
      await get().loadLibrary();
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Track deleted permanently', type: 'success' } }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Delete failed: ${err}`, type: 'error' } }));
      throw err;
    }
  },

  recordPlaybackTransition: async (newTrack: Track | null, playbackSource?: string) => {
    const transition = ++historyTransitionSequence;
    const prevHistoryId = get().currentHistoryId;
    if (prevHistoryId !== null) {
      set({ currentHistoryId: null });
      const observation = finishListening(prevHistoryId);
      await invoke('log_playback_end', {
        historyId: prevHistoryId, durationPlayed: observation.seconds,
        skipped: observation.reason === 'skipped', completionRate: null, endReason: observation.reason,
      }).then(() => window.dispatchEvent(new Event('playback-history-updated')))
        .catch(e => console.error('Failed to log listening:', e));
    }

    if (transition !== historyTransitionSequence) return;

    if (newTrack) {
      const currentHistory = get().autoplaySessionHistory || [];
      if (!currentHistory.some(t => t.path === newTrack.path)) {
        set({ autoplaySessionHistory: [...currentHistory, newTrack] });
      }
      try {
        const pb = get().playback;
        const sampleRate = pb.file_rate || pb.effective_audio_path?.source?.sample_rate || null;
        const bitDepth = pb.effective_audio_path?.source?.bits_per_sample || pb.effective_audio_path?.source?.valid_bits_per_sample || null;
        const bitPerfect = pb.bit_perfect ? 1 : 0;

        const id = await invoke<number>('log_playback_start', {
          path: newTrack.path,
          title: newTrack.title || null,
          artist: newTrack.artist || null,
          album: newTrack.album || null,
          duration: newTrack.duration || null,
          format: newTrack.format || null,
          genre: newTrack.genre || null,
          playbackSource: playbackSource || null,
          sampleRate,
          bitDepth,
          bitPerfect,
          track: newTrack, recordingEvidence: newTrack.recording_evidence || null,
          sourceContext: feedbackContext(newTrack), origin: newTrack.is_autoplay ? 'radio' : newTrack.is_generated_mix ? 'mix' : 'manual',
        });
        if (transition !== historyTransitionSequence) {
          await invoke('log_playback_end', { historyId: id, durationPlayed: 0, skipped: false, completionRate: null, endReason: 'error' });
          return;
        }
        startListening(id, newTrack);
        set({ currentHistoryId: id });
        window.dispatchEvent(new Event('playback-history-updated'));
      } catch (e) {
        console.error("Failed to log playback start:", e);
      }
    }
  },

  playTrack: async (track: Track, isHistory?: boolean, forceResetAutoplay = true, playbackSource?: string, startPos?: number, preservePlaybackSession = false) => {
    if (!track) return;
    if (!preservePlaybackSession) ++historyTransitionSequence;
    if (localStorage.getItem('aideo_local_restore_sync') === 'restoring') throw new Error('Library maintenance is in progress');
    if (!preservePlaybackSession && forceResetAutoplay) {
      if (get().albumSession) await get().cancelAlbumSession();
      else if (get().stopBoundary) await get().cancelStopAfter();
    }
    if (!preservePlaybackSession) get().dismissPlaybackRecovery();
    const requestedQuality = get().streamingQuality;
    if (!preservePlaybackSession) markListeningEnd('skipped');
    track = applySourcePreference(track);
    cancelSourcePlayback();
    if (get().playback.status === 'Playing') {
      invoke('pause_track').catch(() => {});
    }
    const request = playbackRequest();
    if (track.source_context) return playUnifiedTrack(set, get, track, isHistory, forceResetAutoplay, startPos, preservePlaybackSession);
    set(s => ({ currentAttemptId: undefined, playback: { ...s.playback, attempt_id: undefined } }));
    const isCurrentRequest = () => request === playbackRequest();
    if (get().albumSession) {
      await manageSourceQueue(set);
    } else if (forceResetAutoplay && get().sourceQueueManaged) {
      await invoke('set_source_queue_mode', { enabled: false });
      set({ sourceQueueManaged: false });
    } else if (!forceResetAutoplay && get().queue.some(t => t.source_context && !isLocalUnifiedTrack(t))) {
      await manageSourceQueue(set);
    } else if (get().sourceQueueManaged && !get().queue.some(t => t.source_context && !isLocalUnifiedTrack(t))) {
      await invoke('set_source_queue_mode', { enabled: false });
      set({ sourceQueueManaged: false });
      await get().initializeQueue();
    }
    if (!isCurrentRequest()) return;
    if (forceResetAutoplay) {
      set({ 
        autoplaySeedTrack: track,
        autoplaySessionHistory: [track]
      });
    }
    
    const isOnline = isStreamTrack(track.path, track.format);
    if (isOnline && get().appMode === 'local') {
      const msg = 'Online playback is disabled in Local File Only Mode.';
      set({ playbackError: msg });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: msg, type: 'warning' } }));
      return;
    }
    if (isOnline) {
      set({
        playback: {
          ...get().playback,
          is_buffering: true,
          status: 'Playing',
          current_track: track.path,
          position_secs: startPos || 0,
          backend_position_secs: 0,
        }
      });
    }
    let isCached = false;
    if (isOnline) {
      try {
        let lookupUrl = track.path;
        if (track.format === 'Tidal FLAC' || track.format === 'Qobuz FLAC') {
          const cachedResolved = trackIdToStreamUrl.get(streamCacheKey(track, requestedQuality));
          if (cachedResolved) lookupUrl = cachedResolved.url;
        }
        isCached = await invoke<boolean>('check_url_is_cached', { url: lookupUrl });
      } catch (err) {
        console.error('Failed to check if track is cached:', err);
      }
    }

    if (isOnline && !isCached && typeof navigator !== 'undefined' && !navigator.onLine) {
      console.warn('[stream] navigator.onLine reported false; continuing playback attempt via native backend.');
    }

    try {
      if (!isCurrentRequest()) return;
      // Clear queue when starting playback of a new song
      if (forceResetAutoplay) {
        set({ queue: [] });
        localStorage.setItem('aideo_queue', JSON.stringify([]));
        await chainQueueOperation(async () => {
          await invoke('clear_queue').catch(console.error);
        });
      }
      await get().recordPlaybackTransition(track, playbackSource);
      if (!isCurrentRequest()) return;
      const tracks = get().tracks || [];
      const index = tracks.findIndex(t => pathsEqual(t.path, track.path));
      const prevTrack = get().currentTrack;
      const history = prevTrack && !isHistory ? [...(get().playHistory || []), prevTrack].slice(-200) : (get().playHistory || []);
      localStorage.setItem('aideo_play_history', JSON.stringify(history));

      markShufflePlayed(track.path);

      const isHttpUrl = track.path.startsWith('http://') || track.path.startsWith('https://');
      if (isHttpUrl) {
        setOnlineTrackCache(track.path, track);
      }

      localStorage.setItem('aideo_current_track', JSON.stringify(track));
      if (startPos && startPos > 0) {
        safeSetStorage('aideo_resume_position', String(Math.floor(startPos)));
      } else {
        localStorage.removeItem('aideo_resume_position');
      }

      set({
        currentTrackIndex: index,
        currentTrack: track,
        playHistory: history,
        lyricOffset: track.lyric_offset || 0,
        lyrics: [],
        lyricStatus: 'loading',
        coverArt: track.cover_url || null,
        accentColor: '#8b5cf6',
        scrobbledCurrent: false,
        playback: {
          ...get().playback,
          current_track: track.path,
          status: 'Playing',
          position_secs: startPos || 0,
          backend_position_secs: 0,
          effective_audio_path: null,
          file_rate: undefined,
          file_ch: undefined,
          file_format: null,
          dev_rate: 0,
          is_buffering: !get().chromecast_connected && !get().upnp_connected,
          last_skip_time: Date.now()
        },
      });

      if (!track.cover_url && !isOnline && track.path) {
        invoke<string | null>('get_cover_art', { path: track.path }).then(async (art) => {
          if (!isCurrentRequest()) return;
          if (art && typeof art === 'string') {
            set({ coverArt: art });
            try {
              const color = await extractDominantColor(art);
              if (isCurrentRequest()) set({ accentColor: color });
            } catch (_) {}
            invoke('update_media_metadata', {
              title: track.title || track.path.split(/[\\/]/).pop(),
              artist: track.artist || 'Unknown Artist',
              album: track.album || '',
              coverUrl: art,
              duration: track.duration || 0,
            }).catch(() => {});
          }
        }).catch(() => {});
      }

      invoke('update_media_metadata', {
        title: track.title || track.path.split(/[\\/]/).pop(),
        artist: track.artist || 'Unknown Artist',
        album: track.album || '',
        coverUrl: track.cover_url || get().coverArt || null,
        duration: track.duration || 0,
      }).catch(() => { });

      if (isOnline) {
        window.dispatchEvent(new CustomEvent('ui-stream-buffering', {
          detail: { active: true, title: track.title || 'Unknown Title', artist: track.artist || 'Unknown Artist' }
        }));
      }

      let finalPath = track.path;
      const isCloudProvider = track.format === 'Tidal FLAC' || track.format === 'Qobuz FLAC';
      const originalTrackId = resolvedPathMap.get(track.path);
      const effectiveTrackId = (!track.path.startsWith('http://') && !track.path.startsWith('https://')) ? track.path : originalTrackId;
      if (isCloudProvider && effectiveTrackId) {
        try {
          const cachedResolved = trackIdToStreamUrl.get(streamCacheKey(track, requestedQuality, effectiveTrackId));
          // Only reuse cached stream URL if resolved within 30 seconds (prevent using expired CDN tokens)
          if (cachedResolved && (Date.now() - cachedResolved.resolvedAt < 30 * 1000)) {
            finalPath = cachedResolved.url;
            console.log('[Streaming] Using fresh pre-resolved stream URL for track:', track.title);
          } else {
            const resolver = track.format === 'Qobuz FLAC' ? 'qobuz_get_stream_url' : 'tidal_get_stream_url';
            finalPath = await invoke<string>(resolver, { trackId: effectiveTrackId, requestedQuality });
            trackIdToStreamUrl.set(streamCacheKey(track, requestedQuality, effectiveTrackId), { url: finalPath, resolvedAt: Date.now() });
          }
          rememberResolvedPath(finalPath, effectiveTrackId);
        } catch (e) {
          trackIdToStreamUrl.delete(streamCacheKey(track, requestedQuality, effectiveTrackId));
          if (!isCurrentRequest()) return;
          console.error('Failed to resolve streaming URL in playTrack:', e);
          const notified = (track.format === 'Tidal FLAC' && notifyTidalAuthFailure(e, set)) ||
                           (track.format === 'Qobuz FLAC' && notifyQobuzAuthFailure(e, set));
          if (!notified) {
            window.dispatchEvent(new CustomEvent('ui-toast', {
              detail: { message: `Failed to load ${track.format} stream: ${e}`, type: 'error' }
            }));
          }
          set(s => ({
            playback: {
              ...s.playback,
              status: 'Stopped',
              is_buffering: false,
              current_track: null,
            }
          }));
          return;
        }
      }

      if ((track.format === 'Tidal FLAC' || track.format === 'Qobuz FLAC') && !finalPath.startsWith('http://') && !finalPath.startsWith('https://')) {
        console.error('Aborting playback: stream URL unresolved for', track.title);
        set(s => ({
          playback: {
            ...s.playback,
            status: 'Stopped',
            is_buffering: false,
            current_track: null,
          }
        }));
        return;
      }
      // Persist real title/artist under the resolved URL so queue rebuilds and
      // track transitions after a restart show the track, not the raw hostname.
      if (finalPath !== track.path && (finalPath.startsWith('http://') || finalPath.startsWith('https://'))) {
        setOnlineTrackCache(finalPath, track);
      }

      if (!isCurrentRequest()) return;
      if (get().chromecast_connected) {
        const title = track.title || 'Unknown Track';
        const artist = track.artist || 'Unknown Artist';
        const ext = finalPath.split('.').pop()?.split('?')[0].toLowerCase();
        let mime = 'audio/mpeg';
        if (ext === 'flac') mime = 'audio/flac';
        else if (ext === 'm4a' || ext === 'mp4') mime = 'audio/mp4';
        else if (ext === 'wav') mime = 'audio/wav';
        else if (ext === 'ogg') mime = 'audio/ogg';
        
        try {
          await invoke('chromecast_play', {
            path: finalPath,
            title,
            artist,
            contentType: mime,
            coverUrl: track.cover_url || null,
            duration: track.duration || null,
            startTime: startPos || 0.0
          });
        } catch (e) {
          console.error('Chromecast playTrack error:', e);
          set(s => ({
            playback: {
              ...s.playback,
              status: 'Stopped',
              current_track: null,
              position_secs: 0
            },
            currentTrack: null
          }));
          window.dispatchEvent(new CustomEvent('ui-toast', {
            detail: { message: `Casting failed: ${e}`, type: 'error' }
          }));
          return;
        }
      } else if (get().upnp_connected) {
        const title = track.title || 'Unknown Track';
        const artist = track.artist || 'Unknown Artist';
        const album = track.album || 'Unknown Album';
        try {
          await invoke('upnp_play', {
            path: finalPath,
            title,
            artist,
            album,
            coverUrl: track.cover_url || null
          });
          if (startPos && startPos > 0) await invoke('upnp_control', { action: 'seek', value: startPos });
        } catch (e) {
          console.error('UPnP playTrack error:', e);
          set(s => ({
            playback: {
              ...s.playback,
              status: 'Stopped',
              current_track: null,
              position_secs: 0
            },
            currentTrack: null
          }));
          window.dispatchEvent(new CustomEvent('ui-toast', {
            detail: { message: `UPnP casting failed: ${e}`, type: 'error' }
          }));
          return;
        }
      } else {
        const attemptId = `local_attempt_${Date.now()}_${++localAttemptSequence}`;
        set(s => ({ currentAttemptId: attemptId, playback: { ...s.playback, attempt_id: attemptId } }));
        if (get().stopBoundary?.kind === 'track') await invoke('set_stop_after_path', { path: finalPath });
        if (!isCurrentRequest()) return;
        await invoke('play_track', { path: finalPath, startPos: startPos || 0.0, attemptId });
      }
      if (!isCurrentRequest()) return;
      get().triggerAutoplayRadio(track, forceResetAutoplay);

      // Filter out autoplay recommendations from the queue if autoplay is disabled
      if (!get().autoplayEnabled) {
        const currentQueue = get().queue;
        const filtered = currentQueue.filter(t => !t.is_autoplay);
        if (filtered.length !== currentQueue.length) {
          set({ queue: filtered });
          localStorage.setItem('aideo_queue', JSON.stringify(filtered));
          invoke('clear_queue').then(() => {
            if (filtered.length > 0) {
              const paths = filtered.map(t => t.path);
              invoke('add_to_queue_bulk', { paths }).catch(console.error);
            }
          }).catch(console.error);
        }
      }

      // 🚀 Background Pre-caching manager for the next 2 tracks
      setTimeout(() => {
        get().preCacheNextTracks().catch(console.error);
      }, 500);

      // OS notification on track change (useful while minimized to tray or running in background)
      const osNotificationsEnabled = get().osTrackNotificationsEnabled ?? get().notificationsEnabled;
      const osBackgroundOnly = get().osNotifyBackgroundOnly ?? true;

      if (osNotificationsEnabled && !isHistory) {
        scheduleOsTrackNotification(track, {
          enabled: osNotificationsEnabled,
          backgroundOnly: osBackgroundOnly,
        });
      }

      await fetchTrackMetadataAndLyrics(track, set, get, isOnline || track.format === 'Tidal FLAC' || track.format === 'Qobuz FLAC');

    } catch (e) {
      cancelOsTrackNotification();
      if (!isCurrentRequest()) return;
      console.error('playTrack error:', e);
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Playback failed: ${e}`, type: 'error' }
      }));
      
      get().reportPlaybackFailure(String(e), track, startPos ?? get().playback.position_secs);
      return;
    }

    const state = get();
    if (state.queue.length > 0) {
      await get().syncBackendQueue();
    }
    get().updateDiscordPresence();
  },

  resumeLastSession: async () => {
    const saved = get().currentTrack;
    if (!saved || !saved.path) return false;
    const pos = get().resumePosition || 0;
    // Resolve the freshest track object (library entry, queue entry, or saved copy)
    let track: Track | undefined = saved.source_context ? applySourcePreference(saved) : get().tracks.find(t => pathsEqual(t.path, saved.path));
    if (!track) track = get().queue.find(t => pathsEqual(t.path, saved.path));
    if (!track) track = saved;
    await get().playTrack(track, undefined, !get().albumSession, undefined, pos > 0 ? pos : undefined);
    set({ resumePosition: 0 });
    safeRemoveStorage('aideo_resume_position');
    return true;
  },

  dismissResumePrompt: () => {
    set({ resumePosition: 0 });
    safeRemoveStorage('aideo_resume_position');
  },

  handleNativeTrackTransition: async (path: string, attemptId: string) => {
    if (!path || typeof path !== 'string') return;
    set(s => ({
      currentAttemptId: attemptId,
      playback: {
        ...s.playback,
        attempt_id: attemptId,
        current_track: path,
      }
    }));
    const currentQueue = get().queue;
    if (currentQueue.length > 0 && pathsEqual(currentQueue[0]?.path, path)) {
      const newQueue = currentQueue.slice(1);
      set({ queue: newQueue });
      localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
    }
    await get().handleTrackTransition(path);
    await get().syncBackendQueue();
  },

  handleTrackTransition: async (path: string) => {
    if (!path || typeof path !== 'string') return;
    if (isTransitioning) return;
    isTransitioning = true;
    try {
      const state = get();
      const isCurrentOnline = path.startsWith('http://') || path.startsWith('https://');
      const activeTracks = isCurrentOnline
        ? state.tracks.filter(t => isStreamTrack(t.path, t.format))
        : state.tracks.filter(t => !isStreamTrack(t.path, t.format));
      const index = activeTracks.findIndex(t => pathsEqual(t.path, path));
      let track = index !== -1 ? activeTracks[index] : null;

      // Check active queue for metadata if it is an online track
      if (!track) {
        track = state.queue.find(t => pathsEqual(t.path, path)) || null;
      }

      // Check currentTrack first if it matches
      if (!track && state.currentTrack && pathsEqual(state.currentTrack.path, path)) {
        track = { ...state.currentTrack, path };
      }

      // Check playHistory
      if (!track) {
        track = state.playHistory.slice().reverse().find(t => t && pathsEqual(t.path, path) && t.title && t.title !== 'Web Audio Stream') || null;
      }

      // Construct high-fidelity virtual Track object as fallback to ensure seek bar work
      if (!track) {
        const isOnline = path.startsWith('http://') || path.startsWith('https://');
        const meta = isOnline ? parseStreamMetadata(path) : { title: baseName(path), artist: '—', album: '', duration: null, format: 'MP3/FLAC', cover_url: null };
        const isYt = path.includes('youtube.com') || path.includes('youtu.be') || path.includes('googlevideo.com');
        const defaultFormat = isYt ? 'YouTube Direct' : (isOnline ? 'URL' : 'MP3/FLAC');
        track = {
          id: -9999,
          path,
          title: meta.title,
          artist: meta.artist,
          duration: meta.duration ?? null,
          format: meta.format || defaultFormat,
          cover_url: meta.cover_url || null,
          lyric_offset: 0
        };
      }

      const prevTrack = state.currentTrack;
      const history = prevTrack ? [...state.playHistory, prevTrack].slice(-200) : state.playHistory;
      localStorage.setItem('aideo_play_history', JSON.stringify(history));

      // Log the transition in SQLite so autoplayed tracks correctly appear in playback history!
      await get().recordPlaybackTransition(track, 'autoplay');

      const isOnline = path.startsWith('http://') || path.startsWith('https://');

      if (track && track.title && track.title !== 'Web Audio Stream') {
        if (state.currentTrack && pathsEqual(state.currentTrack.path, track.path)) {
          if (!track.duration && state.currentTrack.duration) track.duration = state.currentTrack.duration;
          if (!track.cover_url && state.currentTrack.cover_url) track.cover_url = state.currentTrack.cover_url;
          if ((!track.format || track.format === 'URL') && state.currentTrack.format && state.currentTrack.format !== 'URL') {
            track.format = state.currentTrack.format;
          }
        }
        localStorage.setItem('aideo_current_track', JSON.stringify(track));
      }

      set({
        currentTrackIndex: index,
        currentTrack: track,
        playHistory: history,
        lyricOffset: track?.lyric_offset || 0,
        lyrics: [],
        lyricStatus: 'loading',
        coverArt: track?.cover_url || null,
        accentColor: '#8b5cf6',
        scrobbledCurrent: false,
        playback: { ...get().playback, current_track: path, status: 'Playing', position_secs: 0, last_skip_time: Date.now() },
      });
      get().updateDiscordPresence();

      if (track) {
        await fetchTrackMetadataAndLyrics(track, set, get, isOnline);
        get().triggerAutoplayRadio(track, false);

        // 🚀 Background Pre-caching manager for the next 2 tracks
        setTimeout(() => {
          get().preCacheNextTracks().catch(console.error);
        }, 500);
      }

      await get().fetchQueue();
      if (get().queue.length > 0) await get().syncBackendQueue();
    } finally {
      isTransitioning = false;
    }
  },

  playAlbumToEnd: async (tracks: Track[], title: string) => {
    if (!tracks.length) return;
    if (get().chromecast_connected || get().upnp_connected) throw new Error('Album end stopping is unavailable on remote output');
    await get().cancelStopAfter();
    const session = { title, tracks: sortAlbumTracks(tracks), index: 0 };
    set({ albumSession: session });
    safeSetStorage('aideo_album_session', JSON.stringify(session));
    // ponytail: mixed albums advance through the existing frontend queue policy; native album gapless needs session-correlated reservations.
    await manageSourceQueue(set);
    await get().playTrack(session.tracks[0], undefined, false);
  },

  cancelAlbumSession: async () => {
    set({ albumSession: null });
    safeRemoveStorage('aideo_album_session');
    await get().cancelStopAfter();
    if (!get().queue.some(t => t.source_context && !isLocalUnifiedTrack(t))) {
      await invoke('set_source_queue_mode', { enabled: false });
      set({ sourceQueueManaged: false });
    }
    await get().syncBackendQueue();
  },

  playNext: async () => {
    if (get().stopBoundary?.kind === 'track') await get().cancelStopAfter();
    const album = get().albumSession;
    if (album) {
      if (album.index + 1 >= album.tracks.length) { await get().fulfillStopBoundary(); return; }
      const next = { ...album, index: album.index + 1 };
      set({ albumSession: next });
      safeSetStorage('aideo_album_session', JSON.stringify(next));
      await get().playTrack(next.tracks[next.index], undefined, false);
      return;
    }
    if (get().stopBoundary?.kind === 'track') await get().cancelStopAfter();
    if (isSkipping) return;
    cancelSourcePlayback();
    isSkipping = true;
    try {
      const { tracks, shuffle, repeat, queue, playFromQueue, playTrack, currentTrack } = get();

      // Repeat One: replay current track immediately if no explicit manual track is next in queue
      if (repeat === 'one' && currentTrack && (queue.length === 0 || queue[0]?.is_autoplay)) {
        await playTrack(currentTrack, true, false);
        return;
      }

      // Manual queue priority
      if (queue.length > 0) {
         await playFromQueue(0);
         return;
      }

      // Repeat One: replay current track immediately
      if (repeat === 'one' && currentTrack) {
        await playTrack(currentTrack, true, false);
        return;
      }

      if (get().autoplayEnabled && currentTrack) {
        const attempt = get().currentAttemptId;
        await get().triggerAutoplayRadio(currentTrack, false);
        if (attempt !== get().currentAttemptId || currentTrack.path !== get().currentTrack?.path) return;
        if (get().queue.length > 0) {
          await playFromQueue(0);
          return;
        }
        await get().stopTrack();
        return;
      }

      if (get().currentPlaylist && tracks.length) {
        const currentIndex = tracks.findIndex(t => currentTrack?.playlist_entry_id !== undefined ? t.playlist_entry_id === currentTrack.playlist_entry_id : t.path === currentTrack?.path);
        const nextIndex = shuffle ? pickShuffleIndex(tracks.map(t => String(t.playlist_entry_id ?? t.path)), currentIndex) : currentIndex + 1;
        if (nextIndex >= tracks.length && repeat === 'none') { await get().stopTrack(); return; }
        await playTrack(tracks[nextIndex % tracks.length], false, false);
        return;
      }
      const isCurrentTrackOnline = currentTrack ? isStreamTrack(currentTrack.path, currentTrack.format) : false;
      if (isCurrentTrackOnline && localStorage.getItem('aideo_autoplay_local_for_cloud') !== 'true') {
        await get().stopTrack();
        return;
      }

      const isCurrentOnline = currentTrack ? isStreamTrack(currentTrack.path, currentTrack.format) : false;
      const activeTracks = isCurrentOnline
        ? tracks.filter(t => isStreamTrack(t.path, t.format))
        : tracks.filter(t => !isStreamTrack(t.path, t.format));

      if (activeTracks.length === 0) return;

      const currentActiveIdx = activeTracks.findIndex(t => pathsEqual(t.path, currentTrack?.path || ''));

      if (shuffle) {
        const nextIndex = pickShuffleIndex(activeTracks.map(t => t.path), currentActiveIdx);
        await playTrack(activeTracks[nextIndex], undefined, false);
        return;
      }

      const nextIndex = (currentActiveIdx !== -1 ? currentActiveIdx : -1) + 1;

      if (repeat === 'none' && nextIndex >= activeTracks.length) {
        await get().stopTrack();
        return;
      }

      // Repeat All: wrap around
      await playTrack(activeTracks[nextIndex % activeTracks.length], undefined, false);
    } finally {
      setTimeout(() => {
        isSkipping = false;
      }, 350);
    }
  },

  getNextTrackToPlay: () => {
    const session = get().albumSession;
    if (session) return session.tracks[session.index + 1] ?? null;
    if (get().stopBoundary) return null;
    const { tracks, shuffle, repeat, queue, currentTrack } = get();

    if (repeat === 'one' && currentTrack && (queue.length === 0 || queue[0]?.is_autoplay)) {
      return currentTrack;
    }

    if (queue.length > 0) {
      return queue[0];
    }

    if (repeat === 'one' && currentTrack) {
      return currentTrack;
    }

    const isCurrentOnline = currentTrack ? isStreamTrack(currentTrack.path, currentTrack.format) : false;
    const activeTracks = isCurrentOnline
      ? tracks.filter(t => isStreamTrack(t.path, t.format))
      : tracks.filter(t => !isStreamTrack(t.path, t.format));

    if (activeTracks.length === 0) return null;

    const currentActiveIdx = activeTracks.findIndex(t => pathsEqual(t.path, currentTrack?.path || ''));

    if (shuffle) {
      return null;
    }

    const nextIndex = (currentActiveIdx !== -1 ? currentActiveIdx : -1) + 1;

    if (repeat === 'none' && nextIndex >= activeTracks.length) {
      return null;
    }

    return activeTracks[nextIndex % activeTracks.length];
  },

  getNextTracksToPlay: (count = 2) => {
    const album = get().albumSession;
    if (album) return album.tracks.slice(album.index + 1, album.index + 1 + count);
    if (get().stopBoundary) return [];
    const { tracks, shuffle, repeat, queue, currentTrack } = get();
    const result: Track[] = [];

    // 1. First take from the active queue
    if (queue.length > 0) {
      result.push(...queue.slice(0, count));
    }

    // 2. If we need more tracks, calculate what would play next in sequence
    let remaining = count - result.length;
    if (remaining > 0) {
      if (repeat === 'one' && currentTrack) {
        for (let i = 0; i < remaining; i++) {
          result.push(currentTrack);
        }
      } else {
        const isCurrentOnline = currentTrack ? isStreamTrack(currentTrack.path, currentTrack.format) : false;
        const activeTracks = isCurrentOnline
          ? tracks.filter(t => isStreamTrack(t.path, t.format))
          : tracks.filter(t => !isStreamTrack(t.path, t.format));

        if (activeTracks.length > 0) {
          const currentActiveIdx = activeTracks.findIndex(t => pathsEqual(t.path, currentTrack?.path || ''));
          let nextIndex = (currentActiveIdx !== -1 ? currentActiveIdx : -1) + 1;

          for (let i = 0; i < remaining; i++) {
            if (shuffle) {
              break;
            }
            if (repeat === 'none' && nextIndex >= activeTracks.length) {
              break;
            }
            result.push(activeTracks[nextIndex % activeTracks.length]);
            nextIndex++;
          }
        }
      }
    }
    return result;
  },

  preCacheNextTracks: async () => {
    const requestedQuality = get().streamingQuality;
    const lookaheadEnabled = get().dsp?.lookahead_prebuffer_enabled ?? true;
    if (!lookaheadEnabled) return;

    const nextTracks = get().getNextTracksToPlay(2);
    for (const track of nextTracks) {
      if (!track || track.source_context) continue;
      
      const isOnline = isStreamTrack(track.path, track.format);
      if (!isOnline) continue;

      if (track.path.includes("youtube.com") || track.path.includes("youtu.be") || track.format === 'YouTube Direct') {
        console.log('[Pre-Cache] Pre-resolving YouTube track:', track.title);
        invoke('pre_resolve_youtube_url', { url: track.path }).catch(() => {});
      } 
      else if (track.format === 'Tidal FLAC' || track.format === 'Qobuz FLAC') {
        const providerName = track.format === 'Qobuz FLAC' ? 'Qobuz' : 'Tidal';
        console.log(`[Pre-Cache] Pre-caching ${providerName} track:`, track.title);
        (async () => {
          try {
            const cachedResolved = trackIdToStreamUrl.get(streamCacheKey(track, requestedQuality));
            let finalUrl = '';
            if (cachedResolved && (Date.now() - cachedResolved.resolvedAt < 30 * 1000)) {
              finalUrl = cachedResolved.url;
            } else {
              const resolver = track.format === 'Qobuz FLAC' ? 'qobuz_get_stream_url' : 'tidal_get_stream_url';
              finalUrl = await invoke<string>(resolver, { trackId: track.path, requestedQuality });
              trackIdToStreamUrl.set(streamCacheKey(track, requestedQuality), { url: finalUrl, resolvedAt: Date.now() });
              rememberResolvedPath(finalUrl, track.path);
            }
            if (finalUrl) {
              invoke('cache_cloud_track', { streamUrl: finalUrl }).catch(() => {});
            }
          } catch (e) {
            trackIdToStreamUrl.delete(streamCacheKey(track, requestedQuality));
            console.error(`[Pre-Cache] Failed to pre-cache ${providerName} track:`, e);
            notifyTidalAuthFailure(e, set);
            notifyQobuzAuthFailure(e, set);
          }
        })();
      } 
      else if (track.path.startsWith('http://') || track.path.startsWith('https://')) {
        console.log('[Pre-Cache] Pre-caching Cloud/Subsonic track:', track.title);
        invoke('cache_cloud_track', { streamUrl: track.path }).catch(() => {});
      }
    }
  },

  playPrev: async () => {
    if (get().stopBoundary?.kind === 'track') await get().cancelStopAfter();
    const album = get().albumSession;
    if (album) {
      const previous = { ...album, index: Math.max(0, album.index - 1) };
      set({ albumSession: previous });
      safeSetStorage('aideo_album_session', JSON.stringify(previous));
      await get().playTrack(previous.tracks[previous.index], undefined, false);
      return;
    }    cancelSourcePlayback();
    if (isSkipping) return;
    isSkipping = true;
    try {
      const state = get();
      const { playHistory, tracks, currentTrack } = state;
      
      // If we have history, pop the last track and play it
      if (playHistory.length > 0) {
        const newHistory = [...playHistory];
        const lastTrack = newHistory.pop()!;

        set({ playHistory: newHistory });
        await get().playTrack(lastTrack, true, false);
        return;
      }
      
      // Fallback: sequential previous from active library
      const isCurrentOnline = currentTrack ? isStreamTrack(currentTrack.path, currentTrack.format) : false;
      const activeTracks = isCurrentOnline
        ? tracks.filter(t => isStreamTrack(t.path, t.format))
        : tracks.filter(t => !isStreamTrack(t.path, t.format));

      if (activeTracks.length === 0) return;
      const currentActiveIdx = activeTracks.findIndex(t => pathsEqual(t.path, currentTrack?.path || ''));
      const prevIndex = ((currentActiveIdx !== -1 ? currentActiveIdx : 0) - 1 + activeTracks.length) % activeTracks.length;
      await get().playTrack(activeTracks[prevIndex], undefined, false);
    } finally {
      setTimeout(() => {
        isSkipping = false;
      }, 350);
    }
  },

  toggleShuffle: () => set(s => ({ shuffle: !s.shuffle })),

  toggleRepeat: () => {
    const current = get().repeat;
    const next = current === 'none' ? 'all' : current === 'all' ? 'one' : 'none';
    localStorage.setItem('aideo_repeat', next);
    set({ repeat: next });
    void get().syncBackendQueue();
  },

  triggerAutoplayRadio: async (track: Track, forceReset = false) => {
    const seedTrack = forceReset ? track : (get().autoplaySeedTrack || track || get().currentTrack);
    if (!seedTrack) return;
    if (!get().autoplayEnabled || get().albumSession || get().stopBoundary) return;

    // Guard against degraded seed metadata (placeholder titles like "Web Audio Stream",
    // bare hostnames like "Lgf.audio.tidal.com", placeholder artists like "Online Stream").
    // Searching the providers with those produces random irrelevant tracks that fill the queue.
    const artistGeneric = isGenericStreamArtist(seedTrack.artist);
    const titleGeneric = isGenericStreamTitle(seedTrack.title);
    if (artistGeneric && titleGeneric) {
      console.log('[autoplay] Seed metadata is generic/degraded — skipping radio fill to avoid irrelevant recommendations.');
      return;
    }
    const safeSeedArtist = artistGeneric ? 'Unknown Artist' : seedTrack.artist!;
    const safeSeedTitle = titleGeneric ? 'Unknown Title' : seedTrack.title!;

    const currentReqSeq = ++autoplayReqSeq;
    const playingPath = get().currentTrack?.path;
    const playbackSeq = playbackRequest();

    try {
      console.log(`[autoplay] Generating upcoming radio queue using seed: '${safeSeedTitle}' by '${safeSeedArtist}'...`);
      let recommendedTracks: Track[] = [];
      const engine = get().recommendationEngine || 'our';

      const fetchTidalRadio = async (): Promise<Track[]> => {
        try {
          const tracks = await invoke<any[]>('get_tidal_autoplay_recommendations', {
            artist: safeSeedArtist,
            title: safeSeedTitle
          });
          if (Array.isArray(tracks) && tracks.length > 0) {
            return tracks.map(t => ({
              id: -20000 - Number(t.id || 0),
              path: t.id,
              title: t.title || 'Unknown Title',
              artist: t.artist || 'Unknown Artist',
              duration: typeof t.duration === 'number' && Number.isFinite(t.duration) && t.duration > 0 ? t.duration : null,
              format: 'Tidal FLAC',
              lyric_offset: 0,
              cover_url: t.cover_url || null,
              recording_evidence: t.recording_evidence,
              is_autoplay: true
            }));
          }
        } catch (err) {
          console.warn('[autoplay] get_tidal_autoplay_recommendations error:', err);
        }
        return [];
      };

      const fetchQobuzRadio = async (): Promise<Track[]> => {
        try {
          const tracks = await invoke<any[]>('get_qobuz_autoplay_recommendations', {
            artist: safeSeedArtist,
            title: safeSeedTitle
          });
          if (Array.isArray(tracks) && tracks.length > 0) {
            return tracks.map(t => ({
              id: -50000 - Number(t.id || 0),
              path: t.id,
              title: t.title || 'Unknown Title',
              artist: t.artist || 'Unknown Artist',
              duration: typeof t.duration === 'number' && Number.isFinite(t.duration) && t.duration > 0 ? t.duration : null,
              format: 'Qobuz FLAC',
              lyric_offset: 0,
              cover_url: t.cover_url || null,
              recording_evidence: t.recording_evidence,
              is_autoplay: true
            }));
          }
        } catch (err) {
          console.warn('[autoplay] get_qobuz_autoplay_recommendations error:', err);
        }
        return [];
      };

      const fetchYoutubeRadio = async (): Promise<Track[]> => {
        try {
          let videoId = seedTrack.active_source?.provider === 'youtube' ? seedTrack.active_source.id : '';
          if (!videoId && /^[a-zA-Z0-9_-]{11}$/.test(seedTrack.path)) {
            videoId = seedTrack.path;
          } else if (!videoId) {
            const match = seedTrack.path.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/);
            if (match && match[1]) {
              videoId = match[1];
            }
          }

          const tracksState = get().tracks;
          const playCountsState = get().playCounts;
          const artistPlayCounts: Record<string, number> = {};
          tracksState.forEach(t => {
            if (t.artist && t.artist !== 'Unknown Artist' && t.artist !== 'YouTube Audio' && t.artist !== 'Web Audio Stream') {
              const count = playCountsState[t.path] || 0;
              if (count > 0) {
                artistPlayCounts[t.artist] = (artistPlayCounts[t.artist] || 0) + count;
              }
            }
          });

          const topArtists = Object.entries(artistPlayCounts)
            .sort((a, b) => b[1] - a[1])
            .map(entry => entry[0])
            .slice(0, 5);

          if (topArtists.length === 0) {
            const artistFrequencies: Record<string, number> = {};
            tracksState.forEach(t => {
              if (t.artist && t.artist !== 'Unknown Artist' && t.artist !== 'YouTube Audio' && t.artist !== 'Web Audio Stream') {
                artistFrequencies[t.artist] = (artistFrequencies[t.artist] || 0) + 1;
              }
            });
            const mostFrequent = Object.entries(artistFrequencies)
              .sort((a, b) => b[1] - a[1])
              .map(entry => entry[0])
              .slice(0, 5);
            topArtists.push(...mostFrequent);
          }

          const libraryArtists = Array.from(new Set(
            tracksState
              .map(t => t.artist)
              .filter((a): a is string => !!a && a !== 'Unknown Artist' && a !== 'YouTube Audio' && a !== 'Web Audio Stream')
          ));

          const discoveryLevel = get().autoplayDiscoveryLevel;

          const tracks = await invoke<any[]>('get_youtube_autoplay_recommendations', {
            videoId,
            artist: safeSeedArtist,
            title: safeSeedTitle,
            topArtists,
            libraryArtists,
            discoveryLevel,
          });

          if (Array.isArray(tracks)) {
            return tracks.map((t, idx) => ({
              id: -30000 - Math.floor(Math.random() * 1000000) - idx,
              path: t.url,
              title: t.title || 'Unknown Title',
              artist: t.artist || 'Unknown Artist',
              duration: parseDuration(t.duration_raw) || null,
              format: 'YouTube Direct',
              lyric_offset: 0,
              cover_url: t.cover_url || null,
              is_autoplay: true
            }));
          }
        } catch (err) {
          console.warn('[autoplay] get_youtube_autoplay_recommendations error:', err);
        }
        return [];
      };

      const requested = get();
      const local = requested.tracks.filter(t => !isStreamTrack(t.path, t.format));
      const tasks: Promise<Track[]>[] = [];
      if (requested.appMode !== 'local') {
        if (engine !== 'tidal') tasks.push(bounded(fetchYoutubeRadio(), 8000).catch(() => []));
        if (engine !== 'youtube' && requested.tidalConnected) tasks.push(bounded(fetchTidalRadio(), 8000).catch(() => []));
        if (engine === 'our' && requested.qobuzConnected && requested.qobuzExperimentalEnabled) tasks.push(bounded(fetchQobuzRadio(), 8000).catch(() => []));
      }
      const online = (await Promise.all(tasks)).flat();
      const relatedness = Object.fromEntries(online.map((t, i) => [t.path, 1 - 0.5 * i / Math.max(1, online.length)]));
      const excluded = [...requested.queue.map(t => t.path), ...requested.autoplaySessionHistory.map(t => t.path),
        ...(requested.recentlyClearedAutoplayPaths || []), track.path];
      recommendedTracks = await rankRecommendations(requested, [...online, ...local], 'radio', {
        seed: seedTrack, generation: currentReqSeq, limit: 10, excluded, relatedness,
      });
      if (requested.appMode !== get().appMode || requested.recommendationEngine !== get().recommendationEngine
        || requested.autoplayDiscoveryLevel !== get().autoplayDiscoveryLevel) return;

      if (currentReqSeq !== autoplayReqSeq || playbackSeq !== playbackRequest() || playingPath !== get().currentTrack?.path) {
        console.log('[autoplay] Stale recommendation request superseded, skipping queue update.');
        return;
      }

      const currentQueue = get().queue;
      const manualQueue = currentQueue.filter(t => !t.is_autoplay);
      const existingAutoplay = forceReset ? [] : currentQueue.filter(t => t.is_autoplay);

      const avoided = [track, ...get().autoplaySessionHistory, ...manualQueue, ...existingAutoplay];
      const finalRecommended: Track[] = [];
      for (const recommendation of recommendedTracks) {
        if (!recommendationAllowed(recommendation, get()) || avoided.some(t => sameRecommendationRecording(t, recommendation))
          || finalRecommended.some(t => sameRecommendationRecording(t, recommendation))) continue;
        finalRecommended.push({ ...recommendation, is_autoplay: true });
      }

      const needed = Math.max(0, 10 - existingAutoplay.length);
      const toAppend = finalRecommended.slice(0, needed);

      if (toAppend.length === 0 && !forceReset) {
        return;
      }

      if (!get().autoplayEnabled || get().albumSession || get().stopBoundary || currentReqSeq !== autoplayReqSeq || playbackSeq !== playbackRequest() || playingPath !== get().currentTrack?.path) {
        console.log('[autoplay] Autoplay disabled or stale request superseded, skipping queue update.');
        return;
      }

      const newQueue = [...manualQueue, ...existingAutoplay, ...toAppend];
      set({ queue: newQueue });
      localStorage.setItem('aideo_queue', JSON.stringify(newQueue));

      await get().syncBackendQueue();

      // 🚀 Background Pre-caching manager for the next 2 tracks
      get().preCacheNextTracks().catch(console.error);

      console.log('[autoplay] Dynamically populated upcoming queue with recommendations!');
    } catch (err) {
      console.error('Autoplay background resolution failed:', err);
    }
  },

  toggleAutoplay: async () => {
    const next = !get().autoplayEnabled;
    localStorage.setItem('aideo_autoplay', String(next));
    set({ autoplayEnabled: next });

    if (!next) {
      autoplayReqSeq++;
      const currentQueue = get().queue;
      const filtered = currentQueue.filter(t => !t.is_autoplay);
      set({ queue: filtered });
      localStorage.setItem('aideo_queue', JSON.stringify(filtered));

      try {
        await get().syncBackendQueue();
      } catch (err) {
        console.error('Failed to sync backend queue after disabling autoplay:', err);
      }
    }
  },

  setAutoplayDiscoveryLevel: (level: 'familiarity' | 'balanced' | 'discovery') => {
    localStorage.setItem('aideo_autoplay_discovery_level', level);
    set({ autoplayDiscoveryLevel: level });
    autoplayReqSeq++;
    const queue = filterAutomaticQueue(get(), true);
    set({ queue });
    safeSetStorage('aideo_queue', JSON.stringify(queue));
    void get().syncBackendQueue();
    if (get().autoplayEnabled && get().currentTrack) void get().triggerAutoplayRadio(get().currentTrack!, false);
  },

  setRecommendationEngine: (engine: 'our' | 'youtube' | 'tidal') => {
    localStorage.setItem('aideo_recommendation_engine', engine);
    set({ recommendationEngine: engine });
    autoplayReqSeq++;
    const queue = filterAutomaticQueue(get());
    set({ queue });
    safeSetStorage('aideo_queue', JSON.stringify(queue));
    void get().syncBackendQueue();
    if (get().autoplayEnabled && get().currentTrack) void get().triggerAutoplayRadio(get().currentTrack!, false);
  },

  fetchPlaylists: async () => {
    try {
      const playlists = await invoke<any[]>('get_playlists');
      set({ playlists });
    } catch (e) { console.error(e); }
  },

  smartPlaylists: [],
  fetchSmartPlaylists: async () => {
    try {
      const smartPlaylists = await invoke<any[]>('get_smart_playlists');
      set({ smartPlaylists });
    } catch (e) { console.error(e); }
  },

  createSmartPlaylist: async (name: string, rules: any) => {
    try {
      const rulesJson = typeof rules === 'string' ? rules : JSON.stringify(rules);
      const id = await invoke<number>('create_smart_playlist', { name, rulesJson });
      await get().fetchSmartPlaylists();
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Created Smart Playlist "${name}"`, type: 'success' }
      }));
      return id;
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Failed to create Smart Playlist: ${e}`, type: 'error' }
      }));
      return undefined;
    }
  },

  deleteSmartPlaylist: async (id: number) => {
    try {
      await invoke('delete_smart_playlist', { id });
      await get().fetchSmartPlaylists();
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

  addToPlaylist: async (playlistId: number, track: string | Track) => {
    try {
      await invoke('add_to_playlist', {
        playlistId,
        path: typeof track === 'string' ? track : track.path,
        ...(typeof track !== 'string' && track.source_context
          ? { sourceContext: cleanSourceContext(track.source_context), metadata: track } : {}),
      });
      if (get().currentPlaylist?.id === playlistId) {
        await get().loadPlaylistTracks(playlistId);
      }
    } catch (e) { console.error(e); }
  },

  removeFromPlaylist: async (playlistId: number, track: string | Track) => {
    try {
      await invoke('remove_from_playlist', {
        playlistId,
        path: typeof track === 'string' ? track : track.path,
        ...(typeof track !== 'string' && track.playlist_entry_id !== undefined
          ? { entryId: track.playlist_entry_id } : {}),
      });
      if (get().currentPlaylist?.id === playlistId) {
        await get().loadPlaylistTracks(playlistId);
      }
    } catch (e) { console.error(e); }
  },

  reorderPlaylistTracks: async (playlistId: number, fromIndex: number, toIndex: number) => {
    const isCurrent = get().currentPlaylist?.id === playlistId;
    let currentTracks: Track[] = [];
    if (isCurrent) {
      currentTracks = [...get().tracks];
    } else {
      try {
        currentTracks = await invoke<Track[]>('get_playlist_tracks', { playlistId });
      } catch (e) {
        console.error('Failed to fetch playlist tracks for reordering:', e);
        return;
      }
    }

    if (fromIndex < 0 || fromIndex >= currentTracks.length || toIndex < 0 || toIndex >= currentTracks.length || fromIndex === toIndex) return;

    const [movedTrack] = currentTracks.splice(fromIndex, 1);
    currentTracks.splice(toIndex, 0, movedTrack);

    if (isCurrent) {
      set({ tracks: currentTracks });
    }

    try {
      await invoke('reorder_playlist', {
        playlistId,
        trackPaths: currentTracks.map((t: Track) => t.path),
        ...(currentTracks.every(t => t.playlist_entry_id !== undefined)
          ? { entryIds: currentTracks.map(t => t.playlist_entry_id) } : {}),
      });
    } catch (e) {
      console.error('Failed to save reordered playlist:', e);
      if (isCurrent) {
        await get().loadPlaylistTracks(playlistId);
      }
    }
  },

  loadPlaylistTracks: async (id: number) => {
    try {
      const tracks = await invoke<Track[]>('get_playlist_tracks', { playlistId: id });
      set({ tracks: tracks.map(applySourcePreference), currentPlaylist: get().playlists.find(p => p.id === id) || null });
    } catch (e) { console.error(e); }
  },

  toggleLoveTrack: async (path: string, metadata?: Partial<Track>) => {
    try {
      const track = (metadata?.source_context || metadata?.format ? { ...metadata, path } as Track : null)
        || get().tracks.find(t => pathsEqual(t.path, path))
        || (pathsEqual(get().currentTrack?.path, path) ? get().currentTrack : null)
        || (metadata ? { path, ...metadata } as Track : null);

      if (!track) return;
      const known = track.source_context && get().tracks.find(t => t.source_context?.recording_id === track.source_context?.recording_id && t.loved === 1);
      const isLovedNow = (known || track).loved === 1 ? 0 : 1;
      const sameSavedEntry = (candidate: Track) => track.source_context
        ? candidate.source_context?.recording_id === track.source_context.recording_id
        : !candidate.source_context && sameRecommendationRecording(track, candidate);

      await invoke('toggle_love_track', {
        path,
        loved: isLovedNow === 1,
        title: track.title || null,
        artist: track.artist || null,
        album: track.album || null,
        duration: track.duration || null,
        format: track.format || null,
        coverUrl: track.cover_url || null,
        ...(track.source_context ? { sourceContext: cleanSourceContext(track.source_context) } : {}),
      });

      // Update tracks array in-place
      const updatedTracks = get().tracks.map(t => {
        if (sameSavedEntry(t)) {
          return { ...t, loved: isLovedNow, ...(isLovedNow ? { disliked: 0 } : {}) };
        }
        return isLovedNow && sameRecommendationRecording(track, t) ? { ...t, disliked: 0 } : t;
      });
      if (track.source_context && isLovedNow === 1 && !updatedTracks.some(sameSavedEntry)) updatedTracks.push({ ...track, loved: 1 });
      set({ tracks: updatedTracks });

      // Update currentTrack in-place if it matches
      const current = get().currentTrack;
      if (current && sameSavedEntry(current)) {
        set({ currentTrack: { ...current, loved: isLovedNow, ...(isLovedNow ? { disliked: 0 } : {}) } });
      }
      else if (current && isLovedNow && sameRecommendationRecording(track, current)) set({ currentTrack: { ...current, disliked: 0 } });

      const updatedQueue = get().queue.map(q => {
        if (sameSavedEntry(q)) {
          return { ...q, loved: isLovedNow, ...(isLovedNow ? { disliked: 0 } : {}) };
        }
        return isLovedNow && sameRecommendationRecording(track, q) ? { ...q, disliked: 0 } : q;
      });
      set({ queue: updatedQueue });

      if (isLovedNow === 0) {
        try {
          const tombstones: string[] = JSON.parse(localStorage.getItem('aideo_unliked_tombstones') || '[]');
          if (!tombstones.some(p => pathsEqual(p, path))) {
            tombstones.push(path);
            localStorage.setItem('aideo_unliked_tombstones', JSON.stringify(tombstones));
          }
        } catch (_) {}
      } else {
        try {
          const tombstones: string[] = JSON.parse(localStorage.getItem('aideo_unliked_tombstones') || '[]');
          const filtered = tombstones.filter((p: string) => !pathsEqual(p, path));
          localStorage.setItem('aideo_unliked_tombstones', JSON.stringify(filtered));
        } catch (_) {}
      }

      await get().fetchPlaylists();

      const playlist = get().currentPlaylist;
      if (playlist) {
        await get().loadPlaylistTracks(playlist.id);
      }
      window.dispatchEvent(new Event('recommendation-feedback-updated'));
      return isLovedNow === 1;
    } catch (e) {
      console.error('toggleLoveTrack:', e);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Could not save song: ${String(e)}`, type: 'error' } }));
    }
  },

  setRecommendationInterest: async (track: Track, interested: boolean) => {
    await invoke('set_recommendation_interest', { track, interested, sourceContext: feedbackContext(track), recordingEvidence: track.recording_evidence || null });
    const matches = (candidate: Track) => sameRecommendationRecording(track, candidate);
    const update = (candidate: Track) => matches(candidate) ? { ...candidate, disliked: interested ? 0 : 1, loved: interested ? candidate.loved : 0 } : candidate;
    const saved = get().tracks.map(update);
    if (!saved.some(matches)) saved.push(update(track));
    const queue = get().queue.filter(t => interested || !(t.is_autoplay || t.is_generated_mix) || !matches(t)).map(update);
    set({ tracks: saved, queue, currentTrack: get().currentTrack ? update(get().currentTrack!) : null });
    safeSetStorage('aideo_queue', JSON.stringify(queue));
    if (get().sourceQueueManaged || queue.some(t => t.source_context)) await manageSourceQueue(set);
    else {
      await chainQueueOperation(async () => {
        await invoke('clear_queue');
        if (queue.length) await invoke('add_to_queue_bulk', { paths: queue.map(t => t.path) });
      });
    }
    invalidateRecommendationPreferences();
  },

  toggleDislikeTrack: async (path: string, metadata?: Partial<Track>) => {
    const track = get().tracks.find(t => pathsEqual(t.path, path))
      || (pathsEqual(get().currentTrack?.path, path) ? get().currentTrack : null)
      || (metadata ? { ...metadata, path } as Track : null);
    if (track) await get().setRecommendationInterest(track, track.disliked === 1);
  },

  resetDislikedTracks: async () => {
    try {
      await invoke('reset_disliked_tracks');
      await get().loadLibrary();
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: 'Reset all disliked tracks successfully', type: 'success' } 
      }));
    } catch (e) {
      console.error('resetDislikedTracks:', e);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Failed to reset dislikes: ${e}`, type: 'error' } 
      }));
    }
  },

  fetchCachedCloudHashes: async () => {
    try {
      const hashes = await invoke<string[]>('get_all_cached_cloud_hashes');
      set({ cachedCloudHashes: hashes });
    } catch (e) {
      console.error('fetchCachedCloudHashes:', e);
    }
  },

  cacheCloudTrack: async (track: any) => {
    try {
      const streamUrl = track.stream_url || track.path;
      if (!streamUrl) return;

      // 1. Persist metadata to database
      await invoke('add_track', {
        path: streamUrl,
        title: track.title || null,
        artist: track.artist || null,
        album: track.album || null,
        duration: track.duration || null,
        format: track.provider ? track.provider.toUpperCase() : (track.format || null),
        coverUrl: track.cover_url || null
      });

      // 2. Download and encrypt stream
      await invoke('cache_cloud_track', { streamUrl });

      // 3. Reload library and cache lists
      await get().fetchCachedCloudHashes();
      await get().loadLibrary();
    } catch (e) {
      console.error('cacheCloudTrack:', e);
    }
  },

  deleteCachedTrack: async (streamUrl: string) => {
    try {
      await invoke('delete_cached_track', { streamUrl });
      await get().fetchCachedCloudHashes();
      await get().loadLibrary();
    } catch (e) {
      console.error('deleteCachedTrack:', e);
    }
  },

  generateSmartMix: async (mood: string, _trendSource: string) => {
    const generation = ++mixRequestSequence;
    const startingPlayback = playbackRequest();
    const requested = get();
    const current = () => generation === mixRequestSequence && startingPlayback === playbackRequest()
      && requested.appMode === get().appMode && requested.recommendationEngine === get().recommendationEngine
      && requested.autoplayDiscoveryLevel === get().autoplayDiscoveryLevel && requested.tracks === get().tracks;

    const tracks = get().tracks;
    if (tracks.length === 0) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Your library is empty. Add a music folder first.', type: 'warning' } }));
      return;
    }

    try {
      const selectedMix = await rankRecommendations(requested, tracks, 'mood', { mood, limit: 20, generation });
      if (!current()) return;
      if (selectedMix.length === 0) {
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'No tracks have enough evidence for this mood yet.', type: 'info' } }));
        return;
      }

      const playlistName = `AI Smart Mix - ${mood}`;
      await invoke('save_generated_playlist', { name: playlistName, paths: selectedMix.map(track => track.path) });
      await get().fetchPlaylists();

      if (!current()) return;
      const upcoming = selectedMix.slice(1).map(t => ({ ...t, is_generated_mix: true }));
      set({ queue: upcoming });
      localStorage.setItem('aideo_queue', JSON.stringify(upcoming));

      await invoke('clear_queue');
      if (upcoming.length > 0) {
        const paths = upcoming.map(t => t.path);
        await invoke('add_to_queue_bulk', { paths });
      }

      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Generated dynamic offline AI mix: "${playlistName}"`, type: 'success' } }));
      
      if (!current()) return;
      await get().playTrack(selectedMix[0], false, false);
      get().setView('nowplaying');
    } catch (err) {
      console.error('generateSmartMix:', err);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Could not generate mix: ${String(err)}`, type: 'error' } }));
    }
  },

  matchMetadata: async (track: Track) => {
    try {
      set({ scanStatus: `Matching ${track.title || 'track'}...` });
      
      let searchTitle = track.title || '';
      let searchArtist = track.artist || '';
      
      // Smart parsing for YouTube downloads
      if ((searchArtist === 'YouTube Audio' || searchArtist === 'Web Audio Stream') && searchTitle.includes(' - ')) {
        const parts = searchTitle.split(' - ');
        searchArtist = parts[0].trim();
        searchTitle = parts.slice(1).join(' - ').trim();
      } else if (searchArtist === 'YouTube Audio' || searchArtist === 'Web Audio Stream') {
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
    const generation = ++mixRequestSequence;
    const startingPlayback = playbackRequest();
    const requested = get();
    const current = () => generation === mixRequestSequence && startingPlayback === playbackRequest()
      && requested.appMode === get().appMode && requested.recommendationEngine === get().recommendationEngine
      && requested.autoplayDiscoveryLevel === get().autoplayDiscoveryLevel && requested.tracks === get().tracks;

    const tracks = get().tracks;
    if (tracks.length === 0) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Your library is empty. Add a music folder first.', type: 'warning' } }));
      return;
    }

    const hour = new Date().getHours();
    const mood = hour >= 5 && hour < 12 ? 'energetic' : hour < 17 ? 'focus' : 'chill';
    const selectedTracks = await rankRecommendations(requested, tracks,
      mixType === 'chill' ? 'mood' : mixType,
      { mood: mixType === 'chill' ? mood : undefined, limit: mixType === 'supermix' ? 25 : 20, generation });
    if (!current()) return;

    if (selectedTracks.length === 0) return;

    const upcomingTracks = selectedTracks.slice(1).map(t => ({ ...t, is_generated_mix: true }));
    set({ queue: upcomingTracks });
    localStorage.setItem('aideo_queue', JSON.stringify(upcomingTracks));
    
    try {
      await invoke('clear_queue');
      if (upcomingTracks.length > 0) {
        const paths = upcomingTracks.map(t => t.path);
        await invoke('add_to_queue_bulk', { paths });
      }
    } catch (e) {
      console.error('Failed to sync dynamic mix queue to backend:', e);
    }
    
    if (!current()) return;
    await get().playTrack(selectedTracks[0], false, false);

    let mixName = 'Chill Mix';
    if (mixType === 'supermix') mixName = 'Library Mix';
    else if (mixType === 'recap') mixName = 'Aideo Recap Mix';
    else if (mixType === 'discovery') mixName = 'Discovery Mix';
    else if (mixType === 'chill') {
      const hrs = new Date().getHours();
      if (hrs >= 5 && hrs < 12) mixName = 'Morning Mix';
      else if (hrs >= 12 && hrs < 17) mixName = 'Afternoon Mix';
      else mixName = 'Evening Mix';
    }
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Playing ${mixName}!`, type: 'success' } }));
  },
  setCacheSizeLimit: (limit: number) => {
    set({ cacheSizeLimit: limit });
    localStorage.setItem('aideo_cache_size_limit', String(limit));
    invoke('prune_cache_to_limit', { limitGb: limit }).catch((e) => {
      console.error('Failed to prune cache to limit:', e);
    });
  },
});
