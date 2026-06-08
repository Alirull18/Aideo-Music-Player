import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const getSupabaseCredentials = () => {
  const localUrl = localStorage.getItem('aideo_supabase_url');
  const localKey = localStorage.getItem('aideo_supabase_key');
  return { 
    url: localUrl || SUPABASE_URL, 
    key: localKey || SUPABASE_ANON_KEY 
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
        flowType: 'implicit'
      }
    });
  }
  return supabaseInstance;
};

export const resetSupabaseClient = () => {
  supabaseInstance = null;
};
