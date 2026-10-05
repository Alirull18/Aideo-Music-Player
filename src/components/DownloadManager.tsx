import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { Check, ChevronDown, ChevronUp, Download, FolderOpen, X } from 'lucide-react';
import { useStore } from '../store';
import type { PlaybackSource, Track } from '../store/types';
import { activeDownload, canCancelDownload, collectDownloadSources, trackFromDownloadSource, useDownloadStore, type DownloadJob, type DownloadOption } from '../store/downloadStore';
import { searchSources, sourceKey, sourceName, sourceSearchQuery } from '../utils/unifiedSources';
import { fmt } from '../utils';
import defaultCover from '../assets/default_cover.png';

const reportError = (error: unknown) => window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: String(error), type: 'error', title: 'Download' } }));

export function DownloadProgress({ job, notification = false }: { job: DownloadJob; notification?: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true); setError('');
    try {
      const next = await invoke<DownloadJob>('retry_track_download', { jobId: job.id });
      useDownloadStore.getState().upsert(next);
      if (next.id !== job.id) useDownloadStore.getState().dismiss(job.id);
    } catch (error) { setError(String(error) === 'FILE_EXISTS' ? 'A file now exists at this destination. Choose another copy to review the destination.' : String(error)); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setError('');
    try { await invoke('cancel_track_download', { jobId: job.id }); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    setBusy(true); setError('');
    try {
      await invoke('discard_track_download', { jobId: job.id });
      useDownloadStore.setState(state => ({ jobs: state.jobs.filter(item => item.id !== job.id) }));
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const bytes = `${(job.downloaded / (1024 * 1024)).toFixed(1)} MB`;
  const status = job.status === 'downloading' ? job.percent == null ? `Downloading · ${bytes}` : `Downloading · ${Math.floor(job.percent)}% · ${bytes}`
    : ({ preparing: 'Preparing download…', cancelling: 'Cancelling…', finalizing: 'Saving file and adding to library…', completed: 'Completed · 100%', cancelled: 'Cancelled', recoverable: 'Interrupted · ready to retry', failed: job.saved ? 'Saved · library import failed' : 'Download failed' })[job.status];
  return <article className="download-job" aria-label={`Download: ${job.source.metadata?.title || 'Unknown Title'}`}>
    <div className="download-job-heading">
      {notification && <img className="download-job-cover" src={job.source.metadata?.cover_url || defaultCover} alt="" onError={event => { event.currentTarget.src = defaultCover; }} />}
      <div><strong>{job.source.metadata?.title || 'Unknown Title'}</strong><small>{job.source.metadata?.artist || 'Unknown Artist'} · {sourceName(job.source)}</small></div>
      {notification && !activeDownload(job) && <button type="button" className="download-icon-button" aria-label="Dismiss download notification" onClick={() => useDownloadStore.getState().dismiss(job.id)}><X size={15} /></button>}
    </div>
    <progress max={100} value={job.status === 'completed' ? 100 : job.percent ?? undefined} aria-label={`Download progress for ${job.source.metadata?.title || 'track'}`} />
    <div className="download-job-actions"><span role="status">{status}</span>
      {canCancelDownload(job) && <button type="button" disabled={busy} onClick={() => void cancel()}>Cancel</button>}
      {(job.status === 'failed' || job.status === 'cancelled' || job.status === 'recoverable') && <button type="button" disabled={busy} onClick={() => void retry()}>Retry</button>}
      {!activeDownload(job) && <button type="button" disabled={busy} onClick={() => void discard()}>Discard</button>}
      {job.status === 'failed' && <button type="button" onClick={() => useDownloadStore.getState().open(trackFromDownloadSource(job.source))}>Choose another copy</button>}
    </div>
    {(error || job.error) && <p className="download-error" role="alert">{error || job.error}</p>}
    {!notification && <small className="download-path">{job.option.label}<br />{job.path}</small>}
  </article>;
}

export function DownloadChooser({ track }: { track: Track }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sources, setSources] = useState(() => collectDownloadSources(track));
  const [pending, setPending] = useState<string[]>([]);
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<PlaybackSource | null>(null);
  const [qualityRequest, setQualityRequest] = useState(0);
  const [options, setOptions] = useState<DownloadOption[]>([]);
  const [optionId, setOptionId] = useState('');
  const [checking, setChecking] = useState(false);
  const [folder, setFolder] = useState('');
  const [configured, setConfigured] = useState(false);
  const [starting, setStarting] = useState(false);
  const [collision, setCollision] = useState(false);
  const [error, setError] = useState('');
  const appMode = useStore(s => s.appMode);
  const tidalConnected = useStore(s => s.tidalConnected);
  const qobuzConnected = useStore(s => s.qobuzConnected && s.qobuzExperimentalEnabled);
  const available = (source: PlaybackSource) => source.provider !== 'local' && appMode !== 'local'
    && (source.provider === 'youtube' || (source.provider === 'tidal' ? tidalConnected : qobuzConnected));

  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    const state = useStore.getState();
    const registry = track.source_context?.recording_id ? state.sourceRegistry[track.source_context.recording_id] : null;
    const anchor = registry ? { ...track, source_context: registry } : track;
    setSources(collectDownloadSources(anchor));
    invoke<{ folder: string; configured: boolean }>('get_download_folder').then(settings => {
      if (active && settings) { setFolder(settings.folder); setConfigured(settings.configured); }
    }).catch(error => { if (active) setError(String(error)); });
    void searchSources(sourceSearchQuery(track), {
      tidal: state.appMode !== 'local' && state.tidalConnected,
      qobuz: state.appMode !== 'local' && state.qobuzConnected && state.qobuzExperimentalEnabled,
      youtube: state.appMode !== 'local',
    }, result => {
      if (!active) return;
      setSources(collectDownloadSources(anchor, result.tracks));
      setPending(result.pending); setProviderErrors(result.errors);
    }).catch(error => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [track]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setChecking(true); setOptions([]); setOptionId(''); setError('');
    invoke<DownloadOption[]>('get_track_download_options', { source: selected }).then(options => {
      if (!active) return;
      setOptions(options || []); setOptionId(options?.[0]?.id || '');
      if (!options?.length) setError('No downloadable qualities are available for this copy.');
    }).catch(error => { if (active) setError(String(error)); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [selected, qualityRequest]);

  const chooseFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: 'Choose download folder', defaultPath: folder || undefined });
    if (typeof selected !== 'string') return null;
    const saved = await invoke<string>('set_download_folder', { folder: selected });
    setFolder(saved); setConfigured(true); setCollision(false);
    return saved;
  };
  const start = async (choice: 'ask' | 'keep_both' | 'replace' = 'ask') => {
    const option = options.find(option => option.id === optionId);
    if (!selected || !option || !available(selected)) return;
    setStarting(true); setError('');
    try {
      const destination = configured ? folder : await chooseFolder();
      if (!destination) return;
      const job = await invoke<DownloadJob>('start_track_download', { source: selected, option, folder: destination, collision: choice });
      useDownloadStore.getState().upsert(job);
      useDownloadStore.getState().close();
    } catch (error) {
      if (String(error) === 'FILE_EXISTS') setCollision(true);
      else setError(String(error));
    } finally { setStarting(false); }
  };
  const selectSource = (source: PlaybackSource) => {
    setOptions([]); setOptionId(''); setChecking(true); setCollision(false); setSelected(source);
    setQualityRequest(request => request + 1);
  };
  const renderSource = (source: PlaybackSource) => <button type="button" className="download-source" key={sourceKey(source)}
    aria-pressed={selected != null && sourceKey(selected) === sourceKey(source)} disabled={!available(source) || starting || collision} onClick={() => selectSource(source)}>
    <span className="download-source-choice" aria-hidden="true">{selected != null && sourceKey(selected) === sourceKey(source) && <Check size={12} />}</span>
    <span className="download-source-details"><strong>{sourceName(source)}{source.provider === 'local' ? ' · Already on device' : ''}</strong>
    <span>{source.metadata?.title || track.title} · {source.metadata?.artist || track.artist}</span>
    <small>{source.metadata?.album || 'Album unknown'} · {source.recording_evidence?.version || 'Version not specified'} · {source.metadata?.duration ? fmt(source.metadata.duration) : 'Duration unknown'}</small>
    {source.provider === 'local' && <small>{source.catalog_quality?.codec || source.id.split('.').pop()?.toUpperCase() || 'Format unknown'} · {source.catalog_quality?.bit_depth ? `${source.catalog_quality.bit_depth}-bit` : 'Bit depth unknown'} · {source.catalog_quality?.sample_rate ? `${source.catalog_quality.sample_rate / 1000} kHz` : 'Sample rate unknown'}</small>}
    {source.provider !== 'local' && !available(source) && <small>{appMode === 'local' ? 'Enable Hybrid Mode to download online copies' : 'Connect this provider in Settings > Library'}</small>}</span>
  </button>;

  return createPortal(<dialog ref={dialog} className="download-dialog" aria-labelledby="download-dialog-title" onCancel={event => { event.preventDefault(); if (!starting) useDownloadStore.getState().close(); }}>
    <div className="download-dialog-heading"><img className="download-dialog-cover" src={track.cover_url || defaultCover} alt="" onError={event => { event.currentTarget.src = defaultCover; }} /><div><h2 id="download-dialog-title">Download Song</h2><p>{track.title || 'Unknown Title'} · {track.artist || 'Unknown Artist'}</p></div>
      <button type="button" className="download-icon-button" aria-label="Close download chooser" disabled={starting} onClick={() => useDownloadStore.getState().close()}><X size={20} /></button></div>
    <div className="download-dialog-body"><div className="download-source-list">
      <h3>Choose a source</h3>
      {sources.filter(s => s.match_assessment === 'equivalent').map(renderSource)}
      {sources.some(s => s.match_assessment !== 'equivalent') && <><h3>Possible matches</h3><p>Check the album, version, and duration before downloading.</p>{sources.filter(s => s.match_assessment !== 'equivalent').map(renderSource)}</>}
      {pending.length > 0 && <p role="status">Checking {pending.join(', ')}…</p>}
      {Object.entries(providerErrors).map(([provider, error]) => <p className="download-error" role="status" key={provider}>Couldn’t check {provider}: {error}</p>)}
      {sources.length === 0 && pending.length === 0 && <p>No matching copies found.</p>}
    </div>
    <div className="download-settings"><h3>File options</h3>
    {selected ? <label className="download-quality">Download quality
      {checking ? <span role="status">Checking available qualities…</span> : <select aria-label="Download quality" value={optionId} disabled={starting || collision || !options.length} onChange={event => setOptionId(event.target.value)}>
        {options.length === 0 && <option value="">No available quality</option>}{options.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}
      </select>}
    </label> : <p className="download-help">Select a source to see its available audio qualities.</p>}
    <div className="download-folder"><div className="download-folder-label"><FolderOpen size={16} /><strong>Save to</strong><button type="button" disabled={starting || collision} onClick={() => void chooseFolder().catch(error => setError(String(error)))}>Change</button></div>
      <span title={folder}>{folder || 'Choose a folder on your first download'}</span>{!configured && folder && <small>You’ll choose a folder before downloading.</small>}</div>
    <p className="download-help">Downloads continue in the background and appear in your library when finished.</p>
    {error && <p className="download-error" role="alert">{error}</p>}
    </div></div>
    {collision ? <div className="download-collision" role="alert"><p>A file with this name already exists. Replace keeps the original until the new file is complete.</p>
      <div className="download-dialog-actions"><button type="button" disabled={starting} onClick={() => void start('keep_both')}>Keep both</button><button type="button" disabled={starting} onClick={() => void start('replace')}>Replace</button><button type="button" disabled={starting} onClick={() => setCollision(false)}>Cancel</button></div>
    </div> : <div className="download-dialog-actions"><button type="button" onClick={() => useDownloadStore.getState().close()} disabled={starting}>Cancel</button>
      <button type="button" className="btn-primary" disabled={!selected || !available(selected) || checking || !optionId || starting} onClick={() => void start()}><Download size={16} />{starting ? 'Starting…' : 'Download'}</button></div>}
  </dialog>, document.body);
}

export function DownloadManager() {
  const track = useDownloadStore(s => s.track);
  const jobs = useDownloadStore(s => s.jobs);
  const hidden = useDownloadStore(s => s.hidden);
  const view = useStore(s => s.view);
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const stop = await listen<DownloadJob>('track-download-progress', event => {
        if (!active) return;
        const store = useDownloadStore.getState();
        const previous = store.jobs.find(job => job.id === event.payload.id);
        store.upsert(event.payload);
        if (event.payload.status === 'completed' && previous?.status !== 'completed') {
          void Promise.all([useStore.getState().loadLibrary(), store.refreshPaths()]).catch(reportError);
        }
      });
      if (!active) { stop(); return; }
      unlisten = stop;
      const snapshot = await invoke<DownloadJob[]>('get_track_download_jobs');
      if (active) for (const job of snapshot || []) {
        if (!useDownloadStore.getState().jobs.some(existing => existing.id === job.id)) useDownloadStore.getState().upsert(job);
      }
      if (active) await useDownloadStore.getState().refreshPaths();
    })().catch(reportError);
    return () => { active = false; unlisten?.(); };
  }, []);
  const visible = jobs.filter(job => !hidden.includes(job.id)).sort((a, b) => Number(activeDownload(b)) - Number(activeDownload(a)) || b.id.localeCompare(a.id, undefined, { numeric: true }));
  const activeCount = visible.filter(activeDownload).length;
  const allCompleted = visible.length > 0 && visible.every(job => job.status === 'completed');
  return <>
    {track && <DownloadChooser key={`${track.path}:${track.playlist_entry_id ?? ''}`} track={track} />}
    {visible.length > 0 && view !== 'downloaded' && createPortal(<aside className="download-notifications" aria-label="Download notifications">
      <div className="download-notifications-heading">{allCompleted ? <Check size={16} aria-hidden="true" /> : <Download size={16} />}<strong aria-live="polite">{activeCount ? `${activeCount} ${activeCount === 1 ? 'download' : 'downloads'} in progress` : allCompleted ? 'Downloads completed' : 'Downloads'}</strong>
        <button type="button" className="download-notifications-link" onClick={() => useStore.getState().setView('downloaded')}>View all</button>
        <button type="button" className="download-icon-button" aria-label={minimized ? 'Expand download notifications' : 'Minimize download notifications'} aria-expanded={!minimized} onClick={() => setMinimized(value => !value)}>{minimized ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </div>
      {!minimized && <DownloadProgress key={visible[0].id} job={visible[0]} notification />}
    </aside>, document.querySelector('.app') || document.querySelector('.mini-player-outer-wrapper') || document.body)}
  </>;
}
