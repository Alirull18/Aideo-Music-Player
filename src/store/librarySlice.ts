import { StateCreator } from 'zustand';
import { PlayerState, Track } from './types';
import { invoke } from '@tauri-apps/api/core';
import { extractDominantColor } from './types';
import { pathsEqual, baseName, parseStreamMetadata, resolvedPathMap, onlineTrackCache, trackIdToStreamUrl } from '../utils';
import { chainQueueOperation } from './playbackSlice';

let isTransitioning = false;
let lastPlayedPathFromUI: string | null = null;
let isSkipping = false;

const isStreamTrack = (path: string, format?: string | null): boolean => {
  return path.startsWith('http://') || path.startsWith('https://') || format === 'YouTube Direct' || format === 'Tidal FLAC' || format === 'SUBSONIC' || format === 'JELLYFIN';
};

const fetchTrackMetadataAndLyrics = async (
  track: Track,
  set: any,
  get: any,
  isOnline: boolean
) => {
  const path = track.path;
  if (track.cover_url) {
    if (track.cover_url.startsWith('http://') || track.cover_url.startsWith('https://')) {
      invoke('get_cover_art', { path: track.cover_url }).then(async (art: any) => {
        if (!pathsEqual(get().playback.current_track, path)) return;
        if (art && typeof art === 'string') {
          set({ coverArt: art });
          try {
            const color = await extractDominantColor(art);
            set({ accentColor: color });
          } catch (_) {}
          invoke('update_media_metadata', {
            title: track.title || path.split(/[\\/]/).pop(),
            artist: track.artist || 'Unknown Artist',
            coverUrl: art,
            duration: track.duration || 0,
          }).catch(() => {});
        } else {
          // Fallback to local cover if online retrieval returned null/empty and it is a local path
          if (!path.startsWith('http://') && !path.startsWith('https://')) {
            invoke('get_cover_art', { path }).then(async (localArt: any) => {
              if (!pathsEqual(get().playback.current_track, path)) return;
              if (localArt && typeof localArt === 'string') {
                set({ coverArt: localArt });
                try {
                  const color = await extractDominantColor(localArt);
                  set({ accentColor: color });
                } catch (_) {}
              }
            }).catch(() => {});
          }
        }
      }).catch(() => {
        // Fallback to local cover on connection failure/error
        if (!path.startsWith('http://') && !path.startsWith('https://')) {
          invoke('get_cover_art', { path }).then(async (localArt: any) => {
            if (!pathsEqual(get().playback.current_track, path)) return;
            if (localArt && typeof localArt === 'string') {
              set({ coverArt: localArt });
              try {
                const color = await extractDominantColor(localArt);
                set({ accentColor: color });
              } catch (_) {}
            }
          }).catch(() => {});
        }
      });
    } else {
      extractDominantColor(track.cover_url).then((color) => {
        set({ accentColor: color });
      }).catch(() => {});
    }
  }

  invoke('update_media_metadata', {
    title: track.title || path.split(/[\\/]/).pop(),
    artist: track.artist || 'Unknown Artist',
    coverUrl: track.cover_url || null,
    duration: track.duration || 0,
  }).catch(() => { });

  if (!isOnline && !track.cover_url) {
    invoke('get_cover_art', { path }).then(async (art: any) => {
      if (!pathsEqual(get().playback.current_track, path)) return;
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
        }).catch(() => { });
      } else {
        set({ coverArt: null, accentColor: '#8b5cf6' });
      }
    }).catch(() => {
      if (pathsEqual(get().playback.current_track, path)) {
        set({ coverArt: null, accentColor: '#8b5cf6' });
      }
    });
  }

  invoke('get_lyrics', { path }).then((lrc: any) => {
    if (!pathsEqual(get().playback.current_track, path)) return;
    if (Array.isArray(lrc) && lrc.length > 0) {
      set({ lyrics: lrc, lyricStatus: 'found' });
    } else {
      get().autoFetchLyricsOnline(track);
    }
  }).catch(() => {
    if (pathsEqual(get().playback.current_track, path)) get().autoFetchLyricsOnline(track);
  });
};

