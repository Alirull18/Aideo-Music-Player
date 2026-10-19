import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSupabaseClient, resetSupabaseClient } from '../utils/supabaseClient';
import { useStore } from '../store';

describe('Supabase missing .env safety', () => {
  beforeEach(() => {
    localStorage.removeItem('aideo_supabase_url');
    localStorage.removeItem('aideo_supabase_key');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    resetSupabaseClient();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetSupabaseClient();
  });

  it('returns null from getSupabaseClient when env and localStorage are empty', () => {
    expect(getSupabaseClient()).toBeNull();
  });

  it('resolves authSlice actions cleanly without throwing when Supabase is unconfigured', async () => {
    const state = useStore.getState();
    await expect(state.checkSession()).resolves.toBeUndefined();
    await expect(state.signIn('test@example.com', 'password123')).resolves.toBe(false);
    await expect(state.signUp('test@example.com', 'password123')).resolves.toBe(false);
    await expect(state.signOut()).resolves.toBeUndefined();
  });
});
