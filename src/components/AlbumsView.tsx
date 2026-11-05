import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { 
  Disc, Play, Shuffle, MoreVertical, Plus, Trash2, Activity, ListPlus, Edit3, Image, X, Heart, Tag
} from 'lucide-react';
import { extractDominantColor } from '../utils/colorExtractor';
import { fmt, isLosslessTrack, startSonicMix } from '../utils';
import { shuffleArray } from '../utils/shuffle';
import { ArtistDiscographyDrawer } from './ArtistDiscographyDrawer';
import { sortAlbumTracks, groupTracksByDisc, getTrackNumber, buildAlbumKey } from '../utils/albumUtils';
import { extractPrimaryArtist } from '../utils/unifiedSources';
import { AlbumThumbnail } from './AlbumThumbnail';
import { parseSearchQuery, foldSearchText, simplifyPunctuation } from '../utils/searchParser';
import { Track } from '../store/types';
import { TrackContextMenu } from './TrackContextMenu';


export const isHiResTrack = (t: any) => {
  const sampleRate = t?.catalog_quality?.sample_rate || t?.active_quality?.sample_rate || t?.sample_rate || 0;
  const bitDepth = t?.catalog_quality?.bit_depth || t?.active_quality?.bit_depth || t?.bit_depth || 0;
  if (sampleRate >= 88200 || bitDepth >= 24) return true;
  const f = (t?.format || '').toLowerCase();
  return f.includes('dsf') || f.includes('dff') || f.includes('dsd');
};

export function formatAudioResolution(sampleTrack: any): string | null {
  const sampleRate = sampleTrack?.catalog_quality?.sample_rate || sampleTrack?.active_quality?.sample_rate || sampleTrack?.sample_rate;
  const bitDepth = sampleTrack?.catalog_quality?.bit_depth || sampleTrack?.active_quality?.bit_depth || sampleTrack?.bit_depth;
  
  if (sampleRate && bitDepth) {
    const srKHz = sampleRate >= 1000 ? `${sampleRate / 1000}kHz` : `${sampleRate}Hz`;
    return `${bitDepth}-bit / ${srKHz}`;
  }
  if (sampleRate) {
    const srKHz = sampleRate >= 1000 ? `${sampleRate / 1000}kHz` : `${sampleRate}Hz`;
    return srKHz;
  }
  if (bitDepth) {
    return `${bitDepth}-bit`;
  }
  const f = (sampleTrack?.format || '').toLowerCase();
  if (f.includes('dsd') || f.includes('dsf') || f.includes('dff')) {
    return '1-bit / DSD';
  }
  return null;
}

export function formatChannels(sampleTrack: any): string {
  const ch = sampleTrack?.channels || sampleTrack?.catalog_quality?.channels;
  if (ch === 1) return '1.0 Mono';
  if (ch === 2) return '2.0 Stereo';
  if (ch && ch > 2) return `${ch}.0 Surround`;
  return 'Unknown';
}

export function extractAlbumYear(album: { tracks: any[]; title: string; sampleTrack: any }): number | null {
  const yearCounts = new Map<number, number>();
  for (const t of album.tracks) {
    let y: number | null = null;
    if ((t as any)?.year) {
      const parsed = parseInt(String((t as any).year).trim().slice(0, 4), 10);
      if (!isNaN(parsed) && parsed >= 1900 && parsed <= 2100) y = parsed;
    }
    if (y === null && (t as any)?.date) {
      const parsed = parseInt(String((t as any).date).trim().slice(0, 4), 10);
      if (!isNaN(parsed) && parsed >= 1900 && parsed <= 2100) y = parsed;
    }
    if (y !== null) {
      yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
    }
  }

  if (yearCounts.size > 0) {
    let bestYear: number | null = null;
    let maxCount = -1;
    for (const [year, count] of yearCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        bestYear = year;
      }
    }
    if (bestYear !== null) return bestYear;
  }

  const candidates = [album.title, album.sampleTrack?.path || '', album.sampleTrack?.album || ''];
  for (const str of candidates) {
    const match = str.match(/\b(19\d\d|20\d\d)\b/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (parsed >= 1900 && parsed <= 2100) return parsed;
    }
  }
  return null;
}


interface AlbumGroup {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  sampleTrack: any;
  tracks: any[];
  totalDuration: number;
}


