import { describe, it, expect, vi } from 'vitest';
import { sessionFromOAuthCallback } from '../utils/oauthCallback';

const session = { access_token: 'a', refresh_token: 'r', user: { id: 'u' } };

function client() {
  return {
    auth: {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      setSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    },
  } as any;
}

describe('sessionFromOAuthCallback', () => {
  it('exchanges the PKCE ?code= callback (flowType pkce)', async () => {
    const c = client();
    const result = await sessionFromOAuthCallback('http://localhost:1420/?code=abc123', c);
    expect(c.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(c.auth.setSession).not.toHaveBeenCalled();
    expect(result).toBe(session);
  });

  it('still accepts legacy hash tokens', async () => {
    const c = client();
    const result = await sessionFromOAuthCallback('https://alirull18.github.io/Aideo-Music-Player/#access_token=a&refresh_token=r', c);
    expect(c.auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
    expect(result).toBe(session);
  });

  it('returns null when the URL carries no credentials', async () => {
    const c = client();
    expect(await sessionFromOAuthCallback('http://localhost:1420/', c)).toBeNull();
    expect(c.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('throws when the code exchange fails', async () => {
    const c = client();
    c.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: new Error('bad verifier') });
    await expect(sessionFromOAuthCallback('http://localhost:1420/?code=x', c)).rejects.toThrow('bad verifier');
  });
});
