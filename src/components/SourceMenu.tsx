import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import type { RecordingSources, SourceSelection, Track } from '../store/types';
import { applySourcePreference, groupRecordings, matchingSources, saveSourceChoice, searchSources, sourceFor, sourceKey, sourceName, sourceSearchQuery } from '../utils/unifiedSources';
import './UnifiedSources.css';

export function SourceMenu({ track, compact = false, onChange }: { track: Track; compact?: boolean; onChange?: (track: Track) => void }) {
  const request = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const selectionKey = JSON.stringify(track.source_context?.selection);
  const [context, setContext] = useState<RecordingSources | null>(track.source_context || null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const tidalConnected = useStore(s => s.tidalConnected);
  const qobuzConnected = useStore(s => s.qobuzConnected && s.qobuzExperimentalEnabled);
  const localOnly = useStore(s => s.appMode === 'local');
  const available = (provider: string) => provider === 'local' || (!localOnly && (provider === 'youtube' || (provider === 'tidal' ? tidalConnected : qobuzConnected)));
  useEffect(() => { request.current++; setContext(track.source_context || null); setOpen(false); return () => { request.current++; }; }, [track.path, track.playlist_entry_id, track.source_context?.recording_id, selectionKey]);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const close = () => { request.current++; setOpen(false); };
  const load = async () => {
    const token = ++request.current;
    if (open) { close(); return; }
    setOpen(true);
    const source = sourceFor(track);
    if (!source) { setError('This saved stream has no stable source ID. Find the recording in Search to choose another copy.'); return; }
    const selected = applySourcePreference(track);
    const initial = selected.source_context || groupRecordings([track], '')[0]?.source_context;
    const selection = selected.source_context?.selection || { mode: 'explicit' as const, source };
    setContext(initial ? { ...initial, selection } : null);
    setLoading(true); setError('');
    try {
      const state = useStore.getState();
      await searchSources(sourceSearchQuery(track), {
        tidal: state.appMode !== 'local' && state.tidalConnected,
        qobuz: state.appMode !== 'local' && state.qobuzConnected && state.qobuzExperimentalEnabled, youtube: state.appMode !== 'local',
      }, result => {
        if (token !== request.current) return;
        if (initial) setContext({ ...initial, sources: matchingSources(selected, result.tracks), selection });
        if (Object.keys(result.errors).length) setError(`Could not check ${Object.keys(result.errors).join(', ')}. Available copies are shown.`);
      });
    } catch (e) { if (token === request.current) setError(String(e)); }
    finally { if (token === request.current) setLoading(false); }
  };
  const choose = async (selection: SourceSelection) => {
    if (!context) return;
    setSaving(true); setError('');
    try {
      const next = await saveSourceChoice(track, { ...context, selection });
      const state = useStore.getState();
      const matches = (t: Track) => track.playlist_entry_id !== undefined
        ? t.playlist_entry_id === track.playlist_entry_id
        : t.playlist_entry_id === undefined && (t === track || (t.source_context?.recording_id === context.recording_id));
      const update = (t: Track) => matches(t) ? { ...t, source_context: next.source_context } : t;
      const queue = state.queue.map(update);
      const currentTrack = state.currentTrack ? update(state.currentTrack) : null;
      const shouldSwitch = Boolean(state.currentTrack && matches(state.currentTrack) && (state.playback.status === 'Playing' || state.playback.status === 'Paused'));
      const status = state.playback.status;
      const position = state.playback.position_secs;
      useStore.setState({ tracks: state.tracks.map(update), queue, currentTrack });
      localStorage.setItem('aideo_queue', JSON.stringify(queue));
      if (currentTrack && shouldSwitch) localStorage.setItem('aideo_current_track', JSON.stringify(currentTrack));
      setContext(next.source_context!);
      onChange?.(next);
      request.current++;
      setOpen(false);
      if (shouldSwitch && currentTrack) {
        try {
          await state.playTrack(currentTrack, true, false, undefined, position, true);
          const playing = useStore.getState().currentTrack;
          if (status === 'Paused' && playing && matches(playing)) await useStore.getState().pauseTrack();
          const after = useStore.getState();
          if (after.playback.status === 'Stopped') {
            window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Source preference saved, but the switch failed: ${after.playbackError || 'source unavailable'}`, type: 'error' } }));
          } else {
            window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Switched source at ${Math.floor(position / 60)}:${String(Math.floor(position % 60)).padStart(2, '0')}.`, type: 'success' } }));
          }
        } catch (e) {
          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Source preference saved, but the switch failed: ${String(e)}`, type: 'error' } }));
        }
      } else {
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Source preference saved for the next play.', type: 'success' } }));
      }
    } catch (e) { setError(`Could not save source choice: ${String(e)}`); }
    finally { setSaving(false); }
  };
  return <div className="source-menu" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
    <button type="button" className="source-button" aria-label={compact ? `Change source for ${track.title}` : undefined} aria-expanded={open} onClick={() => void load()}>{compact ? context?.selection.mode === 'explicit' ? sourceName(context.selection.source) : 'Auto' : 'Other sources'}</button>
    {open && createPortal(<dialog ref={dialog} onCancel={close} onClose={close} className="source-options" aria-label={`Sources for ${track.title || 'this recording'}`}>
      <h2>Other sources</h2>
      <p>Catalog matches are preferred. Local and web copies also require matching title, artist, duration, and album when available.</p>
      {loading && <span role="status">Checking available copies...</span>}
      {error && <p role="status">{error}</p>}
      {!loading && context && context.sources.length < 2 && <p>No alternative copies found. Connected sources must have a matching title, artist and duration.</p>}
      {context && <>
        <button type="button" disabled={saving} aria-pressed={context.selection.mode === 'auto'} onClick={() => void choose({ mode: 'auto' })}>Auto · Follow quality preference</button>
        {context.sources.map(source => <button type="button" key={sourceKey(source)} disabled={saving || !available(source.provider)}
          aria-pressed={context.selection.mode === 'explicit' && sourceKey(context.selection.source) === sourceKey(source)}
          onClick={() => void choose({ mode: 'explicit', source })}>
          {sourceName(source)}{source.catalog_quality?.sample_rate ? ` · ${source.catalog_quality.sample_rate / 1000} kHz` : ''}{source.catalog_quality?.bit_depth ? ` / ${source.catalog_quality.bit_depth}-bit` : ''}
          {!available(source.provider) && ' (unavailable)'}
          {source.provider === 'local' && <small>{source.id}</small>}
        </button>)}
      </>}
      <button type="button" className="source-close" onClick={close}>Close</button>
    </dialog>, document.body)}
  </div>;
}
