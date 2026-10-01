import React, { useState, useEffect, useMemo, useRef, memo } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { 
  Disc, Play, Shuffle, MoreVertical, Plus, Trash2, Activity, ListPlus, Edit3, Image, X, Heart, Tag,
  LayoutGrid, ChevronDown, Sparkles, Clock, Music, AlignJustify, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react';
import { extractDominantColor } from '../utils/colorExtractor';
import { fmt, isLosslessTrack, startSonicMix } from '../utils';
import { shuffleArray } from '../utils/shuffle';
import { ArtistDiscographyDrawer } from './ArtistDiscographyDrawer';
import { sortAlbumTracks, groupTracksByDisc, getTrackNumber, buildAlbumKey } from '../utils/albumUtils';
import { extractPrimaryArtist } from '../utils/unifiedSources';
import { AlbumThumbnail } from './AlbumThumbnail';
import { parseSearchQuery, foldSearchText, simplifyPunctuation } from '../utils/searchParser';
import { AlbumViewMode } from '../store/types';

export const ALBUM_VIEW_MODES: { id: AlbumViewMode; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'classic', label: 'Classic Wall', icon: <LayoutGrid size={14} />, desc: 'High-density virtualized 2D grid' },
  { id: 'compact', label: 'Compact Table', icon: <AlignJustify size={14} />, desc: 'Dense sortable table with inline expandable tracklists' },
  { id: 'editorial', label: 'Editorial Magazine', icon: <Sparkles size={14} />, desc: 'Visual storytelling with featured spotlight and shelves' },
];

// Backward compatibility alias for any external consumers
export const ALBUM_DESIGNS = ALBUM_VIEW_MODES;


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
  if (isLosslessTrack(sampleTrack)) {
    return '16-bit / 44.1kHz';
  }
  return null;
}

export function formatChannels(sampleTrack: any): string {
  const ch = sampleTrack?.channels || sampleTrack?.catalog_quality?.channels;
  if (ch === 1) return '1.0 Mono';
  if (ch === 2) return '2.0 Stereo';
  if (ch && ch > 2) return `${ch}.0 Surround`;
  return '2.0 Stereo';
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

/* ── Reusable Album Context Menu ── */
interface AlbumContextMenuProps {
  album: AlbumGroup;
  menuOpenFor: string | null;
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

function AlbumContextMenu({
  album,
  menuOpenFor,
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
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpenFor(menuOpenFor === album.id ? null : album.id);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: menuOpenFor === album.id ? 'white' : 'var(--text-dim)',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.2s, background 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#fff';
          e.currentTarget.style.background = 'var(--glass-h)';
        }}
        onMouseLeave={(e) => {
          if (menuOpenFor !== album.id) {
            e.currentTarget.style.color = 'var(--text-dim)';
            e.currentTarget.style.background = 'transparent';
          }
        }}
        title="Album Options"
        aria-label={`Options for ${album.title}`}
      >
        <MoreVertical size={16} />
      </button>

      <AnimatePresence>
        {menuOpenFor === album.id && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              zIndex: 1001,
              background: 'var(--toast-bg)',
              backdropFilter: 'blur(20px)',
              border: '1px solid var(--glass-border)',
              borderRadius: 12,
              padding: 6,
              minWidth: 200,
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              transformOrigin: 'top right',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handlePlayAlbum(album, false); }}
              style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text)', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Play size={14} />
              Play Album
            </div>

            <div
              onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handlePlayAlbumNext(album); }}
              style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text)', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <ListPlus size={14} />
              Play Album Next
            </div>

            <div
              onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handleAddAlbumToQueue(album); }}
              style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text)', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Plus size={14} />
              Add Album to Queue
            </div>

            <div
              onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); setPlaylistModalTracks(album.tracks); }}
              style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text)', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Plus size={14} />
              Add to Playlist...
            </div>

            <div style={{ height: 1, background: 'var(--glass-border)', margin: '4px 4px' }} />

            <div
              onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); setCoverArtModalTrack(album.sampleTrack); }}
              style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text)', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Image size={14} />
              Manage Cover Art
            </div>

            <div
              onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handleSonicMix(album); }}
              style={{ padding: '8px 12px', fontSize: 13, color: '#10b981', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Activity size={14} style={{ color: '#10b981' }} />
              Sonic Mix
            </div>

            <div
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpenFor(null);
                useStore.getState().setTagEditorBatchTracks(album.tracks);
              }}
              style={{ padding: '8px 12px', fontSize: 13, color: 'var(--accent)', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Tag size={14} />
              Batch Edit Audio Tags
            </div>

            <div
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpenFor(null);
                setEditAlbumModal(album);
                setEditTitle(album.title);
                setEditArtist(album.artist);
              }}
              style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text)', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--glass-h)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Edit3 size={14} />
              Edit Album Data
            </div>

            <div style={{ height: 1, background: 'var(--glass-border)', margin: '4px 4px' }} />

            <div
              onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); handleDeleteAlbum(album); }}
              style={{ padding: '8px 12px', fontSize: 13, color: '#ef4444', cursor: 'pointer', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <Trash2 size={14} color="#ef4444" />
              Delete Album
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Mode 1: Classic Wall Card ── */
interface CardCommonProps {
  album: AlbumGroup;
  isLoved: boolean;
  menuOpenFor: string | null;
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
  menuOpenFor,
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
  const formatText = isLossless ? 'HI-RES' : (album.sampleTrack?.format || 'STEREO');

  return (
    <div
      className="album-card album-card-classic"
      onClick={() => setSelectedAlbum(album)}
      style={{ zIndex: menuOpenFor === album.id ? 1000 : 1 }}
    >
      <div className="classic-card-art-wrap">
        <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} loading="lazy" decoding="async" />

        {/* Loved Heart Toggle Button on Top-Left */}
        <button
          type="button"
          onClick={(e) => toggleLoveAlbum(album.id, e)}
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '50%',
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isLoved ? '#ef4444' : 'var(--text-dim)',
            cursor: 'pointer',
            zIndex: 3,
            transition: 'background 0.2s',
          }}
          title={isLoved ? 'Remove from Loved Albums' : 'Love Album'}
          aria-label={isLoved ? 'Remove from Loved Albums' : 'Love Album'}
        >
          <Heart size={14} fill={isLoved ? '#ef4444' : 'none'} color={isLoved ? '#ef4444' : 'white'} />
        </button>

        {/* Format chip on Top-Right */}
        <div
          className="classic-format-chip"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 8,
            padding: '2px 7px',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'ui-monospace, monospace',
            color: isLossless ? '#6ee7b7' : '#cbd5e1',
            zIndex: 3,
          }}
        >
          {formatText}
        </div>

        {/* Quick Play Button Overlay on Bottom-Right */}
        <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 3 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePlayAlbum(album, false);
            }}
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: 'var(--accent)',
              border: 'none',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 6px 16px rgba(0, 0, 0, 0.5)',
            }}
            title="Play Album"
            aria-label={`Play ${album.title}`}
          >
            <Play size={18} fill="white" style={{ marginLeft: 2 }} />
          </button>
        </div>
      </div>

      <div className="classic-card-title" title={album.title}>
        {album.title}
      </div>

      <div
        className="classic-card-artist"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedArtist(album.artist);
        }}
        title={`View discography of ${album.artist}`}
      >
        {album.artist}
      </div>

      <div className="classic-card-footer">
        <span>{album.tracks.length} {album.tracks.length === 1 ? 'track' : 'tracks'} • {fmt(album.totalDuration)}</span>
        <AlbumContextMenu
          album={album}
          menuOpenFor={menuOpenFor}
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

