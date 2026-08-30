import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Check, LogOut, ExternalLink, Loader2 } from 'lucide-react';
import { useStore } from '../store';

export default function QobuzConnectCard() {
  const qobuzConnected = useStore(s => s.qobuzConnected);
  const checkQobuzStatus = useStore(s => s.checkQobuzStatus);
  const [tokenInput, setTokenInput] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    checkQobuzStatus();
    let isCancelled = false;
    let cleanup: (() => void) | null = null;
    const setup = async () => {
      const uSuccess = await listen('qobuz-login-success', () => {
        if (isCancelled) return;
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Qobuz connected!', type: 'success' } }));
        useStore.setState({ qobuzConnected: true });
        setTokenInput('');
      });
      if (isCancelled) { uSuccess(); return; }
      cleanup = uSuccess;
    };
    setup();
    return () => {
      isCancelled = true;
      cleanup?.();
    };
  }, [checkQobuzStatus]);

  const connect = async () => {
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
  };

  return (
    <div className="settings-lfm-connect-box">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div className="settings-lfm-brand" style={{ background: '#0a1e33', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7fb8e6', fontWeight: 800 }}>
          Q
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Qobuz Streaming <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 999, border: '1px solid rgba(127,184,230,0.4)', color: '#7fb8e6', marginLeft: 6, verticalAlign: 'middle' }}>EXPERIMENTAL</span></div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="settings-status-indicator disconnected">
            <span className="settings-status-dot"></span>
            <span>Not connected</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6, padding: 10, background: 'var(--glass)', borderRadius: 8, border: '1px solid var(--glass-border)' }}>
            Qobuz has no public sign-in API, so Aideo uses your browser session token:
            <br />
            1.&nbsp;<a href="https://play.qobuz.com" target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Log in at play.qobuz.com <ExternalLink size={9} /></a>
            <br />
            2. Press F12 → open the <b>Network</b> tab → reload the page
            <br />
            3. Click any request to <code>api.json</code> and copy the <b>X-User-Auth-Token</b> request header value
            <br />
            4. Paste it below
          </div>
          <input
            type="password"
            placeholder="Paste X-User-Auth-Token here"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
            style={{ width: '100%', padding: '9px 12px', fontSize: 12, borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--glass)', color: 'var(--text)', fontFamily: "'JetBrains Mono', Consolas, monospace" }}
          />
          <button
            className="btn btn-primary"
            style={{ padding: '10px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            disabled={connecting || !tokenInput.trim()}
            onClick={connect}
          >
            {connecting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Connect Qobuz
          </button>
        </div>
      )}
    </div>
  );
}
