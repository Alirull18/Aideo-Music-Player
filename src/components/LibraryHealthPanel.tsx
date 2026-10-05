import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '../store';
import { LibraryRelocationPanel } from './LibraryRelocationPanel';
import { quiesceLibrary, refreshRestoredLibrary, finishLibraryMaintenance } from '../utils/libraryMaintenance';

export interface HealthIssue { kind: string; paths: string[]; detail: string }
export interface HealthReport { scan_id: string; issues: HealthIssue[]; cancelled: boolean; invalidated: boolean; checked: number; total: number }
const labels: Record<string, string> = { missing_file: 'Missing files', unavailable_root: 'Unavailable folders', inaccessible: 'Inaccessible files or folders', incomplete_tags: 'Incomplete tags', absent_artwork: 'Missing artwork', possible_duplicate: 'Possible duplicates', unreadable_metadata: 'Unreadable metadata' };
export function LibraryHealthPanel({ onLocate, onClose }: { onLocate?: (root: string) => void; onClose?: () => void }) {
  const tracks = useStore(s => s.tracks);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [locatingRoot, setLocatingRoot] = useState<string | null>(null);
  const locateButton = useRef<HTMLElement | null>(null);
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const active = useRef<string | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setReport(previous => previous ? { ...previous, invalidated: true } : null);
  }, [tracks]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (active.current) void invoke('cancel_library_health', { scanId: active.current }).catch(() => {}); };
  }, []);
  async function scan() {
    const scanId = crypto.randomUUID();
    const revision = generation.current;
    active.current = scanId;
    setRunning(true); setError(''); setReport(null); setProgress({ checked: 0, total: 0 });
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ scan_id: string; checked: number; total: number }>('library-health-progress', event => {
        if (mounted.current && event.payload.scan_id === active.current) setProgress(event.payload);
      });
      if (!mounted.current) return;
      const result = await invoke<HealthReport>('scan_library_health', { scanId });
      if (mounted.current) setReport({ ...result, invalidated: result.invalidated || revision !== generation.current });
    } catch (failure) { if (mounted.current) setError(String(failure)); }
    finally { unlisten?.(); active.current = null; if (mounted.current) setRunning(false); }
  }
  async function edit(path: string, artwork: boolean) {
    try {
      const track = tracks.find(t => t.path === path) ?? await invoke<(typeof tracks)[number]>('get_track_by_path', { path });
      if (artwork) useStore.getState().setCoverArtModalTrack(track);
      else useStore.getState().setTagEditorTrack(track);
    } catch (failure) { setError(String(failure)); }
  }
  const usable = report && !report.cancelled && !report.invalidated;
  const issues = usable ? report.issues : [];
  const visible = issues.filter(issue => filter === 'all' || issue.kind === filter);
  return <section className="library-health-panel reliability-controls" aria-label="Library health">
    <header className="library-health-header"><h2>Library health</h2>{onClose && <button className="btn btn-secondary" type="button" onClick={onClose}>Close</button>}</header>
    <p>Check local files, tags, artwork and possible duplicates. Inspection changes no files or library records.</p>
    <div className="library-health-controls">
      <button className="btn btn-secondary" type="button" disabled={running} onClick={() => void scan()}>{report ? 'Scan again' : 'Check library'}</button>
      {running && <button className="btn btn-secondary" type="button" onClick={() => void invoke('cancel_library_health', { scanId: active.current }).catch(failure => setError(String(failure)))}>Cancel scan</button>}
    </div>
    <div role="status" aria-live="polite">
      {running && <><progress aria-label="Library check progress" value={progress.total ? progress.checked : undefined} max={progress.total || 1} /> <span>{progress.checked} of {progress.total} entries checked</span></>}
      {report?.cancelled && <p>Scan cancelled. Run it again for a complete report.</p>}
      {report?.invalidated && <p>The library changed. Scan again to refresh these results.</p>}
      {usable && <p>{report.checked} local entries checked · {issues.length} findings</p>}
    </div>
    {error && <p role="alert">{error}</p>}
    {usable && <>
      <label>Show <select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All findings ({issues.length})</option>{Object.entries(labels).map(([kind, label]) => <option key={kind} value={kind}>{label} ({issues.filter(issue => issue.kind === kind).length})</option>)}</select></label>
      {visible.length === 0 && <p>{issues.length === 0 ? 'No issues found in the checked files.' : 'No findings in this category.'}</p>}
      <ul className="library-health-findings">{visible.slice(0, 200).map((issue, index) => <li key={`${issue.kind}:${issue.paths.join('|')}:${index}`}>
        <strong>{labels[issue.kind] ?? issue.kind}</strong>
        {issue.paths.map(path => <p className="library-health-path" key={path}>{path}</p>)}<p>{issue.detail}</p>
        {issue.kind === 'incomplete_tags' && <button className="btn btn-secondary" type="button" onClick={() => void edit(issue.paths[0], false)}>Edit tags</button>}
        {issue.kind === 'absent_artwork' && <button className="btn btn-secondary" type="button" onClick={() => void edit(issue.paths[0], true)}>Edit artwork</button>}
        {issue.kind === 'unavailable_root' && <button className="btn btn-secondary" type="button" onClick={event => { if (onLocate) onLocate(issue.paths[0]); else { locateButton.current = event.currentTarget; setLocatingRoot(issue.paths[0]); } }}>Locate moved folder</button>}
      </li>)}</ul>
      {visible.length > 200 && <p>Showing the first 200 findings. Use a category filter to narrow the list.</p>}
    </>}
    {locatingRoot && <LibraryRelocationPanel oldRoot={locatingRoot} onClose={() => { setLocatingRoot(null); locateButton.current?.focus(); }} onQuiesce={quiesceLibrary} onCommitted={refreshRestoredLibrary} onFinished={finishLibraryMaintenance} />}
  </section>;
}

