import { StateCreator } from 'zustand';
import { PlayerState, DSPState, Track, extractDominantColor } from './types';
import { invoke } from '@tauri-apps/api/core';
import { getStreamName, baseName, pathsEqual, parseStreamMetadata, resolvedPathMap, onlineTrackCache, trackIdToStreamUrl } from '../utils';

let isPolling = false;
let dspThrottleTimeout: any = null;
let lastDspInvokeTime = 0;
let pendingDspState: any = null;
let chromecastTickCount = 0;
let queueOperationPromise = Promise.resolve();
export const chainQueueOperation = (op: () => Promise<any>): Promise<any> => {
  queueOperationPromise = queueOperationPromise.then(op);
  return queueOperationPromise;
};

const THROTTLE_MS = 50; // 20Hz update rate — imperceptibly fast for DSP but prevents IPC flooding on slower machines

const performDspInvoke = async (dsp: any) => {
  try {
    await invoke('set_dsp_state', { dsp });
    lastDspInvokeTime = Date.now();
  } catch (e) {
    console.error('set_dsp_state error:', e);
  }
};

export const createPlaybackSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  networkTelemetry: null,
  playback: {
    status: 'Stopped',
    current_track: (() => {
      try {
        const tr = JSON.parse(localStorage.getItem('aideo_current_track') || 'null');
        return tr ? tr.path : null;
      } catch {
        return null;
      }
    })(),
    position_secs: 0,
    volume: 1.0,
    exclusive: false,
    bit_perfect: false,
    dev_rate: 0,
    driver_type: 'WASAPI'
  },
  dsp: {
    enabled: false,
    low_spec_mode: localStorage.getItem('aideo_low_spec') === 'true',
    audio_profile: (localStorage.getItem('aideo_audio_profile') as any) || 'normal',
    resampler_interpolation: (localStorage.getItem('aideo_resampler_interpolation') as any) || 'linear',
    resampler_sinc_len: Number(localStorage.getItem('aideo_resampler_sinc_len') || 128) as any,
    resampler_oversampling: Number(localStorage.getItem('aideo_resampler_oversampling') || 256) as any,
    ffmpeg_transcode_quality: (localStorage.getItem('aideo_ffmpeg_transcode_quality') as any) || 'studio',
    width: 1.0,
    upsample_rate: 0,
    dither: false,
    exclusive_mode_timing: (localStorage.getItem('aideo_exclusive_timing') as any) || 'polling',
    preamp_gain: Number(localStorage.getItem('aideo_preamp_gain') || 0.0),
    limiter_threshold: Number(localStorage.getItem('aideo_limiter_threshold') || -0.1),
    resampler_phase_mode: (localStorage.getItem('aideo_resampler_phase_mode') as any) || 'linear',
    eq_enabled: false,
    eq_parametric: false,
    eq_graphic_gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    eq_parametric_bands: [
      { freq: 80, gain: 0, q: 0.7, band_type: 'lowshelf' },
      { freq: 120, gain: 0, q: 1.0, band_type: 'peaking' },
      { freq: 240, gain: 0, q: 1.0, band_type: 'peaking' },
      { freq: 400, gain: 0, q: 1.0, band_type: 'peaking' },
      { freq: 750, gain: 0, q: 1.0, band_type: 'peaking' },
      { freq: 1500, gain: 0, q: 1.0, band_type: 'peaking' },
      { freq: 2200, gain: 0, q: 1.0, band_type: 'peaking' },
      { freq: 4000, gain: 0, q: 1.0, band_type: 'peaking' },
      { freq: 6000, gain: 0, q: 0.7, band_type: 'highshelf' },
      { freq: 10000, gain: 0, q: 0.7, band_type: 'peaking' }
    ],
    crossfeed_enabled: false,
    crossfeed_level: -6.0,
    crossfeed_corner: 700.0,
    spatial_enabled: false,
    spatial_haas_delay: 7.5,
    spatial_wet: 0.15,
    subsonic_enabled: false,
    night_mode_enabled: false,
    r128_enabled: false,
    aideo_filter_enabled: localStorage.getItem('aideo_filter_enabled') === 'true',
    aideo_filter_room_size: Number(localStorage.getItem('aideo_filter_room_size') || 0.85),
    aideo_filter_bass_thump: Number(localStorage.getItem('aideo_filter_bass_thump') || 6.0),
    aideo_filter_dampening: Number(localStorage.getItem('aideo_filter_dampening') || 0.5),
    auto_headroom: localStorage.getItem('aideo_auto_headroom') === 'true',
    saturation_enabled: localStorage.getItem('aideo_saturation_enabled') === 'true',
    saturation_drive: Number(localStorage.getItem('aideo_saturation_drive') || 0.0),
    crossfade_transition_enabled: localStorage.getItem('aideo_crossfade_enabled') === 'true',
    crossfade_transition_duration: Number(localStorage.getItem('aideo_crossfade_duration') || 5.0),
    stream_engine: (localStorage.getItem('aideo_stream_engine') || 'yt-dlp') as 'yt-dlp' | 'reqwest',
    lookahead_prebuffer_enabled: localStorage.getItem('aideo_lookahead_prebuffer') !== 'false'
  },
  devices: [],
  currentDevice: null,
  showQueue: false,
  queue: [],

  chromecast_devices: [],
  chromecast_active_device: null,
  chromecast_scanning: false,
  chromecast_connected: false,

  updateDiscordPresence: () => {
    const { playback, tracks, discordEnabled } = get();
    if (!discordEnabled) {
      invoke('clear_discord_presence').catch(console.error);
      return;
    }
    if (!playback.current_track) {
      invoke('update_discord_presence', { details: "Idle", stateStr: "Browsing Library", isPlaying: false });
      return;
    }
    const track = tracks.find(t => pathsEqual(t.path, playback.current_track));
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
      if (get().chromecast_connected) {
        await invoke('chromecast_control', { action: 'pause' });
      } else {
        await invoke('pause_track');
        await invoke('update_media_playback', { playing: false });
      }
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
          let t = state.tracks.find(x => pathsEqual(x.path, targetPath));
          if (!t) {
            t = state.queue.find(x => pathsEqual(x.path, targetPath));
          }
          if (!t && state.currentTrack && pathsEqual(state.currentTrack.path, targetPath)) {
            t = state.currentTrack;
          }
          
          if (t) {
            get().playTrack(t);
            return;
          } else if (targetPath.startsWith('http')) {
            get().playStream(targetPath);
            return;
          }
        }
      }
      if (state.chromecast_connected) {
        await invoke('chromecast_control', { action: 'resume' });
      } else {
        await invoke('resume_track');
        await invoke('update_media_playback', { playing: true });
      }
      set(s => ({ playback: { ...s.playback, status: 'Playing' } }));
      get().updateDiscordPresence();
    } catch (e) { console.error(e); }
  },

  stopTrack: async () => {
    try {
      await get().recordPlaybackTransition(null);
      const current = get().playback.current_track;
      if (get().chromecast_connected) {
        await invoke('chromecast_control', { action: 'stop' });
      } else {
        await invoke('stop_track');
      }
      
      localStorage.removeItem('aideo_current_track');
      set({
        currentTrack: null,
        playback: { 
          ...get().playback, 
          status: 'Stopped',
          current_track: null,
          last_played_track: current || get().playback.last_played_track,
          position_secs: 0 
        },
        coverArt: null,
        lyrics: [],
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
    const now = Date.now();
    set(s => ({ playback: { ...s.playback, position_secs: secs, last_seek_time: now } }));
    try {
      if (get().chromecast_connected) {
        await invoke('chromecast_control', { action: 'seek', value: secs });
      } else {
        await invoke('seek_track', { secs });
      }
    } catch (e) { console.error(e); }
  },

  pollStatus: async () => {
    if (get().chromecast_connected) {
      chromecastTickCount++;
      const currentStatus = get().playback.status;
      
      // Eager local estimation for smooth progress bar updates
      if (currentStatus === 'Playing') {
        const currentTrack = get().currentTrack;
        const dur = currentTrack?.duration || 0;
        set(s => {
          let nextPos = s.playback.position_secs + 0.2;
          if (dur > 0 && nextPos >= dur) {
            nextPos = dur;
          }
          return {
            playback: {
              ...s.playback,
              position_secs: nextPos
            }
          };
        });
      }

      // Query actual Chromecast device status every 5 ticks (1 second) to correct drift
      if (chromecastTickCount >= 5) {
        chromecastTickCount = 0;
        const lastSeekTime = get().playback.last_seek_time || 0;
        const lastSkipTime = get().playback.last_skip_time || 0;
        const now = Date.now();
        
        // If we recently seeked or skipped (within the last 2 seconds), don't overwrite position with stale Chromecast status
        const isTransitioning = (now - lastSeekTime < 2000) || (now - lastSkipTime < 2500);

        try {
          const status: any = await invoke('chromecast_get_status');
          if (status) {
            set(s => {
              const nextStatus = status.status;
              const nextPos = isTransitioning ? s.playback.position_secs : status.position_secs;
              
              // If the song finished naturally, transition to next track
              if (nextStatus === 'Stopped' && status.idle_reason === 'Finished' && s.playback.status === 'Playing' && !isTransitioning) {
                setTimeout(() => {
                  get().playNext();
                }, 100);
              }
              
              return {
                playback: {
                  ...s.playback,
                  status: nextStatus,
                  position_secs: nextPos,
                  volume: status.volume,
                }
              };
            });
          }
        } catch (e) {
          console.error('Failed to get Chromecast status:', e);
        }
      }
      return;
    }
    if (isPolling) return;
    isPolling = true;
    try {
      const state = get();
      const currentStatus = state.playback.status;
      if (currentStatus === 'Stopped' || currentStatus === 'Paused') {
        const lastPollTime = state.playback.last_poll_time || 0;
        const now = Date.now();
        if (now - lastPollTime < 2000) {
          return;
        }
        set(s => ({ playback: { ...s.playback, last_poll_time: now } }));
      }

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
      if (prevTrack && newTrack && !pathsEqual(newTrack, prevTrack)) {
        const timeSinceSkip = Date.now() - (get().playback.last_skip_time || 0);
        if (timeSinceSkip < 800) {
          return;
        }
        // If it's been more than 800ms since the last skip, this must be a natural track transition (e.g. backend reached EOF and played next in queue)
        await get().handleTrackTransition(newTrack);
        return;
      }

      // Initial startup sync or backend-driven recovery
      if (!prevTrack && newTrack) {
        await get().handleTrackTransition(newTrack);
        return;
      }

      set(s => ({ playback: { ...s.playback, ...status } }));

      if (status.network_telemetry && status.current_track && (status.current_track.startsWith('http://') || status.current_track.startsWith('https://'))) {
        set({ networkTelemetry: status.network_telemetry });
      } else if (get().networkTelemetry !== null) {
        set({ networkTelemetry: null });
      }

      if (!status.current_track && get().coverArt) {
        set({ coverArt: null, accentColor: '#8b5cf6', lyrics: [], lyricStatus: 'idle' });
      }

      // Auto Scrobble Logic
      const { current_track, position_secs } = status;
      const { 
        scrobbleEnabled, lastfmSessionKey, 
        listenbrainzEnabled, listenbrainzToken, 
        scrobbledCurrent, tracks, scrobbleThreshold 
      } = get();

      const canLfm = scrobbleEnabled && lastfmSessionKey;
      const canLb = listenbrainzEnabled && listenbrainzToken;

      if ((canLfm || canLb) && !scrobbledCurrent && current_track && status.status === 'Playing') {
        const tr = tracks.find(t => pathsEqual(t.path, current_track));
        if (tr && tr.artist && tr.title) {
          const dur = tr.duration || 200;
          const thresholdSecs = (scrobbleThreshold / 100) * dur;
          if (position_secs > thresholdSecs || position_secs > 240) {
            set({ scrobbledCurrent: true });
            const ts = Math.floor(Date.now() / 1000) - Math.floor(position_secs);

            // 1. Last.fm Scrobble
            if (canLfm) {
              invoke('lastfm_scrobble', { artist: tr.artist, track: tr.title, timestamp: ts, sessionKey: lastfmSessionKey })
                .then(() => {
                  set({ lastScrobble: { artist: tr.artist ?? 'Unknown', track: tr.title ?? 'Unknown' } });
                  setTimeout(() => set({ lastScrobble: null }), 5000);
                })
                .catch((e: any) => {
                  const msg = String(e);
                  console.error('Last.fm Scrobble error:', msg);
                  set({ lastScrobble: { artist: '⚠️ Last.fm Failed', track: msg } });
                  setTimeout(() => set({ lastScrobble: null }), 8000);
                });
            }

            // 2. ListenBrainz Scrobble (Natively in Rust)
            if (canLb) {
              invoke('listenbrainz_scrobble', {
                artist: tr.artist,
                track: tr.title,
                timestamp: ts,
                token: listenbrainzToken
              })
              .then(() => {
                if (!canLfm) {
                  // Only show toast status if Last.fm isn't already doing it
                  set({ lastScrobble: { artist: `${tr.artist} (LB)`, track: tr.title ?? 'Unknown' } });
                  setTimeout(() => set({ lastScrobble: null }), 5000);
                }
              })
              .catch(e => {
                console.error('ListenBrainz scrobble error:', e);
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('pollStatus error:', e);
      invoke('log_error', { msg: `pollStatus error: ${e}` }).catch(() => {});
    } finally {
      isPolling = false;
    }
  },

  setDSP: async (newDSP: Partial<DSPState>) => {
    // 🛡️ Bit-Perfect vs. DSP Coexistence: If the user interacts with any Aideo Lab DSP/equalizer controls
    // while Bit-Perfect is active, automatically turn Bit-Perfect OFF so their audio adjustments take effect immediately.
    const dspKeys = [
      'enabled', 'eq_enabled', 'eq_parametric', 'eq_graphic_gains', 
      'eq_parametric_bands', 'crossfeed_enabled', 'crossfeed_level', 
      'crossfeed_corner', 'spatial_enabled', 'spatial_haas_delay', 
      'spatial_wet', 'subsonic_enabled', 'night_mode_enabled', 
      'r128_enabled', 'width', 'upsample_rate', 'dither',
      'aideo_filter_enabled', 'aideo_filter_room_size', 'aideo_filter_bass_thump', 
      'aideo_filter_dampening', 'preamp_gain', 'limiter_threshold', 'resampler_phase_mode',
      'auto_headroom', 'saturation_enabled', 'saturation_drive', 
      'crossfade_transition_enabled', 'crossfade_transition_duration',
      'stream_engine', 'lookahead_prebuffer_enabled'
    ];
    const isActivatingDSP = dspKeys.some(key => {
      if (key === 'upsample_rate') {
        return newDSP.upsample_rate !== undefined && newDSP.upsample_rate > 0;
      }
      if (key === 'enabled') {
        return newDSP.enabled === true;
      }
      return (newDSP as any)[key] !== undefined;
    });

    if (isActivatingDSP && get().playback.bit_perfect) {
      try {
        await get().toggleBitPerfect();
      } catch (e) {
        console.error('Failed to toggle bit-perfect off:', e);
      }
      newDSP.enabled = true;
    }

    let full = { ...get().dsp, ...newDSP } as DSPState;

    // A. If the user changed the overall preset directly
    if (newDSP.audio_profile !== undefined && newDSP.audio_profile !== 'custom') {
      const preset = newDSP.audio_profile;
      if (preset === 'low') {
        full.resampler_interpolation = 'linear';
        full.resampler_sinc_len = 64;
        full.resampler_oversampling = 128;
        full.ffmpeg_transcode_quality = 'standard';
      } else if (preset === 'normal') {
        full.resampler_interpolation = 'cubic';
        full.resampler_sinc_len = 128;
        full.resampler_oversampling = 256;
        full.ffmpeg_transcode_quality = 'studio';
      } else if (preset === 'high') {
        full.resampler_interpolation = 'cubic';
        full.resampler_sinc_len = 256;
        full.resampler_oversampling = 512;
        full.ffmpeg_transcode_quality = 'hires';
      }
    } 
    // B. If they changed an individual parameter, auto-detect the matching preset
    else if (
      newDSP.resampler_interpolation !== undefined ||
      newDSP.resampler_sinc_len !== undefined ||
      newDSP.resampler_oversampling !== undefined ||
      newDSP.ffmpeg_transcode_quality !== undefined
    ) {
      const interp = full.resampler_interpolation;
      const sinc = full.resampler_sinc_len;
      const over = full.resampler_oversampling;
      const ffmpeg = full.ffmpeg_transcode_quality;

      if (interp === 'linear' && sinc === 64 && over === 128 && ffmpeg === 'standard') {
        full.audio_profile = 'low';
      } else if (interp === 'cubic' && sinc === 128 && over === 256 && ffmpeg === 'studio') {
        full.audio_profile = 'normal';
      } else if (interp === 'cubic' && sinc === 256 && over === 512 && ffmpeg === 'hires') {
        full.audio_profile = 'high';
      } else {
        full.audio_profile = 'custom';
      }
    }

    // Save all to localStorage
    localStorage.setItem('aideo_audio_profile', full.audio_profile);
    localStorage.setItem('aideo_resampler_interpolation', full.resampler_interpolation);
    localStorage.setItem('aideo_resampler_sinc_len', String(full.resampler_sinc_len));
    localStorage.setItem('aideo_resampler_oversampling', String(full.resampler_oversampling));
    localStorage.setItem('aideo_ffmpeg_transcode_quality', full.ffmpeg_transcode_quality);
    localStorage.setItem('aideo_exclusive_timing', full.exclusive_mode_timing);
    localStorage.setItem('aideo_filter_enabled', String(full.aideo_filter_enabled));
    localStorage.setItem('aideo_filter_room_size', String(full.aideo_filter_room_size));
    localStorage.setItem('aideo_filter_bass_thump', String(full.aideo_filter_bass_thump));
    localStorage.setItem('aideo_filter_dampening', String(full.aideo_filter_dampening));
    localStorage.setItem('aideo_preamp_gain', String(full.preamp_gain));
    localStorage.setItem('aideo_limiter_threshold', String(full.limiter_threshold));
    localStorage.setItem('aideo_resampler_phase_mode', full.resampler_phase_mode);
    localStorage.setItem('aideo_auto_headroom', String(full.auto_headroom));
    localStorage.setItem('aideo_saturation_enabled', String(full.saturation_enabled));
    localStorage.setItem('aideo_saturation_drive', String(full.saturation_drive));
    localStorage.setItem('aideo_crossfade_enabled', String(full.crossfade_transition_enabled));
    localStorage.setItem('aideo_crossfade_duration', String(full.crossfade_transition_duration));
    localStorage.setItem('aideo_stream_engine', full.stream_engine);
    localStorage.setItem('aideo_lookahead_prebuffer', String(full.lookahead_prebuffer_enabled));

    // 1. Update React Zustand state instantly for fluid 60fps UI
    set({ dsp: full });
    
    // 2. Manage throttled IPC dispatching to prevent channel flooding
    pendingDspState = full;
    const now = Date.now();
    const timeSinceLast = now - lastDspInvokeTime;
    
    if (timeSinceLast >= THROTTLE_MS) {
      if (dspThrottleTimeout) {
        clearTimeout(dspThrottleTimeout);
        dspThrottleTimeout = null;
      }
      performDspInvoke(full);
    } else {
      if (!dspThrottleTimeout) {
        dspThrottleTimeout = setTimeout(() => {
          dspThrottleTimeout = null;
          if (pendingDspState) {
            performDspInvoke(pendingDspState);
          }
        }, THROTTLE_MS - timeSinceLast);
      }
    }
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

  keepAwake: localStorage.getItem('aideo_keep_awake') === 'true',
  
  toggleKeepAwake: async () => {
    const nextState = !get().keepAwake;
    set({ keepAwake: nextState });
    localStorage.setItem('aideo_keep_awake', String(nextState));
    try {
      await invoke('toggle_keep_awake', { enable: nextState });
    } catch (e) { console.error(e); }
  },

  discordEnabled: localStorage.getItem('aideo_discord_enabled') !== 'false',

  toggleDiscord: () => {
    const nextState = !get().discordEnabled;
    set({ discordEnabled: nextState });
    localStorage.setItem('aideo_discord_enabled', String(nextState));
    if (!nextState) {
      invoke('clear_discord_presence').catch(console.error);
    } else {
      get().updateDiscordPresence();
    }
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

  playStream: async (url: string, metadata?: { title?: string; artist?: string; duration?: number; cover_url?: string | null }, triggerAutoplay = true) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: 'You are offline. Cannot stream online tracks.', type: 'warning' } 
      }));
      return;
    }
    try {
      // De-duplicate / consume track from queue when starting playback
      const currentQueue = get().queue;
      const matchingIndices: number[] = [];
      currentQueue.forEach((t, i) => {
        if (pathsEqual(t.path, url)) {
          matchingIndices.push(i);
        }
      });

      if (matchingIndices.length > 0) {
        const newQueue = currentQueue.filter(t => !pathsEqual(t.path, url));
        set({ queue: newQueue });
        localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
        
        // Remove from the Rust backend queue in reverse order
        for (let i = matchingIndices.length - 1; i >= 0; i--) {
          const indexToRemove = matchingIndices[i];
          invoke('remove_from_queue', { index: indexToRemove }).catch(console.error);
        }
      }

      const streamName = metadata?.title || getStreamName(url);
      const isYoutube = url.includes('youtube.com') || url.includes('youtu.be') || url.includes('googlevideo.com');
      const formatStr = isYoutube ? 'YouTube Direct' : 'URL';
      
      const virtualTrack: Track = {
        id: -9999,
        path: url,
        title: streamName,
        artist: metadata?.artist || 'Online Stream',
        duration: metadata?.duration || null,
        format: formatStr,
        lyric_offset: 0,
        cover_url: metadata?.cover_url || null
      };
      await get().recordPlaybackTransition(virtualTrack);
      onlineTrackCache.set(url, virtualTrack);
      set({
        coverArt: metadata?.cover_url || null,
        accentColor: '#8b5cf6',
        lyrics: [],
        lyricStatus: 'idle',
        currentTrack: virtualTrack,
        playback: { ...get().playback, current_track: url, status: 'Playing', position_secs: 0, last_skip_time: Date.now() },
      });

      if (metadata?.cover_url) {
        if (metadata.cover_url.startsWith('http://') || metadata.cover_url.startsWith('https://')) {
          invoke('get_cover_art', { path: metadata.cover_url }).then(async (art: any) => {
             if (!pathsEqual(get().playback.current_track, url)) return;
            if (art && typeof art === 'string') {
              set({ coverArt: art });
              try {
                const color = await extractDominantColor(art);
                set({ accentColor: color });
              } catch (_) {}
              invoke('update_media_metadata', {
                title: streamName,
                artist: metadata?.artist || 'Online Stream',
                coverUrl: art,
                duration: metadata?.duration || 0,
              }).catch(() => {});
            }
          }).catch(() => {});
        } else {
          extractDominantColor(metadata.cover_url).then((color) => {
            set({ accentColor: color });
          }).catch(() => {});
        }
      }

      if (get().chromecast_connected) {
        try {
          await invoke('chromecast_play', {
            path: url,
            title: streamName,
            artist: metadata?.artist || 'Online Stream',
            contentType: 'audio/mpeg',
            coverUrl: metadata?.cover_url || null,
            duration: metadata?.duration || null
          });
        } catch (e) {
          console.error('Chromecast playStream error:', e);
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
        await invoke('play_track', { path: url, startPos: 0.0 });
      }
      if (triggerAutoplay) {
        get().triggerAutoplayRadio(virtualTrack, true).catch(console.error);
      }

      // Trigger high-fidelity lyric lookup for stream/preview
      set({ lyricStatus: 'loading' });
      invoke('get_lyrics', { path: url }).then((lrc: any) => {
        if (!pathsEqual(get().playback.current_track, url)) return;
        if (Array.isArray(lrc) && lrc.length > 0) {
          set({ lyrics: lrc, lyricStatus: 'found' });
        } else {
          get().autoFetchLyricsOnline(virtualTrack);
        }
      }).catch(() => {
        if (pathsEqual(get().playback.current_track, url)) get().autoFetchLyricsOnline(virtualTrack);
      });

      // Update OS media controls
      invoke('update_media_metadata', {
        title: streamName,
        artist: metadata?.artist || 'Online Stream',
        coverUrl: metadata?.cover_url || null,
        duration: metadata?.duration || 0,
      }).catch(() => { });

    } catch (e) {
      console.error('playStream error:', e);
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Streaming failed: ${e}`, type: 'error' }
      }));
      set((s: any) => ({
        playback: {
          ...s.playback,
          status: 'Stopped',
          current_track: null,
          position_secs: 0
        },
        currentTrack: null
      }));
    }
  },

  addToQueue: async (track: Track) => {
    try {
      // Prevent duplicates: skip if track already exists in queue
      const existsInQueue = get().queue.some(t => pathsEqual(t.path, track.path));
      if (existsInQueue) {
        if (!track.is_autoplay) {
          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Track is already in the queue', type: 'warning' } }));
        }
        return;
      }

      let finalPath = track.path;
      if (track.format === 'Tidal FLAC' && !track.path.startsWith('http://') && !track.path.startsWith('https://')) {
        try {
          const cachedResolved = trackIdToStreamUrl.get(track.path);
          if (cachedResolved && (Date.now() - cachedResolved.resolvedAt < 15 * 60 * 1000)) {
            finalPath = cachedResolved.url;
            console.log('[Tidal] Using pre-resolved stream URL for track in addToQueue:', track.title);
          } else {
            finalPath = await invoke<string>('tidal_get_stream_url', { trackId: track.path });
            trackIdToStreamUrl.set(track.path, { url: finalPath, resolvedAt: Date.now() });
            resolvedPathMap.set(finalPath, track.path);
          }
        } catch (err) {
          console.error('Failed to resolve Tidal stream in addToQueue:', err);
        }
      }

      await chainQueueOperation(async () => {
        await invoke('add_to_queue', { path: finalPath });
      });

      const newQueue = [...get().queue, track];
      set({ queue: newQueue });
      localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
    } catch (e) { console.error(e); }
  },

  playNextInQueue: async (track: Track) => {
    try {
      // Prevent duplicates: skip if track already exists in queue
      const existsInQueue = get().queue.some(t => pathsEqual(t.path, track.path));
      if (existsInQueue) {
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Track is already in the queue', type: 'warning' } }));
        return;
      }

      let finalPath = track.path;
      if (track.format === 'Tidal FLAC' && !track.path.startsWith('http://') && !track.path.startsWith('https://')) {
        try {
          const cachedResolved = trackIdToStreamUrl.get(track.path);
          if (cachedResolved && (Date.now() - cachedResolved.resolvedAt < 15 * 60 * 1000)) {
            finalPath = cachedResolved.url;
            console.log('[Tidal] Using pre-resolved stream URL for track in playNextInQueue:', track.title);
          } else {
            finalPath = await invoke<string>('tidal_get_stream_url', { trackId: track.path });
            trackIdToStreamUrl.set(track.path, { url: finalPath, resolvedAt: Date.now() });
            resolvedPathMap.set(finalPath, track.path);
          }
        } catch (err) {
          console.error('Failed to resolve Tidal stream in playNextInQueue:', err);
        }
      }

      await chainQueueOperation(async () => {
        await invoke('queue_next', { path: finalPath });
      });

      const newQueue = [track, ...get().queue];
      set({ queue: newQueue });
      localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
    } catch (e) { console.error(e); }
  },

  playFromQueue: async (index: number) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    
    const trackToPlay = queue[index];
    const newQueue = [...queue];
    newQueue.splice(index, 1);
    
    // SSOT: Update React state immediately so rapid clicks don't double-pop
    set({ queue: newQueue });
    localStorage.setItem('aideo_queue', JSON.stringify(newQueue));
    
    await chainQueueOperation(async () => {
        await invoke('remove_from_queue', { index }).catch(() => {});
    });
    
    await get().playTrack(trackToPlay, undefined, false);
  },

  removeFromQueue: async (index: number) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    
    const newQueue = [...queue];
    newQueue.splice(index, 1);
    set({ queue: newQueue });
    localStorage.setItem('aideo_queue', JSON.stringify(newQueue));

    await chainQueueOperation(async () => {
      await invoke('remove_from_queue', { index }).catch(() => {});
    });
  },

  clearQueue: async () => {
    try {
      const currentTrack = get().currentTrack;
      const isOnline = currentTrack && (
        currentTrack.path.startsWith('http://') || 
        currentTrack.path.startsWith('https://') || 
        currentTrack.format === 'Tidal FLAC'
      );
      const isAutoplayEnabled = get().autoplayEnabled;
      
      const currentQueue = get().queue;
      const clearedPaths = currentQueue.map(t => t.path);
      if (clearedPaths.length > 0) {
        const existingCleared = get().recentlyClearedAutoplayPaths || [];
        const newCleared = Array.from(new Set([...existingCleared, ...clearedPaths])).slice(-100);
        set({ recentlyClearedAutoplayPaths: newCleared });
      }

      await chainQueueOperation(async () => {
        await invoke('clear_queue');
      });

      set({ queue: [] });
      localStorage.setItem('aideo_queue', JSON.stringify([]));

      if (isAutoplayEnabled && currentTrack && isOnline) {
        await get().stopTrack();
        await get().triggerAutoplayRadio(currentTrack, true);
        
        const newQueue = get().queue;
        if (newQueue.length > 0) {
          await get().playFromQueue(0);
        }
      }
    } catch (e) { console.error(e); }
  },

  reorderQueue: async (from: number, to: number) => {
    const { queue } = get();
    if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return;
    
    try {
      await chainQueueOperation(async () => {
        await invoke('reorder_queue', { from, to });
      });

      const newQueue = [...queue];
      const [moved] = newQueue.splice(from, 1);
      newQueue.splice(to, 0, moved);
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
          const localTracks = parsed.filter(t => !t.path.startsWith('http://') && !t.path.startsWith('https://') && t.format !== 'Tidal FLAC');
          let validTracks = parsed;
          
          const isAutoplayEnabled = localStorage.getItem('aideo_autoplay') !== 'false';
          if (!isAutoplayEnabled) {
            validTracks = validTracks.filter(t => !t.is_autoplay);
          }
          
          if (localTracks.length > 0) {
            const localPaths = localTracks.map(t => t.path);
            const existence: boolean[] = await invoke('check_files_exist', { paths: localPaths });
            const missingPaths = new Set<string>();
            localPaths.forEach((p, idx) => {
              if (!existence[idx]) {
                missingPaths.add(p);
              }
            });
            
            if (missingPaths.size > 0) {
              validTracks = parsed.filter(t => !missingPaths.has(t.path));
            }
          }
          
          await invoke('clear_queue');
          if (validTracks.length > 0) {
            const paths = validTracks.map(t => t.path);
            await invoke('add_to_queue_bulk', { paths });
          }
          set({ queue: validTracks });
          localStorage.setItem('aideo_queue', JSON.stringify(validTracks));
        }
      }
    } catch (e) { console.error("Failed to initialize queue:", e); }
  },

  fetchQueue: async () => {
    try {
      const paths: string[] = await invoke('get_queue');
      const { tracks, queue: currentQueue } = get();
      
      const queueTracks = paths.map((p, idx) => {
        // 1. Check if the track exists in local library tracks
        const libTrack = tracks.find(t => pathsEqual(t.path, p));
        if (libTrack) return libTrack;

        // 2. Check if the track metadata already exists in the current queue state
        const existingTrack = currentQueue.find(t => pathsEqual(t.path, p));
        if (existingTrack) return existingTrack;

        // 3. Fallback: Construct a high-fidelity virtual Track object for online/streaming paths
        const isOnline = p.startsWith('http://') || p.startsWith('https://');
        const meta = isOnline ? parseStreamMetadata(p) : { title: baseName(p), artist: 'Web Stream' };
        const virtualTrack: Track = {
          id: -1000 - idx, // ensure a unique negative ID to prevent conflicts with database IDs
          path: p,
          title: meta.title,
          artist: meta.artist,
          duration: null,
          format: isOnline ? 'URL' : 'MP3/FLAC',
          lyric_offset: 0
        };
        return virtualTrack;
      });

      set({ queue: queueTracks });
      localStorage.setItem('aideo_queue', JSON.stringify(queueTracks));
    } catch (e) { console.error("Failed to fetch queue:", e); }
  },

  toggleQueue: () => {
    set(s => ({ showQueue: !s.showQueue }));
  },

  lowSpecMode: localStorage.getItem('aideo_low_spec') === 'true',

  toggleLowSpecMode: () => {
    const next = !get().lowSpecMode;
    set({ lowSpecMode: next });
    localStorage.setItem('aideo_low_spec', String(next));
    get().setDSP({ low_spec_mode: next });
  },

  discoverCastDevices: async () => {
    set({ chromecast_scanning: true });
    try {
      const devices = await invoke<any[]>('chromecast_discover');
      set({ chromecast_devices: devices, chromecast_scanning: false });
    } catch (e) {
      console.error('Failed to discover Chromecast devices:', e);
      set({ chromecast_scanning: false });
    }
  },

  connectCastDevice: async (device: { name: string; ip: string; port: number }) => {
    try {
      if (get().chromecast_connected) {
        await get().disconnectCastDevice();
      }
      
      // Capture currently playing track and position before connecting and stopping local
      const activeTrack = get().currentTrack;
      const startPos = get().playback.position_secs;
      
      await invoke('chromecast_connect', { ip: device.ip, port: device.port });
      
      await invoke('stop_track').catch(() => {});
      
      set({
        chromecast_active_device: device.ip,
        chromecast_connected: true,
      });

      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Connected to ${device.name}`, type: 'success' } 
      }));
      
      // Seamlessly transfer playback if a song was active
      if (activeTrack) {
        await get().playTrack(activeTrack, true, false, undefined, startPos);
      } else {
        set({
          playback: {
            ...get().playback,
            status: 'Stopped',
            current_track: null,
            position_secs: 0,
          },
          currentTrack: null,
          coverArt: null,
        });
      }
    } catch (e) {
      console.error('Failed to connect to Chromecast:', e);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: 'Failed to connect to Chromecast', type: 'error' } 
      }));
    }
  },

  disconnectCastDevice: async () => {
    try {
      // Capture currently playing track, status, and position before disconnecting
      const activeTrack = get().currentTrack;
      const currentPos = get().playback.position_secs;
      const wasPlaying = get().playback.status === 'Playing';

      if (get().chromecast_connected) {
        await invoke('chromecast_disconnect');
      }
      set({
        chromecast_active_device: null,
        chromecast_connected: false,
      });
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: 'Disconnected from Chromecast', type: 'info' } 
      }));

      // Seamlessly transfer playback back to local player
      if (activeTrack) {
        await get().playTrack(activeTrack, true, false, undefined, currentPos);
        if (!wasPlaying) {
          await get().pauseTrack();
        }
      }
    } catch (e) {
      console.error('Failed to disconnect from Chromecast:', e);
    }
  },
});
