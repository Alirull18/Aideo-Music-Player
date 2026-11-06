import { createClient } from '@supabase/supabase-js';

export const getSupabaseCredentials = () => {
  const localUrl = localStorage.getItem('aideo_supabase_url');
  const localKey = localStorage.getItem('aideo_supabase_key');
  const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  return { 
    url: localUrl || envUrl, 
    key: localKey || envKey 
  };
};

let supabaseInstance: ReturnType<typeof createClient> | null = null;

export const getSupabaseClient = () => {
  const { url, key } = getSupabaseCredentials();
  if (!url || url === 'https://your-project.supabase.co' || !key || key === 'your-anon-key-here' || url === '' || key === '') {
    return null;
  }
  
  if (!supabaseInstance) {
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        flowType: 'pkce'
      }
    });
  }
  return supabaseInstance;
};

export const resetSupabaseClient = () => {
  supabaseInstance = null;
};