const getSavedLovedAlbums = (): string[] => {
  try {
    const raw = localStorage.getItem('aideo-loved-albums');
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
};

/** Returns a function whose identity never changes but always calls the latest closure,
 *  so memoised cards are not re-rendered by handlers that merely close over fresh state. */
function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/* ── Album context menu ── */
interface AlbumContextMenuProps {
  album: AlbumGroup;
  open: boolean;
  casting: boolean;
  setMenuOpenFor: (id: string | null) => void;
  handlePlayAlbum: (album: AlbumGroup, shuffle?: boolean) => void;
  handlePlayAlbumNext: (album: AlbumGroup) => void;
  handleAddAlbumToQueue: (album: AlbumGroup) => void;
  setPlaylistModalTracks: (tracks: any[]) => void;
  setCoverArtModalTrack: (track: any) => void;
  handleSonicMix: (album: AlbumGroup) => void;
  setEditAlbumModal: (album: AlbumGroup) => void;
  setEditTitle: (title: string) => void;
  setEditArtist: (artist: string) => void;
  handleDeleteAlbum: (album: AlbumGroup) => void;
}

function MenuItem({ icon, danger, disabled, onSelect, children }: {
  icon: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`album-menu-item${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {icon}
      {children}
    </button>
  );
}

function AlbumContextMenu({
  album,
  open,
  casting,
  setMenuOpenFor,
  handlePlayAlbum,
  handlePlayAlbumNext,
  handleAddAlbumToQueue,
  setPlaylistModalTracks,
  setCoverArtModalTrack,
  handleSonicMix,
  setEditAlbumModal,
  setEditTitle,
  setEditArtist,
  handleDeleteAlbum,
}: AlbumContextMenuProps) {
  const close = () => setMenuOpenFor(null);

  return (
    <div className="album-menu-anchor" data-album-menu={album.id}>
      <button
        type="button"
        className="album-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Options for ${album.title}`}
        title="Album options"
        onClick={(e) => { e.stopPropagation(); setMenuOpenFor(open ? null : album.id); }}
      >
        <MoreVertical size={16} aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="album-menu"
            role="menu"
            aria-label={`${album.title} actions`}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem icon={<Play size={14} aria-hidden="true" />} onSelect={() => { close(); handlePlayAlbum(album, false); }}>Play album</MenuItem>
            <MenuItem
              icon={<Play size={14} aria-hidden="true" />}
              disabled={casting}
              onSelect={() => { close(); void useStore.getState().playAlbumToEnd(album.tracks, album.title).catch(e => useStore.getState().setPlaybackError(String(e))); }}
            >Play album to end</MenuItem>
            <MenuItem icon={<ListPlus size={14} aria-hidden="true" />} onSelect={() => { close(); handlePlayAlbumNext(album); }}>Play next</MenuItem>
            <MenuItem icon={<Plus size={14} aria-hidden="true" />} onSelect={() => { close(); handleAddAlbumToQueue(album); }}>Add to queue</MenuItem>
            <MenuItem icon={<Plus size={14} aria-hidden="true" />} onSelect={() => { close(); setPlaylistModalTracks(album.tracks); }}>Add to playlist…</MenuItem>
            <MenuItem icon={<Activity size={14} aria-hidden="true" />} onSelect={() => { close(); handleSonicMix(album); }}>Play similar tracks</MenuItem>

            <div className="album-menu-rule" role="separator" />

            <MenuItem icon={<Image size={14} aria-hidden="true" />} onSelect={() => { close(); setCoverArtModalTrack(album.sampleTrack); }}>Manage cover art</MenuItem>
            <MenuItem icon={<Tag size={14} aria-hidden="true" />} onSelect={() => { close(); useStore.getState().setTagEditorBatchTracks(album.tracks); }}>Batch edit tags</MenuItem>
            <MenuItem
              icon={<Edit3 size={14} aria-hidden="true" />}
              onSelect={() => { close(); setEditAlbumModal(album); setEditTitle(album.title); setEditArtist(album.artist); }}
            >Edit album data</MenuItem>

            <div className="album-menu-rule" role="separator" />

            <MenuItem danger icon={<Trash2 size={14} aria-hidden="true" />} onSelect={() => { close(); handleDeleteAlbum(album); }}>Delete album</MenuItem>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Album wall card: the artwork is the tile, the caption sits under it ── */
interface CardCommonProps {
  album: AlbumGroup;
  isLoved: boolean;
  menuOpen: boolean;
  casting: boolean;
  setMenuOpenFor: (id: string | null) => void;
  setSelectedAlbum: (album: AlbumGroup) => void;
  toggleLoveAlbum: (id: string, e: React.MouseEvent) => void;
  handlePlayAlbum: (album: AlbumGroup, shuffle?: boolean) => void;
  handlePlayAlbumNext: (album: AlbumGroup) => void;
  handleAddAlbumToQueue: (album: AlbumGroup) => void;
  setPlaylistModalTracks: (tracks: any[]) => void;
  setCoverArtModalTrack: (track: any) => void;
  handleSonicMix: (album: AlbumGroup) => void;
  setEditAlbumModal: (album: AlbumGroup) => void;
  setEditTitle: (title: string) => void;
  setEditArtist: (artist: string) => void;
  handleDeleteAlbum: (album: AlbumGroup) => void;
  setSelectedArtist: (artist: string) => void;
}

const ClassicAlbumCard = memo(function ClassicAlbumCard({
  album,
  isLoved,
  menuOpen,
  casting,
  setMenuOpenFor,
  setSelectedAlbum,
  toggleLoveAlbum,
  handlePlayAlbum,
  handlePlayAlbumNext,
  handleAddAlbumToQueue,
  setPlaylistModalTracks,
  setCoverArtModalTrack,
  handleSonicMix,
  setEditAlbumModal,
  setEditTitle,
  setEditArtist,
  handleDeleteAlbum,
  setSelectedArtist,
}: CardCommonProps) {
  const isLossless = isLosslessTrack(album.sampleTrack);
  const specText = isHiResTrack(album.sampleTrack) && isLossless ? 'HI-RES' : isLossless ? 'LOSSLESS' : (album.sampleTrack?.format || 'Unknown');
  const open = () => setSelectedAlbum(album);

  return (
    <div className="album-card" data-menu-open={menuOpen || undefined}>
      <div className="album-art">
        <button type="button" className="album-art-open" onClick={open} aria-label={`Open ${album.title} by ${album.artist}`}>
          <AlbumThumbnail sampleTrack={album.sampleTrack} tracks={album.tracks} title="" loading="lazy" decoding="async" />
        </button>

        <button
          type="button"
          className={`album-heart${isLoved ? ' is-loved' : ''}`}
          onClick={(e) => toggleLoveAlbum(album.id, e)}
          aria-pressed={isLoved}
          aria-label={isLoved ? `Remove ${album.title} from loved albums` : `Love ${album.title}`}
          title={isLoved ? 'Remove from loved albums' : 'Love album'}
        >
          <Heart size={14} fill={isLoved ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>

        <span className={`album-spec${isLossless ? ' is-lossless' : ''}`}>{specText}</span>

        <button
          type="button"
          className="album-play"
          onClick={(e) => { e.stopPropagation(); handlePlayAlbum(album, false); }}
          aria-label={`Play ${album.title}`}
          title="Play album"
        >
          <Play size={18} fill="currentColor" aria-hidden="true" />
        </button>
      </div>

      <button type="button" className="album-title" onClick={open} title={album.title}>{album.title}</button>
      <button type="button" className="album-artist" onClick={() => setSelectedArtist(album.artist)} title={`View discography of ${album.artist}`}>{album.artist}</button>

      <div className="album-meta">
        <span className="album-count">{album.tracks.length} {album.tracks.length === 1 ? 'track' : 'tracks'} · {fmt(album.totalDuration)}</span>
        <AlbumContextMenu
          album={album}
          open={menuOpen}
          casting={casting}
          setMenuOpenFor={setMenuOpenFor}
          handlePlayAlbum={handlePlayAlbum}
          handlePlayAlbumNext={handlePlayAlbumNext}
          handleAddAlbumToQueue={handleAddAlbumToQueue}
          setPlaylistModalTracks={setPlaylistModalTracks}
          setCoverArtModalTrack={setCoverArtModalTrack}
          handleSonicMix={handleSonicMix}
          setEditAlbumModal={setEditAlbumModal}
          setEditTitle={setEditTitle}
          setEditArtist={setEditArtist}
          handleDeleteAlbum={handleDeleteAlbum}
        />
      </div>
    </div>
  );
});

function AlbumTrackTable({ tracks, onPlay }: { tracks: any[]; onPlay: (track: any) => void }) {
  return (
    <table className="track-table album-track-table">
      <thead>
        <tr>
          <th className="col-num">#</th>
          <th>Title</th>
          <th className="col-time">Time</th>
        </tr>
      </thead>
      <tbody>
        {tracks.map((t, idx) => (
          <tr
            key={t.id || t.path || idx}
            data-track-path={t.path}
            tabIndex={0}
            onClick={() => onPlay(t)}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPlay(t); }
            }}
          >
            <td className="col-num">{getTrackNumber(t) || idx + 1}</td>
            <td>
              <div className="track-name">{t.title || 'Untitled'}</div>
              <div className="track-sub">{t.artist || 'Unknown Artist'}</div>
            </td>
            <td className="col-time">{fmt(t.duration)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface AlbumsViewProps {
  tracks?: any[];
  searchQuery?: string;
  sortBy?: 'title' | 'artist' | 'count' | 'recent';
  onAlbumCountChange?: (count: number) => void;
}

export function AlbumsView({ 
  tracks: customTracks, 
  searchQuery = '', 
  sortBy = 'title',
  onAlbumCountChange,
}: AlbumsViewProps = {}) {
  const storeTracks = useStore((s) => s.tracks);
  const tracks = customTracks || storeTracks;

  const { 
    playTrack, addToQueue, playNextInQueue, playlists, addToPlaylist,
    setCoverArtModalTrack
  } = useStore(useShallow(s => ({
    playTrack: s.playTrack,
    addToQueue: s.addToQueue,
    playNextInQueue: s.playNextInQueue,
    playlists: s.playlists,
    addToPlaylist: s.addToPlaylist,
    setCoverArtModalTrack: s.setCoverArtModalTrack,
  })));

  const [selectedAlbum, setSelectedAlbum] = useState<AlbumGroup | null>(null);
  const [trackMenu, setTrackMenu] = useState<{ track: Track; anchor: { x: number; y: number } } | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [lovedAlbumKeys, setLovedAlbumKeys] = useState<string[]>(getSavedLovedAlbums);
  const [filterLovedOnly, setFilterLovedOnly] = useState(false);
  const [ambientColor, setAmbientColor] = useState<string>('rgba(139, 92, 246, 0.25)');

  // Modals
  const [playlistModalTracks, setPlaylistModalTracks] = useState<any[] | null>(null);
  const [editAlbumModal, setEditAlbumModal] = useState<AlbumGroup | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');
  const [, setIsProcessing] = useState<string | null>(null);
  const casting = useStore((s) => s.chromecast_connected || s.upnp_connected);

  // Escape closes the open menu first, then the drawer; a click outside the menu closes it.
  useEffect(() => {
    if (!menuOpenFor && !selectedAlbum) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (menuOpenFor) setMenuOpenFor(null);
      else if (!selectedArtist && !playlistModalTracks && !editAlbumModal) setSelectedAlbum(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (menuOpenFor && !(event.target as HTMLElement | null)?.closest?.('[data-album-menu]')) setMenuOpenFor(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpenFor, selectedAlbum, selectedArtist, playlistModalTracks, editAlbumModal]);

  // Extract Ambient Color when Album Drawer opens
  useEffect(() => {
    if (selectedAlbum) {
      const artUrl = selectedAlbum.coverUrl || selectedAlbum.sampleTrack?.cover_url || selectedAlbum.sampleTrack?.path || selectedAlbum.sampleTrack?.stream_url;
      extractDominantColor(artUrl).then(setAmbientColor);
    } else {
      setAmbientColor('rgba(139, 92, 246, 0.25)');
    }
  }, [selectedAlbum]);

  const toggleLoveAlbum = (albumId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setLovedAlbumKeys((prev) => {
      const next = prev.includes(albumId)
        ? prev.filter((id) => id !== albumId)
        : [...prev, albumId];
      localStorage.setItem('aideo-loved-albums', JSON.stringify(next));
      return next;
    });
  };

  // Group tracks into Albums
  const albumGroups = useMemo(() => {
    const map = new Map<string, AlbumGroup>();

    tracks.forEach((t) => {
      const albumTitle = t.album?.trim() || 'Unknown Album';
      const albumArtist = t.album_artist?.trim() || t.albumArtist?.trim();
      const trackArtist = t.artist?.trim() || 'Unknown Artist';
      const key = buildAlbumKey(t);
      
      const isVarious = key.startsWith('various:::') || albumArtist?.toLowerCase() === 'various artists';
      const effectiveArtist = isVarious ? 'Various Artists' : (albumArtist || trackArtist);

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          title: albumTitle,
          artist: effectiveArtist,
          coverUrl: t.cover_url || null,
          sampleTrack: t,
          tracks: [t],
          totalDuration: t.duration || 0,
        });
      } else {
        const group = map.get(key)!;
        group.tracks.push(t);
        group.totalDuration += t.duration || 0;
        if (!group.coverUrl && t.cover_url) {
          group.coverUrl = t.cover_url;
          group.sampleTrack = t;
        }

        if (!albumArtist && group.artist !== 'Various Artists' && group.artist !== trackArtist) {
          const firstArtistMain = extractPrimaryArtist(group.artist) || 'unknown artist';
          const currArtistMain = extractPrimaryArtist(trackArtist) || 'unknown artist';
          if (firstArtistMain !== currArtistMain) {
            group.artist = 'Various Artists';
          } else if (trackArtist.trim().toLowerCase() === currArtistMain && group.artist.trim().toLowerCase() !== currArtistMain) {
            group.artist = trackArtist.trim();
          }
        }
      }
    });

    const result = Array.from(map.values());
    result.forEach((group) => {
      group.tracks = sortAlbumTracks(group.tracks);
    });

    return result;
  }, [tracks]);

  useEffect(() => {
    const replacements = new Map<string, Set<string>>();
    for (const track of tracks) {
      if (track.album_artist?.trim() || track.albumArtist?.trim() || track.compilation === 1 || track.is_compilation === true || track.compilation === '1') continue;
      const artist = track.artist?.trim() || 'Unknown Artist';
      // Only persisted inferred-artist keys need the pre-cutover parsing rule.
      const legacyArtist = artist.split(/\s+(?:feat\.|ft\.|featuring|with|x|vs\.?)\s+|[,/;&]|\s+&\s+/i)[0]?.trim() || artist;
      const legacyKey = `${legacyArtist.toLowerCase()}:::${(track.album?.trim() || 'Unknown Album').toLowerCase()}`;
      const key = buildAlbumKey(track);
      if (key === legacyKey) continue;
      const keys = replacements.get(legacyKey) || new Set<string>();
      keys.add(key);
      replacements.set(legacyKey, keys);
    }
    if (!replacements.size) return;
    const currentKeys = new Set(albumGroups.map(album => album.id));
    setLovedAlbumKeys(previous => {
      const next = [...new Set(previous.flatMap(key => {
        const replacementsForKey = replacements.get(key);
        if (!replacementsForKey) return [key];
        return [...(currentKeys.has(key) ? [key] : []), ...replacementsForKey];
      }))];
      if (next.length === previous.length && next.every((key, index) => key === previous[index])) return previous;
      localStorage.setItem('aideo-loved-albums', JSON.stringify(next));
      return next;
    });
  }, [tracks, albumGroups]);

  // Filter & Sort
  const filteredAlbums = useMemo(() => {
    return albumGroups
      .filter((a) => {
        if (filterLovedOnly && !lovedAlbumKeys.includes(a.id)) return false;
        if (!searchQuery) return true;

        const criteria = parseSearchQuery(searchQuery);
        const foldedTitle = foldSearchText(a.title);
        const foldedArtist = foldSearchText(a.artist);
        const simpleTitle = simplifyPunctuation(foldedTitle);
        const simpleArtist = simplifyPunctuation(foldedArtist);

        const matchArtist = (target: string, simpleTarget: string) => {
          if (foldedArtist.includes(target) || (simpleTarget && simpleArtist.includes(simpleTarget))) return true;
          return a.tracks.some(t => {
            const tArtist = foldSearchText(t.artist);
            const tAlbumArtist = foldSearchText(t.album_artist || t.albumArtist);
            const sArtist = simplifyPunctuation(tArtist);
            const sAlbumArtist = simplifyPunctuation(tAlbumArtist);
            return tArtist.includes(target) || tAlbumArtist.includes(target) ||
              (simpleTarget && (sArtist.includes(simpleTarget) || sAlbumArtist.includes(simpleTarget)));
          });
        };

        if (criteria.artist) {
          const target = foldSearchText(criteria.artist);
          const simpleTarget = simplifyPunctuation(target);
          if (!matchArtist(target, simpleTarget)) return false;
        }

        if (criteria.album) {
          const target = foldSearchText(criteria.album);
          const simpleTarget = simplifyPunctuation(target);
          if (!foldedTitle.includes(target) && (!simpleTarget || !simpleTitle.includes(simpleTarget))) return false;
        }

        for (const token of criteria.freeText) {
          const target = foldSearchText(token);
          const simpleTarget = simplifyPunctuation(target);
          const inTitle = foldedTitle.includes(target) || (Boolean(simpleTarget) && simpleTitle.includes(simpleTarget));
          const inArtist = matchArtist(target, simpleTarget);
          if (!inTitle && !inArtist) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'title') return a.title.localeCompare(b.title);
        if (sortBy === 'artist') return a.artist.localeCompare(b.artist);
        if (sortBy === 'count') return b.tracks.length - a.tracks.length;
        if (sortBy === 'recent') {
          const maxIdA = Math.max(...a.tracks.map((t: any) => (typeof t.id === 'number' ? t.id : (Number(t.id) || 0))), 0);
          const maxIdB = Math.max(...b.tracks.map((t: any) => (typeof t.id === 'number' ? t.id : (Number(t.id) || 0))), 0);
          return maxIdB - maxIdA;
        }
        return 0;
      });
  }, [albumGroups, searchQuery, sortBy, filterLovedOnly, lovedAlbumKeys]);

  // Notify parent of total album count
  useEffect(() => {
    if (onAlbumCountChange) {
      onAlbumCountChange(filteredAlbums.length);
    }
  }, [filteredAlbums.length, onAlbumCountChange]);

  // 2D Grid Virtualization for Classic Wall
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  // Exact scroll offset lives in a ref; the state below only changes when the row under the top edge
  // changes, so scrolling inside one row does not re-render the whole grid.
  const scrollTopRef = useRef(0);
  const rowHeightRef = useRef(300);
  const [, setScrollRow] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el) return;

    let scrollParent: HTMLElement | null = el.parentElement;
    while (scrollParent && scrollParent !== document.body) {
      const overflowY = window.getComputedStyle(scrollParent).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scrollParent = scrollParent.parentElement;
    }
    const target = scrollParent || window;

    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (target === window) {
          scrollTopRef.current = window.scrollY;
          setScrollRow(Math.floor(window.scrollY / rowHeightRef.current));
          setViewportHeight(window.innerHeight);
        } else if (scrollParent) {
          scrollTopRef.current = scrollParent.scrollTop;
          setScrollRow(Math.floor(scrollParent.scrollTop / rowHeightRef.current));
          setViewportHeight(scrollParent.clientHeight);
        }
      });
    };

    let lastWidth = el.clientWidth;
    const updateSize = () => {
      if (el.clientWidth > 0 && Math.abs(lastWidth - el.clientWidth) >= 4) {
        lastWidth = el.clientWidth;
        setContainerWidth(el.clientWidth);
      }
      handleScroll();
    };
    if (el.clientWidth > 0) setContainerWidth(el.clientWidth);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateSize);
      ro.observe(el);
    }

    target.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    handleScroll();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      target.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  // Re-measure dimensions when albums become available
  useEffect(() => {
    if (filteredAlbums.length > 0) {
      const el = gridContainerRef.current;
      if (!el) return;
      if (el.clientWidth > 0) setContainerWidth(el.clientWidth);

      let scrollParent: HTMLElement | null = el.parentElement;
      while (scrollParent && scrollParent !== document.body) {
        const overflowY = window.getComputedStyle(scrollParent).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') break;
        scrollParent = scrollParent.parentElement;
      }
      if (scrollParent && scrollParent.clientHeight > 0) {
        setViewportHeight(scrollParent.clientHeight);
        scrollTopRef.current = scrollParent.scrollTop;
        setScrollRow(Math.floor(scrollParent.scrollTop / rowHeightRef.current));
      }
    }
  }, [filteredAlbums.length]);

  const columns = Math.max(1, Math.floor((containerWidth + 24) / 224));
  const cardWidth = Math.max(160, (containerWidth - (columns - 1) * 24) / columns);
  const estimatedRowHeight = Math.round(cardWidth + 108);
  rowHeightRef.current = estimatedRowHeight;
  const scrollTop = scrollTopRef.current;

  const rows = useMemo(() => {
    const chunks: AlbumGroup[][] = [];
    for (let i = 0; i < filteredAlbums.length; i += columns) {
      chunks.push(filteredAlbums.slice(i, i + columns));
    }
    return chunks;
  }, [filteredAlbums, columns]);

  const overscan = 2;
  const startIndex = Math.max(0, Math.floor(scrollTop / estimatedRowHeight) - overscan);
  const endIndex = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / estimatedRowHeight) + overscan);

  const visibleRows = rows.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * estimatedRowHeight;
  const bottomSpacerHeight = Math.max(0, (rows.length - endIndex) * estimatedRowHeight);

  // Playback & Queue Actions
  const handlePlayAlbum = async (album: AlbumGroup, shuffle = false) => {
    if (album.tracks.length === 0) return;
    const sorted = sortAlbumTracks(album.tracks);
    const trackList = shuffle ? shuffleArray(sorted) : sorted;
    const firstTrack = trackList[0];
    const restTracks = trackList.slice(1);
    
    useStore.setState({ queue: restTracks, shuffle });
    
    try {
      await invoke('clear_queue');
      if (restTracks.length > 0) {
        const paths = restTracks
          .map(t => t.path || t.stream_url)
          .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
        if (paths.length > 0) {
          await invoke('add_to_queue_bulk', { paths });
        }
      }
    } catch (e) {
      console.error('Failed to sync queue:', e);
    }

    await playTrack(firstTrack);
  };

  const handlePlayTrackFromAlbum = async (clickedTrack: any) => {
    await playTrack(clickedTrack);
  };

  const handlePlayAlbumNext = async (album: AlbumGroup) => {
    for (let i = album.tracks.length - 1; i >= 0; i--) {
      await playNextInQueue(album.tracks[i]);
    }
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Queued "${album.title}" to play next`, type: 'info' } 
    }));
  };

  const handleAddAlbumToQueue = async (album: AlbumGroup) => {
    for (const tr of album.tracks) {
      await addToQueue(tr);
    }
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Added ${album.tracks.length} tracks from "${album.title}" to queue`, type: 'success' } 
    }));
  };

  const handleDeleteAlbum = async (album: AlbumGroup) => {
    if (window.confirm(`Are you sure you want to delete the entire album "${album.title}"? This will permanently delete all ${album.tracks.length} track files.`)) {
      setIsProcessing(album.id);
      try {
        for (const tr of album.tracks) {
          if (tr.path) {
            await invoke('delete_track', { path: tr.path });
          }
        }
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Deleted album "${album.title}"`, type: 'success' } }));
        if (selectedAlbum?.id === album.id) setSelectedAlbum(null);
        await useStore.getState().loadLibrary();
      } catch (err) {
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to delete album: ${err}`, type: 'error' } }));
      } finally {
        setIsProcessing(null);
      }
    }
  };

  const handleSonicMix = async (album: AlbumGroup) => {
    if (album.tracks.length === 0) return;
    setIsProcessing(album.id);
    try {
      const sample = album.tracks[0];
      const targetPath = sample.path || sample.stream_url;
      await startSonicMix(targetPath, useStore.getState(), album.title);
    } finally {
      setIsProcessing(null);
    }
  };

  const stableToggleLove = useStableCallback(toggleLoveAlbum);
  const stablePlayAlbum = useStableCallback(handlePlayAlbum);
  const stablePlayAlbumNext = useStableCallback(handlePlayAlbumNext);
  const stableAddToQueue = useStableCallback(handleAddAlbumToQueue);
  const stableSonicMix = useStableCallback(handleSonicMix);
  const stableDeleteAlbum = useStableCallback(handleDeleteAlbum);

  const handleApplyBatchEdit = async () => {
    if (!editAlbumModal) return;
    setIsProcessing(editAlbumModal.id);
    try {
      for (const t of editAlbumModal.tracks) {
        if (t.path) {
          await invoke('update_track_metadata', {
            path: t.path,
            title: t.title || '',
            artist: editArtist || t.artist || '',
            album: editTitle || t.album || ''
          });
        }
      }
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Album metadata updated!', type: 'success' } }));
      setEditAlbumModal(null);
      useStore.getState().loadLibrary();
    } catch (err) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Update failed: ${err}`, type: 'error' } }));
    } finally {
      setIsProcessing(null);
    }
  };

  return (
    <div ref={gridContainerRef} className="albums-grid-wrap album-view-classic" style={{ width: '100%' }} onContextMenu={event => {
      const path = (event.target as HTMLElement).closest<HTMLElement>('[data-track-path]')?.dataset.trackPath;
      const track = path ? tracks.find(track => track.path === path) : null;
      if (track) { event.preventDefault(); setTrackMenu({ track, anchor: { x: event.clientX, y: event.clientY } }); }
    }} onKeyDown={event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-track-path]');
      const track = row ? tracks.find(track => track.path === row.dataset.trackPath) : null;
      if (track && row) { event.preventDefault(); setTrackMenu({ track, anchor: row.getBoundingClientRect() }); }
    }}>
      {trackMenu && <TrackContextMenu track={trackMenu.track} anchor={trackMenu.anchor} onClose={() => setTrackMenu(null)} />}
      
      <div className="albums-toolbar" role="group" aria-label="Album filter">
        <button type="button" className="albums-filter" aria-pressed={!filterLovedOnly} onClick={() => setFilterLovedOnly(false)}>
          All albums <span className="albums-filter-count">{albumGroups.length}</span>
        </button>
        <button type="button" className="albums-filter" aria-pressed={filterLovedOnly} onClick={() => setFilterLovedOnly(true)}>
          <Heart size={13} aria-hidden="true" />
          Loved <span className="albums-filter-count">{lovedAlbumKeys.length}</span>
        </button>
      </div>

      {filteredAlbums.length === 0 ? (
        <div className="albums-empty" role="status">
          <Disc size={40} aria-hidden="true" />
          <span>
            {filterLovedOnly
              ? 'No loved albums bookmarked yet. Click the Heart icon on any album card to love it.'
              : (searchQuery ? `No albums found matching "${searchQuery}"` : 'No albums found in your library.')}
          </span>
        </div>
      ) : (
        /* ── MODE 1: CLASSIC WALL (Virtualized 2D Grid) ── */
        <div style={{ width: '100%', paddingBottom: 40 }}>
          {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
          {visibleRows.map((row, rowIdx) => {
            const actualRowIdx = startIndex + rowIdx;
            return (
              <div
                key={`row-${actualRowIdx}`}
                className="album-virtual-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  gap: 24,
                  marginBottom: 24,
                }}
              >
                {row.map((album) => {
                  const isLoved = lovedAlbumKeys.includes(album.id);
                  return (
                    <ClassicAlbumCard
                      key={album.id}
                      album={album}
                      isLoved={isLoved}
                      menuOpen={menuOpenFor === album.id}
                      casting={casting}
                      setMenuOpenFor={setMenuOpenFor}
                      setSelectedAlbum={setSelectedAlbum}
                      toggleLoveAlbum={stableToggleLove}
                      handlePlayAlbum={stablePlayAlbum}
                      handlePlayAlbumNext={stablePlayAlbumNext}
                      handleAddAlbumToQueue={stableAddToQueue}
                      setPlaylistModalTracks={setPlaylistModalTracks}
                      setCoverArtModalTrack={setCoverArtModalTrack}
                      handleSonicMix={stableSonicMix}
                      setEditAlbumModal={setEditAlbumModal}
                      setEditTitle={setEditTitle}
                      setEditArtist={setEditArtist}
                      handleDeleteAlbum={stableDeleteAlbum}
                      setSelectedArtist={setSelectedArtist}
                    />
                  );
                })}
                {row.length < columns &&
                  Array.from({ length: columns - row.length }).map((_, i) => (
                    <div key={`empty-${i}`} style={{ minWidth: 0 }} />
                  ))}
              </div>
            );
          })}
          {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
        </div>
      )}

      {/* Album detail drawer */}
      <AnimatePresence>
        {selectedAlbum && (
          <motion.div
            className="album-drawer-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedAlbum(null)}
          >
            <motion.div
              className="gatefold-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={`${selectedAlbum.title} by ${selectedAlbum.artist}`}
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 260 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="drawer-header"
                style={{ background: `linear-gradient(180deg, ${ambientColor} 0%, var(--drawer-header-fade) 100%)` }}
              >
                <button type="button" className="drawer-close" onClick={() => setSelectedAlbum(null)} aria-label="Close album" title="Close">
                  <X size={18} aria-hidden="true" />
                </button>

                <div className="drawer-art">
                  <AlbumThumbnail sampleTrack={selectedAlbum.sampleTrack} tracks={selectedAlbum.tracks} title="" loading="lazy" decoding="async" />
                </div>

                <div className="drawer-info">
                  <div className="drawer-title-row">
                    <h2 className="drawer-title">{selectedAlbum.title}</h2>
                    <button
                      type="button"
                      className={`drawer-heart${lovedAlbumKeys.includes(selectedAlbum.id) ? ' is-loved' : ''}`}
                      onClick={(e) => toggleLoveAlbum(selectedAlbum.id, e)}
                      aria-pressed={lovedAlbumKeys.includes(selectedAlbum.id)}
                      aria-label={lovedAlbumKeys.includes(selectedAlbum.id) ? 'Remove from loved albums' : 'Love album'}
                      title={lovedAlbumKeys.includes(selectedAlbum.id) ? 'Remove from loved albums' : 'Love album'}
                    >
                      <Heart size={16} fill={lovedAlbumKeys.includes(selectedAlbum.id) ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                  </div>

                  <button
                    type="button"
                    className="drawer-artist"
                    onClick={() => setSelectedArtist(selectedAlbum.artist)}
                    title={`View discography of ${selectedAlbum.artist}`}
                  >
                    {selectedAlbum.artist}
                  </button>

                  <dl className="gatefold-telemetry-grid">
                    <div className="gatefold-telemetry-item">
                      <dt className="gatefold-telemetry-label">Format</dt>
                      <dd className="gatefold-telemetry-value">{selectedAlbum.sampleTrack?.format || 'STEREO'}</dd>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <dt className="gatefold-telemetry-label">Quality</dt>
                      <dd className="gatefold-telemetry-value">
                        {formatAudioResolution(selectedAlbum.sampleTrack) || (isLosslessTrack(selectedAlbum.sampleTrack) ? 'Lossless · resolution unknown' : 'Resolution unknown')}
                      </dd>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <dt className="gatefold-telemetry-label">Year</dt>
                      <dd className="gatefold-telemetry-value">{extractAlbumYear(selectedAlbum) || 'Unknown'}</dd>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <dt className="gatefold-telemetry-label">Tracks</dt>
                      <dd className="gatefold-telemetry-value">{selectedAlbum.tracks.length}</dd>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <dt className="gatefold-telemetry-label">Duration</dt>
                      <dd className="gatefold-telemetry-value">{fmt(selectedAlbum.totalDuration)}</dd>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <dt className="gatefold-telemetry-label">Channels</dt>
                      <dd className="gatefold-telemetry-value">{formatChannels(selectedAlbum.sampleTrack)}</dd>
                    </div>
                  </dl>

                  <div className="drawer-actions">
                    <button type="button" className="btn btn-primary" autoFocus onClick={() => handlePlayAlbum(selectedAlbum, false)}>
                      <Play size={16} fill="currentColor" aria-hidden="true" />
                      Play album
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => handlePlayAlbum(selectedAlbum, true)}>
                      <Shuffle size={16} aria-hidden="true" />
                      Shuffle
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={casting}
                      onClick={() => void useStore.getState().playAlbumToEnd(selectedAlbum.tracks, selectedAlbum.title).catch(e => useStore.getState().setPlaybackError(String(e)))}
                    >
                      Play to end
                    </button>
                  </div>
                </div>
              </div>

              {/* Drawer Track List */}
              <div className="drawer-tracks">
                {(() => {
                  const discGroups = groupTracksByDisc(selectedAlbum.tracks);
                  const isMultiDisc = discGroups.length > 1;

                  if (isMultiDisc) {
                    return discGroups.map((group) => (
                      <div key={`disc-${group.disc}`} style={{ marginBottom: 20 }}>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 8, 
                          padding: '6px 12px', 
                          marginBottom: 8, 
                          background: 'var(--glass)', 
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--accent)'
                        }}>
                          <Disc size={14} />
                          <span>Disc {group.disc}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>({group.tracks.length} tracks)</span>
                        </div>
                        <AlbumTrackTable tracks={group.tracks} onPlay={handlePlayTrackFromAlbum} />
                      </div>
                    ));
                  }

                  return (
                    <AlbumTrackTable tracks={selectedAlbum.tracks} onPlay={handlePlayTrackFromAlbum} />
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Artist Discography Drawer */}
      <ArtistDiscographyDrawer
        artistName={selectedArtist}
        allTracks={tracks}
        onClose={() => setSelectedArtist(null)}
      />

      {/* Add Album to Playlist Modal */}
      <AnimatePresence>
        {playlistModalTracks && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPlaylistModalTracks(null)}
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
                <h2 style={{ margin: 0, fontSize: 20 }}>Add Album to Playlist</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '4px 0 0 0' }}>
                  Select a playlist to add all {playlistModalTracks.length} songs.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 250, overflowY: 'auto', marginBottom: 20 }}>
                {playlists.length === 0 ? (
                  <p style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                    No playlists created yet.
                  </p>
                ) : (
                  playlists.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={async () => {
                        for (const tr of playlistModalTracks) {
                          const targetPath = tr.path || tr.stream_url;
                          if (targetPath) {
                            await addToPlaylist(pl.id, targetPath);
                          }
                        }
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added ${playlistModalTracks.length} tracks to "${pl.name}"`, type: 'success' } }));
                        setPlaylistModalTracks(null);
                      }}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        background: 'var(--glass)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--text)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: 14,
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(var(--accent-rgb), 0.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
                    >
                      {pl.name}
                    </button>
                  ))
                )}
              </div>

              <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setPlaylistModalTracks(null)}>
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Edit Album Modal */}
      <AnimatePresence>
        {editAlbumModal && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setEditAlbumModal(null)}
          >
            <motion.div
              className="modal-content"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 450, width: '100%', padding: 24 }}
            >
              <h2 style={{ margin: '0 0 16px 0', fontSize: 20 }}>Edit Album Metadata</h2>
              
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Album Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    background: 'var(--glass)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--text)',
                    outline: 'none',
                    fontSize: 14,
                  }}
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Artist Name</label>
                <input
                  type="text"
                  value={editArtist}
                  onChange={(e) => setEditArtist(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    background: 'var(--glass)',
                    border: '1px solid var(--glass-border)',
                    color: 'var(--text)',
                    outline: 'none',
                    fontSize: 14,
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditAlbumModal(null)}>Cancel</button>
                <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={handleApplyBatchEdit}>Save Changes</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
