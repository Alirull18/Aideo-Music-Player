import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { backupCategories, collectBackupSettings, replayPendingBackupSettings, type BackupCategory, type BackupPreview } from '../utils/localBackup';

interface Props {
  onQuiesce: () => Promise<void>;
  onCommitted: () => Promise<void>;
  onFinished: (committed: boolean) => void;
}
const labels: Record<BackupCategory, string> = {
  playlists: 'Playlists', favorites: 'Favorites and loved albums', history: 'Listening history',
  recommendations: 'Recommendation evidence and feedback', settings: 'Appearance and playback preferences',
};
const preferenceLabel = (key: string) => key.replace(/^aideo[-_]/, '').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());
export function LocalBackupPanel({ onQuiesce, onCommitted, onFinished }: Props) {
  const [selected, setSelected] = useState<BackupCategory[]>([...backupCategories]);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage(''); setFailure(false);
    try { await action(); } catch (e) { setFailure(true); setMessage(String(e)); } finally { setBusy(false); }
  }
  async function exportBackup() {
    const destination = await save({ defaultPath: 'Aideo-backup.json', filters: [{ name: 'Aideo backup', extensions: ['json'] }] });
    if (!destination) return;
    await invoke('local_backup_export', { path: destination, categories: selected, settings: collectBackupSettings() });
    setMessage('Backup saved. Local audio files are referenced by path.');
  }
  async function chooseRestore() {
    const source = await open({ multiple: false, filters: [{ name: 'Aideo backup', extensions: ['json'] }] });
    if (typeof source !== 'string') return;
    const next = await invoke<BackupPreview>('local_backup_preview', { path: source, categories: [] });
    setPath(source); setPreview(next); setSelected(next.categories);
  }
  async function restoreBackup() {
    if (!preview) return;
    const rollbackPath = await save({ defaultPath: 'Aideo-before-restore.json', filters: [{ name: 'Rollback backup', extensions: ['json'] }] });
    if (!rollbackPath) return;
    let committed = false;
    try {
      await onQuiesce();
      await invoke('local_backup_restore', { path, categories: selected, rollbackPath, fingerprintExpected: preview.fingerprint, settings: collectBackupSettings() });
      committed = true;
      await replayPendingBackupSettings();
      await onCommitted();
      setPreview(null);
      setMessage('Restore committed. Cloud sync is paused until you review reconciliation. Restart Aideo to apply restored preferences.');
    } catch (e) {
      if (committed) throw new Error(`Library restore committed; preference replay or refresh is pending. Restart Aideo to retry. ${String(e)}`);
      throw e;
    } finally { onFinished(committed); }
  }
  return <section className="reliability-controls" aria-labelledby="local-backup-title">
    <h3 id="local-backup-title">Local backup</h3>
    <p>Keep playlists, favorites and listening evidence in a portable JSON file. Works offline. Account credentials and audio files are excluded.</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: '16px 0' }}>
      <legend>{preview ? 'Choose categories to merge' : 'Choose categories to export'}</legend>
      {backupCategories.filter(c => !preview || preview.categories.includes(c)).map(category => <label key={category} style={{ display: 'block', padding: '6px 0' }}>
        <input type="checkbox" checked={selected.includes(category)} onChange={e => setSelected(current => e.target.checked ? [...current, category] : current.filter(c => c !== category))} />{' '}{labels[category]}
        {preview ? ` (${preview.counts[category]})` : ''}
      </label>)}
    </fieldset>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-secondary" disabled={busy || selected.length === 0} onClick={() => void run(exportBackup)}>Export backup</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(chooseRestore)}>Choose backup to restore</button>
    </div>
    {preview && <div style={{ marginTop: 16 }}>
      <h4>Restore preview</h4>
      <p>{preview.missing_paths.length} missing local paths. Provider entries remain available through their providers.</p>
      {preview.missing_paths.length > 0 && <details><summary>Missing paths</summary><ul>{preview.missing_paths.slice(0, 100).map(p => <li key={p} style={{ overflowWrap: 'anywhere' }}>{p}</li>)}</ul>{preview.missing_paths.length > 100 && <p>Showing the first 100 paths.</p>}</details>}
      {preview.playlist_collisions.length > 0 && <p>Existing playlist names get a distinct restored copy: {preview.playlist_collisions.join(', ')}.</p>}
      {preview.already_imported.length > 0 && <p>Previously restored categories are skipped: {preview.already_imported.join(', ')}.</p>}
      {selected.includes('settings') && <details><summary>Preferences to overwrite</summary><ul>{Object.entries(preview.settings).filter(([key]) => key !== 'aideo-loved-albums').map(([key, value]) => <li key={key}>{preferenceLabel(key)}: {localStorage.getItem(key) ?? '(unset)'} → {value}</li>)}</ul></details>}
      <p>Favorites merge with yours. Existing listening history stays. A rollback backup is saved before commit. Cloud sync pauses for reconciliation.</p>
      <button type="button" className="btn btn-secondary" disabled={busy || selected.length === 0} onClick={() => void run(restoreBackup)}>Save rollback backup and restore selected data</button>{' '}
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
    </div>}
    {busy && <p role="status">Working…</p>}
    {message && <p role={failure ? 'alert' : 'status'}>{message}</p>}
  </section>;
}

