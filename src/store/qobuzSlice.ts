import { StateCreator } from 'zustand';
import { PlayerState, Track } from './types';
import { invoke } from '@tauri-apps/api/core';

export const createQobuzSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  qobuzConnected: false,
  qobuzSearching: false,
  qobuzSearchResults: [],

  checkQobuzStatus: async () => {
    try {
      const ok = await invoke<boolean>('qobuz_status');
      set({ qobuzConnected: !!ok });
    } catch {
      set({ qobuzConnected: false });
    }
  },

  openQobuzLoginWindow: async () => {
    try {
      await invoke('qobuz_open_login_window');
    } catch (e) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to open Qobuz login: ${e}`, type: 'error' } }));
      throw e;
    }
  },

  searchQobuz: async (query: string) => {
    set({ qobuzSearching: true });
    try {
      const res = await invoke<any[] | null>('qobuz_search', { query });
      const results: Track[] = (Array.isArray(res) ? res : []).map((t: any) => ({
        id: -60000 - Number(t.id || 0),
        path: String(t.id),
        title: t.title ?? null,
        artist: t.artist ?? null,
        album: t.album ?? null,
        duration: t.duration ?? 180,
        format: 'Qobuz FLAC',
        lyric_offset: 0,
        cover_url: t.cover_url || null
      }));
      set({ qobuzSearchResults: results });
    } finally {
      set({ qobuzSearching: false });
    }
  },

  playQobuzResult: async (track: Track) => {
    await get().playTrack(track, false, true);
  },

  downloadQobuzTrack: async (track: Track) => {
    const filename = `${track.artist ?? 'Unknown Artist'} - ${track.title ?? 'Unknown Title'}`
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();
    try {
      await invoke('qobuz_download', {
        trackId: String(track.path),
        filename,
        title: track.title ?? '',
        artist: track.artist ?? '',
        album: track.album ?? '',
        duration: track.duration ?? 0
      });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Downloading ${track.title}...`, type: 'info' } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Qobuz download failed: ${e}`, type: 'error' } }));
      throw e;
    }
  },
});

export function notifyQobuzAuthFailure(err: unknown): boolean {
  const msg = typeof err === 'string' ? err : (err instanceof Error ? err.message : '');
  const authFailure = msg.toLowerCase().includes('not authenticated') ||
    (msg.toLowerCase().includes('rejected your session token') && msg.toLowerCase().includes('qobuz'));
  if (!authFailure) return false;
  window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Connect to Qobuz in Settings > Library > Qobuz to resume lossless playback.', type: 'warning' } }));
  window.dispatchEvent(new CustomEvent('ui-goto-settings-tab', { detail: { tab: 'library' } }));
  return true;
}
