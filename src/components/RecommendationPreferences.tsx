import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { Track } from '../store/types';
import { collectBackupSettings } from '../utils/localBackup';
import { quiesceLibrary, finishLibraryMaintenance } from '../utils/libraryMaintenance';
import { invalidateRecommendationPreferences, searchExcludedRecordings, type ExcludedRecording, type ResetPreview, type ResetSelection } from '../utils/recommendations';

export function RecommendationPreferences({ onAllow, onChanged }: { onAllow: (track: Track) => Promise<void>; onChanged: () => Promise<void> }) {
  const [excluded, setExcluded] = useState<ExcludedRecording[]>([]);
  const [recordings, setRecordings] = useState<ExcludedRecording[]>([]);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('recordings');
  const [selected, setSelected] = useState<string[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [preview, setPreview] = useState<{ selection: ResetSelection; result: ResetPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    try {
      const [a, b] = await Promise.all([invoke<ExcludedRecording[]>('get_recommendation_exclusions'), invoke<ExcludedRecording[]>('get_recommendation_recordings')]);
      setExcluded(a); setRecordings(b);
    } catch { throw new Error('Could not load recommendation preferences. Try again in the desktop app.'); }
  }
  useEffect(() => { void load().catch(e => setError(String(e))); }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function changed() { invalidateRecommendationPreferences(); await onChanged(); await load(); }
  async function makePreview() {
    const selection: ResetSelection = { all: scope === 'all', recording_ids: scope === 'recordings' ? selected : [],
      start: scope === 'dates' && start ? Date.parse(`${start}T00:00:00Z`) / 1000 : null,
      end: scope === 'dates' && end ? Date.parse(`${end}T23:59:59Z`) / 1000 : null };
    setPreview(null);
    setPreview({ selection, result: await invoke<ResetPreview>('preview_recommendation_reset', { selection }) });
  }
  async function applyReset() {
    if (!preview) return;
    const rollbackPath = await save({ defaultPath: 'Aideo-before-taste-reset.json', filters: [{ name: 'Rollback backup', extensions: ['json'] }] });
    if (!rollbackPath) return;
    await quiesceLibrary();
    try {
      const count = await invoke<number>('apply_recommendation_reset', { selection: preview.selection, token: preview.result.token, rollbackPath, settings: collectBackupSettings() });
      setPreview(null); setMessage(`${count} listens removed from learned taste. Listening history, favorites and exclusions remain.`);
      await changed();
    } finally { finishLibraryMaintenance(false); }
  }
  return <section className="reliability-controls" aria-labelledby="recommendation-preferences-title">
    <h3 id="recommendation-preferences-title">Recommendation preferences</h3>
    <label>Search recordings and provider references <input value={query} onChange={e => setQuery(e.target.value)} /></label>
    <h4>Excluded recordings</h4>
    {searchExcludedRecordings(excluded, query).map(r => <div key={r.recording_id}>
      <span>{r.track.title || 'Unknown title'} — {r.track.artist || 'Unknown artist'} {r.version || ''}</span>
      <small> {r.sources.join(', ')}</small>
      <button className="btn btn-secondary" disabled={busy} onClick={() => void run(async () => { await onAllow(r.track); await changed(); })}>Allow again</button>
    </div>)}
    {!excluded.length && !error && <p>No excluded recordings.</p>}
    <h4>Reset learned taste</h4>
    <p>Existing listens stop training recommendations. New listens can teach again. Visible history, favorites and exclusions stay intact.</p>
    <label>Reset scope <select disabled={busy} value={scope} onChange={e => { setScope(e.target.value); setPreview(null); }}>
      <option value="recordings">Selected recordings</option><option value="dates">Date range (UTC)</option><option value="all">All learned history</option>
    </select></label>
    {scope === 'recordings' && searchExcludedRecordings(recordings, query).map(r => <label key={r.recording_id} style={{ display: 'block' }}>
      <input type="checkbox" disabled={busy} checked={selected.includes(r.recording_id)} onChange={e => { setSelected(e.target.checked ? [...selected, r.recording_id] : selected.filter(id => id !== r.recording_id)); setPreview(null); }} />
      {r.track.title || 'Unknown title'} — {r.track.artist || 'Unknown artist'} {r.version || ''} ({r.sources.join(', ')})
    </label>)}
    {scope === 'dates' && <><label>From <input type="date" disabled={busy} value={start} onChange={e => { setStart(e.target.value); setPreview(null); }} /></label>
      <label>Through <input type="date" disabled={busy} value={end} onChange={e => { setEnd(e.target.value); setPreview(null); }} /></label></>}
    <button className="btn btn-secondary" disabled={busy} onClick={() => void run(makePreview)}>Preview affected listens</button>
    {preview && <p>{preview.result.count} listens affected. A rollback backup is required before applying. <button className="btn btn-secondary" disabled={busy || !preview.result.count} onClick={() => void run(applyReset)}>Save rollback and reset taste</button></p>}
    {error && <p role="alert">{error} <button className="btn btn-secondary" disabled={busy} onClick={() => void run(load)}>Retry loading preferences</button></p>}{message && <p role="status">{message}</p>}
  </section>;
}
