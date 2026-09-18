import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import type { RecordingSources, SourceSelection, Track } from '../store/types';
import { applySourcePreference, deduplicateSourcesForDisplay, groupRecordings, matchingSources, saveSourceChoice, searchSources, sourceFor, sourceKey, sourceName, sourceSearchQuery } from '../utils/unifiedSources';
import './UnifiedSources.css';

export function SourceMenu({ track, compact = false, onChange, renderTrigger }: { track: Track; compact?: boolean; onChange?: (track: Track) => void; renderTrigger?: (onClick: () => void) => React.ReactNode }) {
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

  const recordingId = track.source_context?.recording_id;
  const registryContext = useStore(s => recordingId ? s.sourceRegistry[recordingId] : undefined);

  const trackIdRef = useRef(`${track.path}:${track.playlist_entry_id ?? ''}`);
  useEffect(() => {
    const currentId = `${track.path}:${track.playlist_entry_id ?? ''}`;
    if (trackIdRef.current !== currentId) {
      trackIdRef.current = currentId;
      request.current++;
      setContext(track.source_context || null);
      setOpen(false);
    } else {
      // Same track: update context without closing dialog
      if (track.source_context) {
        setContext(prev => {
          if (!prev) return track.source_context!;
          const combined = [...new Map([...prev.sources, ...track.source_context!.sources].map(s => [sourceKey(s), s])).values()].slice(0, 32);
          return {
            ...prev,
            ...track.source_context,
            sources: combined,
          };
        });
      }
    }
    return () => { request.current++; };
  }, [track.path, track.playlist_entry_id, track.source_context, selectionKey]);

  useEffect(() => {
    if (registryContext) {
      setContext(prev => {
        if (!prev) return registryContext;
        const combined = [...new Map([...prev.sources, ...registryContext.sources].map(s => [sourceKey(s), s])).values()].slice(0, 32);
        return {
          ...prev,
          sources: combined,
          display_candidates: registryContext.display_candidates || prev.display_candidates,
        };
      });
    }
  }, [registryContext]);

  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  const close = () => { request.current++; setOpen(false); };
  const load = async () => {
    const token = ++request.current;
    if (open) { close(); return; }
    setOpen(true);
    const source = sourceFor(track);
    if (!source) { setError('This saved stream has no stable source ID. Find the recording in Search to choose another copy.'); return; }
    const selected = applySourcePreference(track);
    const recId = track.source_context?.recording_id;
    const fromRegistry = recId ? useStore.getState().sourceRegistry[recId] : undefined;
    const initial = fromRegistry || selected.source_context || groupRecordings([track], '')[0]?.source_context;
    const selection = selected.source_context?.selection || { mode: 'explicit' as const, source };
    const initialContext: RecordingSources | null = initial ? { ...initial, selection } : null;
    setContext(initialContext);

    // If sources already exist in sourceRegistry with alternatives, use them immediately without redundant search
    const totalAlternatives = (fromRegistry?.sources.length || 0) + (fromRegistry?.display_candidates?.length || 0);
    if (fromRegistry && totalAlternatives > 1) {
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true); setError('');
    try {
      const state = useStore.getState();
      await searchSources(sourceSearchQuery(track), {
        tidal: state.appMode !== 'local' && state.tidalConnected,
        qobuz: state.appMode !== 'local' && state.qobuzConnected && state.qobuzExperimentalEnabled, youtube: state.appMode !== 'local',
      }, result => {
        if (token !== request.current) return;
        if (initial) {
          const matched = matchingSources(selected, result.tracks);
          const nextContext: RecordingSources = { ...initial, sources: matched, selection };
          setContext(nextContext);
          useStore.getState().registerDiscoveredSources(nextContext);
        }
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
      if (next.source_context) {
        state.registerDiscoveredSources(next.source_context);
      }
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
    {renderTrigger ? (
      renderTrigger(() => void load())
    ) : (
      <button type="button" className="source-button" aria-label={compact ? `Change source for ${track.title}` : undefined} aria-expanded={open} onClick={() => void load()}>{compact ? context?.selection.mode === 'explicit' ? sourceName(context.selection.source) : 'Auto' : 'Other sources'}</button>
    )}
    {open && createPortal(<dialog ref={dialog} onCancel={close} onClose={close} className="source-options" aria-label={`Sources for ${track.title || 'this recording'}`}>
      <h2>Other sources</h2>
      <p>Sources for the same song are grouped by title, artist and version. Each copy keeps its own duration and album.</p>
      {loading && <span role="status">Checking available copies...</span>}
      {error && <p role="status">{error}</p>}
      {!loading && context && deduplicateSourcesForDisplay([...(context.sources || []), ...(context.display_candidates || [])], context.selection).length < 2 && <p>No alternative copies found. Connected sources must have a matching title, artist and duration.</p>}
      {context && <>
        <button type="button" disabled={saving} aria-pressed={context.selection.mode === 'auto'} onClick={() => void choose({ mode: 'auto' })}>Auto · Follow quality preference</button>
        {deduplicateSourcesForDisplay([...(context.sources || []), ...(context.display_candidates || [])], context.selection).map(source => {
          const isSelected = context.selection.mode === 'explicit' && sourceKey(context.selection.source) === sourceKey(source);
          const fmt = source.catalog_quality?.codec || (source.provider === 'local' ? source.id.split('.').pop()?.toUpperCase() : source.provider === 'youtube' ? 'OPUS' : source.provider === 'tidal' || source.provider === 'qobuz' ? 'FLAC' : null);
          const formatStr = fmt ? ` · ${fmt}` : '';
          const sampleRateStr = source.catalog_quality?.sample_rate ? ` · ${source.catalog_quality.sample_rate / 1000} kHz` : '';
          const bitDepthStr = source.catalog_quality?.bit_depth ? ` / ${source.catalog_quality.bit_depth}-bit` : '';
          const durationSecs = source.metadata?.duration;
          const durationStr = durationSecs && Number.isFinite(durationSecs) && durationSecs > 0
            ? ` · ${Math.floor(durationSecs / 60)}:${String(Math.floor(durationSecs % 60)).padStart(2, '0')}`
            : '';
          const versionTag = source.recording_evidence?.version
            ? ` [${source.recording_evidence.version}]`
            : source.recording_evidence?.explicit === true
              ? ' [Explicit]'
              : '';
          const subtitle = source.provider === 'local'
            ? (source.metadata?.album ? `${source.metadata.album} · ${source.id}` : source.id)
            : source.provider === 'youtube'
              ? (source.metadata?.title || '')
              : (source.metadata?.album || '');

          return (
            <button
              type="button"
              key={sourceKey(source)}
              disabled={saving || !available(source.provider)}
              aria-pressed={isSelected}
              onClick={() => void choose({ mode: 'explicit', source })}
            >
              <div className="source-option-main">
                <span>{sourceName(source)}{formatStr}{sampleRateStr}{bitDepthStr}{durationStr}{versionTag}</span>
                {!available(source.provider) && <span className="source-option-unavailable"> (unavailable)</span>}
              </div>
              {subtitle && <small className="source-option-sub">{subtitle}</small>}
            </button>
          );
        })}
      </>}
      <button type="button" className="source-close" onClick={close}>Close</button>
    </dialog>, document.body)}
  </div>;
}
