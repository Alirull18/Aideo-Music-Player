import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../utils/supabaseClient';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Loader } from 'lucide-react';

export function OauthChildCallback() {
  const [status, setStatus] = useState('Completing authorization...');

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      setStatus('Failed to connect to Supabase client.');
      return;
    }

    // Try to get immediate session
    client.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const safeSessionPayload = {
          access_token: session.access_token,
          user: { id: session.user?.id, email: session.user?.email }
        };
        emit('oauth-success', safeSessionPayload).then(() => {
          getCurrentWindow().close().catch(() => {});
        });
      } else {
        // Listen to state changes if the session is parsing asynchronously
        const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
          if (session) {
            const safeSessionPayload = {
              access_token: session.access_token,
              user: { id: session.user?.id, email: session.user?.email }
            };
            emit('oauth-success', safeSessionPayload).then(() => {
              subscription.unsubscribe();
              getCurrentWindow().close().catch(() => {});
            });
          }
        });

        // Fail-safe timeout in case of cancel/failures
        const timer = setTimeout(() => {
          setStatus('Authorization timed out.');
          subscription.unsubscribe();
        }, 12000);

        return () => {
          clearTimeout(timer);
          subscription.unsubscribe();
        };
      }
    }).catch((err) => {
      console.error('OAuth session resolution error:', err);
      setStatus(`Error parsing credentials: ${err.message || String(err)}`);
    });
  }, []);

  return (
    <div className="browser-landing-root" style={{ background: '#080810' }}>
      <div className="browser-landing-card" style={{ maxWidth: 360 }}>
        <div className="loading-spinner">
          <Loader size={36} className="spin-icon" />
        </div>
        <h2 style={{ fontSize: 18, color: 'white', marginTop: 12 }}>{status}</h2>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
          This window will close automatically when login completes.
        </p>
      </div>
    </div>
  );
}
