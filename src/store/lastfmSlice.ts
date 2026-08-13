import { StateCreator } from 'zustand';
import { PlayerState } from './types';
import { invoke } from '@tauri-apps/api/core';

export const createLastfmSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  scrobbleEnabled: localStorage.getItem('lastfm_scrobble_enabled') !== 'false' && !!localStorage.getItem('lastfm_session'),
  lastfmSessionKey: localStorage.getItem('lastfm_session') || null,
  lastfmToken: null,
  scrobbledCurrent: false,
  lastScrobble: null,
  scrobbleThreshold: parseInt(localStorage.getItem('lastfm_threshold') || '50'),

  setScrobbleThreshold: (val: number) => {
    localStorage.setItem('lastfm_threshold', val.toString());
    set({ scrobbleThreshold: val });
  },

  toggleScrobble: () => set(s => {
    const next = !s.scrobbleEnabled;
    localStorage.setItem('lastfm_scrobble_enabled', String(next));
    return { scrobbleEnabled: next };
  }),

  setLastFmSession: (key: string | null) => {
    if (key) {
      localStorage.setItem('lastfm_session', key);
      localStorage.setItem('lastfm_scrobble_enabled', 'true');
    } else {
      localStorage.removeItem('lastfm_session');
    }
    set({ lastfmSessionKey: key, scrobbleEnabled: !!key });
  },

  lastfmUser: null,
  lastfmRecent: [],
  lastfmTopArtists: [],

  fetchLastfmDashboard: async () => {
    const key = get().lastfmSessionKey;
    if (!key) {
      invoke('log_error', { msg: 'Last.fm fetch cancelled: No session key found.' });
      return;
    }
    try {
      const userRes: any = await invoke('lastfm_get_user_info', { sessionKey: key });
      
      if (!userRes || !userRes.user) {
        invoke('log_error', { msg: 'Last.fm Error: get_user_info returned invalid data: ' + JSON.stringify(userRes) });
        return;
      }

      const user = userRes.user;
      set({ lastfmUser: user });

      if (user && user.name) {
        const recent: any = await invoke('lastfm_get_recent_tracks', { username: user.name });
        const top: any = await invoke('lastfm_get_top_artists', { username: user.name });
        
        set({ 
          lastfmRecent: recent.recenttracks?.track || [], 
          lastfmTopArtists: top.topartists?.artist || [] 
        });
      }
    } catch (e) { 
      console.error('fetchLastfmDashboard error:', e); 
      invoke('log_error', { msg: 'fetchLastfmDashboard exception: ' + e });
    }
  },
});
