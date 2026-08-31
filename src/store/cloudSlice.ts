import { StateCreator } from 'zustand';
import { PlayerState, BatchDownloadItem } from './types';
import { invoke } from '@tauri-apps/api/core';

export const createCloudSlice: StateCreator<PlayerState, [], [], any> = (set) => {
  const cachedSubsonicUrl = localStorage.getItem('aideo_subsonic_url') || '';
  const cachedSubsonicUser = localStorage.getItem('aideo_subsonic_user') || '';
  const cachedSubsonicConnected = localStorage.getItem('aideo_subsonic_connected') === 'true';

  const cachedJellyfinUrl = localStorage.getItem('aideo_jellyfin_url') || '';
  const cachedJellyfinConnected = localStorage.getItem('aideo_jellyfin_connected') === 'true';

  return {
    subsonicUrl: cachedSubsonicUrl,
    subsonicUser: cachedSubsonicUser,
    subsonicPass: '',
    subsonicConnected: cachedSubsonicConnected,
    subsonicLoading: false,

    jellyfinUrl: cachedJellyfinUrl,
    jellyfinConnected: cachedJellyfinConnected,
    jellyfinLoading: false,

    connectSubsonic: async (url: string, user: string, pass: string) => {
      set({ subsonicLoading: true });
      try {
        const result = await invoke<boolean>('subsonic_ping', { url, user, pass });
        if (result) {
          localStorage.setItem('aideo_subsonic_url', url);
          localStorage.setItem('aideo_subsonic_user', user);
          await invoke('save_subsonic_password', { pass });
          localStorage.setItem('aideo_subsonic_connected', 'true');
          set({
            subsonicUrl: url,
            subsonicUser: user,
            subsonicPass: pass,
            subsonicConnected: true,
            subsonicLoading: false,
          });
          return true;
        }
      } catch (err: any) {
        console.error('Subsonic connection failed:', err);
        invoke('log_error', { msg: `Subsonic connection error: ${err}` });
      }
      set({ subsonicLoading: false });
      return false;
    },

    disconnectSubsonic: () => {
      localStorage.removeItem('aideo_subsonic_url');
      localStorage.removeItem('aideo_subsonic_user');
      invoke('save_subsonic_password', { pass: '' }).catch(e => console.error("Failed to clear subsonic pass:", e));
      localStorage.removeItem('aideo_subsonic_connected');
      set({
        subsonicUrl: '',
        subsonicUser: '',
        subsonicPass: '',
        subsonicConnected: false,
      });
    },

    loadSubsonicPassword: async () => {
      try {
        const pass = await invoke<string>('get_subsonic_password');
        set({ subsonicPass: pass });
      } catch (err) {
        console.error('Failed to load Subsonic password:', err);
      }
    },

    connectJellyfin: async (url: string, apiKey: string) => {
      set({ jellyfinLoading: true });
      try {
        const result = await invoke<boolean>('jellyfin_ping', { url, apiKey });
        if (result) {
          localStorage.setItem('aideo_jellyfin_url', url);
          localStorage.setItem('aideo_jellyfin_api_key', apiKey);
          localStorage.setItem('aideo_jellyfin_connected', 'true');
          set({
            jellyfinUrl: url,
            jellyfinConnected: true,
            jellyfinLoading: false,
          });
          return true;
        }
      } catch (err: any) {
        console.error('Jellyfin connection failed:', err);
        invoke('log_error', { msg: `Jellyfin connection error: ${err}` });
      }
      set({ jellyfinLoading: false });
      return false;
    },

    disconnectJellyfin: () => {
      localStorage.removeItem('aideo_jellyfin_url');
      localStorage.removeItem('aideo_jellyfin_api_key');
      localStorage.removeItem('aideo_jellyfin_connected');
      set({
        jellyfinUrl: '',
        jellyfinConnected: false,
      });
    },

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
  };
};
