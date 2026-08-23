import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { 
  Tag, 
  Image as ImageIcon, 
  FileText, 
  Save, 
  UploadCloud, 
  Search, 
  Trash2, 
  Loader2, 
  Layers, 
  Sparkles,
  X
} from 'lucide-react';
import { AudioTagData, AudioTagUpdate, AudioTagBatchUpdate, extractDominantColor, Track } from '../store/types';
import { baseName, cleanSearchQuery } from '../utils';

interface SearchCoverResult {
  id: string;
  title: string;
  artist: string;
  source: string;
  cover_url?: string;
}

export function TagEditorModal() {
  const { 
    tagEditorTrack, 
    setTagEditorTrack, 
    tagEditorBatchTracks, 
    setTagEditorBatchTracks, 
    loadLibrary,
    currentTrack
  } = useStore();

  const isBatchMode = tagEditorBatchTracks && tagEditorBatchTracks.length > 0;
  const activeTrack = isBatchMode ? tagEditorBatchTracks[0] : tagEditorTrack;

  const [activeTab, setActiveTab] = useState<'tags' | 'cover' | 'lyrics'>('tags');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Single Track Form State
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [albumArtist, setAlbumArtist] = useState('');
  const [year, setYear] = useState('');
  const [genre, setGenre] = useState('');
  const [trackNumber, setTrackNumber] = useState<string>('');
  const [trackTotal, setTrackTotal] = useState<string>('');
  const [discNumber, setDiscNumber] = useState<string>('');
  const [discTotal, setDiscTotal] = useState<string>('');
  const [comment, setComment] = useState('');
  const [lyrics, setLyrics] = useState('');
  
  // Cover Art State
  const [coverDataUrl, setCoverDataUrl] = useState<string | null>(null);
  const [newCoverBase64, setNewCoverBase64] = useState<string | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Online Cover Search State
  const [coverSearchQuery, setCoverSearchQuery] = useState('');
  const [searchingCovers, setSearchingCovers] = useState(false);
  const [coverResults, setCoverResults] = useState<SearchCoverResult[]>([]);

  // Auto-Tagger State
  const [autoTagging, setAutoTagging] = useState(false);

  // Load existing tags when opened
  useEffect(() => {
    if (!activeTrack) return;

    if (isBatchMode) {
      setTitle('');
      setArtist(tagEditorBatchTracks.every(t => t.artist === tagEditorBatchTracks[0].artist) ? (tagEditorBatchTracks[0].artist || '') : '');
      setAlbum(tagEditorBatchTracks.every(t => t.album === tagEditorBatchTracks[0].album) ? (tagEditorBatchTracks[0].album || '') : '');
      setAlbumArtist('');
      setYear('');
      setGenre('');
      setComment('');
      setLyrics('');
      setCoverDataUrl(null);
      setNewCoverBase64(null);
      setRemoveCover(false);
      return;
    }

    setLoading(true);
    invoke<AudioTagData>('read_audio_tags', { path: activeTrack.path })
      .then((data) => {
        setTitle(data.title ?? activeTrack.title ?? baseName(activeTrack.path));
        setArtist(data.artist ?? activeTrack.artist ?? '');
        setAlbum(data.album ?? activeTrack.album ?? '');
        setAlbumArtist(data.album_artist ?? '');
        setYear(data.year ?? '');
        setGenre(data.genre ?? '');
        setTrackNumber(data.track_number ? String(data.track_number) : (activeTrack.track_number ? String(activeTrack.track_number) : ''));
        setTrackTotal(data.track_total ? String(data.track_total) : '');
        setDiscNumber(data.disc_number ? String(data.disc_number) : (activeTrack.disc_number ? String(activeTrack.disc_number) : ''));
        setDiscTotal(data.disc_total ? String(data.disc_total) : '');
        setComment(data.comment ?? '');
        setLyrics(data.lyrics ?? '');
        setCoverDataUrl(data.cover_data_url ?? null);
        setNewCoverBase64(null);
        setRemoveCover(false);

        const { artist: cleanArt, title: cleanTit } = cleanSearchQuery(data.artist || '', data.title || baseName(activeTrack.path));
        setCoverSearchQuery(`${cleanArt} ${cleanTit}`.trim());
      })
      .catch((err) => {
        console.warn('Failed to read native tags with lofty, falling back to DB metadata:', err);
        setTitle(activeTrack.title ?? baseName(activeTrack.path));
        setArtist(activeTrack.artist ?? '');
        setAlbum(activeTrack.album ?? '');
        setTrackNumber(activeTrack.track_number ? String(activeTrack.track_number) : '');
        setDiscNumber(activeTrack.disc_number ? String(activeTrack.disc_number) : '');
      })
      .finally(() => setLoading(false));
  }, [activeTrack?.path, isBatchMode]);

  // Keyboard shortcut Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [title, artist, album, albumArtist, year, genre, trackNumber, trackTotal, discNumber, discTotal, comment, lyrics, newCoverBase64, removeCover]);

  if (!activeTrack) return null;

  const handleClose = () => {
    setTagEditorTrack(null);
    setTagEditorBatchTracks([]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isBatchMode) {
        const batchUpdate: AudioTagBatchUpdate = {
          artist: artist.trim() ? artist.trim() : null,
          album: album.trim() ? album.trim() : null,
          album_artist: albumArtist.trim() ? albumArtist.trim() : null,
          year: year.trim() ? year.trim() : null,
          genre: genre.trim() ? genre.trim() : null,
          comment: comment.trim() ? comment.trim() : null,
          cover_base64: newCoverBase64,
          remove_cover: removeCover ? true : null,
        };

        const count = await invoke<number>('batch_update_tags', {
          paths: tagEditorBatchTracks.map(t => t.path),
          update: batchUpdate,
        });

        await loadLibrary();
        window.dispatchEvent(new CustomEvent('ui-toast', {
          detail: { message: `Successfully updated tags for ${count} tracks!`, type: 'success' }
        }));
        handleClose();
      } else {
        const update: AudioTagUpdate = {
          title: title.trim() ? title.trim() : null,
          artist: artist.trim() ? artist.trim() : null,
          album: album.trim() ? album.trim() : null,
          album_artist: albumArtist.trim() ? albumArtist.trim() : null,
          year: year.trim() ? year.trim() : null,
          genre: genre.trim() ? genre.trim() : null,
          track_number: trackNumber.trim() ? parseInt(trackNumber.trim(), 10) || null : null,
          track_total: trackTotal.trim() ? parseInt(trackTotal.trim(), 10) || null : null,
          disc_number: discNumber.trim() ? parseInt(discNumber.trim(), 10) || null : null,
          disc_total: discTotal.trim() ? parseInt(discTotal.trim(), 10) || null : null,
          comment: comment.trim() ? comment.trim() : null,
          lyrics: lyrics.trim() ? lyrics.trim() : null,
          cover_base64: newCoverBase64,
          remove_cover: removeCover ? true : null,
        };

        await invoke<any>('write_audio_tags', {
          path: activeTrack.path,
          update,
        });

        // If currently playing track was updated, refresh live cover and metadata
        if (currentTrack && currentTrack.path === activeTrack.path) {
          const updatedTrack: Track = {
            ...currentTrack,
            title: update.title || currentTrack.title,
            artist: update.artist || currentTrack.artist,
            album: update.album || currentTrack.album,
          };
          useStore.setState({ currentTrack: updatedTrack });
          const art = await invoke<string | null>('get_cover_art', { path: activeTrack.path }).catch(() => null);
          if (art) {
            useStore.setState({ coverArt: art });
            try {
              const color = await extractDominantColor(art);
              useStore.setState({ accentColor: color });
            } catch (_) {}
          }
          useStore.getState().updateDiscordPresence();
        }

        await loadLibrary();
        window.dispatchEvent(new CustomEvent('ui-toast', {
          detail: { message: 'Metadata tags saved to audio file!', type: 'success' }
        }));
        handleClose();
      }
    } catch (err) {
      console.error('Failed to save tags:', err);
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Failed to save metadata: ${err}`, type: 'error' }
      }));
    } finally {
      setSaving(false);
    }
  };

  // MusicBrainz Auto-Tagger
  const handleAutoTag = async () => {
    setAutoTagging(true);
    try {
      const qTitle = title || baseName(activeTrack.path);
      const qArtist = artist;
      const res: any = await invoke('mbz_search_recording', { title: qTitle, artist: qArtist });
      if (res && res.title) {
        setTitle(res.title);
        if (res.artist) setArtist(res.artist);
        if (res.album) setAlbum(res.album);
        if (res.year) setYear(String(res.year));
        if (res.track_number) setTrackNumber(String(res.track_number));

        window.dispatchEvent(new CustomEvent('ui-toast', {
          detail: { message: `Matched tags from MusicBrainz: "${res.title}"`, type: 'info' }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('ui-toast', {
          detail: { message: 'No exact MusicBrainz match found.', type: 'warning' }
        }));
      }
    } catch (e) {
      console.error('Auto-tag error:', e);
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Auto-tag lookup failed: ${e}`, type: 'error' }
      }));
    } finally {
      setAutoTagging(false);
    }
  };

  // Drag & drop cover art handler
  const handleFileDrop = (file: File) => {
    if (!file.type.startsWith('image/')) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: 'Please select an image file (PNG/JPEG).', type: 'warning' }
      }));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = e.target?.result as string;
      if (b64) {
        setNewCoverBase64(b64);
        setRemoveCover(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSearchOnlineCovers = async (q: string) => {
    if (!q.trim()) return;
    setSearchingCovers(true);
    setCoverResults([]);
    try {
      const res: any[] = await invoke('search_lyrics_online', { query: q });
      let results = res.filter(r => r.cover_url && r.cover_url.trim().length > 0);

      if (results.length === 0) {
        try {
          const ytTracks: any[] = await invoke('search_youtube', { query: q });
          if (ytTracks && ytTracks.length > 0) {
            results = ytTracks
              .filter(t => t.thumbnail || t.cover_url)
              .slice(0, 8)
              .map((t, idx) => ({
                id: `yt-${idx}-${t.id || t.video_id}`,
                title: t.title || q,
                artist: t.artist || t.uploader || 'YouTube',
                source: 'YouTube Music',
                cover_url: t.thumbnail || t.cover_url,
              }));
          }
        } catch (_) {}
      }
      setCoverResults(results);
    } catch (e) {
      console.error('Search covers failed:', e);
    } finally {
      setSearchingCovers(false);
    }
  };

  const selectOnlineCoverAsBase64 = async (url: string) => {
    setLoading(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = (e) => {
        const b64 = e.target?.result as string;
        if (b64) {
          setNewCoverBase64(b64);
          setRemoveCover(false);
          setActiveTab('cover');
          window.dispatchEvent(new CustomEvent('ui-toast', {
            detail: { message: 'High-res online cover loaded for embedding!', type: 'success' }
          }));
        }
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.error('Failed to convert online cover:', e);
    } finally {
      setLoading(false);
    }
  };

  const displayedCover = removeCover 
    ? null 
    : (newCoverBase64 || coverDataUrl);

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <motion.div 
        className="modal-box"
        onClick={e => e.stopPropagation()}
        style={{
          width: 740,
          maxWidth: '92vw',
          height: 640,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(18, 18, 26, 0.95)',
          backdropFilter: 'blur(32px)',
          border: '1px solid var(--glass-border)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.6)',
          overflow: 'hidden',
        }}
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--glass-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isBatchMode ? <Layers size={20} className="accent-color" /> : <Tag size={20} className="accent-color" />}
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white' }}>
                {isBatchMode ? `Batch Tag Editor (${tagEditorBatchTracks.length} tracks)` : 'ID3 & FLAC Tag Editor'}
              </h3>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isBatchMode 
                  ? 'Editing shared metadata across all selected files'
                  : (activeTrack.path)}
              </div>
            </div>
          </div>
          <button 
            onClick={handleClose} 
            style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '10px 20px',
          background: 'rgba(0, 0, 0, 0.2)',
          borderBottom: '1px solid var(--glass-border)',
        }}>
          <button
            onClick={() => setActiveTab('tags')}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'tags' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'tags' ? 'white' : 'var(--text-dim)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Tag size={14} />
            Metadata Tags
          </button>

          <button
            onClick={() => setActiveTab('cover')}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'cover' ? 'var(--accent)' : 'transparent',
              color: activeTab === 'cover' ? 'white' : 'var(--text-dim)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ImageIcon size={14} />
            Embedded Cover Art
          </button>

          {!isBatchMode && (
            <button
              onClick={() => setActiveTab('lyrics')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                background: activeTab === 'lyrics' ? 'var(--accent)' : 'transparent',
                color: activeTab === 'lyrics' ? 'white' : 'var(--text-dim)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <FileText size={14} />
              Embedded Lyrics (LRC)
            </button>
          )}

          {!isBatchMode && (
            <button
              onClick={handleAutoTag}
              disabled={autoTagging}
              style={{
                marginLeft: 'auto',
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid rgba(139, 92, 246, 0.3)',
                background: 'rgba(139, 92, 246, 0.1)',
                color: 'var(--accent)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {autoTagging ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
              Auto-Match (MusicBrainz)
            </button>
          )}
        </div>

        {/* Modal Body Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--text-dim)' }}>
              <Loader2 size={32} className="spin accent-color" />
              <span>Reading container metadata...</span>
            </div>
          ) : (
            <>
              {/* TAGS TAB */}
              {activeTab === 'tags' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {!isBatchMode && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Track Title
                      </label>
                      <input
                        type="text"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="Song title"
                        style={{
                          background: 'var(--glass)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: 8,
                          padding: '8px 12px',
                          color: 'white',
                          fontSize: 13,
                        }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Artist
                      </label>
                      <input
                        type="text"
                        value={artist}
                        onChange={e => setArtist(e.target.value)}
                        placeholder="Artist name"
                        style={{
                          background: 'var(--glass)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: 8,
                          padding: '8px 12px',
                          color: 'white',
                          fontSize: 13,
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Album
                      </label>
                      <input
                        type="text"
                        value={album}
                        onChange={e => setAlbum(e.target.value)}
                        placeholder="Album name"
                        style={{
                          background: 'var(--glass)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: 8,
                          padding: '8px 12px',
                          color: 'white',
                          fontSize: 13,
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Album Artist
                      </label>
                      <input
                        type="text"
                        value={albumArtist}
                        onChange={e => setAlbumArtist(e.target.value)}
                        placeholder="Album artist (optional)"
                        style={{
                          background: 'var(--glass)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: 8,
                          padding: '8px 12px',
                          color: 'white',
                          fontSize: 13,
                        }}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                          Year / Date
                        </label>
                        <input
                          type="text"
                          value={year}
                          onChange={e => setYear(e.target.value)}
                          placeholder="YYYY"
                          style={{
                            background: 'var(--glass)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: 8,
                            padding: '8px 12px',
                            color: 'white',
                            fontSize: 13,
                          }}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                          Genre
                        </label>
                        <input
                          type="text"
                          value={genre}
                          onChange={e => setGenre(e.target.value)}
                          placeholder="e.g. Rock"
                          style={{
                            background: 'var(--glass)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: 8,
                            padding: '8px 12px',
                            color: 'white',
                            fontSize: 13,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {!isBatchMode && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                            Track #
                          </label>
                          <input
                            type="number"
                            value={trackNumber}
                            onChange={e => setTrackNumber(e.target.value)}
                            placeholder="1"
                            style={{
                              background: 'var(--glass)',
                              border: '1px solid var(--glass-border)',
                              borderRadius: 8,
                              padding: '8px 12px',
                              color: 'white',
                              fontSize: 13,
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                            Total Tracks
                          </label>
                          <input
                            type="number"
                            value={trackTotal}
                            onChange={e => setTrackTotal(e.target.value)}
                            placeholder="12"
                            style={{
                              background: 'var(--glass)',
                              border: '1px solid var(--glass-border)',
                              borderRadius: 8,
                              padding: '8px 12px',
                              color: 'white',
                              fontSize: 13,
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                            Disc #
                          </label>
                          <input
                            type="number"
                            value={discNumber}
                            onChange={e => setDiscNumber(e.target.value)}
                            placeholder="1"
                            style={{
                              background: 'var(--glass)',
                              border: '1px solid var(--glass-border)',
                              borderRadius: 8,
                              padding: '8px 12px',
                              color: 'white',
                              fontSize: 13,
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                            Total Discs
                          </label>
                          <input
                            type="number"
                            value={discTotal}
                            onChange={e => setDiscTotal(e.target.value)}
                            placeholder="1"
                            style={{
                              background: 'var(--glass)',
                              border: '1px solid var(--glass-border)',
                              borderRadius: 8,
                              padding: '8px 12px',
                              color: 'white',
                              fontSize: 13,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                      Comment / Notes
                    </label>
                    <input
                      type="text"
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Comment tag"
                      style={{
                        background: 'var(--glass)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 8,
                        padding: '8px 12px',
                        color: 'white',
                        fontSize: 13,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* COVER ART TAB */}
              {activeTab === 'cover' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 18, alignItems: 'start' }}>
                    {/* Cover Preview */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                      <div style={{
                        width: 180,
                        height: 180,
                        borderRadius: 12,
                        background: 'rgba(0, 0, 0, 0.4)',
                        border: '1px solid var(--glass-border)',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                      }}>
                        {displayedCover ? (
                          <img 
                            src={displayedCover} 
                            alt="Cover preview" 
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                          />
                        ) : (
                          <div style={{ color: 'var(--text-dim)', fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                            <ImageIcon size={32} />
                            No Artwork
                          </div>
                        )}
                      </div>

                      {displayedCover && (
                        <button
                          onClick={() => {
                            setRemoveCover(true);
                            setNewCoverBase64(null);
                          }}
                          style={{
                            padding: '4px 10px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: 6,
                            color: '#ef4444',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Trash2 size={12} />
                          Remove Cover
                        </button>
                      )}
                    </div>

                    {/* Drag & Drop Box */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div
                        onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
                        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragActive(false);
                          if (e.dataTransfer.files?.[0]) handleFileDrop(e.dataTransfer.files[0]);
                        }}
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                          border: `2px dashed ${dragActive ? 'var(--accent)' : 'var(--glass-border)'}`,
                          borderRadius: 12,
                          padding: '24px 16px',
                          textAlign: 'center',
                          cursor: 'pointer',
                          background: dragActive ? 'rgba(139, 92, 246, 0.08)' : 'var(--glass)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 6,
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <input
                          type="file"
                          ref={fileInputRef}
                          style={{ display: 'none' }}
                          accept="image/png, image/jpeg, image/jpg"
                          onChange={(e) => {
                            if (e.target.files?.[0]) handleFileDrop(e.target.files[0]);
                          }}
                        />
                        <UploadCloud size={24} className="accent-color" />
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>
                          Drag & drop artwork file or click to browse
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                          Supports JPEG, PNG (embedded directly into audio container APIC / Picture block)
                        </div>
                      </div>

                      {/* Online Search Header */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                        <input
                          type="text"
                          value={coverSearchQuery}
                          onChange={e => setCoverSearchQuery(e.target.value)}
                          placeholder="Search high-res cover online..."
                          onKeyDown={e => e.key === 'Enter' && handleSearchOnlineCovers(coverSearchQuery)}
                          style={{
                            flex: 1,
                            background: 'var(--glass)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: 8,
                            padding: '8px 12px',
                            color: 'white',
                            fontSize: 12,
                          }}
                        />
                        <button
                          onClick={() => handleSearchOnlineCovers(coverSearchQuery)}
                          disabled={searchingCovers}
                          style={{
                            padding: '8px 14px',
                            background: 'var(--accent)',
                            border: 'none',
                            borderRadius: 8,
                            color: 'white',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {searchingCovers ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
                          Search
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Online Cover Search Results */}
                  {coverResults.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Online Cover Matches (Click to Embed)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                        {coverResults.map((res, i) => (
                          <div
                            key={i}
                            onClick={() => res.cover_url && selectOnlineCoverAsBase64(res.cover_url)}
                            style={{
                              padding: 6,
                              borderRadius: 8,
                              background: 'var(--glass)',
                              border: '1px solid var(--glass-border)',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                              alignItems: 'center',
                              textAlign: 'center',
                            }}
                          >
                            <img
                              src={res.cover_url}
                              alt={res.title}
                              referrerPolicy="no-referrer"
                              style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 6 }}
                            />
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                              {res.title}
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase' }}>
                              {res.source}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* LYRICS TAB */}
              {activeTab === 'lyrics' && !isBatchMode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    Embedded Lyrics Tag (Synchronized LRC or Plain Text)
                  </label>
                  <textarea
                    value={lyrics}
                    onChange={e => setLyrics(e.target.value)}
                    placeholder="[00:12.34] Lyrics line 1..."
                    rows={14}
                    style={{
                      width: '100%',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 8,
                      padding: 12,
                      color: 'white',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      resize: 'none',
                      lineHeight: 1.5,
                    }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    Embedded directly in the audio container (USLT ID3 frame / Vorbis LYRICS comment).
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--glass-border)',
          background: 'rgba(0, 0, 0, 0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Press <strong>Ctrl + S</strong> to write tags to disk
          </span>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleClose}
              style={{
                padding: '8px 16px',
                background: 'var(--glass-h)',
                border: '1px solid var(--glass-border)',
                borderRadius: 8,
                color: 'white',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              style={{
                padding: '8px 20px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 8,
                color: 'white',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              {saving ? 'Writing Tags...' : (isBatchMode ? `Save ${tagEditorBatchTracks.length} Files` : 'Save Changes')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
