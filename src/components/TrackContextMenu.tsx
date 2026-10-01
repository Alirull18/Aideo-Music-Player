import { useEffect, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  ListPlus,
  Plus,
  Image,
  RefreshCw,
  Activity,
  Sparkles,
  Tag,
  Globe,
  ArrowUp,
  ArrowDown,
  MinusCircle,
  FolderPlus,
  Trash2,
  Heart,
  Download,
} from 'lucide-react';
import { useStore } from '../store';
import { Track, CloudTrack, Playlist } from '../store/types';
import { pathsEqual, cloudTrackToVirtualTrack, getMenuPosition, startSonicMix } from '../utils';
import { discoveryTrack } from '../utils/discoveryFeed';
import { SourceMenu } from './SourceMenu';

export interface TrackContextMenuProps {
  track: any;
  anchor: DOMRect | { x: number; y: number };
  onClose: () => void;
  index?: number;
  isCloud?: boolean;
  onDownload?: (track: any) => void;
  currentPlaylist?: Playlist | null;
  reorderPlaylistTracks?: (playlistId: number, fromIndex: number, toIndex: number) => Promise<void> | void;
  removeFromPlaylist?: (playlistId: number, track: string | Track) => Promise<void> | void;
}


export const TrackContextMenu = memo(function TrackContextMenu({
  track,
  anchor,
  onClose,
  index = 0,
  isCloud: _isCloud = false,
  onDownload,
  currentPlaylist = null,
  reorderPlaylistTracks,
  removeFromPlaylist,
}: TrackContextMenuProps) {
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [isMatching, setIsMatching] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScrollOrResize = () => {
      if (!sourceModalOpen) onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [onClose, sourceModalOpen]);

  if (!track) return null;

  // Resolve virtual track
  let vt: Track = track;
  if (track.provider && (track as any).stream_url) {
    vt = cloudTrackToVirtualTrack(track as CloudTrack);
  } else if (!track.path && (track as any).url) {
    vt = discoveryTrack(track as any);
  }

  // Check if track matches a local library track
  const allTracks = useStore.getState().tracks || [];
  const localMatch = allTracks.find((t: Track) =>
    (vt.path && pathsEqual(t.path, vt.path)) ||
    (Boolean(vt.title && vt.artist) &&
      Boolean(t.title && t.artist) &&
      (t.title ?? '').trim().toLowerCase() === String(vt.title).trim().toLowerCase() &&
      (t.artist ?? '').trim().toLowerCase() === String(vt.artist).trim().toLowerCase())
  );

  const effectiveTrack: any = localMatch || vt;
  const isOnlineUrl =
    Boolean(effectiveTrack.path && (effectiveTrack.path.startsWith('http://') || effectiveTrack.path.startsWith('https://'))) ||
    Boolean(effectiveTrack.url && (effectiveTrack.url.startsWith('http://') || effectiveTrack.url.startsWith('https://')));
  const isLocal = Boolean(localMatch) || (!isOnlineUrl && Boolean(effectiveTrack.path) && /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(effectiveTrack.path));

  const isLoved = effectiveTrack.loved === 1;
  const menuStyle = getMenuPosition(anchor);

  if (sourceModalOpen) {
    return (
      <SourceMenu
        track={effectiveTrack}
        initialOpen
        onClose={() => {
          setSourceModalOpen(false);
          onClose();
        }}
      />
    );
  }

  const currentPlaylistTracks = currentPlaylist ? useStore.getState().tracks : [];
  const realIdx = currentPlaylist
    ? currentPlaylistTracks.findIndex((item: any) =>
        effectiveTrack.playlist_entry_id !== undefined
          ? item.playlist_entry_id === effectiveTrack.playlist_entry_id
          : item.path === effectiveTrack.path
      )
    : -1;
  const effectiveIdx = realIdx !== -1 ? realIdx : index;
  const maxIdx = currentPlaylistTracks.length - 1;

  return createPortal(
    <>
      <div
        className="track-action-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="track-action-menu" style={menuStyle} onClick={(e) => e.stopPropagation()}>
        {/* Play Next */}
        <button
          type="button"
          className="track-action-menu-item"
          onClick={() => {
            onClose();
            useStore.getState().playNextInQueue(effectiveTrack);
          }}
        >
          <span className="menu-item-icon">
            <ListPlus size={15} />
          </span>
          <span>Play Next</span>
        </button>

        {/* Add to Queue */}
        <button
          type="button"
          className="track-action-menu-item"
          onClick={() => {
            onClose();
            useStore.getState().addToQueue(effectiveTrack);
          }}
        >
          <span className="menu-item-icon">
            <Plus size={15} />
          </span>
          <span>Add to Queue</span>
        </button>

        {/* Local Track Actions */}
        {isLocal && (
          <>
            <button
              type="button"
              className="track-action-menu-item"
              onClick={() => {
                onClose();
                useStore.getState().setCoverArtModalTrack(effectiveTrack);
              }}
            >
              <span className="menu-item-icon">
                <Image size={15} />
              </span>
              <span>Manage Cover Art</span>
            </button>

            <div className="track-action-menu-divider" />

            {/* Magic Match */}
            <button
              type="button"
              className="track-action-menu-item accent"
              onClick={async () => {
                onClose();
                setIsMatching(true);
                try {
                  const match = await useStore.getState().matchMetadata(effectiveTrack);
                  if (match) {
                    window.dispatchEvent(
                      new CustomEvent('ui-toast', {
                        detail: {
                          message: `Found metadata match "${match.title || match.name}" by "${match.artist}"`,
                          type: 'success',
                        },
                      })
                    );
                  } else {
                    window.dispatchEvent(
                      new CustomEvent('ui-toast', {
                        detail: { message: 'No match found for this track.', type: 'warning' },
                      })
                    );
                  }
                } catch (err) {
                  window.dispatchEvent(
                    new CustomEvent('ui-toast', { detail: { message: `Metadata lookup failed: ${err}`, type: 'error' } })
                  );
                } finally {
                  setIsMatching(false);
                }
              }}
            >
              <span className="menu-item-icon">
                {isMatching ? <RefreshCw size={15} className="spin" /> : <Activity size={15} />}
              </span>
              <span>{isMatching ? 'Searching...' : 'Match metadata'}</span>
            </button>

            {/* Sonic Mix */}
            <button
              type="button"
              className="track-action-menu-item emerald"
              onClick={async () => {
                onClose();
                await startSonicMix(effectiveTrack.path, useStore.getState());
              }}
            >
              <span className="menu-item-icon">
                <Sparkles size={15} />
              </span>
              <span>Play similar tracks</span>
            </button>

            <div className="track-action-menu-divider" />

            {/* Edit Audio Tags */}
            <button
              type="button"
              className="track-action-menu-item accent"
              onClick={() => {
                onClose();
                useStore.getState().setTagEditorTrack(effectiveTrack);
              }}
            >
              <span className="menu-item-icon">
                <Tag size={15} />
              </span>
              <span>Edit Audio Tags</span>
            </button>
          </>
        )}

        {/* Other Audio Sources */}
        <button
          type="button"
          className="track-action-menu-item"
          onClick={() => {
            setSourceModalOpen(true);
          }}
        >
          <span className="menu-item-icon">
            <Globe size={15} />
          </span>
          <span>Other Audio Sources</span>
        </button>

        {/* Playlist management */}
        {currentPlaylist && reorderPlaylistTracks && removeFromPlaylist ? (
          <>
            {effectiveIdx > 0 && (
              <button
                type="button"
                className="track-action-menu-item"
                onClick={() => {
                  onClose();
                  reorderPlaylistTracks(currentPlaylist.id, effectiveIdx, effectiveIdx - 1);
                }}
              >
                <span className="menu-item-icon">
                  <ArrowUp size={15} />
                </span>
                <span>Move Up</span>
              </button>
            )}
            {effectiveIdx < maxIdx && (
              <button
                type="button"
                className="track-action-menu-item"
                onClick={() => {
                  onClose();
                  reorderPlaylistTracks(currentPlaylist.id, effectiveIdx, effectiveIdx + 1);
                }}
              >
                <span className="menu-item-icon">
                  <ArrowDown size={15} />
                </span>
                <span>Move Down</span>
              </button>
            )}
            <button
              type="button"
              className="track-action-menu-item danger"
              onClick={() => {
                onClose();
                removeFromPlaylist(currentPlaylist.id, effectiveTrack);
              }}
            >
              <span className="menu-item-icon">
                <MinusCircle size={15} />
              </span>
              <span>Remove from Playlist</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="track-action-menu-item"
            onClick={() => {
              onClose();
              useStore.getState().setPlaylistModalTrack(effectiveTrack);
            }}
          >
            <span className="menu-item-icon">
              <FolderPlus size={15} />
            </span>
            <span>Add to Playlist...</span>
          </button>
        )}

        {/* Online / Streaming Specific Actions */}
        {!isLocal && (
          <>
            <div className="track-action-menu-divider" />
            <button
              type="button"
              className="track-action-menu-item"
              onClick={async () => {
                onClose();
                try {
                  const res = await useStore.getState().toggleLoveTrack(effectiveTrack.path, {
                    ...effectiveTrack,
                    loved: isLoved ? 1 : 0,
                  });
                  window.dispatchEvent(
                    new CustomEvent('ui-toast', {
                      detail: {
                        message: res ? 'Saved to Favorite Songs' : 'Removed from Favorite Songs',
                        type: 'success',
                      },
                    })
                  );
                } catch (err) {
                  window.dispatchEvent(
                    new CustomEvent('ui-toast', { detail: { message: `Failed to save song: ${err}`, type: 'error' } })
                  );
                }
              }}
            >
              <span className="menu-item-icon">
                <Heart size={15} fill={isLoved ? 'currentColor' : 'none'} />
              </span>
              <span>{isLoved ? 'Unsave Song' : 'Save Song'}</span>
            </button>

            {onDownload && (
              <button
                type="button"
                className="track-action-menu-item"
                onClick={() => {
                  onClose();
                  onDownload(track);
                }}
              >
                <span className="menu-item-icon">
                  <Download size={15} />
                </span>
                <span>Download Song</span>
              </button>
            )}
          </>
        )}

        {/* Delete local song */}
        {isLocal && !currentPlaylist && (
          <>
            <div className="track-action-menu-divider" />
            <button
              type="button"
              className="track-action-menu-item danger"
              onClick={() => {
                onClose();
                if (
                  window.confirm(
                    `Are you sure you want to delete "${effectiveTrack.title || effectiveTrack.path}"? This will remove it from your library and delete the file.`
                  )
                ) {
                  useStore.getState().deleteTrack(effectiveTrack.path);
                }
              }}
            >
              <span className="menu-item-icon">
                <Trash2 size={15} />
              </span>
              <span>Delete Song</span>
            </button>
          </>
        )}
      </div>
    </>,
    document.body
  );
});
