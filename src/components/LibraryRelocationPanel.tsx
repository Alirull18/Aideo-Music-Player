import { useEffect, useId, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import type { PlayerState } from '../store/types';
import { collectBackupSettings } from '../utils/localBackup';
import { remapLibraryReferences, replayPendingLibraryRelocations, type LibraryRemap, type PathMapping, type RelocationPreview } from '../utils/libraryRelocation';
import { clearSourceCache } from '../utils/unifiedSources';
import { invalidateRecommendationPreferences } from '../utils/recommendations';
import { useDownloadStore, type DownloadJob } from '../store/downloadStore';

interface Props { oldRoot: string; onClose: () => void; onQuiesce: () => Promise<void>; onCommitted: () => Promise<void>; onFinished: (committed: boolean) => void }
interface UndoPreview { id: number; mappings: PathMapping[]; missing_paths: string[]; conflicts: string[] }
function reconcileRuntime(remaps: LibraryRemap[]) {
  const fields = ['albumSession', 'stopBoundary', 'queue', 'currentTrack', 'playHistory', 'playCounts', 'sourceRegistry', 'autoplaySeedTrack', 'autoplaySessionHistory', 'recentlyClearedAutoplayPaths', 'playbackRecovery', 'tagEditorTrack', 'tagEditorBatchTracks', 'coverArtModalTrack', 'playlistModalTrack'] as const;
  for (const remap of remaps) {
    const state = useStore.getState();
    const patch = Object.fromEntries(fields.map(key => [key, remapLibraryReferences(state[key], remap.mappings)])) as Partial<PlayerState>;
    patch.scanDirs = JSON.parse(localStorage.getItem('aideo_scan_dirs') || '[]');
    useStore.setState(patch);
  }
  clearSourceCache(); invalidateRecommendationPreferences();
}
function Mappings({ mappings }: { mappings: PathMapping[] }) {
  return <ol className="library-health-findings">{mappings.slice(0, 100).map(m => <li key={m.old_path}><p className="library-health-path">From: {m.old_path}</p><p className="library-health-path">To: {m.new_path}</p></li>)}</ol>;
}
export function LibraryRelocationPanel({ oldRoot, onClose, onQuiesce, onCommitted, onFinished }: Props) {
  const headingId = useId(); const heading = useRef<HTMLHeadingElement>(null);
  const [preview, setPreview] = useState<RelocationPreview | null>(null);
  const [undo, setUndo] = useState<UndoPreview | null>(null);
  const [committedId, setCommittedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { heading.current?.focus(); }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (failure) { setError(String(failure)); } finally { setBusy(false); }
  }
  async function choose() {
    const newRoot = await open({ directory: true, multiple: false, title: 'Locate moved library folder' });
    if (typeof newRoot !== 'string') return;
    setPreview(await invoke<RelocationPreview>('preview_library_relocation', { oldRoot, newRoot })); setUndo(null);
  }
  async function apply(reverse: boolean) {
    if (reverse ? !undo : !preview) return;
    const rollbackPath = await save({ defaultPath: reverse ? 'Aideo-before-undo-relocation.json' : 'Aideo-before-relocation.json', filters: [{ name: 'Rollback backup', extensions: ['json'] }] });
    if (!rollbackPath) return;
    let committed = false;
    try {
      await onQuiesce();
      const result = await invoke<LibraryRemap>(reverse ? 'undo_library_relocation' : 'apply_library_relocation', { ...(reverse ? { id: undo!.id } : { preview }), rollbackPath, settings: collectBackupSettings() });
      committed = true;
      const remaps = await replayPendingLibraryRelocations(); reconcileRuntime(remaps);
      await onCommitted(); await useStore.getState().syncBackendQueue();
      const downloadJobs = await invoke<DownloadJob[]>('get_track_download_jobs');
      for (const job of downloadJobs ?? []) useDownloadStore.getState().upsert(job);
      await useDownloadStore.getState().refreshPaths();
      setPreview(null); setUndo(null); setCommittedId(reverse ? null : result.id);
      setMessage(reverse ? 'Relocation undone. References restored to their previous paths.' : 'Confirmed references updated. Unresolved files keep their original paths. Cloud sync is paused for review.');
    } catch (failure) {
      if (committed) throw new Error(`Relocation committed; saved-reference replay or library refresh is pending. Restart Aideo to retry. ${String(failure)}`);
      throw failure;
    } finally { onFinished(committed); }
  }
  return <section className="library-health-panel reliability-controls" aria-labelledby={headingId} aria-busy={busy}>
    <header className="library-health-header"><h3 id={headingId} ref={heading} tabIndex={-1}>Locate moved folder</h3><button className="btn btn-secondary" type="button" disabled={busy} onClick={onClose}>Close relocation</button></header>
    <p className="library-health-path">Original folder: {oldRoot}</p>
    <p>Choose the folder containing the same files and subfolders. Preview confirms replacements before changing library references.</p>
    <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void run(choose)}>Choose replacement folder</button>
    {preview && <>
      <h4>Replacement preview</h4><p>{preview.mappings.length} matched · {preview.unresolved.length} unresolved · {preview.conflicts.length} conflicts</p>
      <Mappings mappings={preview.mappings} />
      {preview.unresolved.length > 0 && <details open><summary>Unresolved files keep their original paths</summary><ul>{preview.unresolved.slice(0, 100).map(p => <li key={p} className="library-health-path">{p}</li>)}</ul></details>}
      {preview.conflicts.length > 0 && <div role="alert"><p>Resolve these conflicts before applying:</p><ul>{preview.conflicts.slice(0, 100).map(p => <li key={p} className="library-health-path">{p}</li>)}</ul></div>}
      {preview.mappings.length > 100 && <p>Showing the first 100 matched paths.</p>}
      <p>Playback stops before applying. A rollback backup is saved. Favorites, playlist order, history and recording identity are preserved.</p>
      <button className="btn btn-secondary" type="button" disabled={busy || preview.conflicts.length > 0 || preview.mappings.length === 0} onClick={() => void run(() => apply(false))}>Save rollback and apply confirmed matches</button>
    </>}
    {committedId !== null && !undo && <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void run(async () => setUndo(await invoke<UndoPreview>('preview_library_relocation_undo', { id: committedId })))}>Preview Undo</button>}
    {undo && <>
      <h4>Undo preview</h4><Mappings mappings={undo.mappings} />
      {undo.missing_paths.length > 0 && <p>{undo.missing_paths.length} original files are still unavailable. Undo restores their previous references.</p>}
      {undo.conflicts.map(p => <p role="alert" key={p}>{p}</p>)}
      <button className="btn btn-secondary" type="button" disabled={busy || undo.conflicts.length > 0} onClick={() => void run(() => apply(true))}>Save rollback and undo relocation</button>
    </>}
    {busy && <p role="status">Checking and updating library references…</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
