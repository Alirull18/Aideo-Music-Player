import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, LogOut, ExternalLink, Loader2, ChevronDown, ChevronRight, KeyRound } from 'lucide-react';
import { useStore } from '../store';

export default function QobuzConnectCard() {
  const qobuzConnected = useStore(s => s.qobuzConnected);
  const checkQobuzStatus = useStore(s => s.checkQobuzStatus);
  const openQobuzLoginWindow = useStore(s => s.openQobuzLoginWindow);
  const [tokenInput, setTokenInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [launchingLogin, setLaunchingLogin] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    checkQobuzStatus();
    let isCancelled = false;
    const cleanups: (() => void)[] = [];
    const setup = async () => {
      const uSuccess = await listen('qobuz-login-success', () => {
        if (isCancelled) return;
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Qobuz connected successfully!', type: 'success' } }));
        useStore.setState({ qobuzConnected: true });
        setTokenInput('');
        setLaunchingLogin(false);
      });
      if (isCancelled) { uSuccess(); return; }
      cleanups.push(uSuccess);

      const uError = await listen<string>('qobuz-login-error', (event) => {
        if (isCancelled) return;
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Qobuz login failed: ${event.payload || 'Unknown error'}`, type: 'error' } }));
        setLaunchingLogin(false);
      });
      if (isCancelled) { uError(); return; }
      cleanups.push(uError);
    };
    setup();
    return () => {
      isCancelled = true;
      cleanups.forEach(f => f());
    };
  }, [checkQobuzStatus]);

  const handleOpenLogin = async () => {
    setLaunchingLogin(true);
    try {
      await openQobuzLoginWindow();
    } catch {
      setLaunchingLogin(false);
    }
  };

  const connectManual = async () => {
    if (!tokenInput.trim()) return;
    setConnecting(true);
    try {
      await invoke<{ displayName: string }>('qobuz_connect', { token: tokenInput.trim() });
      useStore.setState({ qobuzConnected: true });
      setTokenInput('');
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Qobuz connected!', type: 'success' } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Qobuz connection failed: ${e}`, type: 'error' } }));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      await invoke<boolean>('qobuz_logout');
    } catch {}
    useStore.setState({ qobuzConnected: false });
    setLaunchingLogin(false);
  };

  return (
    <div className="settings-lfm-connect-box">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div className="settings-lfm-brand" style={{ background: '#0a1e33', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7fb8e6', fontWeight: 800 }}>
          Q
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
            Qobuz Streaming <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 999, border: '1px solid rgba(127,184,230,0.4)', color: '#7fb8e6', marginLeft: 6, verticalAlign: 'middle' }}>EXPERIMENTAL</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Search and stream lossless FLAC up to Hi-Res 192 kHz / 24-bit.</div>
        </div>
      </div>

      {qobuzConnected ? (
        <div className="settings-lfm-connected-header">
          <div className="settings-status-indicator connected">
            <span className="settings-status-dot pulse" style={{ backgroundColor: '#22c55e' }}></span>
            <span>Connected</span>
          </div>
          <button
            className="btn btn-secondary"
            style={{ padding: '6px 12px', fontSize: 11, width: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={disconnect}
          >
            <LogOut size={11} /> Disconnect
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="settings-status-indicator disconnected">
            <span className="settings-status-dot"></span>
            <span>Not connected</span>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, padding: '10px 12px', background: 'var(--glass)', borderRadius: 8, border: '1px solid var(--glass-border)' }}>
            Sign in with your Qobuz account. A secure official login window will open and automatically connect when you finish logging in.
          </div>

          <button
            className="btn btn-primary"
            style={{ padding: '11px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            disabled={launchingLogin}
            onClick={handleOpenLogin}
          >
            {launchingLogin ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
            {launchingLogin ? 'Login Window Open — Signing In...' : 'Log In to Qobuz'}
          </button>

          {/* Collapsible Manual Token Option */}
          <div style={{ marginTop: 4, borderTop: '1px solid var(--glass-border)', paddingTop: 10 }}>
            <button
              type="button"
              onClick={() => setShowManualInput(prev => !prev)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 0',
                outline: 'none',
              }}
            >
              {showManualInput ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <KeyRound size={11} style={{ marginLeft: 2 }} />
              Advanced: Enter token manually
            </button>

            {showManualInput && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.5, padding: '8px 10px', background: 'rgba(0,0,0,0.15)', borderRadius: 6, border: '1px solid var(--glass-border)' }}>
                  If you prefer manual entry: Log in at <a href="https://play.qobuz.com" target="_blank" rel="noreferrer" style={{ color: '#7fb8e6', textDecoration: 'underline' }}>play.qobuz.com</a>, press F12 → Network tab, copy your <code>X-User-Auth-Token</code> header, and paste it below.
                </div>
                <input
                  type="password"
                  placeholder="Paste X-User-Auth-Token here"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') connectManual(); }}
                  style={{ width: '100%', padding: '8px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--glass-border)', background: 'var(--glass)', color: 'var(--text)', fontFamily: "'JetBrains Mono', Consolas, monospace" }}
                />
                <button
                  className="btn btn-secondary"
                  style={{ padding: '8px', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  disabled={connecting || !tokenInput.trim()}
                  onClick={connectManual}
                >
                  {connecting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Connect with Token
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
