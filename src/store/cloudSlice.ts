import { StateCreator } from 'zustand';
import { PlayerState } from './types';
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
  };
};
