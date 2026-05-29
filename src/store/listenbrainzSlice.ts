import { StateCreator } from 'zustand';
import { PlayerState } from './types';

export const createListenbrainzSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  listenbrainzToken: localStorage.getItem('listenbrainz_token') || null,
  listenbrainzUsername: localStorage.getItem('listenbrainz_username') || null,
  listenbrainzEnabled: localStorage.getItem('listenbrainz_token') ? true : false,
  listenbrainzRecent: [],
  listenbrainzRecs: [],
  listenbrainzListenCount: null,

  setListenbrainzToken: (token: string | null) => {
    if (token) {
      localStorage.setItem('listenbrainz_token', token);
      set({ listenbrainzToken: token, listenbrainzEnabled: true });
    } else {
      localStorage.removeItem('listenbrainz_token');
      localStorage.removeItem('listenbrainz_username');
      set({ 
        listenbrainzToken: null, 
        listenbrainzUsername: null, 
        listenbrainzEnabled: false, 
        listenbrainzRecent: [], 
        listenbrainzRecs: [],
        listenbrainzListenCount: null
      });
    }
  },

  validateAndSetListenbrainzToken: async (token: string): Promise<boolean> => {
    try {
      const res = await fetch(`https://api.listenbrainz.org/1/validate-token?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        throw new Error(`Token validation failed with status ${res.status}`);
      }
      const data = await res.json();
      const username = data.user_name || data.user_id;
      if (data.valid && username) {
        localStorage.setItem('listenbrainz_token', token);
        localStorage.setItem('listenbrainz_username', username);
        set({ 
          listenbrainzToken: token, 
          listenbrainzUsername: username, 
          listenbrainzEnabled: true 
        });
        return true;
      }
      return false;
    } catch (e) {
      console.error('validateAndSetListenbrainzToken error:', e);
      return false;
    }
  },

  toggleListenbrainzScrobble: () => set(s => {
    const nextEnabled = !s.listenbrainzEnabled;
    return { listenbrainzEnabled: nextEnabled };
  }),

  fetchListenbrainzDashboard: async () => {
    const token = get().listenbrainzToken;
    const username = get().listenbrainzUsername;
    if (!token || !username) return;

    try {
      // 1. Fetch recent listens
      const listensRes = await fetch(`https://api.listenbrainz.org/1/user/${username}/listens`, {
        headers: { 'Authorization': `Token ${token}` }
      });
      if (listensRes.ok) {
        const listensData = await listensRes.json();
        set({ listenbrainzRecent: listensData.payload.listens || [] });
      }

      // 1b. Fetch listen count
      try {
        const countRes = await fetch(`https://api.listenbrainz.org/1/user/${username}/listen-count`);
        if (countRes.ok) {
          const countData = await countRes.json();
          set({ listenbrainzListenCount: countData.payload?.count ?? null });
        }
      } catch (e) {
        console.error('Fetch listen count error:', e);
      }

      // 2. Fetch recommendations
      const recsRes = await fetch(`https://api.listenbrainz.org/1/cf/recommendation/user/${username}/recording`, {
        headers: { 'Authorization': `Token ${token}` }
      });
      if (recsRes.ok) {
        const recsData = await recsRes.json();
        const mbids = recsData.payload?.mbids || [];
        if (mbids.length > 0) {
          const mbidQuery = mbids.slice(0, 15).map((m: any) => m.recording_mbid).join(',');
          const metaRes = await fetch(`https://api.listenbrainz.org/1/metadata/recording/?recording_mbids=${encodeURIComponent(mbidQuery)}&inc=artist+release`);
          if (metaRes.ok) {
            const metaData = await metaRes.json();
            set({ listenbrainzRecs: metaData || [] });
          }
        } else {
          set({ listenbrainzRecs: [] });
        }
      }
    } catch (e) {
      console.error('fetchListenbrainzDashboard error:', e);
    }
  }
});
