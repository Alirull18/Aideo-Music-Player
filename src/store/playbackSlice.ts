import { StateCreator } from 'zustand';
import { PlayerState, DSPState, Track } from './types';
import { invoke } from '@tauri-apps/api/core';

export const createPlaybackSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  playback: { status: 'Stopped', current_track: null, position_secs: 0, volume: 1.0, exclusive: false, bit_perfect: false, dev_rate: 0, driver_type: 'WASAPI' },
  dsp: { width: 1.0, enabled: false, upsample_rate: 0, dither: false },
  devices: [],
  currentDevice: null,
  showQueue: false,
  queue: [],

  updateDiscordPresence: () => {
    const { playback, tracks } = get();
    if (!playback.current_track) {
      invoke('update_discord_presence', { details: "Idle", stateStr: "Browsing Library", isPlaying: false });
      return;
    }
    const track = tracks.find(t => t.path === playback.current_track);
    const details = track?.title || 'Unknown Track';
    const stateStr = `by ${track?.artist || 'Unknown Artist'}`;
    invoke('update_discord_presence', {
      details,
      stateStr,
      isPlaying: playback.status === 'Playing'
    });
  },

  pauseTrack: async () => {
    try {
      await invoke('pause_track');
      await invoke('update_media_playback', { playing: false });
      set(s => ({ playback: { ...s.playback, status: 'Paused' } }));
      get().updateDiscordPresence();
    } catch (e) { console.error(e); }
  },

  resumeTrack: async () => {
    try {
      const state = get();
      if (state.playback.status === 'Stopped') {
        const targetPath = state.playback.current_track || state.playback.last_played_track;
        if (targetPath) {
          const t = state.tracks.find(x => x.path === targetPath);
          if (t) {
            get().playTrack(t);
            return;
          } else if (targetPath.startsWith('http')) {
            get().playStream(targetPath);
            return;
          }
        }
      }
      await invoke('resume_track');
      await invoke('update_media_playback', { playing: true });
      set(s => ({ playback: { ...s.playback, status: 'Playing' } }));
      get().updateDiscordPresence();
    } catch (e) { console.error(e); }
  },

  stopTrack: async () => {
    try {
      const current = get().playback.current_track;
      await invoke('stop_track');
      
      const isUrl = current?.startsWith('http');
      
      set({
        playback: { 
          ...get().playback, 
          status: 'Stopped',
          current_track: isUrl ? null : current,
          last_played_track: current || get().playback.last_played_track,
          position_secs: 0 
        },
        coverArt: isUrl ? null : get().coverArt,
        lyrics: isUrl ? [] : get().lyrics,
      });
      get().updateDiscordPresence();
    } catch (e) { console.error(e); }
  },

  setVolume: async (vol: number) => {
    try {
      await invoke('set_volume', { volume: vol });
      set(s => ({ playback: { ...s.playback, volume: vol } }));
    } catch (e) { console.error(e); }
  },

  seek: async (secs: number) => {
    set(s => ({ playback: { ...s.playback, position_secs: secs } }));
    try { await invoke('seek_track', { secs }); } catch (e) { console.error(e); }
  },

  pollStatus: async () => {
    try {
      const status: any = await invoke('get_playback_status');
      if (!status) return;

      const prevTrack = get().playback.current_track;
      const newTrack = status.current_track;

      // Anti-Race Condition: If frontend eagerly set a track but backend is still booting it up,
      // the backend will temporarily return null/Stopped. Ignore it to prevent wiping the UI.
      if (prevTrack && !newTrack && status.status === 'Stopped') {
        return;
      }

      // Strict Anti-Bounce: The frontend is the source of truth for track selections.
      // If the backend reports a different track, it means the Rust audio pipeline 
      // is still processing previous skip commands and lagging behind the UI.
      if (prevTrack && newTrack && newTrack !== prevTrack) {
        const timeSinceSkip = Date.now() - (get().playback.last_skip_time || 0);
        if (timeSinceSkip < 2000) {
          return;
        }
        // If it's been more than 2 seconds since the last skip, this must be a natural track transition (e.g. backend reached EOF and played next in queue)
        get().handleTrackTransition(newTrack);
        return;
      }

      // Initial startup sync or backend-driven recovery
      if (!prevTrack && newTrack) {
        get().handleTrackTransition(newTrack);
        return;
      }

      set(s => ({ playback: { ...s.playback, ...status } }));

      if (!status.current_track && get().coverArt) {
        set({ coverArt: null, accentColor: '#8b5cf6', lyrics: [], lyricStatus: 'idle' });
      }

      // Auto Scrobble Logic
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

  setDSP: async (newDSP: Partial<DSPState>) => {
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

  toggleBitPerfect: async () => {
    try {
      const res: boolean = await invoke('toggle_bit_perfect_mode');
      if (res) {
        await get().setDSP({ enabled: false, upsample_rate: 0 });
        await get().setVolume(1.0);
      }
      set(s => ({ playback: { ...s.playback, bit_perfect: res } }));
    } catch (e) { console.error(e); }
  },

  fetchDevices: async () => {
    try {
      const ds: string[] = await invoke('get_audio_devices');
      set({ devices: ds });
    } catch (e) { console.error(e); }
  },

  setAudioDevice: async (name: string) => {
    try {
      await invoke('set_audio_device', { name });
      set({ currentDevice: name });
    } catch (e) { console.error(e); }
  },

  setDriverType: (type: 'WASAPI' | 'ASIO') => {
    set(s => ({ playback: { ...s.playback, driver_type: type } }));
  },

  playStream: async (url: string) => {
    try {
      set({
        coverArt: null,
        accentColor: '#8b5cf6',
        lyrics: [],
        lyricStatus: 'idle',
        playback: { ...get().playback, current_track: url, status: 'Playing', position_secs: 0 },
      });
      await invoke('play_track', { path: url });

      // Update OS media controls
      invoke('update_media_metadata', {
        title: url.split('/').pop() || 'Live Stream',
        artist: 'Online Radio',
        coverUrl: null,
        duration: 0,
      }).catch(() => { });

      await invoke('update_media_playback', { playing: true });
    } catch (e) { console.error('playStream error:', e); }
  },

  addToQueue: async (track: Track) => {
    try {
      await invoke('add_to_queue', { path: track.path });
      const newQueue = [...get().queue, track];
      set({ queue: newQueue });
      localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
    } catch (e) { console.error(e); }
  },

  playNextInQueue: async (track: Track) => {
    try {
      await invoke('queue_next', { path: track.path });
      const newQueue = [track, ...get().queue];
      set({ queue: newQueue });
      localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
    } catch (e) { console.error(e); }
  },

  playFromQueue: async (index: number) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    
    const trackToPlay = queue[index];
    const newQueue = queue.slice(index + 1);
    
    // SSOT: Update React state immediately so rapid clicks don't double-pop
    set({ queue: newQueue });
    localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
    
    // Fire-and-forget the Rust IPC calls so we don't block the UI
    (async () => {
        for (let i = 0; i <= index; i++) {
            await invoke('remove_from_queue', { index: 0 }).catch(() => {});
        }
    })();
    
    get().playTrack(trackToPlay);
  },

  removeFromQueue: async (index: number) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    try {
      await invoke('remove_from_queue', { index });
      const newQueue = [...queue];
      newQueue.splice(index, 1);
      set({ queue: newQueue });
      localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
    } catch (e) { console.error(e); }
  },

  clearQueue: async () => {
    try {
      await invoke('clear_queue');
      set({ queue: [] });
      localStorage.setItem('aideo_queue', JSON.stringify([]));
    } catch (e) { console.error(e); }
  },

  reorderQueue: async (from: number, to: number) => {
    const { queue } = get();
    if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return;
    
    try {
      await invoke('reorder_queue', { from, to });
      const newQueue = [...queue];
      const [item] = newQueue.splice(from, 1);
      newQueue.splice(to, 0, item);
      set({ queue: newQueue });
      localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
    } catch (e) { console.error(e); }
  },

  initializeQueue: async () => {
    try {
      const saved = localStorage.getItem('aideo_queue');
      if (saved) {
        const parsed: Track[] = JSON.parse(saved);
        if (parsed.length > 0) {
          await invoke('clear_queue');
          for (const track of parsed) {
            await invoke('add_to_queue', { path: track.path });
          }
          set({ queue: parsed });
        }
      }
    } catch (e) { console.error("Failed to initialize queue:", e); }
  },

  fetchQueue: async () => {
    try {
      const paths: string[] = await invoke('get_queue');
      const { tracks } = get();
      const queueTracks = paths.map(p => tracks.find(t => t.path === p)).filter(t => !!t) as Track[];
      set({ queue: queueTracks });
      localStorage.setItem('aideo_queue', JSON.stringify(queueTracks));
    } catch (e) { console.error(e); }
  },

  toggleQueue: () => {
    set(s => ({ showQueue: !s.showQueue }));
  },
});
