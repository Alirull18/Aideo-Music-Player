import { memo } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { baseName } from '../utils';

export const AddToPlaylistModal = memo(function AddToPlaylistModal() {
  const { playlistModalTrack, setPlaylistModalTrack, playlists, addToPlaylist, createPlaylist, setCustomPrompt } = useStore(
    useShallow(s => ({
      playlistModalTrack: s.playlistModalTrack,
      setPlaylistModalTrack: s.setPlaylistModalTrack,
      playlists: s.playlists,
      addToPlaylist: s.addToPlaylist,
      createPlaylist: s.createPlaylist,
      setCustomPrompt: s.setCustomPrompt,
    }))
  );

  if (!playlistModalTrack) return null;

  const trackTitle = playlistModalTrack.title || baseName(playlistModalTrack.path) || 'Unknown Track';

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => setPlaylistModalTrack(null)}
      style={{ zIndex: 9999 }}
    >
      <motion.div
        className="modal-content"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 400, width: '100%', padding: 24 }}
      >
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Add to Playlist</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '4px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {trackTitle}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', marginBottom: 24, paddingRight: 4 }}>
          {playlists.length > 0 ? (
            playlists.map((p: any) => (
              <div
                key={p.id}
                onClick={async () => {
                  try {
                    await addToPlaylist(p.id, playlistModalTrack);
                    setPlaylistModalTrack(null);
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added to ${p.name}`, type: 'success' } }));
                  } catch (err) {
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to add to playlist: ${err}`, type: 'error' } }));
                  }
                }}
                style={{ padding: '12px 16px', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 8, cursor: 'pointer', transition: 'background 0.2s', fontSize: 14, fontWeight: 500 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--glass-h)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--glass)')}
              >
                {p.name}
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--text-dim)', fontSize: 14, textAlign: 'center', padding: '32px 0', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
              You don't have any playlists yet.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setPlaylistModalTrack(null)}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => {
              const currentTrack = playlistModalTrack;
              setPlaylistModalTrack(null);
              setCustomPrompt({
                open: true,
                title: 'Create New Playlist',
                placeholder: 'Enter playlist name...',
                initialValue: '',
                actionLabel: 'Create',
                onSubmit: async (val: string) => {
                  if (val.trim()) {
                    try {
                      await createPlaylist(val.trim());
                      // Find the new playlist from updated state
                      const updatedPlaylists = useStore.getState().playlists;
                      const created = updatedPlaylists.find((pl: any) => pl.name === val.trim());
                      if (created && currentTrack) {
                        await useStore.getState().addToPlaylist(created.id, currentTrack);
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Playlist "${val}" created and track added!`, type: 'success' } }));
                      } else {
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Playlist "${val}" created!`, type: 'success' } }));
                      }
                    } catch (err) {
                      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to create playlist: ${err}`, type: 'error' } }));
                    }
                  }
                },
              });
            }}
          >
            + New Playlist
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
});