/* ── Mode 2: Compact Table with Inline Accordion ── */
interface CompactTableViewProps {
  albums: AlbumGroup[];
  lovedAlbumKeys: string[];
  toggleLoveAlbum: (id: string, e?: React.MouseEvent) => void;
  handlePlayAlbum: (album: AlbumGroup, shuffle?: boolean) => void;
  handlePlayAlbumNext: (album: AlbumGroup) => void;
  handleAddAlbumToQueue: (album: AlbumGroup) => void;
  handlePlayTrackFromAlbum: (track: any) => void;
  setSelectedAlbum: (album: AlbumGroup) => void;
  setSelectedArtist: (artist: string) => void;
  menuOpenFor: string | null;
  setMenuOpenFor: (id: string | null) => void;
  setPlaylistModalTracks: (tracks: any[]) => void;
  setCoverArtModalTrack: (track: any) => void;
  handleSonicMix: (album: AlbumGroup) => void;
  setEditAlbumModal: (album: AlbumGroup) => void;
  setEditTitle: (title: string) => void;
  setEditArtist: (artist: string) => void;
  handleDeleteAlbum: (album: AlbumGroup) => void;
  currentTrack?: any;
  isPlaying?: boolean;
}

type CompactSortKey = 'title' | 'artist' | 'year' | 'tracks' | 'duration';

