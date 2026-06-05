import { StateCreator } from 'zustand';
import { PlayerState } from './types';
import { getSupabaseClient, resetSupabaseClient } from '../utils/supabaseClient';
import { syncToCloud, syncFromCloud } from '../utils/syncEngine';

export const createAuthSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  supabaseUrl: localStorage.getItem('aideo_supabase_url') || '',
  supabaseKey: localStorage.getItem('aideo_supabase_key') || '',
  user: null,
  session: null,
  authLoading: false,
  syncing: false,

  setSupabaseCredentials: (url: string, key: string) => {
    localStorage.setItem('aideo_supabase_url', url);
    localStorage.setItem('aideo_supabase_key', key);
    resetSupabaseClient();
    set({ supabaseUrl: url, supabaseKey: key });
    
    // Proactively check session status with new credentials
    get().checkSession().catch(() => {});
  },

  signIn: async (email: string, pass: string): Promise<boolean> => {
    const client = getSupabaseClient();
    if (!client) return false;

    set({ authLoading: true });
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password: pass });
      if (error) {
        set({ authLoading: false });
        get().setPlaybackError(`Authentication failed: ${error.message}`);
        return false;
      }
      set({ 
        session: data.session, 
        user: data.session?.user ?? null, 
        authLoading: false 
      });
      get().setPlaybackSuccess('Logged in successfully!');
      return true;
    } catch (e: any) {
      set({ authLoading: false });
      get().setPlaybackError(`Login error: ${e.message || e}`);
      return false;
    }
  },

  signUp: async (email: string, pass: string): Promise<boolean> => {
    const client = getSupabaseClient();
    if (!client) return false;

    set({ authLoading: true });
    try {
      const { data, error } = await client.auth.signUp({ email, password: pass });
      if (error) {
        set({ authLoading: false });
        get().setPlaybackError(`Registration failed: ${error.message}`);
        return false;
      }
      set({ 
        session: data.session, 
        user: data.session?.user ?? null, 
        authLoading: false 
      });
      get().setPlaybackSuccess('Registration successful! Please check your email inbox.');
      return true;
    } catch (e: any) {
      set({ authLoading: false });
      get().setPlaybackError(`Sign up error: ${e.message || e}`);
      return false;
    }
  },

  signOut: async () => {
    const client = getSupabaseClient();
    if (client) {
      await client.auth.signOut().catch(() => {});
    }
    set({ user: null, session: null, authLoading: false });
    get().setPlaybackSuccess('Logged out successfully.');
  },

  checkSession: async () => {
    const client = getSupabaseClient();
    if (!client) {
      set({ user: null, session: null });
      return;
    }

    try {
      const { data } = await client.auth.getSession();
      set({ 
        session: data.session, 
        user: data.session?.user ?? null 
      });
    } catch {
      set({ user: null, session: null });
    }
  },

  signInWithOAuth: async (provider: 'google' | 'github'): Promise<void> => {
    const client = getSupabaseClient();
    if (!client) return;

    set({ authLoading: true });
    try {
      const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
      
      if (!isTauri) {
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: window.location.origin
          }
        });
        if (error) {
          get().setPlaybackError(`OAuth redirect error: ${error.message}`);
        }
        set({ authLoading: false });
        return;
      }

      const { data, error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin,
          skipBrowserRedirect: true
        }
      });

      if (error) {
        set({ authLoading: false });
        get().setPlaybackError(`OAuth error: ${error.message}`);
        return;
      }

      if (data?.url) {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const loginWin = new WebviewWindow('supabase-login', {
          url: data.url,
          title: `Sign in with ${provider === 'google' ? 'Google' : 'GitHub'}`,
          width: 500,
          height: 650,
          resizable: true,
        });

        loginWin.once('tauri://error', (e) => {
          console.error('Failed to open OAuth login window:', e);
          set({ authLoading: false });
        });

        loginWin.onCloseRequested(() => {
          set({ authLoading: false });
        }).catch(() => {});
      } else {
        set({ authLoading: false });
        get().setPlaybackError('Could not retrieve authorization URL.');
      }
    } catch (e: any) {
      set({ authLoading: false });
      get().setPlaybackError(`OAuth login failed: ${e.message || e}`);
    }
  },

  syncToCloud: async () => {
    await syncToCloud();
  },

  syncFromCloud: async (options?: any) => {
    await syncFromCloud(options);
  }
});
