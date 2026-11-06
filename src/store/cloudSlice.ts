import { StateCreator } from 'zustand';
import { PlayerState, BatchDownloadItem } from './types';
import { invoke } from '@tauri-apps/api/core';

const LEGACY_KEYS = [
  'aideo_subsonic_url', 'aideo_subsonic_user', 'aideo_subsonic_connected',
  'aideo_jellyfin_url', 'aideo_jellyfin_api_key', 'aideo_jellyfin_connected',
];
const PURGED_FLAG = 'aideo_legacy_servers_purged';

/** Built-in Subsonic/Jellyfin connectors were removed; drop their stored secrets once. */
export async function purgeLegacyServerCredentials(): Promise<void> {
  try {
    if (localStorage.getItem(PURGED_FLAG) === 'true') return;
    LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
    await invoke('delete_keyring_secret', { service: 'subsonic_password' });
    localStorage.setItem(PURGED_FLAG, 'true');
  } catch (err) {
    // Retried next launch; the flag is only set after the keyring entry is gone.
    console.warn('Legacy server credential purge failed:', err);
  }
}

export const createCloudSlice: StateCreator<PlayerState, [], [], any> = (set) => ({
  batchDownloadProgress: null,

  downloadBatchPlaylist: async (items: BatchDownloadItem[], playlistName?: string) => {
    if (!items || items.length === 0) return 0;
    try {
      set({
        batchDownloadProgress: {
          completed: 0,
          total: items.length,
          current_title: items[0]?.title || '',
          percent: 0,
          is_done: false,
          error: null,
        }
      });

      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Started downloading ${items.length} tracks to local disk...`, type: 'info' }
      }));

      const count = await invoke<number>('download_playlist_batch', {
        items,
        quality: 'high',
        playlistName: playlistName || 'Downloaded Playlist'
      });

      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Successfully downloaded and tagged ${count}/${items.length} tracks!`, type: 'success' }
      }));

      // Refresh library in store
      try {
        const freshTracks = await invoke<any[]>('get_library');
        if (freshTracks && Array.isArray(freshTracks)) {
          set({ tracks: freshTracks });
        }
      } catch (_) {}

      return count;
    } catch (err: any) {
      console.error('Batch download failed:', err);
      set(s => ({
        batchDownloadProgress: s.batchDownloadProgress ? { ...s.batchDownloadProgress, is_done: true, error: String(err) } : null
      }));
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Batch download error: ${err}`, type: 'error' }
      }));
      return 0;
    }
  },
});
