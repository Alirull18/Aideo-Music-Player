import { useState, useMemo, memo } from 'react';
import { Play, ListPlus, SkipForward, Heart, MoreVertical } from 'lucide-react';
import { useStore } from '../store';
import type { Track } from '../store/types';
import type { SourceSearch } from '../utils/unifiedSources';
import { applySourcePreference, sourceName } from '../utils/unifiedSources';
import { fmt } from '../utils';
import { SourceMenu } from './SourceMenu';
import { TrackCover } from './aideo/HomeParts';
import { TrackContextMenu } from './TrackContextMenu';

const SearchSong = memo(function SearchSong({ 
  track: original,
  isLovedInLibrary
}: { 
  track: Track;
  isLovedInLibrary: boolean;
}) {
  const currentRecordingId = useStore(s => s.currentTrack?.source_context?.recording_id);
  const currentActiveSource = useStore(s => s.currentTrack?.active_source);
  const buffering = useStore(s => s.playback.is_buffering);
  const [, refreshChoice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loved, setLoved] = useState<boolean>();
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | { x: number; y: number } | null>(null);
  const track = applySourcePreference(original);
  const isCurrent = currentRecordingId === track.source_context?.recording_id;
  const isLoved = loved ?? isLovedInLibrary;
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
  return (
    <article
      className={`unified-result${isCurrent ? ' is-current' : ''}`}
      aria-label={`${track.title} by ${track.artist}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuAnchor({ x: e.clientX, y: e.clientY });
      }}
    >
      <button type="button" className="unified-play" aria-label={`Play ${track.title} by ${track.artist}`} onClick={() => void useStore.getState().playTrack(track)}>
        <TrackCover path={track.path} src={track.cover_url} title={track.title || ''} artist={track.artist || ''} size={48} />
        <span className="unified-play-icon"><Play size={18} fill="currentColor" /></span>
      </button>
      <div className="unified-result-info">
        <span className="unified-track-title">{track.title || 'Untitled'}</span>
        <p>{track.artist || 'Unknown artist'}{track.album ? ` / ${track.album}` : ''}</p>
        <div className="unified-source-line">
          <SourceMenu track={track} compact onChange={() => refreshChoice(value => value + 1)} />
          <small>{[...new Set([...(track.source_context?.sources || []), ...(track.source_context?.display_candidates || [])].map(sourceName))].join(' / ')}</small>
          {isCurrent && currentActiveSource && <small>{`Playing from ${sourceName(currentActiveSource)}`}</small>}
          {isCurrent && buffering && <small role="status">Preparing audio...</small>}
        </div>
        {message && <p className="unified-action-status" role="status">{message}</p>}
      </div>
      <span className="unified-duration tabular-nums">{track.duration ? fmt(track.duration) : '--:--'}</span>
      <div className="unified-result-actions" aria-label={`Actions for ${track.title}`}>
        <button type="button" className="source-button" disabled={busy} onClick={() => void action('next')}><SkipForward size={15} />Play next</button>
        <button type="button" className="source-button" disabled={busy} onClick={() => void action('queue')}><ListPlus size={15} />Add to queue</button>
        <button type="button" className="source-button" disabled={busy} aria-pressed={isLoved} onClick={() => void action('save')}><Heart size={15} fill={isLoved ? 'currentColor' : 'none'} />{isLoved ? 'Unsave song' : 'Save song'}</button>
        <button
          type="button"
          className="source-button icon-only"
          title="More options"
          aria-label="More options"
          onClick={(e) => {
            e.stopPropagation();
            setMenuAnchor(e.currentTarget.getBoundingClientRect());
          }}
          style={{ padding: '6px 8px' }}
        >
          <MoreVertical size={15} />
        </button>
      </div>
      {menuAnchor && (
        <TrackContextMenu
          track={track}
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </article>
  );
});

export function UnifiedSearchResults({ result }: { result: SourceSearch }) {
  const quality = useStore(s => s.streamingQuality);
  const appMode = useStore(s => s.appMode);
  const tracks = useStore(s => s.tracks);

  const lovedRecordingIds = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (t.loved === 1 && t.source_context?.recording_id) {
        set.add(t.source_context.recording_id);
      }
    }
    return set;
  }, [tracks]);

  return <section className="unified-results" aria-label="Unified search results">
    <div className="unified-search-status" role="status">
      <strong>{result.tracks.length} {result.tracks.length === 1 ? 'song' : 'songs'}</strong>
      <span>{appMode === 'local' ? 'Local Library Only' : `Auto / ${quality === 'data_saver' ? 'Data saver' : quality === 'standard_lossless' ? 'Standard lossless' : 'Best available'}`}</span>
      {result.pending.length > 0 && <p>{`Searching ${result.pending.join(', ')}...`}</p>}
      {Object.keys(result.errors).length > 0 && <p>Could not search {Object.keys(result.errors).join(', ')}. Results from available sources are shown.</p>}
    </div>
    {!result.pending.length && !result.tracks.length && (
      <p>{appMode === 'local' ? 'No matching local songs found. Try a different query or add music folders in Settings.' : 'No matching songs in this filter. Try All sources, another search, or check connections in Settings.'}</p>
    )}
    {result.tracks.map(track => {
      const recordingId = track.source_context?.recording_id;
      const isLoved = Boolean(recordingId && lovedRecordingIds.has(recordingId));
      return (
        <SearchSong 
          key={track.source_context!.recording_id} 
          track={track} 
          isLovedInLibrary={isLoved}
        />
      );
    })}
  </section>;
}