const CompactTableView = memo(function CompactTableView({
  albums,
  lovedAlbumKeys,
  toggleLoveAlbum,
  handlePlayAlbum,
  handlePlayAlbumNext,
  handleAddAlbumToQueue,
  handlePlayTrackFromAlbum,
  setSelectedAlbum,
  setSelectedArtist,
  menuOpenFor,
  setMenuOpenFor,
  setPlaylistModalTracks,
  setCoverArtModalTrack,
  handleSonicMix,
  setEditAlbumModal,
  setEditTitle,
  setEditArtist,
  handleDeleteAlbum,
  currentTrack,
  isPlaying,
}: CompactTableViewProps) {
  const [sortKey, setSortKey] = useState<CompactSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleHeaderSort = (key: CompactSortKey) => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'year' || key === 'tracks' || key === 'duration' ? 'desc' : 'asc');
    }
  };

  const sortedAlbums = useMemo(() => {
    if (!sortKey) return albums;
    return [...albums].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'title') {
        cmp = a.title.localeCompare(b.title);
      } else if (sortKey === 'artist') {
        cmp = a.artist.localeCompare(b.artist);
      } else if (sortKey === 'year') {
        const yA = extractAlbumYear(a) || 0;
        const yB = extractAlbumYear(b) || 0;
        cmp = yA - yB;
      } else if (sortKey === 'tracks') {
        cmp = a.tracks.length - b.tracks.length;
      } else if (sortKey === 'duration') {
        cmp = a.totalDuration - b.totalDuration;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [albums, sortKey, sortDir]);

  const renderSortIndicator = (key: CompactSortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown size={12} style={{ opacity: 0.35, marginLeft: 4 }} />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp size={12} style={{ color: 'var(--accent)', marginLeft: 4 }} />
    ) : (
      <ArrowDown size={12} style={{ color: 'var(--accent)', marginLeft: 4 }} />
    );
  };

  return (
    <div className="compact-table-container">
      <table className="compact-table">
        <thead>
          <tr>
            <th style={{ width: 56, textAlign: 'center' }}>Cover</th>
            <th className="compact-th-sortable" onClick={() => handleHeaderSort('title')}>
              <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                Album Title {renderSortIndicator('title')}
              </div>
            </th>
            <th className="compact-th-sortable" style={{ width: '22%' }} onClick={() => handleHeaderSort('artist')}>
              <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                Artist {renderSortIndicator('artist')}
              </div>
            </th>
            <th className="compact-th-sortable" style={{ width: 90, textAlign: 'right' }} onClick={() => handleHeaderSort('year')}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', width: '100%' }}>
                Year {renderSortIndicator('year')}
              </div>
            </th>
            <th className="compact-th-sortable" style={{ width: 90, textAlign: 'right' }} onClick={() => handleHeaderSort('tracks')}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', width: '100%' }}>
                Tracks {renderSortIndicator('tracks')}
              </div>
            </th>
            <th className="compact-th-sortable" style={{ width: 100, textAlign: 'right' }} onClick={() => handleHeaderSort('duration')}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', width: '100%' }}>
                Duration {renderSortIndicator('duration')}
              </div>
            </th>
            <th style={{ width: 100, textAlign: 'center' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sortedAlbums.map((album) => {
            const isExpanded = Boolean(expandedIds[album.id]);
            const isLoved = lovedAlbumKeys.includes(album.id);
            const year = extractAlbumYear(album);
            const isLossless = isLosslessTrack(album.sampleTrack);
            const discGroups = groupTracksByDisc(album.tracks);
            const resolution = formatAudioResolution(album.sampleTrack);

            return (
              <React.Fragment key={`compact-${album.id}`}>
                <tr
                  className={`compact-table-row ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => toggleExpand(album.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpand(album.id);
                    }
                  }}
                  role="button"
                  aria-expanded={isExpanded}
                >
                  <td style={{ textAlign: 'center' }}>
                    <div className="compact-cover-wrap">
                      <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} loading="lazy" decoding="async" />
                      <div
                        className="compact-play-overlay"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayAlbum(album, false);
                        }}
                        title={`Play ${album.title}`}
                      >
                        <Play size={16} fill="white" color="white" />
                      </div>
                    </div>
                  </td>

                  <td>
                    <div className="compact-album-title" title={album.title}>
                      {album.title}
                    </div>
                  </td>

                  <td>
                    <div
                      className="compact-album-artist"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedArtist(album.artist);
                      }}
                      title={`View discography of ${album.artist}`}
                    >
                      {album.artist}
                    </div>
                  </td>

                  <td style={{ textAlign: 'right' }}>
                    {year ? <span className="compact-pill">{year}</span> : <span style={{ color: 'var(--text-dim)' }}>-</span>}
                  </td>

                  <td style={{ textAlign: 'right' }}>
                    <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                      {album.tracks.length}
                    </span>
                  </td>

                  <td style={{ textAlign: 'right' }}>
                    <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                      {fmt(album.totalDuration)}
                    </span>
                  </td>

                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={(e) => toggleLoveAlbum(album.id, e)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: isLoved ? '#ef4444' : 'var(--text-dim)',
                        }}
                        title={isLoved ? 'Remove from Loved Albums' : 'Love Album'}
                        aria-label={isLoved ? 'Remove from Loved Albums' : 'Love Album'}
                      >
                        <Heart size={15} fill={isLoved ? '#ef4444' : 'none'} color={isLoved ? '#ef4444' : 'currentColor'} />
                      </button>

                      <AlbumContextMenu
                        album={album}
                        menuOpenFor={menuOpenFor}
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

                      <button
                        type="button"
                        onClick={() => toggleExpand(album.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--text-dim)',
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                        }}
                        title={isExpanded ? 'Collapse Tracklist' : 'Expand Tracklist'}
                        aria-label={isExpanded ? 'Collapse Tracklist' : 'Expand Tracklist'}
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                  </td>
                </tr>

                {isExpanded && (
                  <tr className="compact-accordion-row">
                    <td colSpan={7}>
                      <div className="compact-accordion-drawer">
                        {/* Left column: Cover + format info + Play/Shuffle */}
                        <div className="compact-accordion-left">
                          <div className="compact-accordion-cover" onClick={() => setSelectedAlbum(album)} style={{ cursor: 'pointer' }}>
                            <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} loading="lazy" decoding="async" />
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {isLossless && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#6ee7b7', fontFamily: 'ui-monospace, monospace' }}>
                                LOSSLESS
                              </span>
                            )}
                            {resolution && (
                              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'ui-monospace, monospace' }}>
                                {resolution}
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                            <button
                              type="button"
                              onClick={() => handlePlayAlbum(album, false)}
                              style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: 'var(--accent)',
                                border: 'none',
                                color: 'white',
                                fontSize: 12,
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                cursor: 'pointer',
                              }}
                            >
                              <Play size={14} fill="white" />
                              Play All
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePlayAlbum(album, true)}
                              style={{
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                color: 'var(--text)',
                                fontSize: 12,
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                cursor: 'pointer',
                              }}
                            >
                              <Shuffle size={14} />
                              Shuffle
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedAlbum(album)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: 8,
                                background: 'transparent',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                color: 'var(--text-dim)',
                                fontSize: 11,
                                fontWeight: 500,
                                cursor: 'pointer',
                                marginTop: 2,
                              }}
                            >
                              View Gatefold
                            </button>
                          </div>
                        </div>

                        {/* Right column: Interactive Tracklist */}
                        <div className="compact-accordion-right">
                          <div className="compact-track-list">
                            {discGroups.map(({ disc, tracks: discTracks }) => (
                              <div key={`disc-${disc}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {discGroups.length > 1 && (
                                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.8, padding: '4px 8px' }}>
                                    Disc {disc}
                                  </div>
                                )}
                                  {discTracks.map((t: any, idx: number) => {
                                    const isCurrent = Boolean(
                                      currentTrack && (currentTrack.id === t.id || (t.path && currentTrack.path === t.path))
                                    );
                                    const trackNum = getTrackNumber(t) || idx + 1;

                                    return (
                                      <div
                                        key={t.id || t.path || idx}
                                        className={`compact-track-item ${isCurrent ? 'playing' : ''}`}
                                        onClick={() => handlePlayTrackFromAlbum(t)}
                                        onDoubleClick={() => handlePlayTrackFromAlbum(t)}
                                        title="Click or double-click to play"
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                                          <span style={{ width: 22, textAlign: 'right', fontSize: 11, color: isCurrent ? 'var(--accent)' : 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                                            {isCurrent && isPlaying ? <Activity size={12} color="var(--accent)" /> : trackNum}
                                          </span>
                                          <span style={{ fontWeight: isCurrent ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {t.title || 'Untitled Track'}
                                          </span>
                                          {t.artist && t.artist !== album.artist && (
                                            <span style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              • {t.artist}
                                            </span>
                                          )}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                                          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace' }}>
                                            {fmt(t.duration)}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              useStore.getState().addToQueue(t);
                                              window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added "${t.title}" to queue`, type: 'success' } }));
                                            }}
                                            style={{
                                              background: 'none',
                                              border: 'none',
                                              cursor: 'pointer',
                                              padding: 4,
                                              color: 'var(--text-dim)',
                                              display: 'flex',
                                              alignItems: 'center',
                                            }}
                                            title="Add to queue"
                                          >
                                            <ListPlus size={13} />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

/* ── Mode 3: Editorial Album Card ── */
const EditorialAlbumCard = memo(function EditorialAlbumCard({
  album,
  isLoved,
  menuOpenFor,
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
  const year = extractAlbumYear(album);
  const isLossless = isLosslessTrack(album.sampleTrack);

  return (
    <div
      className="editorial-card"
      onClick={() => setSelectedAlbum(album)}
      style={{ zIndex: menuOpenFor === album.id ? 1000 : 1 }}
    >
      <div className="classic-card-art-wrap">
        <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} loading="lazy" decoding="async" />

        <button
          type="button"
          onClick={(e) => toggleLoveAlbum(album.id, e)}
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '50%',
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isLoved ? '#ef4444' : 'var(--text-dim)',
            cursor: 'pointer',
            zIndex: 3,
          }}
          title={isLoved ? 'Remove from Loved Albums' : 'Love Album'}
          aria-label={isLoved ? 'Remove from Loved Albums' : 'Love Album'}
        >
          <Heart size={14} fill={isLoved ? '#ef4444' : 'none'} color={isLoved ? '#ef4444' : 'white'} />
        </button>

        <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 3 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePlayAlbum(album, false);
            }}
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: '#f59e0b',
              border: 'none',
              color: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 6px 16px rgba(0, 0, 0, 0.5)',
            }}
            title="Play Album"
            aria-label={`Play ${album.title}`}
          >
            <Play size={18} fill="#111" style={{ marginLeft: 2 }} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <div className="editorial-card-title" title={album.title}>
          {album.title}
        </div>
        <AlbumContextMenu
          album={album}
          menuOpenFor={menuOpenFor}
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

      <div
        className="editorial-card-artist"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedArtist(album.artist);
        }}
        title={`View discography of ${album.artist}`}
      >
        {album.artist}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', paddingTop: 4 }}>
        <span>{album.tracks.length} tracks • {fmt(album.totalDuration)}</span>
        {isLossless && <span style={{ color: '#6ee7b7', fontWeight: 600, fontSize: 10 }}>LOSSLESS</span>}
        {year && <span>{year}</span>}
      </div>
    </div>
  );
});


/* ── Hero Spotlight Component for Editorial Magazine ── */
function HeroSpotlight({
  album,
  isLoved,
  toggleLoveAlbum,
  handlePlayAlbum,
  handlePlayTrackFromAlbum,
  setSelectedAlbum,
  setSelectedArtist,
}: {
  album: AlbumGroup;
  isLoved: boolean;
  toggleLoveAlbum: (id: string, e: React.MouseEvent) => void;
  handlePlayAlbum: (album: AlbumGroup, shuffle?: boolean) => void;
  handlePlayTrackFromAlbum: (track: any) => void;
  setSelectedAlbum: (album: AlbumGroup) => void;
  setSelectedArtist: (artist: string) => void;
}) {
  const isLossless = isLosslessTrack(album.sampleTrack);
  const year = extractAlbumYear(album);
  const previewTracks = album.tracks.slice(0, 3);

  return (
    <div className="studio-hero-spotlight">
      <div className="hero-cover-wrap" onClick={() => setSelectedAlbum(album)} style={{ cursor: 'pointer' }}>
        <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} loading="lazy" decoding="async" />
      </div>

      <div className="hero-content">
        <div>
          <div className="hero-eyebrow">
            <span className="hero-badge-spotlight">Editorial Spotlight</span>
            {isLossless && <span className="hero-badge-telemetry hero-badge-lossless">HI-RES LOSSLESS</span>}
            <span className="hero-badge-telemetry">{album.sampleTrack?.format || 'STEREO'}</span>
            <span className="hero-badge-telemetry">
              <Clock size={10} style={{ marginRight: 2 }} />
              {fmt(album.totalDuration)}
            </span>
            <span className="hero-badge-telemetry">
              <Music size={10} style={{ marginRight: 2 }} />
              {album.tracks.length} tracks
            </span>
            {year && <span className="hero-badge-telemetry">{year}</span>}
          </div>

          <h1 className="hero-title" onClick={() => setSelectedAlbum(album)} style={{ cursor: 'pointer', marginTop: 8 }} title={album.title}>
            {album.title}
          </h1>

          <div
            className="hero-artist"
            onClick={() => setSelectedArtist(album.artist)}
            title={`View discography of ${album.artist}`}
          >
            {album.artist}
          </div>
        </div>

        {/* Sneak peek 3 tracks */}
        {previewTracks.length > 0 && (
          <div className="hero-sneak-peek">
            <div className="sneak-peek-header">
              <span>Track Highlights</span>
              <span>Duration</span>
            </div>
            {previewTracks.map((t, idx) => (
              <div
                key={t.id || t.path || idx}
                className="sneak-peek-track"
                onClick={() => handlePlayTrackFromAlbum(t)}
                title="Play track"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: 11, width: 16 }}>{idx + 1}</span>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title || 'Untitled Track'}
                  </span>
                </div>
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{fmt(t.duration)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handlePlayAlbum(album, false)}
            style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 20 }}
          >
            <Play size={16} fill="white" />
            Play Album
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handlePlayAlbum(album, true)}
            style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 20 }}
          >
            <Shuffle size={16} />
            Shuffle
          </button>
          <button
            type="button"
            onClick={(e) => toggleLoveAlbum(album.id, e)}
            style={{
              padding: '10px 14px',
              borderRadius: 20,
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: isLoved ? '#ef4444' : 'var(--text-dim)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
            }}
            title={isLoved ? 'Remove from Loved Albums' : 'Love Album'}
          >
            <Heart size={15} fill={isLoved ? '#ef4444' : 'none'} color={isLoved ? '#ef4444' : 'currentColor'} />
            <span>{isLoved ? 'Loved' : 'Love'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedAlbum(album)}
            style={{
              padding: '10px 16px',
              borderRadius: 20,
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
            title="Inspect Album in Gatefold Drawer"
          >
            View Gatefold
          </button>
        </div>
      </div>
    </div>
  );
}

interface AlbumsViewProps {
  tracks?: any[];
  searchQuery?: string;
  sortBy?: 'title' | 'artist' | 'count' | 'recent';
  onAlbumCountChange?: (count: number) => void;
  albumViewMode?: AlbumViewMode;
  albumDesign?: string; // legacy fallback
  layoutMode?: string; // legacy fallback
}

export function AlbumsView({ 
  tracks: customTracks, 
  searchQuery = '', 
  sortBy = 'title',
  onAlbumCountChange,
  albumViewMode: customAlbumViewMode,
  albumDesign: customAlbumDesign,
  layoutMode: customLayoutMode,
}: AlbumsViewProps = {}) {
  const storeTracks = useStore((s) => s.tracks);
  const tracks = customTracks || storeTracks;
  const storeAlbumViewMode = useStore((s) => s.albumViewMode);
  const setStoreAlbumViewMode = useStore((s) => s.setAlbumViewMode);

  // Determine effective view mode with full fallback support
  const effectiveViewMode: AlbumViewMode = useMemo(() => {
    if (customAlbumViewMode) {
      if ((customAlbumViewMode as any) === 'audiophile') return 'compact';
      return customAlbumViewMode;
    }
    if (customLayoutMode === 'gallery') return 'editorial';
    if (customLayoutMode === 'classic') return 'classic';
    if (customAlbumDesign === 'studio' || (customAlbumDesign as any) === 'audiophile') return 'compact';
    if (customAlbumDesign === 'vinyl' || customAlbumDesign === 'ambient' || customAlbumDesign === 'crate' || customAlbumDesign === 'brutalist') return 'classic';
    if ((storeAlbumViewMode as any) === 'audiophile') return 'compact';
    return storeAlbumViewMode || 'classic';
  }, [customAlbumViewMode, customLayoutMode, customAlbumDesign, storeAlbumViewMode]);

  const handleViewModeChange = (mode: AlbumViewMode) => {
    setStoreAlbumViewMode(mode);
    try {
      localStorage.setItem('aideo-album-view-mode', mode);
    } catch (_) {}
  };

  const { 
    playTrack, addToQueue, playNextInQueue, playlists, addToPlaylist,
    setCoverArtModalTrack, currentTrack
  } = useStore(useShallow(s => ({
    playTrack: s.playTrack,
    addToQueue: s.addToQueue,
    playNextInQueue: s.playNextInQueue,
    playlists: s.playlists,
    addToPlaylist: s.addToPlaylist,
    setCoverArtModalTrack: s.setCoverArtModalTrack,
    currentTrack: s.currentTrack,
  })));
  const playbackStatus = useStore(s => (s.playback as any)?.status || (s as any).playbackStatus);
  const isPlaying = playbackStatus === 'Playing';

  const [selectedAlbum, setSelectedAlbum] = useState<AlbumGroup | null>(null);
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

  // Featured Album & Curations for Editorial Magazine
  const featuredAlbum = useMemo(() => {
    if (filteredAlbums.length === 0) return null;
    const loved = filteredAlbums.find((a) => lovedAlbumKeys.includes(a.id));
    if (loved) return loved;
    const hiRes = filteredAlbums.find((a) => isLosslessTrack(a.sampleTrack));
    if (hiRes) return hiRes;
    return filteredAlbums[0];
  }, [filteredAlbums, lovedAlbumKeys]);

  const curatedLovedAlbums = useMemo(() => {
    return filteredAlbums.filter((a) => lovedAlbumKeys.includes(a.id));
  }, [filteredAlbums, lovedAlbumKeys]);

  const curatedHiResAlbums = useMemo(() => {
    return filteredAlbums.filter((a) => isLosslessTrack(a.sampleTrack));
  }, [filteredAlbums]);

  // Notify parent of total album count
  useEffect(() => {
    if (onAlbumCountChange) {
      onAlbumCountChange(filteredAlbums.length);
    }
  }, [filteredAlbums.length, onAlbumCountChange]);

  // 2D Grid Virtualization for Classic Wall
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  const [scrollTop, setScrollTop] = useState(0);
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
          setScrollTop(window.scrollY);
          setViewportHeight(window.innerHeight);
        } else if (scrollParent) {
          setScrollTop(scrollParent.scrollTop);
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
        setScrollTop(scrollParent.scrollTop);
      }
    }
  }, [filteredAlbums.length]);

  const columns = Math.max(1, Math.floor((containerWidth + 24) / 224));
  const cardWidth = Math.max(160, (containerWidth - (columns - 1) * 24) / columns);
  const estimatedRowHeight = Math.round(cardWidth + 104);

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
    <div ref={gridContainerRef} className={`albums-grid-wrap album-view-${effectiveViewMode}`} style={{ width: '100%' }}>
      
      {/* Header Segmented Toggle: [ Classic Wall | Audiophile Vault | Editorial Magazine ] */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="album-view-mode-toggle">
            {ALBUM_VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`album-view-mode-btn ${effectiveViewMode === mode.id ? 'active' : ''}`}
                onClick={() => handleViewModeChange(mode.id)}
                title={mode.desc}
              >
                {mode.icon}
                <span>{mode.label}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setFilterLovedOnly(false)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 16,
              border: 'none',
              background: !filterLovedOnly ? 'rgba(var(--accent-rgb), 0.15)' : 'transparent',
              color: !filterLovedOnly ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'background 0.2s, color 0.2s',
            }}
          >
            All Albums ({albumGroups.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterLovedOnly(true)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 16,
              border: 'none',
              background: filterLovedOnly ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
              color: filterLovedOnly ? '#ef4444' : 'var(--text-dim)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'background 0.2s, color 0.2s',
            }}
          >
            <Heart size={13} fill={filterLovedOnly ? '#ef4444' : 'none'} color={filterLovedOnly ? '#ef4444' : 'var(--text-dim)'} />
            Loved Albums ({lovedAlbumKeys.length})
          </button>
        </div>
      </div>

      {/* Main Albums Content across 3 Distinct Experiences */}
      {filteredAlbums.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, gap: 16, color: 'var(--text-dim)' }}>
          <Disc size={48} style={{ opacity: 0.3 }} />
          <span>
            {filterLovedOnly
              ? 'No loved albums bookmarked yet. Click the Heart icon on any album card to love it.'
              : (searchQuery ? `No albums found matching "${searchQuery}"` : 'No albums found in your library.')}
          </span>
        </div>
      ) : effectiveViewMode === 'compact' ? (
        /* ── MODE 2: COMPACT TABLE WITH INLINE ACCORDION ── */
        <CompactTableView
          albums={filteredAlbums}
          lovedAlbumKeys={lovedAlbumKeys}
          toggleLoveAlbum={toggleLoveAlbum}
          handlePlayAlbum={handlePlayAlbum}
          handlePlayAlbumNext={handlePlayAlbumNext}
          handleAddAlbumToQueue={handleAddAlbumToQueue}
          handlePlayTrackFromAlbum={handlePlayTrackFromAlbum}
          setSelectedAlbum={setSelectedAlbum}
          setSelectedArtist={setSelectedArtist}
          menuOpenFor={menuOpenFor}
          setMenuOpenFor={setMenuOpenFor}
          setPlaylistModalTracks={setPlaylistModalTracks}
          setCoverArtModalTrack={setCoverArtModalTrack}
          handleSonicMix={handleSonicMix}
          setEditAlbumModal={setEditAlbumModal}
          setEditTitle={setEditTitle}
          setEditArtist={setEditArtist}
          handleDeleteAlbum={handleDeleteAlbum}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
        />
      ) : effectiveViewMode === 'editorial' ? (
        /* ── MODE 3: EDITORIAL MAGAZINE ── */
        <div className="editorial-magazine-container">
          {/* 1. Hero Spotlight */}
          {featuredAlbum && (
            <HeroSpotlight
              album={featuredAlbum}
              isLoved={lovedAlbumKeys.includes(featuredAlbum.id)}
              toggleLoveAlbum={toggleLoveAlbum}
              handlePlayAlbum={handlePlayAlbum}
              handlePlayTrackFromAlbum={handlePlayTrackFromAlbum}
              setSelectedAlbum={setSelectedAlbum}
              setSelectedArtist={setSelectedArtist}
            />
          )}

          {/* 2. Curated Shelves: Loved & Heavy Rotation */}
          {curatedLovedAlbums.length > 0 && (
            <div className="studio-shelf-section">
              <div className="studio-shelf-header">
                <div className="studio-shelf-title-group">
                  <Heart size={16} fill="#ef4444" color="#ef4444" />
                  <h3 className="studio-shelf-title">Loved & Heavy Rotation</h3>
                </div>
                <span className="studio-shelf-subtitle">{curatedLovedAlbums.length} {curatedLovedAlbums.length === 1 ? 'album' : 'albums'}</span>
              </div>
              <div className="studio-shelf-scroll-row">
                {curatedLovedAlbums.map(album => (
                  <div key={`loved-shelf-${album.id}`} className="studio-shelf-card" onClick={() => setSelectedAlbum(album)}>
                    <div className="shelf-card-art-wrap">
                      <div className="shelf-card-art-inner">
                        <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} loading="lazy" decoding="async" />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayAlbum(album, false);
                        }}
                        style={{
                          position: 'absolute',
                          bottom: 8,
                          right: 8,
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          background: 'var(--accent)',
                          border: 'none',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        }}
                        title="Play Album"
                        aria-label={`Play ${album.title}`}
                      >
                        <Play size={16} fill="white" style={{ marginLeft: 2 }} />
                      </button>
                    </div>
                    <div className="shelf-card-info">
                      <div className="shelf-card-title" title={album.title}>{album.title}</div>
                      <div className="shelf-card-artist" title={album.artist}>{album.artist}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Curated Shelves: Audiophile & Hi-Res Masters */}
          {curatedHiResAlbums.length > 0 && (
            <div className="studio-shelf-section">
              <div className="studio-shelf-header">
                <div className="studio-shelf-title-group">
                  <Sparkles size={16} color="#38bdf8" />
                  <h3 className="studio-shelf-title">Audiophile & Hi-Res Masters</h3>
                </div>
                <span className="studio-shelf-subtitle">Lossless studio recordings ({curatedHiResAlbums.length})</span>
              </div>
              <div className="studio-shelf-scroll-row">
                {curatedHiResAlbums.map(album => (
                  <div key={`hires-shelf-${album.id}`} className="studio-shelf-card" onClick={() => setSelectedAlbum(album)}>
                    <div className="shelf-card-art-wrap">
                      <div className="shelf-card-art-inner">
                        <AlbumThumbnail sampleTrack={album.sampleTrack} title={album.title} loading="lazy" decoding="async" />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayAlbum(album, false);
                        }}
                        style={{
                          position: 'absolute',
                          bottom: 8,
                          right: 8,
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          background: '#38bdf8',
                          border: 'none',
                          color: '#090d16',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        }}
                        title="Play Album"
                        aria-label={`Play ${album.title}`}
                      >
                        <Play size={16} fill="#090d16" style={{ marginLeft: 2 }} />
                      </button>
                    </div>
                    <div className="shelf-card-info">
                      <div className="shelf-card-title" title={album.title}>{album.title}</div>
                      <div className="shelf-card-artist" title={album.artist}>{album.artist}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Spacious Editorial Catalog Grid */}
          <div className="editorial-catalog-section">
            <div className="editorial-catalog-header">
              <h3 className="editorial-catalog-title">Editorial Catalog</h3>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{filteredAlbums.length} {filteredAlbums.length === 1 ? 'album' : 'albums'}</span>
            </div>
            <div className="editorial-catalog-grid">
              {filteredAlbums.map(album => (
                <EditorialAlbumCard
                  key={`editorial-${album.id}`}
                  album={album}
                  isLoved={lovedAlbumKeys.includes(album.id)}
                  menuOpenFor={menuOpenFor}
                  setMenuOpenFor={setMenuOpenFor}
                  setSelectedAlbum={setSelectedAlbum}
                  toggleLoveAlbum={toggleLoveAlbum}
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
                  setSelectedArtist={setSelectedArtist}
                />
              ))}
            </div>
          </div>
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
                      menuOpenFor={menuOpenFor}
                      setMenuOpenFor={setMenuOpenFor}
                      setSelectedAlbum={setSelectedAlbum}
                      toggleLoveAlbum={toggleLoveAlbum}
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

      {/* Album Detail Drawer with Dynamic Ambient Backdrop & Gatefold Telemetry */}
      <AnimatePresence>
        {selectedAlbum && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedAlbum(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(16px)',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              onClick={(e) => e.stopPropagation()}
              className="gatefold-drawer"
              style={{
                width: '100%',
                maxWidth: 640,
                height: '100%',
                background: 'var(--drawer-bg)',
                borderLeft: '1px solid var(--glass-border)',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: 'var(--shadow-drawer)',
              }}
            >
              {/* Drawer Header with Dynamic Ambient Tint */}
              <div 
                className="drawer-header"
                style={{ 
                  padding: 24, 
                  borderBottom: '1px solid var(--glass-border)', 
                  display: 'flex', 
                  gap: 20, 
                  position: 'relative',
                  background: `linear-gradient(180deg, ${ambientColor} 0%, var(--drawer-header-fade) 100%)`,
                  transition: 'background 0.5s ease',
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedAlbum(null)}
                  style={{
                    position: 'absolute',
                    top: 20,
                    right: 20,
                    background: 'var(--glass-h)',
                    border: 'none',
                    borderRadius: '50%',
                    width: 32,
                    height: 32,
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Close Drawer"
                  aria-label="Close Drawer"
                >
                  <X size={18} />
                </button>

                <div style={{ width: 130, height: 130, borderRadius: 10, overflow: 'hidden', flexShrink: 0, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <AlbumThumbnail sampleTrack={selectedAlbum.sampleTrack} title={selectedAlbum.title} loading="lazy" decoding="async" />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, flex: 1, paddingRight: 40 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ 
                      fontSize: 10, 
                      fontWeight: 700, 
                      letterSpacing: 1, 
                      textTransform: 'uppercase', 
                      color: 'var(--accent)',
                      fontFamily: 'ui-monospace, monospace'
                    }}>
                      GATEFOLD AUDIOPHILE ARCHIVE
                    </span>
                    <button
                      type="button"
                      onClick={(e) => toggleLoveAlbum(selectedAlbum.id, e)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
                      title="Love Album"
                      aria-label="Love Album"
                    >
                      <Heart size={14} fill={lovedAlbumKeys.includes(selectedAlbum.id) ? '#ef4444' : 'none'} color={lovedAlbumKeys.includes(selectedAlbum.id) ? '#ef4444' : 'var(--text-dim)'} />
                    </button>
                  </div>

                  <h2 className="drawer-title" style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>{selectedAlbum.title}</h2>
                  
                  {/* Clickable Artist Name */}
                  <div 
                    className="drawer-artist"
                    onClick={() => setSelectedArtist(selectedAlbum.artist)}
                    style={{ fontSize: 14, color: 'var(--text-dim)', cursor: 'pointer', transition: 'color 0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                    title={`View discography of ${selectedAlbum.artist}`}
                  >
                    {selectedAlbum.artist}
                  </div>

                  {/* Gatefold Telemetry Grid */}
                  <div className="gatefold-telemetry-grid">
                    <div className="gatefold-telemetry-item">
                      <span className="gatefold-telemetry-label">Format</span>
                      <span className="gatefold-telemetry-value">{selectedAlbum.sampleTrack?.format || 'STEREO'}</span>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <span className="gatefold-telemetry-label">Quality</span>
                      <span className="gatefold-telemetry-value">
                        {isHiResTrack(selectedAlbum.sampleTrack)
                          ? '24-bit Hi-Res Lossless'
                          : isLosslessTrack(selectedAlbum.sampleTrack)
                          ? '16-bit CD Lossless'
                          : 'Standard Quality'}
                      </span>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <span className="gatefold-telemetry-label">Year</span>
                      <span className="gatefold-telemetry-value">{extractAlbumYear(selectedAlbum) || 'Unknown'}</span>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <span className="gatefold-telemetry-label">Tracks</span>
                      <span className="gatefold-telemetry-value">{selectedAlbum.tracks.length}</span>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <span className="gatefold-telemetry-label">Duration</span>
                      <span className="gatefold-telemetry-value">{fmt(selectedAlbum.totalDuration)}</span>
                    </div>
                    <div className="gatefold-telemetry-item">
                      <span className="gatefold-telemetry-label">Channels</span>
                      <span className="gatefold-telemetry-value">{formatChannels(selectedAlbum.sampleTrack)}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handlePlayAlbum(selectedAlbum, false)}
                      style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 20 }}
                    >
                      <Play size={16} fill="white" />
                      Play Album
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handlePlayAlbum(selectedAlbum, true)}
                      style={{ padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, borderRadius: 20 }}
                    >
                      <Shuffle size={16} />
                      Shuffle
                    </button>
                  </div>
                </div>
              </div>

              {/* Drawer Track List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
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
                        <table className="track-table" style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              <th style={{ width: 40, textAlign: 'center' }}>#</th>
                              <th>Title</th>
                              <th style={{ width: 72, textAlign: 'right' }}>Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.tracks.map((t, idx) => (
                              <tr
                                key={t.id || t.path || idx}
                                onClick={() => handlePlayTrackFromAlbum(t)}
                                style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                              >
                                <td style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
                                  {getTrackNumber(t) || idx + 1}
                                </td>
                                <td>
                                  <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{t.title || 'Untitled'}</div>
                                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t.artist || 'Unknown Artist'}</div>
                                </td>
                                <td style={{ textAlign: 'right', color: 'var(--text-dim)', fontSize: 13 }}>
                                  {fmt(t.duration)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ));
                  }

                  return (
                    <table className="track-table" style={{ width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ width: 40, textAlign: 'center' }}>#</th>
                          <th>Title</th>
                          <th style={{ width: 72, textAlign: 'right' }}>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAlbum.tracks.map((t, idx) => (
                          <tr
                            key={t.id || t.path || idx}
                            onClick={() => handlePlayTrackFromAlbum(t)}
                            style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                          >
                            <td style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
                              {getTrackNumber(t) || idx + 1}
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{t.title || 'Untitled'}</div>
                              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{t.artist || 'Unknown Artist'}</div>
                            </td>
                            <td style={{ textAlign: 'right', color: 'var(--text-dim)', fontSize: 13 }}>
                              {fmt(t.duration)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
