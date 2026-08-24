import { useState, useEffect, memo, useRef, useMemo } from 'react';
import { useStore, Track } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Sparkles, History, Compass, Play, Pause, Music, Star, Moon, Download, Check, Loader2, RefreshCw, LayoutGrid, List, Search, X, ArrowLeft, Layers, Flame, Disc, RotateCcw, Zap, Clock, ListMusic, CloudRain, Target, Activity, Plus, Sliders } from 'lucide-react';
import { YoutubeMix } from '../store/types';

// Format track duration
function fmt(s: number | null) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// Extract track base name
function baseName(p: string | null) {
  return p ? (p.split(/[\\/]/).pop() ?? p) : '—';
}

// Parse raw duration strings into seconds (defaulting to 180s if 0 or invalid)
function parseDuration(raw: string | null | undefined): number {
  if (!raw) return 180;
  const parts = raw.split(':').map(Number);
  if (parts.some(isNaN)) return 180;
  let secs = 0;
  if (parts.length === 3) {
    secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    secs = parts[0] * 60 + parts[1];
  } else {
    secs = parts[0] || 0;
  }
  return secs > 0 ? secs : 180;
}

// Format large stats numbers
function formatNumber(numStr: string | number | null | undefined) {
  if (!numStr) return '0';
  const num = typeof numStr === 'number' ? numStr : parseInt(numStr, 10);
  if (isNaN(num)) return '0';
  return num.toLocaleString();
}

// Clean HTML tags from Last.fm biography summaries
function cleanBio(bioStr: string | null | undefined) {
  if (!bioStr) return '';
  return bioStr.replace(/<[^>]*>/g, '').trim();
}



// Clickable artist link with hover underline
const ArtistLink = memo(({ name, onClick }: { name: string; onClick: () => void }) => {
  const [hover, setHover] = useState(false);
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: 'pointer',
        textDecoration: hover ? 'underline' : 'none',
        color: hover ? 'var(--accent)' : 'inherit',
        transition: 'color 0.2s ease',
      }}
    >
      {name}
    </span>
  );
});

