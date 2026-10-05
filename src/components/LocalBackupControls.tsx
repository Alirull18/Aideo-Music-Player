import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LocalBackupPanel } from './LocalBackupPanel';
import { quiesceLibrary, refreshRestoredLibrary, finishLibraryMaintenance } from '../utils/libraryMaintenance';

export function LocalBackupControls() {
  const [pending, setPending] = useState(!!localStorage.getItem('aideo_local_restore_sync'));
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const changed = () => setPending(!!localStorage.getItem('aideo_local_restore_sync'));
    window.addEventListener('library-maintenance-finished', changed);
    return () => window.removeEventListener('library-maintenance-finished', changed);
  }, []);
  async function resume() {
    try {
      if (localStorage.getItem('aideo_local_restore_sync') === 'restoring') throw new Error('Wait for library maintenance to finish.');
      await invoke('local_backup_clear_reconciliation');
      localStorage.removeItem('aideo_local_restore_sync');
      setPending(false); setReview(false); setError('');
    } catch (e) { setError(String(e)); }
  }
  return <>
    <LocalBackupPanel onQuiesce={quiesceLibrary} onCommitted={refreshRestoredLibrary} onFinished={committed => { finishLibraryMaintenance(committed); setPending(!!localStorage.getItem('aideo_local_restore_sync')); }} />
    {pending && <section className="reliability-controls" aria-label="Cloud reconciliation">
      <p>Cloud sync is paused after local changes.</p>
      <button className="btn btn-secondary" onClick={() => setReview(!review)}>Review cloud effects</button>
      {review && <><p>Resuming allows future sync to upload restored favorites and listening history. Matching playlist names can replace playlist contents in either direction. Restored copies with distinct names can upload as additional playlists. Review your playlists first. This button resumes sync; it does not start a transfer.</p><button className="btn btn-secondary" onClick={() => void resume()}>I reviewed the changes — resume cloud sync</button></>}
      {error && <p role="alert">{error}</p>}
    </section>}
  </>;
}
