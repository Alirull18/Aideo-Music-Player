import { useState } from 'react';
import { Play, ListPlus, SkipForward, Heart } from 'lucide-react';
import { useStore } from '../store';
import type { Track } from '../store/types';
import type { SourceSearch } from '../utils/unifiedSources';
import { applySourcePreference, sourceName } from '../utils/unifiedSources';
import { fmt } from '../utils';
import { SourceMenu } from './SourceMenu';
import { TrackCover } from './aideo/HomeParts';

function SearchSong({ track: original }: { track: Track }) {
  const saved = useStore(s => s.tracks);
  const current = useStore(s => s.currentTrack);
  const buffering = useStore(s => s.playback.is_buffering);
  const [choice, setChoice] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loved, setLoved] = useState<boolean>();
  const track = applySourcePreference(choice || original);
  const isCurrent = current?.source_context?.recording_id === track.source_context?.recording_id;
  const isLoved = loved ?? saved.some(t => t.loved === 1 && t.source_context?.recording_id === track.source_context?.recording_id);
  const action = async (kind: 'queue' | 'next' | 'save') => {
    setBusy(true); setMessage('');
    try {
      const state = useStore.getState();
      if (kind === 'save') {
        const result = await state.toggleLoveTrack(track.path, { ...track, loved: isLoved ? 1 : 0 });
        if (typeof result !== 'boolean') throw new Error('Could not save song. Try again.');
        setLoved(result); setMessage(result ? 'Saved to Favorite Songs' : 'Removed from Favorite Songs');
      } else {
        const added = await (kind === 'next' ? state.playNextInQueue(track) : state.addToQueue(track));
        if (!added) throw new Error('Could not add to queue. Check your player connection and try again.');
        setMessage(kind === 'next' ? 'Playing next' : 'Added to queue');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <article className={`unified-result${isCurrent ? ' is-current' : ''}`} aria-label={`${track.title} by ${track.artist}`}>
    <button type="button" className="unified-play" aria-label={`Play ${track.title} by ${track.artist}`} onClick={() => void useStore.getState().playTrack(track)}>
      <TrackCover path={track.path} src={track.cover_url} title={track.title || ''} artist={track.artist || ''} size={48} />
      <span className="unified-play-icon"><Play size={18} fill="currentColor" /></span>
    </button>
    <div className="unified-result-info">
      <span className="unified-track-title">{track.title || 'Untitled'}</span>
      <p>{track.artist || 'Unknown artist'}{track.album ? ` / ${track.album}` : ''}</p>
      <div className="unified-source-line">
        <SourceMenu track={track} compact onChange={setChoice} />
        <small>{isCurrent && current?.active_source ? `Playing from ${sourceName(current.active_source)}` : [...new Set(track.source_context!.sources.map(sourceName))].join(' / ')}</small>
        {isCurrent && buffering && <small role="status">Preparing audio...</small>}
      </div>
      {message && <p className="unified-action-status" role="status">{message}</p>}
    </div>
    <span className="unified-duration">{track.duration ? fmt(track.duration) : '--:--'}</span>
    <div className="unified-result-actions" aria-label={`Actions for ${track.title}`}>
      <button type="button" className="source-button" disabled={busy} onClick={() => void action('next')}><SkipForward size={15} />Play next</button>
      <button type="button" className="source-button" disabled={busy} onClick={() => void action('queue')}><ListPlus size={15} />Add to queue</button>
      <button type="button" className="source-button" disabled={busy} aria-pressed={isLoved} onClick={() => void action('save')}><Heart size={15} fill={isLoved ? 'currentColor' : 'none'} />{isLoved ? 'Unsave song' : 'Save song'}</button>
    </div>
  </article>;
}

export function UnifiedSearchResults({ result }: { result: SourceSearch }) {
  const quality = useStore(s => s.streamingQuality);
  return <section className="unified-results" aria-label="Unified search results">
    <div className="unified-search-status" role="status">
      <strong>{result.tracks.length} {result.tracks.length === 1 ? 'song' : 'songs'}</strong>
      <span>Auto / {quality === 'data_saver' ? 'Data saver' : quality === 'standard_lossless' ? 'Standard lossless' : 'Best available'}</span>
      {result.pending.length > 0 && <p>{`Searching ${result.pending.join(', ')}...`}</p>}
      {Object.keys(result.errors).length > 0 && <p>Could not search {Object.keys(result.errors).join(', ')}. Results from available sources are shown.</p>}
    </div>
    {!result.pending.length && !result.tracks.length && <p>No matching songs in this filter. Try All sources, another search, or check connections in Settings.</p>}
    {result.tracks.map(track => <SearchSong key={track.source_context!.recording_id} track={track} />)}
  </section>;
}
