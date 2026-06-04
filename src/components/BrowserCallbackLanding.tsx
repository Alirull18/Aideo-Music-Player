import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../utils/supabaseClient';
import { Check, Sparkles, AlertCircle, Loader } from 'lucide-react';

export function BrowserCallbackLanding() {
  const [loading, setLoading] = useState(true);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // 1. Parse errors from URL hash or query params
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);
    const errorDesc = hashParams.get('error_description') || queryParams.get('error_description');
    const errorName = hashParams.get('error') || queryParams.get('error');

    if (errorDesc || errorName) {
      setErrorMsg(errorDesc ? decodeURIComponent(errorDesc.replace(/\+/g, ' ')) : errorName);
      setLoading(false);
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      setLoading(false);
      return;
    }

    // 2. Try fetching immediate session
    client.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserEmail(session.user.email || null);
        setIsConfirmed(true);
        setLoading(false);
      } else {
        // Listen to auth state changes in case it's processing in the background
        const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
          if (session?.user) {
            setUserEmail(session.user.email || null);
            setIsConfirmed(true);
            setLoading(false);
          }
        });

        // Check if there are no auth-related parameters at all
        const hasAuthParams = window.location.hash.includes('access_token') || 
                             window.location.search.includes('code') ||
                             window.location.search.includes('error');

        // If not a callback, stop loading quickly. Otherwise, give it a bit of time to parse.
        const timeoutDuration = hasAuthParams ? 4000 : 1500;
        const timer = setTimeout(() => {
          setLoading(false);
          subscription.unsubscribe();
        }, timeoutDuration);

        return () => {
          clearTimeout(timer);
          subscription.unsubscribe();
        };
      }
    }).catch((err) => {
      console.error("Auth session retrieval error:", err);
      setErrorMsg(err.message || String(err));
      setLoading(false);
    });
  }, []);

  return (
    <div className="browser-landing-root">
      {/* Premium background effects */}
      <div className="browser-landing-glow1"></div>
      <div className="browser-landing-glow2"></div>

      <div className="browser-landing-card">
        <div className="browser-landing-logo">
          <Sparkles className="logo-sparkle" size={24} />
          <span className="logo-text">Aideo Cloud Link</span>
        </div>

        {loading ? (
          <div className="browser-landing-state animate-fade">
            <div className="loading-spinner">
              <Loader size={36} className="spin-icon" />
            </div>
            <h2>Connecting to Supabase</h2>
            <p>Verifying authentication credentials. Please hold on...</p>
          </div>
        ) : errorMsg ? (
          <div className="browser-landing-state error-state animate-fade">
            <div className="state-icon error-icon">
              <AlertCircle size={32} />
            </div>
            <h2>Verification Failed</h2>
            <p className="error-description">{errorMsg}</p>
            <p className="fallback-instructions">
              The link might have expired or already been used. Please try requesting a new verification email from the desktop application.
            </p>
          </div>
        ) : isConfirmed ? (
          <div className="browser-landing-state success-state animate-fade">
            <div className="state-icon success-icon">
              <Check size={32} />
            </div>
            <h2>Email Confirmed!</h2>
            {userEmail && (
              <div className="user-badge">
                <span>{userEmail}</span>
              </div>
            )}
            <p className="success-description">
              Your email has been verified successfully. You can now close this browser tab and return to the desktop client.
            </p>
            <div className="next-steps-card">
              <div className="step-item">
                <span className="step-num">1</span>
                <span>Close this browser tab</span>
              </div>
              <div className="step-item">
                <span className="step-num">2</span>
                <span>Open the <strong>Aideo Desktop App</strong></span>
              </div>
              <div className="step-item">
                <span className="step-num">3</span>
                <span>Log in to access cloud synchronization</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="browser-landing-state default-state animate-fade">
            <h2>Aideo Music Player</h2>
            <p>This web interface handles authentication and verification redirects.</p>
            <p className="default-description">
              Please launch the Aideo application directly on your desktop to manage your local library, play streams, or sync your music library to the cloud.
            </p>
            <button 
              className="btn btn-primary browser-btn"
              onClick={() => {
                window.location.href = 'https://github.com/Alirull18/Aideo-Music-Player';
              }}
            >
              Get Desktop App
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