// Row for rendering a popular track with resolved cover art via iTunes
const PopularTrackRow = memo(({ 
  track, 
  artistName, 
  idx, 
  resolvingTrackId, 
  downloadingIds, 
  downloadedIds, 
  copiedId, 
  handlePlayPopularTrack, 
  handleOpenWebBypassForPopular, 
  handleDownloadPopularTrack,
  formatNumber,
  totalTracks
}: {
  track: any;
  artistName: string;
  idx: number;
  resolvingTrackId: string | null;
  downloadingIds: Set<string>;
  downloadedIds: Set<string>;
  copiedId: string | null;
  handlePlayPopularTrack: (name: string) => void;
  handleOpenWebBypassForPopular: (name: string, provider: 'lucida' | 'squid') => void;
  handleDownloadPopularTrack: (name: string) => void;
  formatNumber: (n: any) => string;
  totalTracks: number;
}) => {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    const query = `${artistName} - ${track.name}`;
    fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=1`)
      .then(res => res.json())
      .then(data => {
        if (data.results && data.results.length > 0) {
          const url = data.results[0].artworkUrl100.replace('100x100bb.jpg', '200x200bb.jpg');
          setCoverUrl(url);
        }
      })
      .catch(() => {});
  }, [track.name, artistName]);

  const isResolving = resolvingTrackId === `${artistName}-${track.name}`;
  const isDownloading = downloadingIds.has(`${artistName}-${track.name}`);
  const isDownloaded = downloadedIds.has(`${artistName}-${track.name}`);

  return (
    <div 
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 20px',
        borderBottom: idx === totalTracks - 1 ? 'none' : '1px solid var(--glass-border)',
        transition: 'background 0.2s',
        gap: 16
      }}
      className="dropdown-item-hover"
    >
      {/* Number index */}
      <div style={{ width: 24, fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', display: 'flex', justifyContent: 'center' }}>
        {idx + 1}
      </div>

      {/* Cover art thumbnail */}
      <div style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {coverUrl ? (
          <img src={coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}>
            <Music size={16} color="var(--text-dim)" />
          </div>
        )}
      </div>

      {/* Title and metadata */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {track.name}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {artistName}
        </span>
      </div>

      {/* Listeners stats */}
      {track.listeners && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 500, minWidth: 100, textAlign: 'right' }}>
          {formatNumber(track.listeners)} listeners
        </div>
      )}

      {/* Action Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Play Button */}
        <button
          onClick={() => handlePlayPopularTrack(track.name)}
          style={{
            background: isResolving ? 'rgba(6, 182, 212, 0.1)' : 'var(--glass)',
            border: '1px solid ' + (isResolving ? 'rgba(6, 182, 212, 0.2)' : 'var(--glass-border)'),
            borderRadius: 8,
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isResolving ? '#06b6d4' : 'white',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => {
            if (!isResolving) e.currentTarget.style.background = 'var(--glass-h)';
          }}
          onMouseLeave={e => {
            if (!isResolving) e.currentTarget.style.background = 'var(--glass)';
          }}
          title="Play song"
        >
          {isResolving ? (
            <Loader2 className="spin" size={14} />
          ) : (
            <Play size={14} fill="currentColor" />
          )}
        </button>

        {/* Lucida Web Bypass */}
        <button
          onClick={() => handleOpenWebBypassForPopular(track.name, 'lucida')}
          style={{
            background: 'var(--glass)',
            border: '1px solid var(--glass-border)',
            borderRadius: 8,
            padding: '0 8px',
            height: 32,
            fontSize: 11,
            fontWeight: 700,
            color: copiedId === `${artistName}-${track.name}-lucida` ? '#10b981' : 'var(--text-dim)',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = copiedId === `${artistName}-${track.name}-lucida` ? '#10b981' : 'var(--text-dim)'}
          title="Copy & search FLAC on Lucida"
        >
          {copiedId === `${artistName}-${track.name}-lucida` ? <Check size={12} /> : "L"}
        </button>

        {/* Squid Web Bypass */}
        <button
          onClick={() => handleOpenWebBypassForPopular(track.name, 'squid')}
          style={{
            background: 'var(--glass)',
            border: '1px solid var(--glass-border)',
            borderRadius: 8,
            padding: '0 8px',
            height: 32,
            fontSize: 11,
            fontWeight: 700,
            color: copiedId === `${artistName}-${track.name}-squid` ? '#10b981' : 'var(--text-dim)',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = copiedId === `${artistName}-${track.name}-squid` ? '#10b981' : 'var(--text-dim)'}
          title="Copy & search FLAC on Squid"
        >
          {copiedId === `${artistName}-${track.name}-squid` ? <Check size={12} /> : "S"}
        </button>

        {/* Download Button */}
        {isDownloaded ? (
          <div 
            style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: 8,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#10b981'
            }}
            title="Added to Offline Library"
          >
            <Check size={14} />
          </div>
        ) : isDownloading ? (
          <div 
            style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: 8,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#10b981'
            }}
          >
            <Loader2 className="spin" size={14} />
          </div>
        ) : (
          <button
            onClick={() => handleDownloadPopularTrack(track.name)}
            style={{
              background: 'var(--glass)',
              border: '1px solid var(--glass-border)',
              borderRadius: 8,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text)',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-h)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--glass)'}
            title="Download song offline"
          >
            <Download size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

import { SimpleLRU } from '../utils/lruCache';
import { buildUnifiedTabs, getUnifiedTabTracks, UnifiedTabId } from '../utils/discoveryFeed';

// Artwork caching
const coverArtCache = new SimpleLRU<string, string | null>(300);
const pendingArtRequests = new SimpleLRU<string, Promise<any>>(300);

// Helper to get premium CSS class for recommendation source badges
function getBadgeClass(source: string) {
  const src = source.toLowerCase();
  if (src.includes('similar to') || src.includes('collaborative')) return 'badge-lastfm';
  if (src.includes('fans of') || src.includes('from ') || src.includes('favorites') || src.includes('favourite')) return 'badge-favorites';
  if (src.includes('listenbrainz')) return 'badge-listenbrainz';
  if (src.includes('last.fm')) return 'badge-lastfm';
  if (src.includes('youtube') || src.includes('trending') || src.includes('global') || src.includes('radio')) return 'badge-youtube';
  if (src.includes('discovery') || src.includes('genre') || src.includes('top ') || src.includes('•') || src.includes('recently played') || src.includes('recent') || src.includes('γçó') || src.includes('gçó')) return 'badge-recent';
  return 'badge-default';
}

const TrackCardThumbnail = memo(({ 
  path, 
  coverUrl, 
  className, 
  fallbackIconSize = 22 
}: { 
  path?: string | null, 
  coverUrl?: string | null, 
  className?: string, 
  fallbackIconSize?: number 
}) => {
  const isDirectWebUrl = Boolean(coverUrl && (coverUrl.startsWith('http://') || coverUrl.startsWith('https://') || coverUrl.startsWith('data:')));
  const targetPath = isDirectWebUrl ? coverUrl! : (coverUrl || path || '');
  const isOnlinePath = targetPath.startsWith('http://') || targetPath.startsWith('https://') || targetPath.startsWith('data:');

  const [art, setArt] = useState<string | null>(() => {
    if (!targetPath) return null;
    if (isOnlinePath) return targetPath;
    return coverArtCache.get(targetPath) || null;
  });

  useEffect(() => {
    if (!targetPath) {
      setArt(null);
      return;
    }

    if (isOnlinePath) {
      setArt(targetPath);
      return;
    }

    let active = true;
    const cached = coverArtCache.get(targetPath);
    if (cached !== undefined) {
      setArt(cached);
      return;
    }

    if (!pendingArtRequests.has(targetPath)) {
      const req = invoke('get_cover_art', { path: targetPath }).then((res: any) => {
        const artUrl = (res && typeof res === 'string') ? res : null;
        coverArtCache.set(targetPath, artUrl);
        return artUrl;
      }).catch(() => {
        coverArtCache.set(targetPath, null);
        return null;
      }).finally(() => {
        pendingArtRequests.delete(targetPath);
      });
      pendingArtRequests.set(targetPath, req);
    }
    
    pendingArtRequests.get(targetPath)?.then(resolvedArt => {
      if (active) {
        setArt(resolvedArt || null);
      }
    });

    return () => {
      active = false;
    };
  }, [targetPath, isOnlinePath]);

  if (!art) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117' }}>
        <Music size={fallbackIconSize} color="var(--text-dim)" />
      </div>
    );
  }

  return (
    <img 
      src={art} 
      alt="" 
      referrerPolicy="no-referrer" 
      loading="lazy" 
      className={className || "aideo-track-img"}
      onError={() => {
        if (targetPath) coverArtCache.set(targetPath, null);
        setArt(null);
      }} 
    />
  );
});

export function AideoView() {
  const { 
    tracks, 
    playHistory, 
    playCounts, 
    playTrack, 
    setView, 
    playStream,
    playbackCurrentTrack,
    playbackStatus,
    currentTrack,
    pauseTrack,
    resumeTrack,
    generateSmartMix,
    showSmartMixWidget,
    discoveryData,
    setDiscoveryData,
    isLoadingRecs,
    setIsLoadingRecs,
    activeDiscoveryTab,
    setActiveDiscoveryTab,
    addToQueue,
    triggerAutoplayRadio,
    appMode,
    resumePosition,
    resumeLastSession,
    dismissResumePrompt,
    discoveryLayout,
    setDiscoveryLayout,
    aideoPageDesign
  } = useStore(useShallow(s => ({
    tracks: s.tracks,
    playHistory: s.playHistory,
    playCounts: s.playCounts,
    playTrack: s.playTrack,
    setView: s.setView,
    playStream: s.playStream,
    playbackCurrentTrack: s.playback.current_track,
    playbackStatus: s.playback.status,
    currentTrack: s.currentTrack,
    pauseTrack: s.pauseTrack,
    resumeTrack: s.resumeTrack,
    generateSmartMix: s.generateSmartMix,
    showSmartMixWidget: s.showSmartMixWidget,
    discoveryData: s.discoveryData,
    setDiscoveryData: s.setDiscoveryData,
    isLoadingRecs: s.isLoadingRecs,
    setIsLoadingRecs: s.setIsLoadingRecs,
    activeDiscoveryTab: s.activeDiscoveryTab,
    setActiveDiscoveryTab: s.setActiveDiscoveryTab,
    addToQueue: s.addToQueue,
    triggerAutoplayRadio: s.triggerAutoplayRadio,
    appMode: s.appMode,
    resumePosition: s.resumePosition,
    resumeLastSession: s.resumeLastSession,
    dismissResumePrompt: s.dismissResumePrompt,
    discoveryLayout: s.discoveryLayout,
    setDiscoveryLayout: s.setDiscoveryLayout,
    aideoPageDesign: s.aideoPageDesign,
  })));
  const [greeting, setGreeting] = useState('Good morning');
  const [discoveryViewMode, setDiscoveryViewMode] = useState<'list' | 'grid'>('grid');
  const [audiophileFilter, setAudiophileFilter] = useState<'all' | 'lossless' | 'rotation' | 'recs' | 'charts'>('all');
  const isFetchingRef = useRef(false);
  const [isRefreshingRecs, setIsRefreshingRecs] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, { percent: number; downloaded_mb: number; total_mb: number }>>({});

  const [activeMood, setActiveMood] = useState('Chill');
  const [activeSource, setActiveSource] = useState('Library History');
  const [generatingMix, setGeneratingMix] = useState(false);
  const [visibleRecsCount, setVisibleRecsCount] = useState(15);
  const [discoveryCardSize, setDiscoveryCardSize] = useState<number>(185);
  
  // YouTube Music / Web Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [quickResults, setQuickResults] = useState<any[]>([]);
  const [searchActive, setSearchActive] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [artistProfile, setArtistProfile] = useState<any | null>(null);
  const [artistActiveTab, setArtistActiveTab] = useState<'popular' | 'all' | 'library'>('popular');
  const [artistDiscography, setArtistDiscography] = useState<any[]>([]);
  const [isLoadingDiscography, setIsLoadingDiscography] = useState(false);
  const [artistSongFilter, setArtistSongFilter] = useState('');
  const [resolvingTrackId, setResolvingTrackId] = useState<string | null>(null);
  const [showFullBio, setShowFullBio] = useState(false);
  const [artistHeroImage, setArtistHeroImage] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load search history, click outside, and remote trigger handler
  useEffect(() => {
    const history = localStorage.getItem('aideo_search_history');
    if (history) {
      try {
        setSearchHistory(JSON.parse(history));
      } catch (e) {
        console.error(e);
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    const handleRemoteSearch = (e: any) => {
      const { query: q } = e.detail || {};
      if (q) {
        triggerSearch(q);
      }
    };
    window.addEventListener('ui-trigger-aideo-search', handleRemoteSearch);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('ui-trigger-aideo-search', handleRemoteSearch);
    };
  }, []);

  useEffect(() => {
    if (artistProfile && artistProfile.name) {
      setArtistActiveTab('popular');
      setArtistSongFilter('');
      setArtistDiscography([]);
      setIsLoadingDiscography(true);

      // Fetch artist hero image (using top song or album cover)
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistProfile.name)}&media=music&entity=album&limit=1`)
        .then(res => res.json())
        .then(data => {
          if (data.results && data.results.length > 0) {
            const url = data.results[0].artworkUrl100.replace('100x100bb.jpg', '600x600bb.jpg');
            setArtistHeroImage(url);
          } else {
            setArtistHeroImage(null);
          }
        })
        .catch(() => setArtistHeroImage(null));

      // Fetch full pristine studio discography & all releases from YouTube Music
      invoke<any[]>('get_artist_discography', { artist: artistProfile.name })
        .then((tracks) => {
          setArtistDiscography(tracks || []);
        })
        .catch((err) => {
          console.warn('Failed to load artist discography:', err);
        })
        .finally(() => {
          setIsLoadingDiscography(false);
        });
    } else {
      setArtistHeroImage(null);
      setArtistDiscography([]);
      setArtistSongFilter('');
    }
  }, [artistProfile]);

  // Fetch suggestions and quick results dynamically
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      setQuickResults([]);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      try {
        // Autocomplete suggestions
        const suggs = await invoke<string[]>('get_search_suggestions', { query: searchQuery.trim() });
        setSuggestions(suggs.slice(0, 5));

        // Quick search results
        const tracks = await invoke<any[]>('search_youtube', { query: searchQuery.trim() });
        setQuickResults(tracks.slice(0, 3));
      } catch (e) {
        console.error('Failed to fetch suggestions/quick results:', e);
      }
    }, 250);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  const triggerSearch = async (q: string) => {
    setSearchQuery(q);
    setSearchFocused(false);
    setSearchActive(true);
    setIsSearching(true);
    setArtistProfile(null);
    setShowFullBio(false);

    // Save to search history
    setSearchHistory(prev => {
      const next = [q, ...prev.filter(item => item !== q)].slice(0, 10);
      localStorage.setItem('aideo_search_history', JSON.stringify(next));
      return next;
    });

    try {
      const isShortQuery = q.trim().split(/\s+/).length <= 3;
      if (isShortQuery) {
        try {
          const profile = await invoke<any>('get_artist_profile', { artist: q.trim() });
          if (profile && profile.name) {
            const listeners = parseInt(profile.listeners || '0', 10);
            const playcount = parseInt(profile.playcount || '0', 10);
            if (listeners >= 200 || playcount >= 500) {
              setArtistProfile(profile);
              setIsSearching(false);
              return;
            } else {
              console.log(`[Aideo] Skipping low-popularity Last.fm artist profile "${profile.name}" (listeners: ${listeners}, playcount: ${playcount}) to prevent false matches.`);
            }
          }
        } catch (e) {
          console.log("Failed to fetch artist profile:", e);
        }
      }

      const tracks = await invoke<any[]>('search_youtube', { query: q });
      setSearchResults(tracks);
    } catch (err) {
      console.error("Search failed:", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Search failed: ${err}`, type: 'error' } }));
    } finally {
      setIsSearching(false);
    }
  };

  const handleAideoSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      triggerSearch(searchQuery.trim());
    }
  };

  const handleDeleteHistory = (e: React.MouseEvent, q: string) => {
    e.stopPropagation();
    setSearchHistory(prev => {
      const next = prev.filter(item => item !== q);
      localStorage.setItem('aideo_search_history', JSON.stringify(next));
      return next;
    });
  };

  const handlePlayQuickTrack = async (track: any) => {
    setSearchFocused(false);
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Playing: ${track.title}...`, type: 'info' } 
    }));
    try {
      const parsedSeconds = parseDuration(track.duration_raw);
      await playStream(track.url, {
        title: track.title,
        artist: track.artist,
        cover_url: track.cover_url,
        duration: parsedSeconds
      });
      
      invoke('update_media_metadata', {
        title: track.title,
        artist: track.artist,
        coverUrl: track.cover_url || null,
        duration: parsedSeconds,
      }).catch(() => {});
    } catch (e) {
      console.error('Failed to stream quick track:', e);
    }
  };

  const handleGenerateSmartMix = async () => {
    setGeneratingMix(true);
    try {
      await generateSmartMix(activeMood, activeSource);
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingMix(false);
    }
  };

  useEffect(() => {
    const sub = listen<any>('ytdlp-download-progress', (event) => {
      const { url, percent, downloaded_mb, total_mb } = event.payload;
      setDownloadProgress(prev => ({
        ...prev,
        [url]: { percent, downloaded_mb, total_mb }
      }));
    });

    return () => {
      sub.then(f => f());
    };
  }, []);

  const fetchRecommendations = async (forceRefresh = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsRefreshingRecs(true);
    setIsLoadingRecs(true);
    setVisibleRecsCount(15);

    if (forceRefresh) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Refreshing recommendations...', type: 'info' } }));
    } else {
      // Load cached discovery hub data first (offline-first instant load)
      try {
        const cached = await invoke<any>('get_cached_discovery_hub');
        if (cached) {
          setDiscoveryData(cached);
          setIsLoadingRecs(false);
          setActiveDiscoveryTab('all');
        }
      } catch (e) {
        console.warn('Failed to load cached discovery hub:', e);
      }
    }

    try {
      // 1. Fetch freshest state directly from store to prevent React closure/stale-state bugs
      let currentStore = useStore.getState();
      const currentTracks = currentStore.tracks;
      const currentPlayCounts = currentStore.playCounts;
      const isLfmConnected = !!currentStore.lastfmSessionKey;
      const isLbConnected = !!currentStore.listenbrainzToken;
      const discoveryLevel = currentStore.autoplayDiscoveryLevel;

      // A. Load ListenBrainz collaborative filtering recommendations if connected
      if (isLbConnected && (!currentStore.listenbrainzRecs || currentStore.listenbrainzRecs.length === 0)) {
        try {
          await Promise.race([
            currentStore.fetchListenbrainzDashboard(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('LB timeout')), 2000))
          ]);
        } catch (e) {
          console.warn('ListenBrainz dashboard timed out or failed:', e);
        }
      }

      // B. Load Last.fm personalized top artists if connected
      if (isLfmConnected && (!currentStore.lastfmTopArtists || currentStore.lastfmTopArtists.length === 0)) {
        try {
          await Promise.race([
            currentStore.fetchLastfmDashboard(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('LFM timeout')), 2000))
          ]);
        } catch (e) {
          console.warn('Last.fm dashboard timed out or failed:', e);
        }
      }

      // Refresh store state after potential background fetches
      currentStore = useStore.getState();

      // --- Find seed artists from offline library play history or frequencies ---
      let offlineSeedArtists: string[] = [];
      const artistPlayCounts: Record<string, number> = {};
      currentTracks.forEach(track => {
        if (track.artist && track.artist !== 'Unknown Artist' && track.artist !== 'YouTube Audio' && track.artist !== 'Web Audio Stream') {
          const count = currentPlayCounts[track.path] || 0;
          if (count > 0) {
            artistPlayCounts[track.artist] = (artistPlayCounts[track.artist] || 0) + count;
          }
        }
      });

      offlineSeedArtists = Object.entries(artistPlayCounts)
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0])
        .slice(0, 5);

      if (offlineSeedArtists.length === 0) {
        const artistFrequencies: Record<string, number> = {};
        currentTracks.forEach(track => {
          if (track.artist && track.artist !== 'Unknown Artist' && track.artist !== 'YouTube Audio' && track.artist !== 'Web Audio Stream') {
            artistFrequencies[track.artist] = (artistFrequencies[track.artist] || 0) + 1;
          }
        });
        const mostFrequent = Object.entries(artistFrequencies)
          .sort((a, b) => b[1] - a[1])
          .map(entry => entry[0])
          .slice(0, 5);
        offlineSeedArtists.push(...mostFrequent);
      }

      // Find top played artists for re-ranking
      let topArtists = Object.entries(artistPlayCounts)
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0])
        .slice(0, 5);

      if (topArtists.length === 0) {
        topArtists.push(...offlineSeedArtists);
      }

      // Inject the currently playing artist as the number 1 seed and top artist
      if (currentTrack && currentTrack.artist && currentTrack.artist !== 'Unknown Artist' && currentTrack.artist !== 'YouTube Audio' && currentTrack.artist !== 'Web Audio Stream' && currentTrack.artist !== 'Web Stream' && currentTrack.artist !== 'Online Stream') {
        offlineSeedArtists = [currentTrack.artist, ...offlineSeedArtists.filter(a => a !== currentTrack.artist)].slice(0, 5);
        topArtists = [currentTrack.artist, ...topArtists.filter(a => a !== currentTrack.artist)].slice(0, 5);
      }

      // Find library artists for re-ranking
      const libraryArtists = Array.from(new Set(
        currentTracks
          .map(t => t.artist)
          .filter((a): a is string => !!a && a !== 'Unknown Artist' && a !== 'YouTube Audio' && a !== 'Web Audio Stream' && a !== 'Web Stream')
      ));

      // Gather Last.fm Top Artists names
      const lastfmTopArtistsList = (currentStore.lastfmTopArtists || []).map((a: any) => a.name as string);

      // Gather ListenBrainz Recommended Tracks
      const lbTracks: string[] = [];
      if (isLbConnected && currentStore.listenbrainzRecs) {
        const recsArray = Array.isArray(currentStore.listenbrainzRecs)
          ? currentStore.listenbrainzRecs
          : Object.entries(currentStore.listenbrainzRecs).map(([_, val]: [string, any]) => ({ ...val }));

        recsArray.slice(0, 8).forEach((rec: any) => {
          const artist = rec.artist?.name || rec.artist_credit_name || rec.recording?.artist_credit_name || '';
          const title = rec.recording?.name || rec.recording_name || '';
          if (artist && title) {
            lbTracks.push(`${artist} - ${title}`);
          }
        });
      }

      // 🚀 Invoke new high-performance parallel backend command!
      const resolved = await invoke<any>('get_personalized_discovery_hub', {
        seedArtists: offlineSeedArtists,
        topArtists,
        libraryArtists,
        discoveryLevel,
        lastfmConnected: isLfmConnected,
        lastfmTopArtists: lastfmTopArtistsList,
        listenbrainzConnected: isLbConnected,
        listenbrainzRecs: lbTracks,
        appMode,
        isOnline: navigator.onLine,
      });

      setDiscoveryData(resolved);
      setActiveDiscoveryTab('all');
    } catch (err) {
      console.error('Failed to load personalized discovery recommendations:', err);
    } finally {
      setIsLoadingRecs(false);
      setIsRefreshingRecs(false);
      isFetchingRef.current = false;
    }
  };

  // Load/refresh recommendations when library is loaded
  useEffect(() => {
    if (tracks.length > 0) {
      fetchRecommendations();
    } else {
      const timer = setTimeout(() => {
        fetchRecommendations();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [tracks.length]);

  const handleDownloadTrack = async (track: any) => {
    if (downloadingIds.has(track.id) || downloadedIds.has(track.id)) return;
    setDownloadingIds(prev => {
      const next = new Set(prev);
      next.add(track.id);
      return next;
    });
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Downloading high-fidelity stream: ${track.title}...`, type: 'info' } 
    }));
    try {
      await invoke('download_track', {
        url: track.url,
        quality: 'high',
        title: track.title,
        artist: track.artist,
        coverUrl: track.cover_url
      });
      setDownloadedIds(prev => {
        const next = new Set(prev);
        next.add(track.id);
        return next;
      });
      // Refresh the library store immediately so it updates the downloaded state
      await useStore.getState().loadLibrary();
      // Immediately refresh recommendations list to filter out the downloaded track
      await fetchRecommendations();
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Successfully added to offline library: ${track.title}!`, type: 'success' } 
      }));
    } catch (err) {
      console.error("Download error", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Web stream download failed: ${err}`, type: 'error' } 
      }));
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  const handleTogglePreview = async (track: any) => {
    const isCurrentTrack = playbackCurrentTrack === track.url;
    const isPlaying = isCurrentTrack && playbackStatus === 'Playing';
    const isPaused = isCurrentTrack && playbackStatus === 'Paused';

    if (isPlaying) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Pausing preview: ${track.title}`, type: 'info' } 
      }));
      try {
        await pauseTrack();
      } catch (e) {
        console.error('Failed to pause track:', e);
      }
    } else if (isPaused) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Resuming preview: ${track.title}...`, type: 'info' } 
      }));
      try {
        await resumeTrack();
      } catch (e) {
        console.error('Failed to resume track:', e);
      }
    } else {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Streaming preview: ${track.title}...`, type: 'info' } 
      }));
      try {
        const parsedSeconds = parseDuration(track.duration_raw);
        await playStream(track.url, {
          title: track.title,
          artist: track.artist,
          cover_url: track.cover_url || null,
          duration: parsedSeconds
        });
        
        // Update OS media metadata specifically for this stream with its title and artist info
        invoke('update_media_metadata', {
          title: track.title,
          artist: track.artist,
          coverUrl: track.cover_url || null,
          duration: parsedSeconds,
        }).catch(() => {});
      } catch (e) {
        console.error('Failed to stream track preview:', e);
      }
    }
  };

  const handlePlayDiscoveryMix = async (mix: any) => {
    if (!mix.tracks || mix.tracks.length === 0) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: "This mix has no tracks.", type: 'warning' } 
      }));
      return;
    }

    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `✨ Loading Mix: ${mix.title}...`, type: 'info' } 
    }));

    try {
      const parsedSeconds = (track: any): number => parseDuration(track.duration_raw);

      const tracksToQueue: Track[] = mix.tracks.map((t: any) => {
        const isOnline = t.url.startsWith('http://') || t.url.startsWith('https://');
        if (isOnline) {
          return {
            id: -30000 - Math.floor(Math.random() * 100000),
            path: t.url,
            title: t.title,
            artist: t.artist,
            duration: parsedSeconds(t),
            format: 'YouTube Direct',
            cover_url: t.cover_url || null,
          } as Track;
        } else {
          const existing = tracks.find(lt => lt.path === t.url);
          if (existing) return existing;
          return {
            id: parseInt(t.id.replace('local_', '')) || -9999,
            path: t.url,
            title: t.title,
            artist: t.artist,
            duration: parsedSeconds(t),
            format: 'Local File',
            cover_url: t.cover_url || null,
          } as Track;
        }
      });

      const upcoming = tracksToQueue.slice(1);
      useStore.setState({ queue: upcoming });
      localStorage.setItem('aideo_queue', JSON.stringify(upcoming));

      await invoke('clear_queue');
      if (upcoming.length > 0) {
        const paths = upcoming.map(t => t.path);
        await invoke('add_to_queue_bulk', { paths });
      }

      const first = tracksToQueue[0];
      const isFirstOnline = first.path.startsWith('http://') || first.path.startsWith('https://');
      if (isFirstOnline) {
        await playStream(first.path, {
          title: first.title || undefined,
          artist: first.artist || undefined,
          cover_url: first.cover_url,
          duration: first.duration || undefined,
        }, false);
      } else {
        await playTrack(first);
      }

      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Playing ${mix.title}!`, type: 'success' } 
      }));
      setView('nowplaying');
    } catch (err) {
      console.error("Failed to play discovery mix:", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Failed to load mix: ${err}`, type: 'error' } 
      }));
    }
  };

  const handlePlayPopularTrack = async (trackName: string) => {
    if (!artistProfile) return;
    const trackId = `${artistProfile.name}-${trackName}`;
    setResolvingTrackId(trackId);
    try {
      const query = `${artistProfile.name} - ${trackName}`;
      const results = await invoke<any[]>('search_youtube', { query });
      if (results && results.length > 0) {
        const match = results[0];
        const parsedSeconds = parseDuration(match.duration_raw);
        await playStream(match.url, {
          title: match.title,
          artist: match.artist,
          cover_url: match.cover_url,
          duration: parsedSeconds
        });
        
        invoke('update_media_metadata', {
          title: match.title,
          artist: match.artist,
          coverUrl: match.cover_url || null,
          duration: parsedSeconds,
        }).catch(() => {});
      } else {
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Could not resolve stream for "${trackName}"`, type: 'error' } 
        }));
      }
    } catch (err) {
      console.error("Failed to resolve and play popular track:", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Resolution error: ${err}`, type: 'error' } 
      }));
    } finally {
      setResolvingTrackId(null);
    }
  };

  const handleOpenWebBypassForPopular = (trackName: string, provider: 'lucida' | 'squid') => {
    if (!artistProfile) return;
    const searchString = `${artistProfile.name} - ${trackName}`.trim();
    const uniqueId = `${artistProfile.name}-${trackName}-${provider}`;
    navigator.clipboard.writeText(searchString).then(() => {
      setCopiedId(uniqueId);
      setTimeout(() => setCopiedId(null), 2000);
      
      const targetUrl = provider === 'lucida' ? 'https://lucida.to' : 'https://squid.wtf';
      
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Copied "${searchString}"! Opening ${provider} in browser...`, type: 'success' } 
      }));
      
      openUrl(targetUrl).catch(() => {
        window.open(targetUrl, '_blank');
      });
    });
  };

  const handleDownloadPopularTrack = async (trackName: string) => {
    if (!artistProfile) return;
    const trackId = `${artistProfile.name}-${trackName}`;
    if (downloadingIds.has(trackId) || downloadedIds.has(trackId)) return;
    
    setDownloadingIds(prev => {
      const next = new Set(prev);
      next.add(trackId);
      return next;
    });

    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Resolving stream to download: ${trackName}...`, type: 'info' } 
    }));

    try {
      const query = `${artistProfile.name} - ${trackName}`;
      const results = await invoke<any[]>('search_youtube', { query });
      if (results && results.length > 0) {
        const match = results[0];
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Downloading high-fidelity stream: ${match.title}...`, type: 'info' } 
        }));
        await invoke('download_track', {
          url: match.url,
          quality: 'high',
          title: match.title,
          artist: match.artist,
          coverUrl: match.cover_url
        });
        
        setDownloadedIds(prev => {
          const next = new Set(prev);
          next.add(trackId);
          return next;
        });

        await useStore.getState().loadLibrary();
        await fetchRecommendations();
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Successfully added to offline library: ${match.title}!`, type: 'success' } 
        }));
      } else {
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Could not resolve stream for "${trackName}" to download`, type: 'error' } 
        }));
      }
    } catch (err) {
      console.error("Download error for popular track:", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Download failed: ${err}`, type: 'error' } 
      }));
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(trackId);
        return next;
      });
    }
  };

  const handlePlayArtistTopTracks = async (shuffle = false) => {
    if (!artistProfile || !artistProfile.top_tracks || artistProfile.top_tracks.length === 0) return;
    
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Resolving tracks for ${artistProfile.name}...`, type: 'info' } 
    }));

    let tracksToPlay = [...artistProfile.top_tracks];
    if (shuffle) {
      for (let i = tracksToPlay.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tracksToPlay[i], tracksToPlay[j]] = [tracksToPlay[j], tracksToPlay[i]];
      }
    }

    const firstTrack = tracksToPlay[0];
    const trackName = firstTrack.name;
    const query = `${artistProfile.name} - ${trackName}`;
    setResolvingTrackId('top-tracks-play-all');

    try {
      const results = await invoke<any[]>('search_youtube', { query });
      if (results && results.length > 0) {
        const match = results[0];
        const parsedSeconds = parseDuration(match.duration_raw);

        // Clear queue on frontend and backend manually to prevent stopping the track that is about to start
        useStore.setState({ queue: [] });
        localStorage.setItem('aideo_queue', JSON.stringify([]));
        await invoke('clear_queue').catch(() => {});

        await playStream(match.url, {
          title: match.title,
          artist: match.artist,
          cover_url: match.cover_url,
          duration: parsedSeconds
        }, false);

        const remainingTracks = tracksToPlay.slice(1);
        
        (async () => {
          for (const t of remainingTracks) {
            try {
              const res = await invoke<any[]>('search_youtube', { query: `${artistProfile.name} - ${t.name}` });
              if (res && res.length > 0) {
                const subMatch = res[0];
                const subDuration = parseDuration(subMatch.duration_raw);
                const virtualTrack: Track = {
                  id: -20000 - Math.floor(Math.random() * 100000),
                  path: subMatch.url,
                  title: subMatch.title,
                  artist: subMatch.artist,
                  duration: subDuration,
                  format: 'YouTube Direct',
                  lyric_offset: 0,
                  cover_url: subMatch.cover_url || null
                };
                await addToQueue(virtualTrack);
              }
            } catch (err) {
              console.error("Failed to background resolve track for queue:", err);
            }
          }
          
          // Once all remaining tracks are queued, trigger autoplay radio to append recommendations at the end
          const currentTrack = useStore.getState().currentTrack;
          if (currentTrack) {
            useStore.getState().triggerAutoplayRadio(currentTrack, false).catch(console.error);
          }
        })();

      } else {
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Could not resolve stream for "${trackName}"`, type: 'error' } 
        }));
      }
    } catch (err) {
      console.error("Play top tracks error:", err);
    } finally {
      setResolvingTrackId(null);
    }
  };

  const handleStartArtistRadio = async () => {
    if (!artistProfile || !artistProfile.top_tracks || artistProfile.top_tracks.length === 0) return;
    const firstTrack = artistProfile.top_tracks[0];
    setResolvingTrackId('artist-radio');
    try {
      const results = await invoke<any[]>('search_youtube', { query: `${artistProfile.name} - ${firstTrack.name}` });
      if (results && results.length > 0) {
        const match = results[0];
        const parsedSeconds = parseDuration(match.duration_raw);
        const virtualTrack: Track = {
          id: -9999,
          path: match.url,
          title: match.title,
          artist: match.artist,
          duration: parsedSeconds,
          format: 'YouTube Direct',
          lyric_offset: 0,
          cover_url: match.cover_url || null
        };
        await playStream(match.url, {
          title: match.title,
          artist: match.artist,
          cover_url: match.cover_url,
          duration: parsedSeconds
        }, false);
        await triggerAutoplayRadio(virtualTrack, true);
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Started ${artistProfile.name} Radio!`, type: 'success' } 
        }));
      }
    } catch (err) {
      console.error("Start radio error:", err);
    } finally {
      setResolvingTrackId(null);
    }
  };

  // Personalized Greeting based on local time
  useEffect(() => {
    const hrs = new Date().getHours();
    if (hrs < 12) setGreeting('Good morning');
    else if (hrs < 18) setGreeting('Good afternoon');
    else setGreeting('Good evening');
  }, []);

  // Compute "Recently Played" Track Objects
  const recentTracks = [...playHistory]
    .reverse()
    // Show unique recent tracks, maintaining order (most recent first)
    .filter((t, index, self) => self.findIndex(st => st.path === t.path) === index)
    .slice(0, 15);

  // Compute "Quick Recap" Tracks (frequently played)
  let recapTracks = [...tracks]
    .filter(t => (playCounts[t.path] || 0) > 0)
    .sort((a, b) => (playCounts[b.path] || 0) - (playCounts[a.path] || 0))
    .slice(0, 8);

  // Fallback to library tracks if no play history is available yet
  if (recapTracks.length === 0 && tracks.length > 0) {
    recapTracks = tracks.slice(0, 8);
  }

  // Calculate total play count summary
  const totalPlays = Object.values(playCounts).reduce((sum, count) => sum + count, 0);

  const localArtistTracks = useMemo(() => {
    if (!artistProfile?.name) return [];
    const target = artistProfile.name.toLowerCase().trim();
    return tracks.filter(t => t.artist?.toLowerCase().trim() === target || t.artist?.toLowerCase().includes(target));
  }, [artistProfile?.name, tracks]);

  const filteredTopTracks = useMemo(() => {
    const list = artistProfile?.top_tracks || [];
    if (!artistSongFilter.trim()) return list;
    const q = artistSongFilter.toLowerCase().trim();
    return list.filter((t: any) => (t.name || '').toLowerCase().includes(q));
  }, [artistProfile?.top_tracks, artistSongFilter]);

  const filteredDiscography = useMemo(() => {
    if (!artistSongFilter.trim()) return artistDiscography;
    const q = artistSongFilter.toLowerCase().trim();
    return artistDiscography.filter((t: any) => (t.title || '').toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q));
  }, [artistDiscography, artistSongFilter]);

  const filteredLocalTracks = useMemo(() => {
    if (!artistSongFilter.trim()) return localArtistTracks;
    const q = artistSongFilter.toLowerCase().trim();
    return localArtistTracks.filter((t: any) => (t.title || '').toLowerCase().includes(q));
  }, [localArtistTracks, artistSongFilter]);

  const heroTrack = useMemo(() => {
    if (currentTrack) return currentTrack;
    if (recapTracks.length > 0) return recapTracks[0];
    if (tracks.length > 0) return tracks[0];
    return null;
  }, [currentTrack, recapTracks, tracks]);

  const topRotationTracks = useMemo(() => {
    return recapTracks.slice(0, 3);
  }, [recapTracks]);

  const audiophileTracks = useMemo(() => {
    if (audiophileFilter === 'lossless') {
      const filtered = tracks.filter(t => (t.path || '').toLowerCase().match(/\.(flac|wav|alac|aiff|dsd)$/i));
      return filtered.length > 0 ? filtered.slice(0, 30) : recapTracks;
    }
    if (audiophileFilter === 'rotation') {
      return recapTracks.slice(0, 30);
    }
    if (audiophileFilter === 'recs') {
      return (discoveryData?.recommendations || []).slice(0, 30);
    }
    if (audiophileFilter === 'charts') {
      return (discoveryData?.global_charts || []).slice(0, 30);
    }
    return tracks.length > 0 ? tracks.slice(0, 30) : recapTracks;
  }, [audiophileFilter, tracks, recapTracks, discoveryData]);

  const getFormatBadge = (track: any) => {
    const p = (track.path || track.url || '').toLowerCase();
    if (p.endsWith('.flac')) return { badge: 'FLAC 24/96', cls: 'badge-flac' };
    if (p.endsWith('.wav')) return { badge: 'WAV 24b', cls: 'badge-hi-res' };
    if (p.endsWith('.alac') || p.endsWith('.aiff') || p.endsWith('.dsd')) return { badge: 'HI-RES DSD', cls: 'badge-hi-res' };
    if (p.endsWith('.mp3')) return { badge: 'MP3 320k', cls: 'badge-bitrate' };
    if (p.endsWith('.m4a') || p.endsWith('.aac') || p.endsWith('.ogg')) return { badge: 'AAC / OGG', cls: 'badge-bitrate' };
    if (track.url || p.startsWith('http')) return { badge: 'ONLINE STREAM', cls: 'badge-wasapi' };
    return { badge: 'STUDIO PCM', cls: 'badge-wasapi' };
  };

  const renderTrackCarousel = (tracksList: any[]) => {
    if (!tracksList || tracksList.length === 0) return null;
    const isGrid = discoveryViewMode === 'grid';
    
    return (
      <div 
        className={isGrid ? "aideo-discovery-grid-layout" : "aideo-discovery-grid"}
        style={isGrid ? { gridTemplateColumns: `repeat(auto-fill, minmax(${discoveryCardSize}px, 1fr))` } : undefined}
      >
        {tracksList.map((track) => {
          const isPlaying = playbackCurrentTrack === track.url && playbackStatus === 'Playing';
          if (isGrid) {
            return (
              <div 
                key={track.id} 
                className={`aideo-discovery-grid-card ${isPlaying ? 'is-playing' : ''}`}
              >
                <div className="discovery-grid-cover-wrap">
                  <TrackCardThumbnail 
                    path={track.url} 
                    coverUrl={track.cover_url} 
                    className="discovery-grid-cover-img" 
                    fallbackIconSize={24} 
                  />

                  {isPlaying && (
                    <div className="discovery-eq-indicator" title="Currently Playing">
                      <div className="discovery-eq-bar" />
                      <div className="discovery-eq-bar" />
                      <div className="discovery-eq-bar" />
                    </div>
                  )}

                  <div className="discovery-grid-overlay">
                    <div 
                      className="discovery-grid-play-circle"
                      onClick={() => handleTogglePreview(track)}
                      title={
                        isPlaying
                          ? "Pause stream preview"
                          : "Stream online preview"
                      }
                    >
                      {isPlaying ? (
                        <Pause size={15} fill="currentColor" />
                      ) : (
                        <Play size={15} fill="currentColor" style={{ marginLeft: 1 }} />
                      )}
                    </div>
                  </div>
                </div>

                <div className="discovery-grid-meta">
                  <h4 className="discovery-grid-title" title={track.title}>{track.title}</h4>
                  <p className="discovery-grid-artist" title={track.artist}>
                    <ArtistLink name={track.artist} onClick={() => triggerSearch(track.artist)} />
                  </p>
                  {track.recommendation_source && (
                    <span className={`discovery-source-badge ${getBadgeClass(track.recommendation_source)}`}>
                      {(track.recommendation_source.includes('•') || track.recommendation_source.includes('ΓÇó')) && (
                        <span className="pulse" style={{ display: 'inline-block', width: 3, height: 3, borderRadius: '50%', background: '#10b981', marginRight: 3 }} />
                      )}
                      {track.recommendation_source}
                    </span>
                  )}
                </div>

                <div className="discovery-grid-footer">
                  <span className="discovery-grid-dur-badge">{track.duration_raw}</span>

                  {downloadedIds.has(track.id) ? (
                    <div className="discovery-download-btn downloaded" title="Added to Offline Library">
                      <Check size={12} />
                    </div>
                  ) : downloadingIds.has(track.id) ? (
                    <div 
                      className="discovery-download-btn downloading" 
                      title="Downloading stream offline..."
                    >
                      {downloadProgress[track.url] && (
                        <div 
                          style={{ 
                            position: 'absolute', 
                            left: 0, 
                            top: 0, 
                            bottom: 0, 
                            width: `${downloadProgress[track.url].percent}%`, 
                            background: 'rgba(16, 185, 129, 0.25)', 
                            zIndex: 0,
                            transition: 'width 0.2s ease-out'
                          }} 
                        />
                      )}
                      <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', fontSize: 9, fontWeight: 700 }}>
                        {downloadProgress[track.url] ? `${Math.round(downloadProgress[track.url].percent)}%` : <Loader2 size={10} className="pulse" />}
                      </span>
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleDownloadTrack(track)}
                      className="discovery-download-btn"
                      title="Download stream offline"
                    >
                      <Download size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          } else {
            return (
              <div 
                key={track.id}
                className={`aideo-discovery-list-item ${isPlaying ? 'is-playing' : ''}`}
              >
                <div className="discovery-cover-wrap">
                  <TrackCardThumbnail 
                    path={track.url} 
                    coverUrl={track.cover_url} 
                    className="discovery-cover-img" 
                    fallbackIconSize={20} 
                  />

                  {isPlaying && (
                    <div className="discovery-eq-indicator" style={{ top: 4, right: 4, padding: '2px 4px' }} title="Currently Playing">
                      <div className="discovery-eq-bar" />
                      <div className="discovery-eq-bar" />
                      <div className="discovery-eq-bar" />
                    </div>
                  )}

                  <div className="discovery-overlay">
                    <div 
                      className="discovery-play-circle"
                      onClick={() => handleTogglePreview(track)}
                      title={
                        isPlaying
                          ? "Pause preview"
                          : "Stream online preview"
                      }
                    >
                      {isPlaying ? (
                        <Pause size={13} fill="currentColor" />
                      ) : (
                        <Play size={13} fill="currentColor" style={{ marginLeft: 1 }} />
                      )}
                    </div>
                  </div>
                </div>

                <div className="discovery-meta">
                  <h4 className="discovery-title" title={track.title}>{track.title}</h4>
                  <p className="discovery-artist" title={track.artist}>
                    <ArtistLink name={track.artist} onClick={() => triggerSearch(track.artist)} />
                  </p>
                  {track.recommendation_source && (
                    <span className={`discovery-source-badge ${getBadgeClass(track.recommendation_source)}`}>
                      {(track.recommendation_source.includes('•') || track.recommendation_source.includes('ΓÇó')) && (
                        <span className="pulse" style={{ display: 'inline-block', width: 3, height: 3, borderRadius: '50%', background: '#10b981', marginRight: 4 }} />
                      )}
                      {track.recommendation_source}
                    </span>
                  )}
                </div>

                <div className="discovery-footer">
                  <span className="discovery-dur-badge">{track.duration_raw}</span>

                  {downloadedIds.has(track.id) ? (
                    <div className="discovery-download-btn downloaded" title="Added to Offline Library">
                      <Check size={12} />
                    </div>
                  ) : downloadingIds.has(track.id) ? (
                    <div 
                      className="discovery-download-btn downloading" 
                      title="Downloading stream offline..."
                    >
                      {downloadProgress[track.url] && (
                        <div 
                          style={{ 
                            position: 'absolute', 
                            left: 0, 
                            top: 0, 
                            bottom: 0, 
                            width: `${downloadProgress[track.url].percent}%`, 
                            background: 'rgba(16, 185, 129, 0.25)', 
                            zIndex: 0,
                            transition: 'width 0.2s ease-out'
                          }} 
                        />
                      )}
                      <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', fontSize: 9, fontWeight: 700 }}>
                        {downloadProgress[track.url] ? `${Math.round(downloadProgress[track.url].percent)}%` : <Loader2 size={10} className="pulse" />}
                      </span>
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleDownloadTrack(track)}
                      className="discovery-download-btn"
                      title="Download high-fidelity stream offline"
                    >
                      <Download size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          }
        })}
      </div>
    );
  };

  const renderMixCards = (mixes: YoutubeMix[]) => {
    if (!mixes || mixes.length === 0) return null;
    return (
      <div className="aideo-mix-grid">
        {mixes.map((mix: YoutubeMix) => {
          const idLower = mix.id.toLowerCase();
          const titleLower = mix.title.toLowerCase();

          let iconType = 'sparkles';
          let iconColorClass = 'sm';

          if (idLower.includes('energy') || titleLower.includes('energy') || titleLower.includes('workout')) {
            iconType = 'energy';
            iconColorClass = 'dc';
          } else if (idLower.includes('focus') || titleLower.includes('focus') || titleLower.includes('flow')) {
            iconType = 'focus';
            iconColorClass = 'ch';
          } else if (idLower.includes('chill') || titleLower.includes('chill') || titleLower.includes('unwind') || titleLower.includes('late night')) {
            iconType = 'chill';
            iconColorClass = 'ch';
          } else if (idLower.includes('melancholy') || titleLower.includes('reflections') || titleLower.includes('moody') || titleLower.includes('sad')) {
            iconType = 'melancholy';
            iconColorClass = 'rc';
          } else if (idLower.includes('spotlight') || titleLower.includes('spotlight') || idLower.includes('artist')) {
            iconType = 'spotlight';
            iconColorClass = 'sm';
          } else if (idLower.includes('recap') || titleLower.includes('recap')) {
            iconType = 'recap';
            iconColorClass = 'rc';
          } else if (idLower.includes('discovery') || titleLower.includes('discovery')) {
            iconType = 'discovery';
            iconColorClass = 'dc';
          } else if (idLower.includes('playlist') || titleLower.includes('playlist')) {
            iconType = 'playlist';
            iconColorClass = 'dc';
          }

          const renderIcon = () => {
            switch (iconType) {
              case 'energy': return <Zap size={20} />;
              case 'focus': return <Target size={20} />;
              case 'chill': return <Moon size={20} />;
              case 'melancholy': return <CloudRain size={20} />;
              case 'spotlight': return <Star size={20} />;
              case 'recap': return <History size={20} />;
              case 'discovery': return <Compass size={20} />;
              case 'playlist': return <ListMusic size={20} />;
              default: return <Sparkles size={20} className="pulse" />;
            }
          };

          return (
            <motion.div 
              key={mix.id}
              whileTap={{ scale: 0.98 }}
              onClick={() => handlePlayDiscoveryMix(mix)}
              className={`aideo-mix-card ${iconColorClass}`}
            >
              <div className="mix-card-content">
                <div className={`mix-card-icon-wrap ${iconColorClass}`}>
                  {renderIcon()}
                </div>
                <div className="mix-card-text">
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{mix.title}</h3>
                  <p>{mix.description}</p>
                </div>
                <button className="mix-play-btn" title={`Play ${mix.title}`}>
                  <Play size={16} fill="currentColor" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    );
  };

  const renderResumePrompt = () => {
    if (!(resumePosition > 0 && currentTrack)) return null;
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', marginBottom: 24, borderRadius: 16, background: 'var(--glass)', border: '1px solid var(--glass-border)', cursor: 'default' }}
      >
        <div style={{ width: 46, height: 46, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'var(--glass)' }}>
          <TrackCardThumbnail path={currentTrack.path} coverUrl={currentTrack.cover_url} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--accent)', marginBottom: 2 }}>Continue where you left off</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentTrack.title || baseName(currentTrack.path)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {currentTrack.artist || 'Unknown Artist'} · paused at {fmt(resumePosition)}
            {currentTrack.duration ? ` of ${fmt(currentTrack.duration)}` : ''}
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 12, flexShrink: 0 }}
          onClick={() => { resumeLastSession(); setView('nowplaying'); }}
        >
          <RotateCcw size={14} />
          Resume
        </button>
        <button
          onClick={dismissResumePrompt}
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4, flexShrink: 0 }}
          title="Dismiss"
        >
          <X size={16} />
        </button>
      </motion.div>
    );
  };

  const renderBentoHeroSection = () => {
    return (
      <div className="aideo-bento-grid">
        {/* Bento Cell 1: Spotlight Master Track */}
        {heroTrack && (
          <div className="aideo-bento-card aideo-bento-spotlight">
            <div className="bento-spotlight-content">
              <div className="bento-spotlight-thumb-wrap">
                <TrackCardThumbnail path={heroTrack.path} coverUrl={heroTrack.cover_url} />
              </div>
              <div className="bento-spotlight-meta">
                <div className="bento-spotlight-tag">
                  <Sparkles size={12} /> Spotlight Feature
                </div>
                <h3 className="bento-spotlight-title" title={heroTrack.title || baseName(heroTrack.path)}>
                  {heroTrack.title || baseName(heroTrack.path)}
                </h3>
                <p className="bento-spotlight-artist" title={heroTrack.artist || 'Unknown Artist'}>
                  <ArtistLink name={heroTrack.artist || 'Unknown Artist'} onClick={() => triggerSearch(heroTrack.artist || 'Unknown Artist')} />
                  {heroTrack.duration ? ` · ${fmt(heroTrack.duration)}` : ''}
                </p>
                <div className="bento-spotlight-actions">
                  <button
                    className="bento-play-btn"
                    onClick={() => {
                      playTrack(heroTrack as Track);
                    }}
                  >
                    <Play size={14} fill="currentColor" />
                    Play Spotlight
                  </button>
                  <button
                    className="bento-action-btn"
                    title="Add to Play Queue"
                    onClick={() => {
                      addToQueue(heroTrack as Track);
                      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added to queue: ${heroTrack.title || baseName(heroTrack.path)}`, type: 'success' } }));
                    }}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bento Cell 2: Interactive Mood Soundscapes */}
        <div className="aideo-bento-card aideo-bento-moods">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
              <Sparkles size={14} color="var(--accent)" />
              Mood Soundscapes
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase' }}>1-Click Mix</span>
          </div>
          <div className="bento-mood-chips">
            {[
              { label: 'Chill', color: '#06b6d4', icon: <Moon size={13} color="#06b6d4" /> },
              { label: 'Energetic', color: '#f59e0b', icon: <Flame size={13} color="#f59e0b" /> },
              { label: 'Focus', color: '#10b981', icon: <Target size={13} color="#10b981" /> },
              { label: 'Melancholic', color: '#a855f7', icon: <CloudRain size={13} color="#a855f7" /> },
              { label: 'Happy', color: '#ec4899', icon: <Star size={13} color="#ec4899" /> },
            ].map(m => (
              <button
                key={m.label}
                className={`bento-mood-chip ${activeMood === m.label ? 'active' : ''}`}
                onClick={async () => {
                  setActiveMood(m.label);
                  setGeneratingMix(true);
                  try {
                    await generateSmartMix(m.label, activeSource);
                  } finally {
                    setGeneratingMix(false);
                  }
                }}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Bento Cell 3: Live Library Pulse */}
        <div className="aideo-bento-card aideo-bento-pulse">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
              <Activity size={14} color="#10b981" />
              Library Pulse & DSP
            </div>
            <span style={{ fontSize: 10, color: '#10b981', fontWeight: 700, background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', borderRadius: 4 }}>
              BIT-PERFECT
            </span>
          </div>

          <div className="bento-pulse-bars">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={`pulse-${i}`} className="bento-pulse-bar" style={{ animationDelay: `${i * 0.08}s`, height: `${20 + ((i * 17) % 75)}%` }} />
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--glass-border)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              <strong style={{ color: '#fff' }}>{tracks.length}</strong> master tracks · <strong style={{ color: '#fff' }}>{totalPlays}</strong> plays
            </div>
            <button
              onClick={() => setView('settings')}
              className="btn btn-secondary"
              style={{ fontSize: 11, padding: '4px 10px', height: 26, display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <Sliders size={11} />
              Audio Cockpit
            </button>
          </div>
        </div>

        {/* Bento Cell 4: Top Heavy Rotation Stack */}
        <div className="aideo-bento-card aideo-bento-rotation">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
              <Flame size={14} color="#f59e0b" />
              Heavy Rotation
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Top Played</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topRotationTracks.map((t, idx) => (
              <div
                key={t.id || t.path}
                className="bento-rotation-item"
                onClick={() => { playTrack(t); setView('nowplaying'); }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, color: idx === 0 ? 'var(--accent)' : 'var(--text-dim)', width: 16 }}>
                  #{idx + 1}
                </span>
                <div style={{ width: 28, height: 28, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
                  <TrackCardThumbnail path={t.path} coverUrl={t.cover_url} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title || baseName(t.path)}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.artist || 'Unknown Artist'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {playCounts[t.path] > 0 && (
                    <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Star size={9} fill="#f59e0b" /> {playCounts[t.path]}
                    </span>
                  )}
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--glass-h)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Play size={10} fill="currentColor" style={{ marginLeft: 1 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderAudiophileHudSection = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Audiophile HUD Telemetry Header */}
        <div className="aideo-audiophile-hud">
          <div className="audiophile-hud-left">
            <Activity size={18} color="#06b6d4" />
            <span className="audiophile-hud-title">AIDEO // AUDIO TELEMETRY ENGINE</span>
            <span className="audiophile-badge badge-flac">FLAC LOSSLESS</span>
            <span className="audiophile-badge badge-wasapi">BIT-PERFECT WASAPI</span>
            <span className="audiophile-badge badge-hi-res">24-BIT / 96KHZ</span>
            <span className="audiophile-badge badge-bitrate">{tracks.length} MASTER TRACKS</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)' }}>
              PLAYS: <strong style={{ color: '#fff' }}>{totalPlays}</strong>
            </span>
            <button
              onClick={() => fetchRecommendations(true)}
              className="btn btn-secondary"
              style={{ fontSize: 11, height: 28, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <RefreshCw size={11} className={isRefreshingRecs ? "spin" : ""} />
              Sync
            </button>
          </div>
        </div>

        {/* Filter Chips Bar */}
        <div className="aideo-audiophile-filters">
          {[
            { id: 'all' as const, label: 'ALL MASTER TRACKS' },
            { id: 'lossless' as const, label: 'LOSSLESS & FLAC' },
            { id: 'rotation' as const, label: 'HEAVY ROTATION' },
            { id: 'recs' as const, label: 'DISCOVERY FEED' },
            { id: 'charts' as const, label: 'GLOBAL CHARTS' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setAudiophileFilter(f.id)}
              className={`audiophile-filter-btn ${audiophileFilter === f.id ? 'active' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Audiophile Master Table */}
        <div className="aideo-audiophile-table-wrap">
          <table className="aideo-audiophile-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>TRACK TITLE & ARTIST</th>
                <th style={{ width: 140 }}>AUDIO SPEC</th>
                <th style={{ width: 90, textAlign: 'right' }}>DURATION</th>
                <th style={{ width: 90, textAlign: 'right' }}>PLAYS</th>
                <th style={{ width: 100, textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {audiophileTracks.map((t: any, idx) => {
                const fmtInfo = getFormatBadge(t);
                const trackPath = t.path || t.url || '';
                const isPlaying = (playbackCurrentTrack === t.path || playbackCurrentTrack === t.url) && playbackStatus === 'Playing';
                return (
                  <tr
                    key={t.id || t.path || idx}
                    onClick={() => {
                      if (t.path) playTrack(t as Track);
                      else handleTogglePreview(t);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="audiophile-idx-col">{String(idx + 1).padStart(2, '0')}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#111' }}>
                          <TrackCardThumbnail path={t.path || t.url} coverUrl={t.cover_url} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: isPlaying ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.title || baseName(trackPath)}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                            {t.artist || 'Unknown Artist'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`audiophile-badge ${fmtInfo.cls}`}>
                        {fmtInfo.badge}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-dim)' }}>
                      {fmt(t.duration)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: (t.path && playCounts[t.path] > 0) ? '#f59e0b' : 'var(--text-dim)' }}>
                      {t.path ? (playCounts[t.path] || 0) : 0}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            if (t.path) playTrack(t as Track);
                            else handleTogglePreview(t);
                          }}
                          className="btn btn-secondary"
                          style={{ width: 28, height: 28, padding: 0, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Play Track"
                        >
                          {isPlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                        </button>
                        <button
                          onClick={() => {
                            addToQueue(t as any);
                            window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Queued: ${t.title || baseName(trackPath)}`, type: 'success' } }));
                          }}
                          className="btn btn-secondary"
                          style={{ width: 28, height: 28, padding: 0, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Add to Queue"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderCinematicHeroSection = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Cinematic Ambient Hero Banner */}
        {heroTrack && (
          <div className="aideo-cinematic-hero">
            <div className="cinematic-hero-scrim" />
            <div className="cinematic-hero-body">
              <div style={{ maxWidth: 640 }}>
                <div className="cinematic-hero-tag">
                  <Flame size={14} color="#fbbf24" />
                  FEATURED SPOTLIGHT MASTER
                </div>
                <h1 className="cinematic-hero-title">
                  {heroTrack.title || baseName(heroTrack.path)}
                </h1>
                <p className="cinematic-hero-artist">
                  <ArtistLink name={heroTrack.artist || 'Unknown Artist'} onClick={() => triggerSearch(heroTrack.artist || 'Unknown Artist')} />
                  {heroTrack.album ? ` · ${heroTrack.album}` : ''}
                  {heroTrack.duration ? ` · ${fmt(heroTrack.duration)}` : ''}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    className="cinematic-hero-play-btn"
                    onClick={() => {
                      playTrack(heroTrack);
                    }}
                  >
                    <Play size={16} fill="currentColor" />
                    Play Master Track
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ borderRadius: 99, padding: '12px 22px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => {
                      addToQueue(heroTrack);
                      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added to queue: ${heroTrack.title || baseName(heroTrack.path)}`, type: 'success' } }));
                    }}
                  >
                    <Plus size={15} />
                    Queue Next
                  </button>
                </div>
              </div>

              <div style={{ width: 140, height: 140, borderRadius: 20, overflow: 'hidden', flexShrink: 0, boxShadow: 'var(--shadow-cover)', border: '1px solid var(--glass-border)' }}>
                <TrackCardThumbnail path={heroTrack.path} coverUrl={heroTrack.cover_url} />
              </div>
            </div>
          </div>
        )}

        {/* Cinematic Mood Stations */}
        <div className="aideo-section" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Sparkles size={18} color="var(--accent)" />
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: -0.3, color: 'var(--text)' }}>
              Cinematic Mood Stations
            </h3>
          </div>

          <div className="aideo-cinematic-stations">
            {[
              { title: 'Chill Wave', sub: 'Atmospheric Ambient & Lo-Fi', mood: 'Chill', grad: 'linear-gradient(135deg, rgba(6, 182, 212, 0.35) 0%, rgba(15, 23, 42, 0.9) 100%)', border: 'rgba(6, 182, 212, 0.3)' },
              { title: 'Hyperdrive Energy', sub: 'High-BPM Electronic & Beats', mood: 'Energetic', grad: 'linear-gradient(135deg, rgba(245, 158, 11, 0.35) 0%, rgba(15, 23, 42, 0.9) 100%)', border: 'rgba(245, 158, 11, 0.3)' },
              { title: 'Deep Zen Focus', sub: 'Binaural & Instrumental Waves', mood: 'Focus', grad: 'linear-gradient(135deg, rgba(16, 185, 129, 0.35) 0%, rgba(15, 23, 42, 0.9) 100%)', border: 'rgba(16, 185, 129, 0.3)' },
              { title: 'Midnight Melancholy', sub: 'Nocturnal Soul & Acoustic', mood: 'Melancholic', grad: 'linear-gradient(135deg, rgba(168, 85, 247, 0.35) 0%, rgba(15, 23, 42, 0.9) 100%)', border: 'rgba(168, 85, 247, 0.3)' },
              { title: 'Golden Euphoria', sub: 'Uplifting Pop & Summer Anthems', mood: 'Happy', grad: 'linear-gradient(135deg, rgba(236, 72, 153, 0.35) 0%, rgba(15, 23, 42, 0.9) 100%)', border: 'rgba(236, 72, 153, 0.3)' },
            ].map(st => (
              <div
                key={st.title}
                className="cinematic-station-card"
                style={{ background: st.grad, borderColor: st.border }}
                onClick={async () => {
                  setActiveMood(st.mood);
                  setGeneratingMix(true);
                  try {
                    await generateSmartMix(st.mood, activeSource);
                  } finally {
                    setGeneratingMix(false);
                  }
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 2 }}>{st.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{st.sub}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fff', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                    <Play size={14} fill="currentColor" style={{ marginLeft: 2 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderDiscoveryHubSection = () => {
    return (
      <section className="aideo-section">
        <div className="aideo-discovery-header">
          <div className="aideo-discovery-title-wrap">
            <h2 className="aideo-sec-title" style={{ margin: 0 }}>Discovery Hub</h2>
            <p style={{ margin: '3px 0 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
              Personalized curation derived from your offline library & streaming trends
            </p>
          </div>

          <div className="aideo-discovery-toolbar">
            {/* Layout Selector: Multi-Shelf vs Unified Feed */}
            <div className="discovery-layout-toggle" title={`Layout: ${discoveryLayout === 'shelves' ? 'Multi-Shelf View' : 'Unified Feed'}`}>
              <button 
                onClick={() => setDiscoveryLayout('shelves')}
                className={`discovery-layout-btn ${discoveryLayout === 'shelves' ? 'active' : ''}`}
                title="Multi-Shelf View"
              >
                <Layers size={13} />
                <span>Shelves</span>
              </button>
              <button 
                onClick={() => setDiscoveryLayout('unified')}
                className={`discovery-layout-btn ${discoveryLayout === 'unified' ? 'active' : ''}`}
                title="Unified Feed View"
              >
                <LayoutGrid size={13} />
                <span>Unified</span>
              </button>
            </div>

            {/* Size Slider (Square Small / Big) */}
            {discoveryViewMode === 'grid' && (
              <div className="discovery-size-slider-wrap" title={`Grid Card Size: ${discoveryCardSize}px`}>
                <LayoutGrid size={11} className="discovery-size-icon-small" />
                <input 
                  type="range"
                  min={130}
                  max={280}
                  step={5}
                  value={discoveryCardSize}
                  onChange={(e) => setDiscoveryCardSize(Number(e.target.value))}
                  className="discovery-size-slider"
                  style={{ '--slider-pct': `${Math.round(((discoveryCardSize - 130) / (280 - 130)) * 100)}%` } as React.CSSProperties}
                  aria-label="Adjust square card size"
                />
                <LayoutGrid size={15} className="discovery-size-icon-large" />
              </div>
            )}

            <div className="discovery-view-toggle">
              <button 
                onClick={() => setDiscoveryViewMode('grid')}
                className={`discovery-view-btn ${discoveryViewMode === 'grid' ? 'active' : ''}`}
                title="Grid View"
              >
                <LayoutGrid size={14} />
              </button>
              <button 
                onClick={() => setDiscoveryViewMode('list')}
                className={`discovery-view-btn ${discoveryViewMode === 'list' ? 'active' : ''}`}
                title="List View"
              >
                <List size={14} />
              </button>
            </div>

            <button 
              onClick={() => fetchRecommendations(true)} 
              disabled={isRefreshingRecs || isLoadingRecs}
              className="discovery-refresh-btn"
              title="Re-run discovery algorithm"
            >
              <RefreshCw size={13} className={isRefreshingRecs || isLoadingRecs ? "spin" : ""} />
              <span>{isRefreshingRecs ? "Curating..." : "Refresh Recommendations"}</span>
            </button>
          </div>
        </div>

        {isLoadingRecs ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)', fontSize: 12, fontWeight: 500 }}>
              <Loader2 className="spin" size={14} style={{ color: 'var(--accent)' }} />
              <span>Curating personalized recommendations from your listening habits...</span>
            </div>
            <div 
              className="discovery-skeleton-grid"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${discoveryCardSize}px, 1fr))` }}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={`skel-${i}`} className="discovery-skeleton-card">
                  <div className="discovery-skeleton-cover" />
                  <div className="discovery-skeleton-line" />
                  <div className="discovery-skeleton-line short" />
                </div>
              ))}
            </div>
          </div>
        ) : discoveryData ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: discoveryLayout === 'shelves' ? 12 : 0 }}>
            {discoveryLayout === 'shelves' ? (
              <>
                {/* Shelf 1: Jump Back In (Recently Played) */}
                {discoveryData.recently_played && discoveryData.recently_played.length > 0 && (
                  <div className="discovery-shelf-section" style={{ marginBottom: 28 }}>
                    <div className="discovery-shelf-header">
                      <div className="discovery-shelf-title-wrap">
                        <RotateCcw size={17} color="var(--accent)" />
                        <h3 className="discovery-shelf-title">Jump Back In</h3>
                      </div>
                      <span className="discovery-shelf-badge">{discoveryData.recently_played.length} tracks</span>
                    </div>
                    {renderTrackCarousel(discoveryData.recently_played.slice(0, 12))}
                  </div>
                )}

                {/* Shelf 2: Made For You Mixes */}
                {discoveryData.mixed_for_you && discoveryData.mixed_for_you.length > 0 && (
                  <div className="discovery-shelf-section" style={{ marginBottom: 28 }}>
                    <div className="discovery-shelf-header">
                      <div className="discovery-shelf-title-wrap">
                        <Sparkles size={17} color="#06b6d4" />
                        <h3 className="discovery-shelf-title">Made For You</h3>
                      </div>
                      <span className="discovery-shelf-badge">Personalized Station Mixes</span>
                    </div>
                    {renderMixCards(discoveryData.mixed_for_you)}
                  </div>
                )}

                {/* Shelf 3: Recommended For You (similar-to-loved + same artist algorithm) */}
                {discoveryData.recommendations && discoveryData.recommendations.length > 0 && (
                  <div className="discovery-shelf-section" style={{ marginBottom: 28 }}>
                    <div className="discovery-shelf-header">
                      <div className="discovery-shelf-title-wrap">
                        <Target size={17} color="var(--accent)" />
                        <h3 className="discovery-shelf-title">Recommended For You</h3>
                      </div>
                      <span className="discovery-shelf-badge">Similar To Songs You Love</span>
                    </div>
                    {renderTrackCarousel(discoveryData.recommendations.slice(0, 12))}
                  </div>
                )}

                {/* Shelf 4: Forgotten Gems */}
                {discoveryData.forgotten_gems && discoveryData.forgotten_gems.length > 0 && (
                  <div className="discovery-shelf-section" style={{ marginBottom: 28 }}>
                    <div className="discovery-shelf-header">
                      <div className="discovery-shelf-title-wrap">
                        <Clock size={17} color="#a855f7" />
                        <h3 className="discovery-shelf-title">Forgotten Gems</h3>
                      </div>
                      <span className="discovery-shelf-badge">Old Favorites You Haven't Played Recently</span>
                    </div>
                    {renderTrackCarousel(discoveryData.forgotten_gems.slice(0, 12))}
                  </div>
                )}

                {/* Shelf 5: Curated Playlist Mixes */}
                {discoveryData.playlist_mixes && discoveryData.playlist_mixes.length > 0 && (
                  <div className="discovery-shelf-section" style={{ marginBottom: 28 }}>
                    <div className="discovery-shelf-header">
                      <div className="discovery-shelf-title-wrap">
                        <ListMusic size={17} color="#ec4899" />
                        <h3 className="discovery-shelf-title">Curated Playlist Mixes</h3>
                      </div>
                      <span className="discovery-shelf-badge">Ready to Play</span>
                    </div>
                    {renderMixCards(discoveryData.playlist_mixes)}
                  </div>
                )}

                {/* Shelf 6: Heavy Rotation */}
                {discoveryData.heavy_rotation && discoveryData.heavy_rotation.length > 0 && (
                  <div className="discovery-shelf-section" style={{ marginBottom: 28 }}>
                    <div className="discovery-shelf-header">
                      <div className="discovery-shelf-title-wrap">
                        <Flame size={17} color="#f59e0b" />
                        <h3 className="discovery-shelf-title">Heavy Rotation</h3>
                      </div>
                      <span className="discovery-shelf-badge">Your Most Repeated Listening Trends</span>
                    </div>
                    {renderTrackCarousel(discoveryData.heavy_rotation.slice(0, 12))}
                  </div>
                )}

                {/* Shelf 7: Global Trends & Charts */}
                {discoveryData.global_charts && discoveryData.global_charts.length > 0 && (
                  <div className="discovery-shelf-section" style={{ marginBottom: 28 }}>
                    <div className="discovery-shelf-header">
                      <div className="discovery-shelf-title-wrap">
                        <Compass size={17} color="#3b82f6" />
                        <h3 className="discovery-shelf-title">Global Trends & Charts</h3>
                      </div>
                      <span className="discovery-shelf-badge">Last.fm Real-Time Discovery</span>
                    </div>
                    {renderTrackCarousel(discoveryData.global_charts.slice(0, 12))}
                  </div>
                )}
              </>
            ) : (
              /* Unified Feed View */
              <div className="discovery-unified-container">
                <div className="discovery-unified-tabs">
                  {buildUnifiedTabs(discoveryData).map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveDiscoveryTab(tab.id);
                        setVisibleRecsCount(15);
                      }}
                      className={`discovery-unified-tab ${activeDiscoveryTab === tab.id ? 'active' : ''}`}
                    >
                      <span>{tab.label}</span>
                      {tab.count > 0 && <span className="tab-badge">{tab.count}</span>}
                    </button>
                  ))}
                </div>

                {activeDiscoveryTab === 'all' && discoveryData.mixed_for_you && discoveryData.mixed_for_you.length > 0 && (
                  <div className="discovery-unified-section">
                    <div className="discovery-unified-section-title">
                      <Sparkles size={14} color="#06b6d4" />
                      <span>Made For You</span>
                    </div>
                    {renderMixCards(discoveryData.mixed_for_you)}
                  </div>
                )}

                {activeDiscoveryTab === 'all' && discoveryData.playlist_mixes && discoveryData.playlist_mixes.length > 0 && (
                  <div className="discovery-unified-section">
                    <div className="discovery-unified-section-title">
                      <ListMusic size={14} color="#ec4899" />
                      <span>Curated Playlist Mixes</span>
                    </div>
                    {renderMixCards(discoveryData.playlist_mixes)}
                  </div>
                )}

                {(() => {
                  const tracksToDisplay = getUnifiedTabTracks(
                    discoveryData,
                    (activeDiscoveryTab as UnifiedTabId) || 'all',
                  );

                  if (tracksToDisplay.length === 0) {
                    return (
                      <div className="aideo-empty-box" style={{ margin: '20px 0' }}>
                        <Compass size={28} />
                        <p>No tracks currently curated in this feed category.</p>
                      </div>
                    );
                  }

                  const paginatedTracks = tracksToDisplay.slice(0, visibleRecsCount);

                  return (
                    <div>
                      {renderTrackCarousel(paginatedTracks)}
                      {tracksToDisplay.length > visibleRecsCount && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
                          <button
                            onClick={() => setVisibleRecsCount(prev => prev + 15)}
                            className="discovery-cta-secondary"
                          >
                            <span>Load More Discovery Tracks</span>
                            <span style={{ fontSize: 11, opacity: 0.7 }}>
                              ({visibleRecsCount} of {tracksToDisplay.length})
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 180, color: 'var(--text-dim)', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 16, padding: 24, textAlign: 'center' }}>
            <Sparkles size={24} color="var(--accent)" style={{ marginBottom: 8 }} />
            <p style={{ margin: '0 0 12px 0', fontSize: 13 }}>Personalized discovery mixes are ready to be curated.</p>
            <button className="btn btn-primary" onClick={() => fetchRecommendations(true)} style={{ padding: '8px 18px', fontSize: 12 }}>
              Load Recommendations
            </button>
          </div>
        )}
      </section>
    );
  };

  const renderQuickRecapSection = () => {
    return (
      <section className="aideo-section">
        <h2 className="aideo-sec-title">Quick Recap</h2>
        {recapTracks.length > 0 ? (
          <div className="aideo-recap-grid">
            {recapTracks.map((t) => (
              <div 
                key={t.id || t.path} 
                className="aideo-recap-item"
                onClick={() => { playTrack(t); setView('nowplaying'); }}
              >
                <div className="aideo-item-cover-wrap">
                  <TrackCardThumbnail path={t.path} coverUrl={t.cover_url} />
                  <div className="aideo-item-play-overlay">
                    <Play size={16} fill="white" color="white" />
                  </div>
                </div>
                <div className="aideo-item-info">
                  <div className="aideo-item-title" title={t.title || baseName(t.path)}>
                    {t.title || baseName(t.path)}
                  </div>
                  <div className="aideo-item-artist" title={t.artist || 'Unknown Artist'}>
                    <ArtistLink name={t.artist || 'Unknown Artist'} onClick={() => triggerSearch(t.artist || 'Unknown Artist')} />
                  </div>
                </div>
                <div className="aideo-item-duration">{fmt(t.duration)}</div>
                {playCounts[t.path] > 0 && (
                  <div className="aideo-item-badge">
                    <Star size={10} fill="var(--accent)" color="var(--accent)" style={{ marginRight: 4 }} />
                    {playCounts[t.path]} {playCounts[t.path] === 1 ? 'play' : 'plays'}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="aideo-empty-box">
            <Music size={32} style={{ marginBottom: 12, color: 'var(--accent)' }} />
            <p style={{ marginBottom: 16 }}>Add folders in settings to scan and load tracks into your library.</p>
            <button className="btn btn-primary" onClick={() => setView('settings')} style={{ padding: '8px 16px', fontSize: 12 }}>
              Open Settings
            </button>
          </div>
        )}
      </section>
    );
  };

  const renderRecentlyPlayedSection = () => {
    return (
      <section className="aideo-section" style={{ marginBottom: 40 }}>
        <h2 className="aideo-sec-title">Recently Played</h2>
        {recentTracks.length > 0 ? (
          <div className="aideo-carousel">
            {recentTracks.map(t => (
              <motion.div 
                key={t.id || t.path}
                whileHover={{ scale: 1.03 }}
                className="aideo-carousel-card"
                onClick={() => { playTrack(t); setView('nowplaying'); }}
              >
                <div className="carousel-cover-wrap">
                  <TrackCardThumbnail path={t.path} coverUrl={t.cover_url} />
                  <div className="carousel-play-overlay">
                    <div className="carousel-play-btn-circle">
                      <Play size={20} fill="white" color="white" />
                    </div>
                  </div>
                </div>
                <div className="carousel-meta">
                  <h4 className="carousel-title" title={t.title || baseName(t.path)}>
                    {t.title || baseName(t.path)}
                  </h4>
                  <p className="carousel-artist" title={t.artist || 'Unknown Artist'}>
                    <ArtistLink name={t.artist || 'Unknown Artist'} onClick={() => triggerSearch(t.artist || 'Unknown Artist')} />
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="aideo-empty-box">
            <History size={32} />
            <p>Your play history is empty. Listen to some tracks from your library first!</p>
          </div>
        )}
      </section>
    );
  };

  const renderSmartMixBuilderSection = () => {
    return (
      <section className="aideo-section" style={{ marginBottom: 32 }}>
        <h2 className="aideo-sec-title">Smart Mix Builder</h2>
        <p className="aideo-subtitle" style={{ marginBottom: 16 }}>Compile dynamic offline playlists custom-tailored to your listening trends, habits, and mood.</p>
        
        <div style={{
          background: 'var(--glass)',
          border: '1px solid var(--glass-border)',
          borderRadius: 16,
          padding: 22,
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 20,
          alignItems: 'center'
        }}>
          {/* Mood Selector */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Select Mood Profile</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['Energetic', 'Chill', 'Focus', 'Melancholic', 'Happy'].map(m => {
                const active = activeMood === m;
                return (
                  <button
                    key={m}
                    onClick={() => setActiveMood(m)}
                    style={{
                      background: active ? 'rgba(6, 182, 212, 0.12)' : 'var(--glass)',
                      border: '1px solid ' + (active ? 'rgba(6, 182, 212, 0.35)' : 'var(--glass-border)'),
                      borderRadius: 8,
                      padding: '6px 12px',
                      color: active ? '#22d3ee' : 'var(--text-dim)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass-h)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass)'; }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Seed Trend Source Selector */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Seed Trend Source</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['Library History', 'Last.fm Trends', 'ListenBrainz Scrobbles'].map(s => {
                const active = activeSource === s;
                return (
                  <button
                    key={s}
                    onClick={() => setActiveSource(s)}
                    style={{
                      background: active ? 'rgba(6, 182, 212, 0.12)' : 'var(--glass)',
                      border: '1px solid ' + (active ? 'rgba(6, 182, 212, 0.35)' : 'var(--glass-border)'),
                      borderRadius: 8,
                      padding: '6px 12px',
                      color: active ? '#22d3ee' : 'var(--text-dim)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass-h)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass)'; }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generator trigger button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleGenerateSmartMix}
              disabled={generatingMix}
              style={{
                padding: '12px 24px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                background: 'var(--accent)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: generatingMix ? 'wait' : 'pointer',
                border: 'none',
                color: 'white',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                opacity: generatingMix ? 0.75 : 1
              }}
              onMouseEnter={(e) => { if (!generatingMix) e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { if (!generatingMix) e.currentTarget.style.transform = 'none'; }}
            >
              {generatingMix ? (
                <>
                  <Loader2 className="spin" size={15} /> Analyzing Patterns...
                </>
              ) : (
                <>
                  <Sparkles size={15} /> Generate & Play Smart Mix
                </>
              )}
            </button>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="aideo-home-wrap">
      {/* Background tint overlay */}
      <div className="aideo-bg-tint"></div>

      {/* Premium Web Search Bar */}
      <div style={{ marginBottom: 36, maxWidth: 640, position: 'relative' }} ref={dropdownRef}>
        <form onSubmit={handleAideoSearch} style={{ display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', display: 'flex', alignItems: 'center' }}>
              <Search size={18} />
            </div>
            <input 
              type="text" 
              placeholder="Search web stream..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setSearchFocused(false);
                }
              }}
              style={{
                width: '100%',
                padding: searchQuery ? '14px 44px 14px 48px' : '14px 20px 14px 48px',
                borderRadius: 14,
                border: '1px solid var(--glass-border)',
                background: 'var(--glass)',
                backdropFilter: 'blur(12px)',
                color: 'var(--text)',
                fontSize: 14,
                fontWeight: 500,
                outline: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              onFocusCapture={(e) => {
                e.target.style.borderColor = 'rgba(var(--accent-rgb), 0.5)';
                e.target.style.boxShadow = '0 0 20px rgba(var(--accent-rgb), 0.15)';
                e.target.style.background = 'var(--glass-h)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'var(--glass-border)';
                e.target.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
                e.target.style.background = 'var(--glass)';
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSuggestions([]);
                  setQuickResults([]);
                }}
                style={{
                  position: 'absolute',
                  right: 16,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 4,
                  borderRadius: '50%',
                  transition: 'background 0.2s, color 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--glass-h)';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'none';
                  e.currentTarget.style.color = 'var(--text-dim)';
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <button
            type="submit"
            style={{
              padding: '0 24px',
              borderRadius: 14,
              border: '1px solid rgba(var(--accent-rgb), 0.3)',
              background: 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.2), rgba(var(--accent-rgb), 0.05))',
              color: 'var(--dynamic-accent)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 15px rgba(var(--accent-rgb), 0.1)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.3), rgba(var(--accent-rgb), 0.1))';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(var(--accent-rgb), 0.2)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.2), rgba(var(--accent-rgb), 0.05))';
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(var(--accent-rgb), 0.1)';
            }}
          >
            Search
          </button>
        </form>

        {/* Floating Suggestions Dropdown */}
        {searchFocused && (searchHistory.length > 0 || suggestions.length > 0 || quickResults.length > 0) && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            background: 'rgba(12, 12, 20, 0.96)',
            backdropFilter: 'blur(24px)',
            borderRadius: 16,
            border: '1px solid var(--glass-border)',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            zIndex: 1000,
            overflow: 'hidden',
            padding: '12px 0',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* History Items */}
            {searchHistory.slice(0, 5).map(q => (
              <div 
                key={`hist-${q}`}
                onClick={() => triggerSearch(q)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
                className="dropdown-item-hover"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text)', fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 }}>
                  <History size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q}</span>
                </div>
                <button
                  onClick={(e) => handleDeleteHistory(e, q)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: '50%',
                    transition: 'background 0.2s, color 0.2s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                    e.currentTarget.style.color = '#f87171';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'none';
                    e.currentTarget.style.color = 'var(--text-dim)';
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}

            {/* Autocomplete Suggestion Items */}
            {suggestions.map(q => (
              <div 
                key={`sugg-${q}`}
                onClick={() => triggerSearch(q)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  color: 'var(--text)',
                  fontSize: 13,
                  fontWeight: 500,
                  gap: 12,
                }}
                className="dropdown-item-hover"
              >
                <Search size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q}</span>
              </div>
            ))}

            {/* Quick Play Songs Section */}
            {quickResults.length > 0 && (
              <>
                <div style={{
                  padding: '12px 16px 6px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  borderTop: '1px solid var(--glass-border)',
                  marginTop: 6,
                }}>
                  Songs
                </div>
                {quickResults.map(track => (
                  <div 
                    key={`quick-${track.id}`}
                    onClick={() => handlePlayQuickTrack(track)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 16px',
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                      gap: 12,
                    }}
                    className="dropdown-item-hover"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                      <TrackCardThumbnail 
                        path={track.url} 
                        coverUrl={track.cover_url} 
                        className="aideo-search-thumb" 
                        fallbackIconSize={16} 
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {track.title}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {track.artist}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>
                      {track.duration_raw}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {searchActive ? (
        <div className="aideo-search-results-view">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
            <button
              onClick={() => {
                setSearchActive(false);
                setSearchQuery('');
                setSearchResults([]);
                setArtistProfile(null);
              }}
              style={{
                background: 'var(--glass)',
                border: '1px solid var(--glass-border)',
                color: 'var(--text)',
                padding: '8px 16px',
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-h)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--glass)'}
            >
              <ArrowLeft size={16} />
              Back to Dashboard
            </button>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', margin: 0 }}>
              Search Results for <span style={{ color: 'var(--accent)' }}>"{searchQuery}"</span>
            </h1>
          </div>

          {isSearching ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 320, color: 'var(--text-dim)', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 20 }}>
              <Loader2 className="spin" size={36} style={{ marginBottom: 12, color: 'var(--accent)' }} />
              <span style={{ fontSize: 14, fontWeight: 500 }}>Searching Web Stream...</span>
            </div>
          ) : artistProfile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              {/* Hero Banner */}
              <div style={{
                position: 'relative',
                borderRadius: 20,
                overflow: 'hidden',
                background: 'var(--glass)',
                border: '1px solid var(--glass-border)',
                padding: '40px',
                display: 'flex',
                gap: '32px',
                alignItems: 'center',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                minHeight: '260px'
              }}>
                {/* Blurred Cover Art Background */}
                {artistHeroImage && (
                  <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundImage: `url(${artistHeroImage})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: 'blur(60px) brightness(0.25)',
                    opacity: 0.65,
                    zIndex: 0,
                    transform: 'scale(1.1)'
                  }} />
                )}
                
                {/* Artist Artwork / Thumbnail */}
                <div style={{
                  position: 'relative',
                  width: 180,
                  height: 180,
                  borderRadius: 20,
                  overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  border: '1px solid var(--glass-border)',
                  zIndex: 1,
                  flexShrink: 0,
                  background: '#1a1a24',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {artistHeroImage ? (
                    <img 
                      src={artistHeroImage} 
                      alt={artistProfile.name} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Music size={64} color="var(--text-dim)" />
                  )}
                </div>

                {/* Artist Information & Actions */}
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
                  <div>
                    <h2 style={{ fontSize: '40px', fontWeight: 900, color: 'var(--text)', margin: '0 0 8px 0', letterSpacing: '-0.5px', lineHeight: 1.1 }}>
                      {artistProfile.name}
                    </h2>
                    <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-dim)', fontWeight: 500 }}>
                      {artistProfile.listeners && (
                        <span>👥 {formatNumber(artistProfile.listeners)} monthly listeners</span>
                      )}
                      {artistProfile.playcount && (
                        <span>💿 {formatNumber(artistProfile.playcount)} total plays</span>
                      )}
                    </div>
                  </div>

                  {/* Biography Summary */}
                  {artistProfile.bio && (
                    <div style={{ maxWidth: '720px' }}>
                      <p style={{
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: 'var(--text-dim)',
                        margin: 0,
                        display: '-webkit-box',
                        WebkitLineClamp: showFullBio ? 'unset' : 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {cleanBio(artistProfile.bio)}
                      </p>
                      {cleanBio(artistProfile.bio).length > 200 && (
                        <button
                          onClick={() => setShowFullBio(!showFullBio)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#06b6d4',
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '4px 0',
                            marginTop: 4,
                            cursor: 'pointer',
                            transition: 'color 0.2s'
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = '#22d3ee'}
                          onMouseLeave={e => e.currentTarget.style.color = '#06b6d4'}
                        >
                          {showFullBio ? 'Show Less' : 'Read More'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Actions buttons */}
                  <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                    <button
                      onClick={() => handlePlayArtistTopTracks(false)}
                      disabled={resolvingTrackId === 'top-tracks-play-all'}
                      style={{
                        padding: '10px 24px',
                        borderRadius: 12,
                        fontSize: 13,
                        fontWeight: 700,
                        background: 'var(--accent)',
                        border: 'none',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        transition: 'transform 0.2s, background 0.2s',
                        boxShadow: '0 4px 15px rgba(139, 92, 246, 0.4)'
                      }}
                      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'none'}
                    >
                      {resolvingTrackId === 'top-tracks-play-all' ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <Play size={16} fill="white" />
                      )}
                      Play Top Tracks
                    </button>
                    <button
                      onClick={() => handlePlayArtistTopTracks(true)}
                      disabled={resolvingTrackId === 'top-tracks-play-all'}
                      style={{
                        padding: '10px 20px',
                        borderRadius: 12,
                        fontSize: 13,
                        fontWeight: 700,
                        background: 'var(--glass)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-h)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--glass)'}
                    >
                      Shuffle
                    </button>
                    <button
                      onClick={handleStartArtistRadio}
                      disabled={resolvingTrackId === 'artist-radio'}
                      style={{
                        padding: '10px 20px',
                        borderRadius: 12,
                        fontSize: 13,
                        fontWeight: 700,
                        background: 'var(--glass)',
                        border: '1px solid var(--glass-border)',
                        color: 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        transition: 'background 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-h)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--glass)'}
                    >
                      {resolvingTrackId === 'artist-radio' ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <Sparkles size={16} />
                      )}
                      Start Radio
                    </button>
                  </div>
                </div>
              </div>

              {/* Discography & Tracks Navigation */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  {/* Tabs */}
                  <div style={{ display: 'flex', gap: 6, background: 'var(--glass)', padding: 4, borderRadius: 14, border: '1px solid var(--glass-border)' }}>
                    <button
                      onClick={() => setArtistActiveTab('popular')}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 10,
                        fontSize: 12,
                        fontWeight: 700,
                        border: 'none',
                        background: artistActiveTab === 'popular' ? 'var(--accent)' : 'transparent',
                        color: artistActiveTab === 'popular' ? '#fff' : 'var(--text-dim)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <Flame size={14} />
                      Popular ({artistProfile.top_tracks?.length || 0})
                    </button>

                    <button
                      onClick={() => setArtistActiveTab('all')}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 10,
                        fontSize: 12,
                        fontWeight: 700,
                        border: 'none',
                        background: artistActiveTab === 'all' ? 'var(--accent)' : 'transparent',
                        color: artistActiveTab === 'all' ? '#fff' : 'var(--text-dim)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <Disc size={14} />
                      All Releases & Songs ({artistDiscography.length || (isLoadingDiscography ? '...' : 0)})
                    </button>

                    {localArtistTracks.length > 0 && (
                      <button
                        onClick={() => setArtistActiveTab('library')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 10,
                          fontSize: 12,
                          fontWeight: 700,
                          border: 'none',
                          background: artistActiveTab === 'library' ? 'var(--accent)' : 'transparent',
                          color: artistActiveTab === 'library' ? '#fff' : 'var(--text-dim)',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}
                      >
                        <Music size={14} />
                        In Library ({localArtistTracks.length})
                      </button>
                    )}
                  </div>

                  {/* Search/Filter within Artist Songs */}
                  <div style={{ position: 'relative', minWidth: 260, flex: '1 1 260px', maxWidth: 400 }}>
                    <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                    <input
                      type="text"
                      placeholder={`Filter all songs by ${artistProfile.name} (e.g. 'de do dri', b-sides)...`}
                      value={artistSongFilter}
                      onChange={e => setArtistSongFilter(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px 8px 34px',
                        borderRadius: 12,
                        background: 'var(--glass)',
                        border: '1px solid var(--glass-border)',
                        color: '#fff',
                        fontSize: 12,
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                    {artistSongFilter && (
                      <button
                        onClick={() => setArtistSongFilter('')}
                        style={{
                          position: 'absolute',
                          right: 8,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-dim)',
                          cursor: 'pointer',
                          padding: 2,
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Tab Contents */}
                {artistActiveTab === 'popular' && (
                  <div style={{
                    background: 'var(--glass)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 20,
                    overflow: 'hidden',
                    backdropFilter: 'blur(20px)'
                  }}>
                    {filteredTopTracks && filteredTopTracks.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {filteredTopTracks.map((t: any, idx: number) => (
                          <PopularTrackRow
                            key={`top-track-${idx}`}
                            track={t}
                            artistName={artistProfile.name}
                            idx={idx}
                            resolvingTrackId={resolvingTrackId}
                            downloadingIds={downloadingIds}
                            downloadedIds={downloadedIds}
                            copiedId={copiedId}
                            handlePlayPopularTrack={handlePlayPopularTrack}
                            handleOpenWebBypassForPopular={handleOpenWebBypassForPopular}
                            handleDownloadPopularTrack={handleDownloadPopularTrack}
                            formatNumber={formatNumber}
                            totalTracks={filteredTopTracks.length}
                          />
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                        <span>No tracks matched "{artistSongFilter}" in Popular Hits.</span>
                        {artistDiscography.length > 0 && (
                          <button
                            onClick={() => setArtistActiveTab('all')}
                            style={{
                              background: 'var(--accent)',
                              border: 'none',
                              color: '#fff',
                              padding: '6px 16px',
                              borderRadius: 12,
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Search across All Releases & Discography
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {artistActiveTab === 'all' && (
                  <div>
                    {isLoadingDiscography ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px', color: 'var(--text-dim)', background: 'var(--glass)', borderRadius: 20 }}>
                        <Loader2 className="spin" size={28} style={{ marginBottom: 10, color: 'var(--accent)' }} />
                        <span style={{ fontSize: 13 }}>Loading full discography, singles & b-sides for {artistProfile.name}...</span>
                      </div>
                    ) : filteredDiscography.length > 0 ? (
                      renderTrackCarousel(filteredDiscography)
                    ) : (
                      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)', background: 'var(--glass)', borderRadius: 16 }}>
                        No songs found in discography matching "{artistSongFilter}".
                      </div>
                    )}
                  </div>
                )}

                {artistActiveTab === 'library' && (
                  <div style={{
                    background: 'var(--glass)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 20,
                    overflow: 'hidden',
                    backdropFilter: 'blur(20px)'
                  }}>
                    {filteredLocalTracks.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {filteredLocalTracks.map((t, idx) => (
                          <div
                            key={t.id || t.path}
                            onClick={() => playTrack(t)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '12px 20px',
                              borderBottom: idx === filteredLocalTracks.length - 1 ? 'none' : '1px solid var(--glass-border)',
                              cursor: 'pointer',
                              gap: 16
                            }}
                            className="dropdown-item-hover"
                          >
                            <div style={{ width: 24, fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', textAlign: 'center' }}>
                              {idx + 1}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {t.title}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                                {t.album || 'Unknown Album'}
                              </div>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                              {fmt(t.duration)}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)' }}>
                        No local tracks found in your library for {artistProfile.name}.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : searchResults.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {renderTrackCarousel(searchResults)}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: 'var(--text-dim)', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 20 }}>
              <Music size={36} style={{ marginBottom: 12, color: 'var(--accent)' }} />
              <span style={{ fontSize: 14, fontWeight: 500 }}>No results found for "{searchQuery}".</span>
            </div>
          )}
        </div>
      ) : (
        <>
          {aideoPageDesign === 'bento' && (
            <div className="aideo-bento-container">
              {/* Greeting */}
              <div className="aideo-greeting-header" style={{ marginBottom: 24 }}>
                <div className="aideo-header-info">
                  <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="aideo-title">
                    {greeting}, Listener
                  </motion.h1>
                  <p className="aideo-subtitle">Editorial Curation · Personalized Discovery Bento</p>
                </div>
                <div className="aideo-header-stats">
                  <div className="aideo-stat-box">
                    <span className="aideo-stat-num">{tracks.length}</span>
                    <span className="aideo-stat-label">Tracks</span>
                  </div>
                  <div className="aideo-stat-box">
                    <span className="aideo-stat-num">{totalPlays}</span>
                    <span className="aideo-stat-label">Plays</span>
                  </div>
                </div>
              </div>

              {renderResumePrompt()}
              {renderBentoHeroSection()}
              {renderDiscoveryHubSection()}
              {renderRecentlyPlayedSection()}
              {showSmartMixWidget && renderSmartMixBuilderSection()}
            </div>
          )}

          {aideoPageDesign === 'audiophile' && (
            <div className="aideo-audiophile-container">
              {renderAudiophileHudSection()}
              {renderResumePrompt()}
              {renderDiscoveryHubSection()}
              {renderRecentlyPlayedSection()}
              {showSmartMixWidget && renderSmartMixBuilderSection()}
            </div>
          )}

          {aideoPageDesign === 'cinematic' && (
            <div className="aideo-cinematic-container">
              {renderCinematicHeroSection()}
              {renderResumePrompt()}
              {renderDiscoveryHubSection()}
              {renderRecentlyPlayedSection()}
              {showSmartMixWidget && renderSmartMixBuilderSection()}
            </div>
          )}

          {(aideoPageDesign === 'classic' || !['bento', 'audiophile', 'cinematic'].includes(aideoPageDesign)) && (
            <>
              {/* Greeting Header */}
              <div className="aideo-greeting-header">
                <div className="aideo-header-info">
                  <motion.h1 
                    initial={{ opacity: 0, y: -15 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    transition={{ duration: 0.5 }}
                    className="aideo-title"
                  >
                    {greeting}, Listener
                  </motion.h1>
                  <p className="aideo-subtitle">Your personalized music portal is fully customized and ready.</p>
                </div>
                <div className="aideo-header-stats">
                  <div className="aideo-stat-box">
                    <span className="aideo-stat-num">{tracks.length}</span>
                    <span className="aideo-stat-label">Tracks</span>
                  </div>
                  <div className="aideo-stat-box">
                    <span className="aideo-stat-num">{totalPlays}</span>
                    <span className="aideo-stat-label">Total Plays</span>
                  </div>
                </div>
              </div>

              {renderResumePrompt()}
              {renderDiscoveryHubSection()}
              {renderQuickRecapSection()}
              {renderRecentlyPlayedSection()}
              {showSmartMixWidget && renderSmartMixBuilderSection()}
            </>
          )}
        </>
      )}
    </div>
  );
}
