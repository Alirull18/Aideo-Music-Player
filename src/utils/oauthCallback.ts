import type { Session, SupabaseClient } from '@supabase/supabase-js';

/**
 * Turns the URL captured from the desktop OAuth window into a session.
 * PKCE (supabaseClient flowType) returns `?code=`; legacy implicit flow returns hash tokens.
 * Returns null when the URL carries neither.
 */
export async function sessionFromOAuthCallback(url: string, client: SupabaseClient): Promise<Session | null> {
  const parsed = new URL(url);
  const code = parsed.searchParams.get('code');
  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data.session;
  }
  const hash = new URLSearchParams(parsed.hash.slice(1));
  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  const { data, error } = await client.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  return data.session;
}
