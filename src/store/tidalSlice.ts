import { StateCreator } from 'zustand';
import { PlayerState, Track } from './types';
import { invoke } from '@tauri-apps/api/core';

export const createTidalSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  tidalConnected: false,
  tidalSearching: false,
  tidalSearchResults: [],
  pendingSettingsTab: null,

  checkTidalStatus: async () => {
    try {
      const ok = await invoke<boolean>('tidal_login_poll_status');
      set({ tidalConnected: !!ok });
    } catch {
      set({ tidalConnected: false });
    }
  },

  searchTidal: async (query: string) => {
    set({ tidalSearching: true });
    try {
      const res = await invoke<any[] | null>('tidal_search', { query });
      const results: Track[] = (Array.isArray(res) ? res : []).map((t: any) => ({
        id: -30000 - Number(t.id || 0),
        path: String(t.id),
        title: t.title ?? null,
        artist: t.artist ?? null,
        album: t.album ?? null,
        duration: t.duration ?? 180,
        format: 'Tidal FLAC',
        lyric_offset: 0,
        cover_url: t.cover_url || null
      }));
      set({ tidalSearchResults: results });
    } finally {
      set({ tidalSearching: false });
    }
  },

  playTidalResult: async (track: Track) => {
    await get().playTrack(track, false, true);
  },

  downloadTidalTrack: async (track: Track) => {
    const filename = `${track.artist ?? 'Unknown Artist'} - ${track.title ?? 'Unknown Title'}`
      .replace(/[\\/:*?"<>|]/g, '')
      .trim();
    try {
      await invoke('tidal_download', {
        trackId: String(track.path),
        filename,
        title: track.title ?? '',
        artist: track.artist ?? '',
        album: track.album ?? '',
        duration: track.duration ?? 0
      });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Downloading ${track.title}...`, type: 'info' } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Tidal download failed: ${e}`, type: 'error' } }));
      throw e;
    }
  },
});

export function notifyTidalAuthFailure(err: unknown): boolean {
  const msg = typeof err === 'string' ? err : (err instanceof Error ? err.message : '');
  const authFailure = msg.toLowerCase().includes('not authenticated') ||
    (msg.toLowerCase().includes('expired') && msg.toLowerCase().includes('tidal'));
  if (!authFailure) return false;
  window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Connect to Tidal in Settings > Library > Tidal to resume lossless playback.', type: 'warning' } }));
  window.dispatchEvent(new CustomEvent('ui-goto-settings-tab', { detail: { tab: 'library' } }));
  return true;
}
