import { useEffect } from 'react';
import { useStore } from '../store';
export function PlaybackRecovery() {
  const recovery = useStore(s => s.playbackRecovery);
  const currentTrack = useStore(s => s.currentTrack);
  const albumSession = useStore(s => s.albumSession);
  const status = useStore(s => s.playback.status);
  useEffect(() => {
    if (recovery && !recovery.pending && (currentTrack?.path !== recovery.track.path || status === 'Playing')) {
      useStore.getState().dismissPlaybackRecovery();
    }
  }, [recovery, currentTrack, status]);
  if (!recovery) return null;
  const openRecovery = () => {
    if (recovery.action === 'reconnect') useStore.setState({ showSettings: true, pendingSettingsTab: 'plugins' });
    if (recovery.action === 'output') useStore.setState({ showControlCenter: true });
    if (recovery.action === 'library') {
      useStore.getState().setView('library');
      window.dispatchEvent(new Event('open-library-health'));
    }
  };
  const skipAlbumTrack = async () => {
    const state = useStore.getState();
    if (!state.albumSession || state.currentTrack?.path !== recovery.track.path) return;
    state.dismissPlaybackRecovery();
    try { await state.playNext(); }
    catch (error) { useStore.getState().reportPlaybackFailure(String(error)); }
  };
  return <section className="playback-recovery reliability-controls" aria-label="Playback recovery" style={{ position: 'fixed', bottom: 100, left: 24, right: 24, zIndex: 110, padding: 16, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--glass-border)' }}>
    <div role="alert"><strong>{recovery.track.title} — {recovery.track.artist}</strong><p style={{ overflowWrap: 'anywhere' }}>{recovery.error}</p></div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button className="btn" disabled={recovery.pending} onClick={() => void useStore.getState().retryPlaybackRecovery()}>{recovery.pending ? 'Retrying…' : 'Retry'}</button>
      {albumSession && <button className="btn" disabled={recovery.pending} onClick={() => void skipAlbumTrack()}>Skip album track</button>}
      {recovery.action !== 'retry' && <button className="btn" onClick={openRecovery}>{recovery.action === 'reconnect' ? 'Reconnect provider' : recovery.action === 'output' ? 'Choose output' : 'Locate file'}</button>}
      <button className="btn" onClick={() => useStore.getState().dismissPlaybackRecovery()}>Dismiss</button>
    </div>
  </section>;
}
