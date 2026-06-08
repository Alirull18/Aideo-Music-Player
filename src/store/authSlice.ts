import { StateCreator } from 'zustand';
import { PlayerState } from './types';
import { getSupabaseClient, resetSupabaseClient } from '../utils/supabaseClient';
import { syncToCloud, syncFromCloud } from '../utils/syncEngine';
import { invoke } from '@tauri-apps/api/core';

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
    if (!client) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: 'Supabase client is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.', type: 'error' } 
      }));
      return false;
    }

    set({ authLoading: true });
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password: pass });
      if (error) {
        set({ authLoading: false });
        get().setPlaybackError(`Authentication failed: ${error.message}`);
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Authentication failed: ${error.message}`, type: 'error' } 
        }));
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
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Login error: ${e.message || e}`, type: 'error' } 
      }));
      return false;
    }
  },

  signUp: async (email: string, pass: string): Promise<boolean> => {
    const client = getSupabaseClient();
    if (!client) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: 'Supabase client is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.', type: 'error' } 
      }));
      return false;
    }

    set({ authLoading: true });
    try {
      const { data, error } = await client.auth.signUp({ email, password: pass });
      if (error) {
        set({ authLoading: false });
        get().setPlaybackError(`Registration failed: ${error.message}`);
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Registration failed: ${error.message}`, type: 'error' } 
        }));
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
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Sign up error: ${e.message || e}`, type: 'error' } 
      }));
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
    if (!client) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: 'Supabase client is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.', type: 'error' } 
      }));
      return;
    }

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
          window.dispatchEvent(new CustomEvent('ui-toast', { 
            detail: { message: `OAuth redirect error: ${error.message}`, type: 'error' } 
          }));
        }
        set({ authLoading: false });
        return;
      }

      const isDev = window.location.origin.includes('localhost:1420');
      const redirectTo = isDev ? window.location.origin : 'https://alirull18.github.io/Aideo-Music-Player/';

      const { data, error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true
        }
      });

      if (error) {
        set({ authLoading: false });
        get().setPlaybackError(`OAuth error: ${error.message}`);
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `OAuth error: ${error.message}`, type: 'error' } 
        }));
        return;
      }

      if (data?.url) {
        await invoke('open_oauth_window', { url: data.url, provider });
        set({ authLoading: false });
      } else {
        set({ authLoading: false });
        get().setPlaybackError('Could not retrieve authorization URL.');
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: 'Could not retrieve authorization URL.', type: 'error' } 
        }));
      }
    } catch (e: any) {
      set({ authLoading: false });
      get().setPlaybackError(`OAuth login failed: ${e.message || e}`);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `OAuth login failed: ${e.message || e}`, type: 'error' } 
      }));
    }
  },

  syncToCloud: async () => {
    await syncToCloud();
  },

  syncFromCloud: async (options?: any) => {
    await syncFromCloud(options);
  }
});
