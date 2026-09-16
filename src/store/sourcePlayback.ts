import type { StoreApi } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PlaybackSource, PlayerState, Track } from './types';
import { setOnlineTrackCache } from '../utils';
import { applySourcePreference, matchingSources, rankSources, resolveSource, searchSources, sourceKey, sourceMetadata, sourceName, sourceSearchQuery } from '../utils/unifiedSources';

type SetState = StoreApi<PlayerState>['setState'];
let sequence = 0;
let retry: { path: string; run: (error: string) => Promise<void> } | null = null;
let pendingUpgrade: (() => void) | null = null;
export function cancelSourcePlayback() { sequence++; retry = null; pendingUpgrade?.(); pendingUpgrade = null; }
export const playbackRequest = () => sequence;
export function handleSourceFailure(path: string, error: string) {
  if (!retry || retry.path !== path) return;
  const next = retry;
  retry = null;
  void next.run(error);
}

export async function manageSourceQueue(set: SetState) {
  // ponytail: mixed-source queues resolve at track start; add native recording-aware prefetch before enabling gapless here.
  await invoke('set_source_queue_mode', { enabled: true });
  set({ sourceQueueManaged: true });
}

export async function playUnifiedTrack(set: SetState, get: () => PlayerState, original: Track, isHistory = false, resetAutoplay = true, startPos = 0, preservePlaybackSession = false) {
  const token = sequence;
  const current = () => token === sequence;
  let track: Track = { ...applySourcePreference(original), active_source: undefined, active_quality: undefined };
  let context = track.source_context!;
  const quality = get().streamingQuality;
  const enabled = (source: PlaybackSource) => source.provider === 'local' || (get().appMode !== 'local'
    && (source.provider === 'youtube' || (source.provider === 'tidal' ? get().tidalConnected : get().qobuzConnected && get().qobuzExperimentalEnabled)));
  const ordered = rankSources(context.sources.filter(enabled), quality, get().preferredSource);
  if (context.selection.mode === 'explicit') {
    const selected = context.selection.source;
    const index = ordered.findIndex(s => sourceKey(s) === sourceKey(selected));
    if (index >= 0) ordered.unshift(...ordered.splice(index, 1));
  }
  const previous = get().currentTrack;
  const history = previous && !isHistory && !preservePlaybackSession ? [...get().playHistory, previous].slice(-200) : get().playHistory;
  const queue = [...get().queue];
  const queued = resetAutoplay ? queue.findIndex(t => t === original || (t.source_context?.recording_id === context.recording_id && t.playlist_entry_id === track.playlist_entry_id)) : -1;
  if (queued >= 0) queue.splice(queued, 1);
  set({ currentTrack: track, queue, playHistory: history, playbackError: null,
    currentTrackIndex: get().tracks.findIndex(t => t === original || (t.playlist_entry_id !== undefined && t.playlist_entry_id === track.playlist_entry_id)), lyricOffset: track.lyric_offset || 0,
    coverArt: track.cover_url || null,
    ...(preservePlaybackSession ? {} : { lyrics: [], lyricStatus: 'loading' as const, scrobbledCurrent: false }),
    playback: { ...get().playback, status: 'Playing', current_track: track.path, position_secs: startPos, backend_position_secs: 0, backend_stop_detected_at: 0, file_rate: undefined, file_format: null, effective_audio_path: null, is_buffering: true, last_skip_time: Date.now() },
  });
  localStorage.setItem('aideo_queue', JSON.stringify(queue));
  localStorage.setItem('aideo_current_track', JSON.stringify(track));
  localStorage.setItem('aideo_play_history', JSON.stringify(history));
  let index = 0;
  let attemptSequence = 0;
  let lastError = 'No available source';
  let historyRecorded = false;
  let discovery: ReturnType<typeof searchSources> | undefined;
  let discoveryConsumed = false;
  const discover = () => discovery ||= searchSources(sourceSearchQuery(track), {
    tidal: get().appMode !== 'local' && get().tidalConnected,
    qobuz: get().appMode !== 'local' && get().qobuzConnected && get().qobuzExperimentalEnabled,
    youtube: get().appMode !== 'local',
  }, () => {});
  const attempt = async (failure?: string) => {
    const attemptToken = ++attemptSequence;
    const active = () => current() && attemptToken === attemptSequence;
    if (failure) { lastError = failure; startPos = get().playback.position_secs; }
    while (active() && index < ordered.length) {
      const source: PlaybackSource = ordered[index++];
      try {
        if (!enabled(source)) throw new Error('Source is unavailable');
        if (source.provider === 'tidal' && !get().tidalConnected) throw new Error('Tidal is disconnected');
        if (source.provider === 'qobuz' && (!get().qobuzConnected || !get().qobuzExperimentalEnabled)) throw new Error('Qobuz is unavailable');
        const result = await resolveSource(source, quality, Boolean(failure));
        if (!active()) return;
        const playingTrack = { ...track, ...(source.metadata ? sourceMetadata(source.metadata) : {}), active_source: source, active_quality: result.quality };
        setOnlineTrackCache(result.url, playingTrack);
        set({ currentTrack: playingTrack, coverArt: playingTrack.cover_url || null, playback: { ...get().playback, current_track: result.url, status: 'Playing', position_secs: startPos,
          backend_position_secs: 0, backend_stop_detected_at: 0, file_rate: undefined, file_format: null, effective_audio_path: null,
          is_buffering: true, last_skip_time: Date.now() } });
        retry = { path: result.url, run: attempt };
        if (get().chromecast_connected) {
          await invoke('chromecast_play', { path: result.url, title: playingTrack.title, artist: playingTrack.artist, coverUrl: playingTrack.cover_url, duration: playingTrack.duration, startTime: startPos, contentType: result.quality.codec || 'audio/mpeg' });
        } else if (get().upnp_connected) {
          await invoke('upnp_play', { path: result.url, title: playingTrack.title, artist: playingTrack.artist, album: playingTrack.album, coverUrl: playingTrack.cover_url });
          if (startPos > 0) await invoke('upnp_control', { action: 'seek', value: startPos });
        } else await invoke('play_track', { path: result.url, startPos });
        if (!active()) return;
        const desired = ordered[0]?.catalog_quality;
        const dropped = quality !== 'data_saver' && (result.quality.lossless !== true
          || (quality === 'best_available' && ((desired?.sample_rate || 0) > (result.quality.sample_rate || 0) || (desired?.bit_depth || 0) > (result.quality.bit_depth || 0))));
        if (index > 1 || dropped) window.dispatchEvent(new CustomEvent('ui-toast', { detail: {
          message: `${index > 1 ? 'Source unavailable. Using' : 'Preferred quality unavailable or unverified. Using'} ${sourceName(source)} for this play. Your preference is unchanged.`, type: 'info',
        } }));
        await invoke('update_media_metadata', { title: playingTrack.title, artist: playingTrack.artist, album: playingTrack.album, coverUrl: playingTrack.cover_url, duration: playingTrack.duration }).catch(() => {});
        if (!active()) return;
        if (!historyRecorded && !preservePlaybackSession) {
          historyRecorded = true;
          await get().recordPlaybackTransition(playingTrack, source.provider);
          if (!active()) return;
          const counts = { ...get().playCounts, [context.recording_id]: (get().playCounts[context.recording_id] || 0) + 1 };
          set({ playCounts: counts });
          localStorage.setItem('aideo_play_counts', JSON.stringify(counts));
          if (resetAutoplay) set({ autoplaySeedTrack: track, autoplaySessionHistory: [track] });
          void get().autoFetchLyricsOnline(playingTrack);
        }
        localStorage.setItem('aideo_current_track', JSON.stringify(playingTrack));
        get().updateDiscordPresence();
        return;
      } catch (error) { lastError = String(error); if (active()) retry = null; }
    }
    if (active() && !discoveryConsumed && track.title && track.artist) {
      discoveryConsumed = true;
      const found = await discover();
      if (!active()) return;
      const tried = new Set(ordered.map(sourceKey));
      const sources = matchingSources(track, found.tracks).filter(enabled);
      const alternatives = rankSources(sources.filter(s => !tried.has(sourceKey(s))), quality, get().preferredSource);
      if (alternatives.length) {
        context = { ...context, sources };
        track = { ...track, source_context: context };
        ordered.push(...alternatives);
        return attempt();
      }
    }
    if (active()) {
      retry = null;
      const message = `No source could play this recording. ${lastError}`;
      set({ playbackError: message, playback: { ...get().playback, status: 'Stopped', current_track: null, is_buffering: false } });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message, type: 'error' } }));
    }
  };
  try {
    if (context.selection.mode === 'auto' && quality !== 'data_saver' && track.title && track.artist) void discover();
    await manageSourceQueue(set);
    if (current()) {
      if (get().chromecast_connected) await invoke('chromecast_control', { action: 'stop' });
      else if (get().upnp_connected) await invoke('upnp_control', { action: 'stop' });
      else await invoke('stop_track');
    }
    if (current() && context.selection.mode === 'auto') {
      const resolved: PlaybackSource[] = [];
      const resolving = Promise.all(ordered.map(async source => {
        try {
          const result = await resolveSource(source, quality);
          resolved.push({ ...source, catalog_quality: result.quality });
        } catch { /* An unavailable source remains a fallback candidate. */ }
      }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([resolving, new Promise<void>(resolve => { timer = setTimeout(resolve, 750); })]);
      clearTimeout(timer);
      if (!current()) return;
      const ready = new Set(resolved.map(sourceKey));
      ordered.splice(0, ordered.length, ...rankSources(resolved, quality, get().preferredSource), ...ordered.filter(s => !ready.has(sourceKey(s))));
    }
    if (current()) await attempt();
    if (current() && context.selection.mode === 'auto' && quality !== 'data_saver' && track.title && track.artist) {
      // ponytail: one background upgrade per play; native prefetch/crossfade can make the handoff seamless later.
      void (async () => {
        const found = await discover();
        if (!current()) return;
        const sources = matchingSources(track, found.tracks).filter(enabled);
        const resolved = await Promise.all(sources.map(async source => {
          try { return { ...source, catalog_quality: (await resolveSource(source, quality)).quality }; }
          catch { return null; }
        }));
        if (!current()) return;
        const best = rankSources(resolved.filter((s): s is NonNullable<typeof s> => s !== null), quality, get().preferredSource)[0];
        const upgrade = () => {
          if (!current()) return;
          const state = get();
          const active = state.currentTrack?.active_source;
          const playing = state.currentTrack?.active_quality;
          const better = best?.catalog_quality;
          if (!best || !active || sourceKey(best) === sourceKey(active) || better?.lossless !== true
            || state.currentTrack?.source_context?.selection.mode !== 'auto'
            || state.streamingQuality !== quality || !enabled(best)) return;
          const resolution = (q: typeof playing) => (q?.sample_rate || 0) * (q?.bit_depth || 0);
          if (playing?.lossless === true && (quality !== 'best_available' || resolution(better) <= resolution(playing))) return;
          if (state.playback.status !== 'Playing' || state.playback.is_buffering) return;
          pendingUpgrade?.(); pendingUpgrade = null;
          context = { ...context, sources };
          track = { ...track, source_context: context };
          startPos = state.playback.position_secs;
          ordered.splice(0, ordered.length, best, ...ordered.filter(s => sourceKey(s) !== sourceKey(best)));
          index = 0;
          void attempt().then(() => {
            if (current() && get().currentTrack?.active_source && sourceKey(get().currentTrack!.active_source!) === sourceKey(best)) {
              window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Upgraded to ${sourceName(best)} at your current position.`, type: 'info' } }));
            }
          }).catch(() => {});
        };
        const { useStore } = await import('../store');
        if (!current()) return;
        pendingUpgrade?.();
        pendingUpgrade = useStore.subscribe(upgrade);
        upgrade();
      })().catch(() => { /* Keep the current playable source if the optional lookup fails. */ });
    }
  } catch (error) {
    if (current()) {
      set({ playbackError: String(error), playback: { ...get().playback, status: 'Stopped', is_buffering: false } });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Playback failed: ${String(error)}`, type: 'error' } }));
    }
  }
}
