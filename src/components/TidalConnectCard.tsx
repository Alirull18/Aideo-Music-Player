import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, LogOut, ExternalLink, Loader2 } from 'lucide-react';
import { useStore } from '../store';

export default function TidalConnectCard() {
  const tidalConnected = useStore(s => s.tidalConnected);
  const checkTidalStatus = useStore(s => s.checkTidalStatus);
  const [pairing, setPairing] = useState(false);
  const [userCode, setUserCode] = useState('');
  const [verificationUrl, setVerificationUrl] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    checkTidalStatus();
    let isCancelled = false;
    const cleanups: (() => void)[] = [];
    const setup = async () => {
      const uSuccess = await listen('tidal-login-success', () => {
        if (isCancelled) return;
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Tidal connected!', type: 'success' } }));
        useStore.setState({ tidalConnected: true });
        setPairing(false);
        setUserCode('');
        setVerificationUrl('');
      });
      if (isCancelled) { uSuccess(); return; }
      cleanups.push(uSuccess);

      const uExpired = await listen('tidal-login-expired', () => {
        if (isCancelled) return;
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Tidal pairing expired. Please start pairing again.', type: 'error' } }));
        setPairing(false);
        setUserCode('');
        setVerificationUrl('');
      });
      if (isCancelled) { uExpired(); return; }
      cleanups.push(uExpired);
    };
    setup();
    return () => {
      isCancelled = true;
      cleanups.forEach(f => f());
    };
  }, [checkTidalStatus]);

  const resetPairingUi = () => {
    setPairing(false);
    setUserCode('');
    setVerificationUrl('');
  };

  const startPairing = async () => {
    setConnecting(true);
    try {
      const res = await invoke<{ userCode: string; verificationUriComplete: string }>('tidal_login_start');
      setUserCode(res.userCode);
      setVerificationUrl(res.verificationUriComplete);
      setPairing(true);
      await openUrl(res.verificationUriComplete);
    } catch (e) {
      resetPairingUi();
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to start Tidal pairing: ${e}`, type: 'error' } }));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    try {
      await invoke<boolean>('tidal_logout');
    } catch {}
    resetPairingUi();
    useStore.setState({ tidalConnected: false });
  };

  return (
    <div className="settings-lfm-connect-box">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div className="settings-lfm-brand" style={{ background: '#000000', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800 }}>
          T
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Tidal Streaming</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Search, stream and download lossless FLAC tracks.</div>
        </div>
      </div>

      {tidalConnected ? (
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
      ) : pairing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, padding: 14, background: 'var(--glass)', borderRadius: 8, border: '1px solid var(--glass-border)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>Enter this code in the Tidal page that opened in your browser.</span>
          <div style={{ fontFamily: "'JetBrains Mono', Consolas, monospace", fontSize: 26, fontWeight: 700, letterSpacing: 4, textAlign: 'center', color: 'var(--text)' }}>{userCode}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)' }}>
            <Loader2 size={12} className="animate-spin" /> Waiting for approval...
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, padding: '8px', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
              onClick={() => verificationUrl && openUrl(verificationUrl)}
            >
              <ExternalLink size={11} /> Open Link Again
            </button>
            <button
              className="btn btn-secondary"
              style={{ padding: '8px', fontSize: 11, width: 'auto' }}
              onClick={resetPairingUi}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="settings-status-indicator disconnected">
            <span className="settings-status-dot"></span>
            <span>Not connected</span>
          </div>
          <button
            className="btn btn-primary"
            style={{ padding: '10px', fontSize: 12, marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            disabled={connecting}
            onClick={startPairing}
          >
            {connecting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Connect Tidal
          </button>
        </div>
      )}
    </div>
  );
}