export const createLibrarySlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  tracks: [],
  currentTrackIndex: -1,
  currentTrack: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('aideo_current_track') || 'null');
      if (saved && (saved.title === 'Web Audio Stream' || saved.artist === 'Web Stream')) {
        const history: any[] = JSON.parse(localStorage.getItem('aideo_play_history') || '[]');
        const realTrack = history.slice().reverse().find(t => t && typeof t === 'object' && t.title && t.title !== 'Web Audio Stream' && t.artist !== 'Web Stream');
        if (realTrack) {
          localStorage.setItem('aideo_current_track', JSON.stringify(realTrack));
          return realTrack;
        }
      }
      return saved;
    } catch {
      return null;
    }
  })(),
  shuffle: false,
  repeat: (localStorage.getItem('aideo_repeat') as 'none' | 'all' | 'one') || 'none',
  currentHistoryId: null,
  autoplayEnabled: localStorage.getItem('aideo_autoplay') !== 'false',
  autoplayDiscoveryLevel: (localStorage.getItem('aideo_autoplay_discovery_level') as 'familiarity' | 'balanced' | 'discovery') || 'balanced',
  autoplayAlgorithm: (localStorage.getItem('aideo_autoplay_algorithm') as 'v1' | 'v2') || 'v2',
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
    } catch (e: any) { set({ scanStatus: 'Scan failed: ' + e }); }
  },

  loadLibrary: async () => {
    try {
      const tracks: Track[] = await invoke('get_library');
      set({ tracks });

      // Synchronize currently playing track tags instantly
      const current = get().currentTrack;
      if (current) {
        const updatedTrack = tracks.find(t => pathsEqual(t.path, current.path));
        if (updatedTrack) {
          set({ currentTrack: updatedTrack });
        }
      }

      // Synchronize queued tracks tags instantly
      const currentQueue = get().queue;
      if (currentQueue.length > 0) {
        const updatedQueue = currentQueue.map(q => {
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
    const prevHistoryId = get().currentHistoryId;
    const prevTrack = get().currentTrack;
    const currentPos = get().playback.position_secs;

    if (prevHistoryId !== null) {
      const duration = prevTrack?.duration || 0;
      const skipped = duration > 0 ? currentPos < duration - 5.0 : false;
      invoke('log_playback_end', {
        historyId: prevHistoryId,
        durationPlayed: currentPos,
        skipped,
      }).catch((e) => console.error("Failed to log playback end:", e));
      set({ currentHistoryId: null });
    }

    if (newTrack) {
      const currentHistory = get().autoplaySessionHistory || [];
      if (!currentHistory.some(t => t.path === newTrack.path)) {
        set({ autoplaySessionHistory: [...currentHistory, newTrack] });
      }
      try {
        const id = await invoke<number>('log_playback_start', {
          path: newTrack.path,
          title: newTrack.title || null,
          artist: newTrack.artist || null,
          album: null,
          duration: newTrack.duration || null,
          format: newTrack.format || null,
          genre: null,
          playbackSource: playbackSource || null,
        });
        set({ currentHistoryId: id });
      } catch (e) {
        console.error("Failed to log playback start:", e);
      }
    }
  },

  playTrack: async (track: Track, isHistory?: boolean, forceResetAutoplay = true, playbackSource?: string, startPos?: number) => {
    if (!track) return;
    if (forceResetAutoplay) {
      set({ 
        autoplaySeedTrack: track,
        autoplaySessionHistory: [track]
      });
    }
    
    const isOnline = track.path.startsWith('http://') || track.path.startsWith('https://') || track.format === 'Tidal FLAC' || track.format === 'YouTube Direct';
    let isCached = false;
    if (isOnline) {
      try {
        let lookupUrl = track.path;
        if (track.format === 'Tidal FLAC') {
          const cachedResolved = trackIdToStreamUrl.get(track.path);
          if (cachedResolved) lookupUrl = cachedResolved.url;
        }
        isCached = await invoke<boolean>('check_url_is_cached', { url: lookupUrl });
      } catch (err) {
        console.error('Failed to check if track is cached:', err);
      }
    }

    if (isOnline && !isCached && typeof navigator !== 'undefined' && !navigator.onLine) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: 'You are offline. Cannot stream online tracks.', type: 'warning' } 
      }));
      return;
    }

    try {
      await get().recordPlaybackTransition(track, playbackSource);

      // De-duplicate / consume track from queue when starting playback
      const currentQueue = get().queue;
      const matchingIndices: number[] = [];
      currentQueue.forEach((t, i) => {
        if (pathsEqual(t.path, track.path)) {
          matchingIndices.push(i);
        }
      });

      if (matchingIndices.length > 0) {
        const newQueue = currentQueue.filter(t => !pathsEqual(t.path, track.path));
        set({ queue: newQueue });
        localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
        
        // Remove from the Rust backend queue in reverse order sequentially
        for (let i = matchingIndices.length - 1; i >= 0; i--) {
          const indexToRemove = matchingIndices[i];
          chainQueueOperation(async () => {
            await invoke('remove_from_queue', { index: indexToRemove }).catch(console.error);
          });
        }
        await chainQueueOperation(async () => {});
      }

      const index = get().tracks.findIndex(t => pathsEqual(t.path, track.path));
      const prevTrack = get().currentTrack;
      const history = prevTrack && !isHistory ? [...get().playHistory, prevTrack].slice(-200) : get().playHistory;
      localStorage.setItem('aideo_play_history', JSON.stringify(history));

      lastPlayedPathFromUI = track.path;
      const counts = { ...get().playCounts };
      counts[track.path] = (counts[track.path] || 0) + 1;
      localStorage.setItem('aideo_play_counts', JSON.stringify(counts));

      const isOnline = track.path.startsWith('http://') || track.path.startsWith('https://');
      if (isOnline) {
        onlineTrackCache.set(track.path, track);
      }

      localStorage.setItem('aideo_current_track', JSON.stringify(track));

      set({
        currentTrackIndex: index,
        currentTrack: track,
        playHistory: history,
        playCounts: counts,
        lyricOffset: track.lyric_offset || 0,
        lyrics: [],
        lyricStatus: 'loading',
        coverArt: track.cover_url || null,
        accentColor: '#8b5cf6',
        scrobbledCurrent: false,
        playback: { ...get().playback, current_track: track.path, status: 'Playing', position_secs: startPos || 0, last_skip_time: Date.now() },
      });

      if (isOnline) {
        window.dispatchEvent(new CustomEvent('ui-stream-buffering', {
          detail: { active: true, title: track.title || 'Unknown Title', artist: track.artist || 'Unknown Artist' }
        }));
      }

      let finalPath = track.path;
      if (track.format === 'Tidal FLAC' && !track.path.startsWith('http://') && !track.path.startsWith('https://')) {
        try {
          const cachedResolved = trackIdToStreamUrl.get(track.path);
          if (cachedResolved && (Date.now() - cachedResolved.resolvedAt < 15 * 60 * 1000)) {
            finalPath = cachedResolved.url;
            console.log('[Tidal] Using pre-resolved stream URL for track:', track.title);
          } else {
            finalPath = await invoke<string>('tidal_get_stream_url', { trackId: track.path });
            trackIdToStreamUrl.set(track.path, { url: finalPath, resolvedAt: Date.now() });
            resolvedPathMap.set(finalPath, track.path);
          }
        } catch (e) {
          console.error('Failed to resolve Tidal stream in playTrack:', e);
        }
      }

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
      } else {
        await invoke('play_track', { path: finalPath, startPos: startPos || 0.0 });
      }
      get().triggerAutoplayRadio(track, forceResetAutoplay);

      // Filter out autoplay recommendations from the queue if autoplay is disabled or if playing a local track
      const isTrackOnline = track.path.startsWith('http://') || track.path.startsWith('https://') || track.format === 'Tidal FLAC' || track.format === 'YouTube Direct';
      if (!get().autoplayEnabled || !isTrackOnline) {
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

      await fetchTrackMetadataAndLyrics(track, set, get, isOnline || track.format === 'Tidal FLAC');

    } catch (e) {
      console.error('playTrack error:', e);
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Playback failed: ${e}`, type: 'error' }
      }));
      
      // Filter out the failed track from the queue if it's there
      const currentQueue = get().queue;
      const filteredQueue = currentQueue.filter((t: Track) => !pathsEqual(t.path, track.path));
      if (filteredQueue.length !== currentQueue.length) {
        set({ queue: filteredQueue });
        localStorage.setItem('aideo_queue', JSON.stringify(filteredQueue));
        const idx = currentQueue.findIndex((t: Track) => pathsEqual(t.path, track.path));
        if (idx !== -1) {
          invoke('remove_from_queue', { index: idx }).catch(console.error);
        }
      }

      set((s: any) => ({
        playback: {
          ...s.playback,
          status: 'Stopped',
          current_track: null,
          position_secs: 0
        },
        currentTrack: null
      }));
      setTimeout(() => {
        get().playNext();
      }, 1500);
    }

    const state = get();
    // Only auto-queue from library if the user's manual queue is empty
    if (state.queue.length === 0 && state.tracks.length > 0 && state.currentTrackIndex >= 0) {
      if (state.repeat === 'one') {
        // Repeat One: re-queue the same track so the backend loops it
        try { await invoke('add_to_queue', { path: track.path }); } catch (e) { }
      } else if (state.repeat === 'none') {
        // Repeat None: don't queue if we're at the last track
        const nextIndex = state.shuffle
          ? Math.floor(Math.random() * state.tracks.length)
          : state.currentTrackIndex + 1;
        if (nextIndex < state.tracks.length) {
          try { await invoke('add_to_queue', { path: state.tracks[nextIndex].path }); } catch (e) { }
        }
      } else {
        // Repeat All: wrap around
        const nextIndex = state.shuffle
          ? Math.floor(Math.random() * state.tracks.length)
          : (state.currentTrackIndex + 1) % state.tracks.length;
        try { await invoke('add_to_queue', { path: state.tracks[nextIndex].path }); } catch (e) { }
      }
    }
    get().updateDiscordPresence();
  },

  handleTrackTransition: async (path: string) => {
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

      // Check currentTrack first if it matches or if path is a temp file representation of currentTrack
      if (!track && state.currentTrack && (pathsEqual(state.currentTrack.path, path) || (state.currentTrack.title && state.currentTrack.title !== 'Web Audio Stream'))) {
        track = { ...state.currentTrack, path };
      }

      // Check playHistory
      if (!track) {
        track = state.playHistory.slice().reverse().find(t => t && pathsEqual(t.path, path) && t.title && t.title !== 'Web Audio Stream') || null;
      }

      // Construct high-fidelity virtual Track object as fallback to ensure seek bar work
      if (!track) {
        const isOnline = path.startsWith('http://') || path.startsWith('https://');
        const meta = isOnline ? parseStreamMetadata(path) : { title: baseName(path), artist: '—', album: '' };
        track = {
          id: -9999,
          path,
          title: meta.title,
          artist: meta.artist,
          duration: null,
          format: isOnline ? 'URL' : 'MP3/FLAC',
          lyric_offset: 0
        };
      }

      const prevTrack = state.currentTrack;
      const history = prevTrack ? [...state.playHistory, prevTrack].slice(-200) : state.playHistory;
      localStorage.setItem('aideo_play_history', JSON.stringify(history));

      // Log the transition in SQLite so autoplayed tracks correctly appear in playback history!
      await get().recordPlaybackTransition(track, 'autoplay');

      const counts = { ...state.playCounts };
      if (lastPlayedPathFromUI && pathsEqual(path, lastPlayedPathFromUI)) {
        // UI-driven play count already logged in playTrack, bypass duplication
        lastPlayedPathFromUI = null;
      } else {
        counts[path] = (counts[path] || 0) + 1;
        localStorage.setItem('aideo_play_counts', JSON.stringify(counts));
      }

      const isOnline = path.startsWith('http://') || path.startsWith('https://');

      if (track && track.title && track.title !== 'Web Audio Stream') {
        localStorage.setItem('aideo_current_track', JSON.stringify(track));
      }

      set({
        currentTrackIndex: index,
        currentTrack: track,
        playHistory: history,
        playCounts: counts,
        lyricOffset: track?.lyric_offset || 0,
        lyrics: [],
        lyricStatus: 'loading',
        coverArt: track?.cover_url || null,
        accentColor: '#8b5cf6',
        scrobbledCurrent: false,
        playback: { ...state.playback, current_track: path, status: 'Playing', position_secs: 0, last_skip_time: Date.now() },
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

      const newState = get();
      await newState.fetchQueue();
      if (newState.queue.length === 0 && activeTracks.length > 0) {
        if (newState.repeat === 'one' && track) {
          // Repeat One: re-queue the same track
          try { await invoke('add_to_queue', { path: track.path }); } catch (e) { }
        } else if (newState.repeat === 'none') {
          // Repeat None: don't queue past the last track
          const nextIndex = newState.shuffle
            ? Math.floor(Math.random() * activeTracks.length)
            : index + 1;
          if (nextIndex < activeTracks.length) {
            try { await invoke('add_to_queue', { path: activeTracks[nextIndex].path }); } catch (e) { }
          }
        } else {
          // Repeat All: wrap around
          const nextIndex = newState.shuffle
            ? Math.floor(Math.random() * activeTracks.length)
            : (index + 1) % activeTracks.length;
          try { await invoke('add_to_queue', { path: activeTracks[nextIndex].path }); } catch (e) { }
        }
      }
    } finally {
      isTransitioning = false;
    }
  },

  playNext: async () => {
    if (isSkipping) return;
    isSkipping = true;
    try {
      const { tracks, currentTrackIndex, shuffle, repeat, queue, playFromQueue, playTrack, currentTrack } = get();

      // Repeat One: replay current track immediately
      if (repeat === 'one' && currentTrack) {
        await playTrack(currentTrack, true, false);
        return;
      }

      // Manual queue priority
      if (queue.length > 0) {
         await playFromQueue(0);
         return;
      }

      // Prevent cloud/online streams from falling back to local files, and trigger Autoplay Loop if enabled
      const isCurrentTrackOnline = currentTrack?.path.startsWith('http://') || currentTrack?.path.startsWith('https://') || currentTrack?.format === 'Tidal FLAC';
      if (isCurrentTrackOnline) {
        if (get().autoplayEnabled && currentTrack) {
          window.dispatchEvent(new CustomEvent('ui-toast', { 
            detail: { message: `✨ Autoplay: Customizing your infinite radio...`, type: 'info' } 
          }));

          try {
            let recommendedTracks: Track[] = [];
            const seedTrack = get().autoplaySeedTrack || currentTrack;
            const isTidal = seedTrack.format === 'Tidal FLAC' || seedTrack.path.includes('api.tidal.com');

            if (isTidal) {
              let trackId = seedTrack.path;
              if (trackId.startsWith('http')) {
                const parts = trackId.split('/');
                trackId = parts[parts.length - 1] || trackId;
              }
              const tracks = await invoke<any[]>('get_tidal_autoplay_recommendations', {
                artist: seedTrack.artist || 'Unknown Artist',
                title: seedTrack.title || 'Unknown Title'
              });
              recommendedTracks = tracks.map(t => ({
                id: -20000 - Number(t.id),
                path: t.id,
                title: t.title,
                artist: t.artist,
                duration: t.duration,
                format: 'Tidal FLAC',
                lyric_offset: 0,
                cover_url: t.cover_url,
                is_autoplay: true
              }));
            } else {
              let videoId = '';
              const match = seedTrack.path.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/);
              if (match && match[1]) {
                videoId = match[1];
              } else if (seedTrack.path.startsWith('http')) {
                const urlParts = seedTrack.path.split(/[=]/);
                if (urlParts.length > 1) videoId = urlParts.pop() || '';
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
                artist: seedTrack.artist || 'Unknown Artist',
                title: seedTrack.title || 'Unknown Title',
                topArtists,
                libraryArtists,
                discoveryLevel,
                autoplayAlgorithm: get().autoplayAlgorithm || 'v2'
              });

              const parseDuration = (raw: string): number => {
                if (!raw) return 180;
                const parts = raw.split(':').map(Number);
                if (parts.some(isNaN)) return 180;
                let secs = 0;
                if (parts.length === 3) {
                  secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
                } else if (parts.length === 2) {
                  secs = parts[0] * 60 + parts[1];
                } else {
                  secs = parts[0] || 0;
                }
                return secs > 0 ? secs : 180;
              };

              recommendedTracks = tracks.map(t => ({
                id: -30000,
                path: t.url,
                title: t.title,
                artist: t.artist,
                duration: parseDuration(t.duration_raw),
                format: 'YouTube Direct',
                lyric_offset: 0,
                cover_url: t.cover_url,
                is_autoplay: true
              }));
            }

            // Filter out previously played tracks in current autoplay session, currently playing track, already queued tracks, and disliked tracks
            const playedSet = new Set(get().autoplaySessionHistory.map(t => t.path));
            const queuedSet = new Set(get().queue.map(t => t.path));
            const dislikedSet = new Set(get().tracks.filter(t => t.disliked === 1).map(t => t.path));
            const currentTrackPath = currentTrack?.path;

            const cleanText = (str: string | null) => {
              if (!str) return '';
              let val = str.toLowerCase();
              val = val.replace(/[\(\[][^\)\]]+[\)\]]/g, '');
              val = val.replace(/\s+(feat|ft|featuring|official\s+audio|official\s+video).*$/i, '');
              return val.trim();
            };

            const playedTitleArtistSet = new Set(
              get().autoplaySessionHistory.map(t => `${cleanText(t.artist)} - ${cleanText(t.title)}`)
            );

            const queuedTitleArtistSet = new Set(
              get().queue.map(t => `${cleanText(t.artist)} - ${cleanText(t.title)}`)
            );

            let finalRecommended = recommendedTracks.filter(t => 
              !playedSet.has(t.path) && 
              !queuedSet.has(t.path) && 
              !dislikedSet.has(t.path) &&
              t.path !== currentTrackPath &&
              !playedTitleArtistSet.has(`${cleanText(t.artist)} - ${cleanText(t.title)}`) &&
              !queuedTitleArtistSet.has(`${cleanText(t.artist)} - ${cleanText(t.title)}`)
            );

            if (finalRecommended.length === 0) {
              finalRecommended = recommendedTracks.filter(t => 
                !queuedSet.has(t.path) && 
                !dislikedSet.has(t.path) &&
                t.path !== currentTrackPath
              );
            }

            if (finalRecommended.length === 0) {
              finalRecommended = recommendedTracks.filter(t => !dislikedSet.has(t.path));
            }

            if (finalRecommended.length === 0) {
              finalRecommended = recommendedTracks;
            }

            if (finalRecommended.length > 0) {
              // Append top 10 recommended tracks to the queue
              for (const rt of finalRecommended.slice(0, 10)) {
                await get().addToQueue(rt);
              }
              // Play the first one immediately!
              await get().playFromQueue(0);
              return;
            }
          } catch (err) {
            console.error('Autoplay recommendation loop failed:', err);
          }
        }

        const allowAutoplay = localStorage.getItem('aideo_autoplay_local_for_cloud') === 'true';
        if (!allowAutoplay) {
          const { stopTrack } = get();
          await stopTrack();
          return;
        }
      }

      const isCurrentOnline = currentTrack?.path.startsWith('http://') || currentTrack?.path.startsWith('https://') || currentTrack?.format === 'Tidal FLAC';
      const activeTracks = isCurrentOnline
        ? tracks.filter(t => isStreamTrack(t.path, t.format))
        : tracks.filter(t => !isStreamTrack(t.path, t.format));

      if (activeTracks.length === 0) return;

      const currentActiveIdx = activeTracks.findIndex(t => pathsEqual(t.path, currentTrack?.path || ''));

      if (shuffle) {
        const nextIndex = Math.floor(Math.random() * activeTracks.length);
        await playTrack(activeTracks[nextIndex], undefined, false);
        return;
      }

      const nextIndex = (currentActiveIdx !== -1 ? currentActiveIdx : currentTrackIndex) + 1;

      // Repeat None: stop at end of library
      if (repeat === 'none' && nextIndex >= activeTracks.length) {
        const { stopTrack } = get();
        await stopTrack();
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
    const { tracks, currentTrackIndex, shuffle, repeat, queue, currentTrack } = get();

    if (repeat === 'one' && currentTrack) {
      return currentTrack;
    }

    if (queue.length > 0) {
      return queue[0];
    }

    const isCurrentOnline = currentTrack?.path.startsWith('http://') || currentTrack?.path.startsWith('https://') || currentTrack?.format === 'Tidal FLAC' || currentTrack?.format === 'YouTube Direct';
    const activeTracks = isCurrentOnline
      ? tracks.filter(t => isStreamTrack(t.path, t.format))
      : tracks.filter(t => !isStreamTrack(t.path, t.format));

    if (activeTracks.length === 0) return null;

    const currentActiveIdx = activeTracks.findIndex(t => pathsEqual(t.path, currentTrack?.path || ''));

    if (shuffle) {
      return null;
    }

    const nextIndex = (currentActiveIdx !== -1 ? currentActiveIdx : currentTrackIndex) + 1;

    if (repeat === 'none' && nextIndex >= activeTracks.length) {
      return null;
    }

    return activeTracks[nextIndex % activeTracks.length];
  },

  getNextTracksToPlay: (count = 2) => {
    const { tracks, currentTrackIndex, shuffle, repeat, queue, currentTrack } = get();
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
        const isCurrentOnline = currentTrack?.path.startsWith('http://') || currentTrack?.path.startsWith('https://') || currentTrack?.format === 'Tidal FLAC' || currentTrack?.format === 'YouTube Direct';
        const activeTracks = isCurrentOnline
          ? tracks.filter(t => isStreamTrack(t.path, t.format))
          : tracks.filter(t => !isStreamTrack(t.path, t.format));

        if (activeTracks.length > 0) {
          const currentActiveIdx = activeTracks.findIndex(t => pathsEqual(t.path, currentTrack?.path || ''));
          let nextIndex = (currentActiveIdx !== -1 ? currentActiveIdx : currentTrackIndex) + 1;

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
    const lookaheadEnabled = get().dsp?.lookahead_prebuffer_enabled ?? true;
    if (!lookaheadEnabled) return;

    const nextTracks = get().getNextTracksToPlay(2);
    for (const track of nextTracks) {
      if (!track) continue;
      
      const isOnline = track.path.startsWith('http://') || track.path.startsWith('https://') || track.format === 'Tidal FLAC' || track.format === 'YouTube Direct';
      if (!isOnline) continue;

      if (track.path.includes("youtube.com") || track.path.includes("youtu.be") || track.format === 'YouTube Direct') {
        console.log('[Pre-Cache] Pre-resolving YouTube track:', track.title);
        invoke('pre_resolve_youtube_url', { url: track.path }).catch(() => {});
      } 
      else if (track.format === 'Tidal FLAC') {
        console.log('[Pre-Cache] Pre-caching Tidal track:', track.title);
        (async () => {
          try {
            const cachedResolved = trackIdToStreamUrl.get(track.path);
            let finalUrl = '';
            if (cachedResolved && (Date.now() - cachedResolved.resolvedAt < 15 * 60 * 1000)) {
              finalUrl = cachedResolved.url;
            } else {
              finalUrl = await invoke<string>('tidal_get_stream_url', { trackId: track.path });
              trackIdToStreamUrl.set(track.path, { url: finalUrl, resolvedAt: Date.now() });
              resolvedPathMap.set(finalUrl, track.path);
            }
            if (finalUrl) {
              invoke('cache_cloud_track', { streamUrl: finalUrl }).catch(() => {});
            }
          } catch (e) {
            console.error('[Pre-Cache] Failed to pre-cache Tidal track:', e);
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
    if (isSkipping) return;
    isSkipping = true;
    try {
      const state = get();
      const { playHistory, tracks, currentTrackIndex, currentTrack } = state;
      
      // If we have history, pop the last track and play it
      if (playHistory.length > 0) {
        const newHistory = [...playHistory];
        const lastTrack = newHistory.pop()!;

        set({ playHistory: newHistory });
        await get().playTrack(lastTrack, true, false);
        return;
      }
      
      // Fallback: sequential previous from active library
      const isCurrentOnline = currentTrack?.path.startsWith('http://') || currentTrack?.path.startsWith('https://');
      const activeTracks = isCurrentOnline
        ? tracks.filter(t => isStreamTrack(t.path, t.format))
        : tracks.filter(t => !isStreamTrack(t.path, t.format));

      if (activeTracks.length === 0) return;
      const currentActiveIdx = activeTracks.findIndex(t => pathsEqual(t.path, currentTrack?.path || ''));
      const prevIndex = ((currentActiveIdx !== -1 ? currentActiveIdx : currentTrackIndex) - 1 + activeTracks.length) % activeTracks.length;
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
  },

  triggerAutoplayRadio: async (track: Track, forceReset = false) => {
    // Lock to the original user-clicked seed track to keep the radio centered on the same vibe!
    const seedTrack = get().autoplaySeedTrack || track;
    if (!seedTrack) return;
    const isCurrentTrackOnline = seedTrack.path.startsWith('http://') || seedTrack.path.startsWith('https://') || seedTrack.format === 'Tidal FLAC';
    if (!isCurrentTrackOnline || !get().autoplayEnabled) return;

    try {
      console.log(`[autoplay] Generating upcoming radio queue using seed: '${seedTrack.title}' by '${seedTrack.artist}'...`);
      let recommendedTracks: Track[] = [];
      const isTidal = seedTrack.format === 'Tidal FLAC' || seedTrack.path.includes('api.tidal.com');

      if (isTidal) {
        const tracks = await invoke<any[]>('get_tidal_autoplay_recommendations', {
          artist: seedTrack.artist || 'Unknown Artist',
          title: seedTrack.title || 'Unknown Title'
        });
        recommendedTracks = tracks.map(t => ({
          id: -20000 - Number(t.id),
          path: t.id,
          title: t.title,
          artist: t.artist,
          duration: t.duration,
          format: 'Tidal FLAC',
          lyric_offset: 0,
          cover_url: t.cover_url,
          is_autoplay: true
        }));
      } else {
        let videoId = '';
        const match = seedTrack.path.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/);
        if (match && match[1]) {
          videoId = match[1];
        } else if (seedTrack.path.startsWith('http')) {
          const urlParts = seedTrack.path.split(/[=]/);
          if (urlParts.length > 1) videoId = urlParts.pop() || '';
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
          artist: seedTrack.artist || 'Unknown Artist',
          title: seedTrack.title || 'Unknown Title',
          topArtists,
          libraryArtists,
          discoveryLevel,
          autoplayAlgorithm: get().autoplayAlgorithm || 'v2'
        });

        const parseDuration = (raw: string): number => {
          if (!raw) return 180;
          const parts = raw.split(':').map(Number);
          if (parts.some(isNaN)) return 180;
          let secs = 0;
          if (parts.length === 3) {
            secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
          } else if (parts.length === 2) {
            secs = parts[0] * 60 + parts[1];
          } else {
            secs = parts[0] || 0;
          }
          return secs > 0 ? secs : 180;
        };

        recommendedTracks = tracks.map(t => ({
          id: -30000,
          path: t.url,
          title: t.title,
          artist: t.artist,
          duration: parseDuration(t.duration_raw),
          format: 'YouTube Direct',
          lyric_offset: 0,
          cover_url: t.cover_url,
          is_autoplay: true
        }));
      }

      const currentQueue = get().queue;
      const manualQueue = currentQueue.filter(t => !t.is_autoplay);
      const existingAutoplay = forceReset ? [] : currentQueue.filter(t => t.is_autoplay);

      const cleanText = (str: string | null) => {
        if (!str) return '';
        let val = str.toLowerCase();
        val = val.replace(/[\(\[][^\)\]]+[\)\]]/g, '');
        val = val.replace(/\s+(feat|ft|featuring|official\s+audio|official\s+video).*$/i, '');
        return val.trim();
      };

      const playedTitleArtistSet = new Set(
        get().autoplaySessionHistory.map(t => `${cleanText(t.artist)} - ${cleanText(t.title)}`)
      );

      const playedSet = new Set(get().autoplaySessionHistory.map(t => t.path));
      const currentTrackPath = track.path;
      const existingPaths = new Set([
        currentTrackPath,
        ...manualQueue.map(t => t.path),
        ...existingAutoplay.map(t => t.path)
      ]);
      const existingTitleArtistSet = new Set([
        `${cleanText(track.artist)} - ${cleanText(track.title)}`,
        ...manualQueue.map(t => `${cleanText(t.artist)} - ${cleanText(t.title)}`),
        ...existingAutoplay.map(t => `${cleanText(t.artist)} - ${cleanText(t.title)}`)
      ]);

      const clearedSet = new Set(get().recentlyClearedAutoplayPaths || []);
      const dislikedSet = new Set(get().tracks.filter(t => t.disliked === 1).map(t => t.path));
      let finalRecommended = recommendedTracks.filter(t => 
        !playedSet.has(t.path) && 
        !playedTitleArtistSet.has(`${cleanText(t.artist)} - ${cleanText(t.title)}`) &&
        !existingPaths.has(t.path) && 
        !existingTitleArtistSet.has(`${cleanText(t.artist)} - ${cleanText(t.title)}`) &&
        !clearedSet.has(t.path) &&
        !dislikedSet.has(t.path)
      );
      if (finalRecommended.length === 0) {
        finalRecommended = recommendedTracks.filter(t => 
          !existingPaths.has(t.path) && 
          !existingTitleArtistSet.has(`${cleanText(t.artist)} - ${cleanText(t.title)}`) &&
          !clearedSet.has(t.path) &&
          !dislikedSet.has(t.path)
        );
      }
      if (finalRecommended.length === 0) {
        finalRecommended = recommendedTracks.filter(t => 
          !existingPaths.has(t.path) &&
          !existingTitleArtistSet.has(`${cleanText(t.artist)} - ${cleanText(t.title)}`) &&
          !dislikedSet.has(t.path)
        );
      }
      if (finalRecommended.length === 0) {
        finalRecommended = recommendedTracks.filter(t => !dislikedSet.has(t.path));
      }

      const needed = Math.max(0, 10 - existingAutoplay.length);
      const toAppend = finalRecommended.slice(0, needed);

      const newQueue = [...manualQueue, ...existingAutoplay, ...toAppend];
      set({ queue: newQueue });
      localStorage.setItem('aideo_queue', JSON.stringify(newQueue));

      await invoke('clear_queue');
      if (newQueue.length > 0) {
        const paths: string[] = [];
        for (const t of newQueue) {
          let p = t.path;
          if (t.format === 'Tidal FLAC' && !t.path.startsWith('http://') && !t.path.startsWith('https://')) {
            try {
              p = await invoke<string>('tidal_get_stream_url', { trackId: t.path });
              resolvedPathMap.set(p, t.path);
            } catch (err) {
              console.error('Failed to resolve Tidal autoplay recommended stream:', err);
            }
          }
          paths.push(p);
        }
        await invoke('add_to_queue_bulk', { paths });
      }

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
      const currentQueue = get().queue;
      const filtered = currentQueue.filter(t => !t.is_autoplay);
      set({ queue: filtered });
      localStorage.setItem('aideo_queue', JSON.stringify(filtered));

      try {
        await invoke('clear_queue');
        if (filtered.length > 0) {
          const paths = filtered.map(t => t.path);
          await invoke('add_to_queue_bulk', { paths });
        }
      } catch (err) {
        console.error('Failed to sync backend queue after disabling autoplay:', err);
      }
    }
  },

  setAutoplayDiscoveryLevel: (level: 'familiarity' | 'balanced' | 'discovery') => {
    localStorage.setItem('aideo_autoplay_discovery_level', level);
    set({ autoplayDiscoveryLevel: level });
  },

  setAutoplayAlgorithm: (algo: 'v1' | 'v2') => {
    localStorage.setItem('aideo_autoplay_algorithm', algo);
    set({ autoplayAlgorithm: algo });
  },

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

  toggleLoveTrack: async (path: string, metadata?: Partial<Track>) => {
    try {
      const track = get().tracks.find(t => pathsEqual(t.path, path))
        || (pathsEqual(get().currentTrack?.path, path) ? get().currentTrack : null)
        || (metadata ? { path, ...metadata } as Track : null);

      if (!track) return;
      const isLovedNow = track.loved === 1 ? 0 : 1;

      await invoke('toggle_love_track', {
        path,
        loved: isLovedNow === 1,
        title: track.title || null,
        artist: track.artist || null,
        album: track.album || null,
        duration: track.duration || null,
        format: track.format || null,
        coverUrl: track.cover_url || null
      });

      // Update tracks array in-place
      const updatedTracks = get().tracks.map(t => {
        if (pathsEqual(t.path, path)) {
          return { ...t, loved: isLovedNow };
        }
        return t;
      });
      set({ tracks: updatedTracks });

      // Update currentTrack in-place if it matches
      const current = get().currentTrack;
      if (current && pathsEqual(current.path, path)) {
        set({ currentTrack: { ...current, loved: isLovedNow } });
      }

      const updatedQueue = get().queue.map(q => {
        if (pathsEqual(q.path, path)) {
          return { ...q, loved: isLovedNow };
        }
        return q;
      });
      set({ queue: updatedQueue });

      await get().fetchPlaylists();

      const playlist = get().currentPlaylist;
      if (playlist) {
        await get().loadPlaylistTracks(playlist.id);
      }
    } catch (e) {
      console.error('toggleLoveTrack:', e);
    }
  },

  toggleDislikeTrack: async (path: string, metadata?: Partial<Track>) => {
    try {
      const track = get().tracks.find(t => pathsEqual(t.path, path))
        || (pathsEqual(get().currentTrack?.path, path) ? get().currentTrack : null)
        || (metadata ? { path, ...metadata } as Track : null);

      if (!track) return;
      const isDislikedNow = track.disliked === 1 ? 0 : 1;

      await invoke('toggle_dislike_track', {
        path,
        disliked: isDislikedNow === 1,
        title: track.title || null,
        artist: track.artist || null,
        album: track.album || null,
        duration: track.duration || null,
        format: track.format || null,
        coverUrl: track.cover_url || null
      });

      // Update tracks array in-place
      const updatedTracks = get().tracks.map(t => {
        if (pathsEqual(t.path, path)) {
          return { ...t, disliked: isDislikedNow, loved: isDislikedNow === 1 ? 0 : t.loved };
        }
        return t;
      });
      set({ tracks: updatedTracks });

      // Update currentTrack in-place if it matches
      const current = get().currentTrack;
      if (current && pathsEqual(current.path, path)) {
        set({ currentTrack: { ...current, disliked: isDislikedNow, loved: isDislikedNow === 1 ? 0 : current.loved } });
      }

      // If disliking, also remove it from the active queue!
      if (isDislikedNow === 1) {
        const currentQueue = get().queue;
        const matchingIndices: number[] = [];
        currentQueue.forEach((t, i) => {
          if (pathsEqual(t.path, path)) {
            matchingIndices.push(i);
          }
        });

        if (matchingIndices.length > 0) {
          const newQueue = currentQueue.filter(t => !pathsEqual(t.path, path));
          set({ queue: newQueue });
          localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
          
          for (let i = matchingIndices.length - 1; i >= 0; i--) {
            await invoke('remove_from_queue', { index: matchingIndices[i] }).catch(console.error);
          }
        }
      }

      const updatedQueue = get().queue.map(q => {
        if (pathsEqual(q.path, path)) {
          // If disliking, loved must be 0!
          return { ...q, disliked: isDislikedNow, loved: isDislikedNow === 1 ? 0 : q.loved };
        }
        return q;
      });
      set({ queue: updatedQueue });

      await get().fetchPlaylists();

      const playlist = get().currentPlaylist;
      if (playlist) {
        await get().loadPlaylistTracks(playlist.id);
      }
      
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: isDislikedNow === 1 ? 'Added to disliked tracks' : 'Removed from disliked tracks', type: 'info' } 
      }));
    } catch (e) {
      console.error('toggleDislikeTrack:', e);
    }
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

  generateSmartMix: async (mood: string, trendSource: string) => {
    const tracks = get().tracks;
    if (tracks.length === 0) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Your library is empty. Add a music folder first.', type: 'warning' } }));
      return;
    }

    try {
      // 1. Define Mood Keywords
      let keywords: string[] = [];
      const moodLower = mood.toLowerCase();
      if (moodLower === 'energetic') {
        keywords = ['rock', 'dance', 'metal', 'energy', 'upbeat', 'electronic', 'gym', 'fast', 'hype', 'hard', 'heavy', 'loud', 'synthwave', 'run', 'workout'];
      } else if (moodLower === 'chill') {
        keywords = ['chill', 'relax', 'acoustic', 'slow', 'ambient', 'lofi', 'lo-fi', 'sleep', 'jazz', 'folk', 'cozy', 'soft', 'calm', 'smooth'];
      } else if (moodLower === 'focus') {
        keywords = ['focus', 'study', 'coding', 'instrument', 'classical', 'piano', 'ambient', 'synth', 'study', 'instrumental', 'post-rock'];
      } else if (moodLower === 'melancholic') {
        keywords = ['sad', 'blue', 'rain', 'dark', 'tear', 'cry', 'slow', 'emotional', 'acoustic', 'autumn', 'cold', 'lost', 'memory', 'melancholic'];
      } else if (moodLower === 'happy') {
        keywords = ['happy', 'joy', 'sun', 'summer', 'pop', 'fun', 'disco', 'bright', 'smile', 'positive', 'feel-good', 'celebrate'];
      }

      // 2. Score tracks based on mood keywords
      let moodTracks = tracks.filter(t => {
        const title = (t.title || '').toLowerCase();
        const artist = (t.artist || '').toLowerCase();
        const album = (t.album || '').toLowerCase();
        return keywords.some(k => title.includes(k) || artist.includes(k) || album.includes(k));
      });

      // Fallback if mood matches are thin
      if (moodTracks.length < 5) {
        moodTracks = [...tracks];
      }

      // 3. Re-rank based on seed/trend source
      let sortedTracks = [...moodTracks];
      const sourceLower = trendSource.toLowerCase();

      if (sourceLower.includes('history')) {
        // Library Play Counts
        const counts = get().playCounts;
        sortedTracks.sort((a, b) => (counts[b.path] || 0) - (counts[a.path] || 0));
      } else if (sourceLower.includes('last.fm')) {
        // Last.fm Top Artists scrobble trends
        const lfmArtists = (get().lastfmTopArtists || []).map((a: any) => (a.name || '').toLowerCase());
        if (lfmArtists.length > 0) {
          sortedTracks.sort((a, b) => {
            const aArtist = (a.artist || '').toLowerCase();
            const bArtist = (b.artist || '').toLowerCase();
            const aMatches = lfmArtists.some((la: string) => aArtist.includes(la) || la.includes(aArtist));
            const bMatches = lfmArtists.some((la: string) => bArtist.includes(la) || la.includes(bArtist));
            return (bMatches ? 1 : 0) - (aMatches ? 1 : 0);
          });
        }
      } else if (sourceLower.includes('listenbrainz')) {
        // ListenBrainz Recent Scrobbles scrobble trends
        const lbListens = (get().listenbrainzRecent || []).map((l: any) => {
          const meta = l.track_metadata;
          return (meta?.artist_name || '').toLowerCase();
        });
        if (lbListens.length > 0) {
          sortedTracks.sort((a, b) => {
            const aArtist = (a.artist || '').toLowerCase();
            const bArtist = (b.artist || '').toLowerCase();
            const aMatches = lbListens.some((lb: string) => aArtist.includes(lb) || lb.includes(aArtist));
            const bMatches = lbListens.some((lb: string) => bArtist.includes(lb) || lb.includes(bArtist));
            return (bMatches ? 1 : 0) - (aMatches ? 1 : 0);
          });
        }
      }

      // Select top 20 tracks for our smart mix
      const selectedMix = sortedTracks.slice(0, 20);
      if (selectedMix.length === 0) return;

      // 4. Create/Sync a local playlist named "AI Smart Mix - [Mood]"
      const playlistName = `AI Smart Mix - ${mood}`;
      await invoke('create_playlist', { name: playlistName });
      await get().fetchPlaylists();

      // Find the playlist ID
      const targetPlaylist = get().playlists.find(p => p.name === playlistName);
      if (targetPlaylist) {
        // Clear old tracks in this playlist
        await invoke('delete_playlist', { id: targetPlaylist.id });
        await invoke('create_playlist', { name: playlistName });
        await get().fetchPlaylists();
        const reCreated = get().playlists.find(p => p.name === playlistName);
        if (reCreated) {
          for (const t of selectedMix) {
            await invoke('add_to_playlist', { playlistId: reCreated.id, path: t.path });
          }
        }
      }

      // 5. Play first track and queue the rest
      const upcoming = selectedMix.slice(1);
      set({ queue: upcoming });
      localStorage.setItem('aideo_queue', JSON.stringify(upcoming));

      await invoke('clear_queue');
      if (upcoming.length > 0) {
        const paths = upcoming.map(t => t.path);
        await invoke('add_to_queue_bulk', { paths });
      }

      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Generated dynamic offline AI mix: "${playlistName}"`, type: 'success' } }));
      
      await get().playTrack(selectedMix[0]);
      get().setView('nowplaying');
    } catch (err) {
      console.error('generateSmartMix:', err);
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

    const upcomingTracks = selectedTracks.slice(1);
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
  setCacheSizeLimit: (limit: number) => {
    set({ cacheSizeLimit: limit });
    localStorage.setItem('aideo_cache_size_limit', String(limit));
    invoke('prune_cache_to_limit', { limitGb: limit }).catch((e) => {
      console.error('Failed to prune cache to limit:', e);
    });
  },
});
