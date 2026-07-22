import { useState, useEffect, memo, useRef } from 'react';
import { useStore, Track } from '../store';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Sparkles, History, Compass, Play, Pause, Music, Star, Moon, Download, Check, Loader2, RefreshCw, LayoutGrid, List, Search, X, ArrowLeft, Layers } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
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
        borderBottom: idx === totalTracks - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)',
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
            background: isResolving ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255,255,255,0.04)',
            border: '1px solid ' + (isResolving ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255,255,255,0.08)'),
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
            if (!isResolving) e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
          }}
          onMouseLeave={e => {
            if (!isResolving) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
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
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
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
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
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
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
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

// Artwork caching
const coverArtCache = new Map<string, string | null>();
const pendingArtRequests = new Map<string, Promise<any>>();

// Helper to get premium CSS class for recommendation source badges
function getBadgeClass(source: string) {
  const src = source.toLowerCase();
  if (src.includes('listenbrainz')) return 'badge-listenbrainz';
  if (src.includes('last.fm')) return 'badge-lastfm';
  if (src.includes('favorites') || src.includes('favourite')) return 'badge-favorites';
  if (src.includes('youtube') || src.includes('trending') || src.includes('global')) return 'badge-youtube';
  if (src.includes('•') || src.includes('recently played') || src.includes('recent') || src.includes('γçó') || src.includes('gçó')) return 'badge-recent';
  return 'badge-default';
}

const TrackCardThumbnail = memo(({ path, coverUrl }: { path: string, coverUrl?: string | null }) => {
  const targetPath = coverUrl || path;
  const [art, setArt] = useState<string | null>(coverArtCache.get(targetPath) || null);

  useEffect(() => {
    let active = true;
    const cached = coverArtCache.get(targetPath) || null;
    setArt(cached);

    if (!targetPath) return;

    if (targetPath.startsWith('data:')) {
      setArt(targetPath);
      return;
    }

    if (!cached && !coverArtCache.has(targetPath)) {
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
    }

    return () => {
      active = false;
    };
  }, [targetPath]);

  return (
    <img src={art || defaultCover} alt="" loading="lazy" className="aideo-track-img" />
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
    playback,
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
    appMode
  } = useStore();
  const [greeting, setGreeting] = useState('Good morning');
  const [discoveryViewMode, setDiscoveryViewMode] = useState<'list' | 'grid'>('grid');
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
  const [selectedMood, setSelectedMood] = useState<'all' | 'chill' | 'energy' | 'acoustic'>('all');
  
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
    } else {
      setArtistHeroImage(null);
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

  const getFilteredRecommendations = () => {
    const recs = discoveryData?.recommendations || [];
    const dislikedPaths = new Set(tracks.filter(t => t.disliked === 1).map(t => t.path));
    const filteredByDislike = recs.filter((track: any) => !dislikedPaths.has(track.url || track.path));
    
    if (selectedMood === 'all') return filteredByDislike;

    return filteredByDislike.filter((track: any) => {
      const title = (track.title || '').toLowerCase();
      const artist = (track.artist || '').toLowerCase();
      
      // If it's a local track fallback (starts with local_), check its sonic profile if available!
      if (track.id?.startsWith('local_')) {
        const localId = parseInt(track.id.replace('local_', ''), 10);
        const localTrack = tracks.find(t => t.id === localId);
        if (localTrack) {
          const energy = localTrack.energy ?? 0.5;
          const bpm = localTrack.bpm ?? 120;
          const bass = localTrack.bass_ratio ?? 0.33;
          const treble = localTrack.treble_ratio ?? 0.33;

          if (selectedMood === 'chill') {
            return energy < 0.45 || bass > 0.4;
          }
          if (selectedMood === 'energy') {
            return energy > 0.55 || bpm > 125;
          }
          if (selectedMood === 'acoustic') {
            return treble > 0.4 || bpm < 95;
          }
        }
      }

      // Keyword matching fallback for online / general tracks
      if (selectedMood === 'chill') {
        const terms = ['chill', 'lofi', 'relax', 'ambient', 'soft', 'slow', 'sleep', 'jazz', 'night', 'lo-fi', 'lullaby', 'calm', 'bedtime'];
        return terms.some(t => title.includes(t) || artist.includes(t));
      }
      if (selectedMood === 'energy') {
        const terms = ['energy', 'dance', 'club', 'electro', 'house', 'beat', 'remix', 'workout', 'rock', 'synthwave', 'pop', 'party', 'fast', 'edm', 'drum', 'bass', 'rap', 'hip-hop', 'hard'];
        return terms.some(t => title.includes(t) || artist.includes(t));
      }
      if (selectedMood === 'acoustic') {
        const terms = ['acoustic', 'unplugged', 'vocal', 'live', 'piano', 'solo', 'acapella', 'session', 'guitar', 'plugged', 'ballad', 'indie'];
        return terms.some(t => title.includes(t) || artist.includes(t));
      }
      return true;
    });
  };

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
          if (cached.mixed_for_you && cached.mixed_for_you.length > 0) {
            setActiveDiscoveryTab('mixed');
          } else if (cached.recommendations && cached.recommendations.length > 0) {
            setActiveDiscoveryTab('recommendations');
          } else if (cached.global_charts && cached.global_charts.length > 0) {
            setActiveDiscoveryTab('charts');
          }
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
          await currentStore.fetchListenbrainzDashboard();
        } catch (e) {
          console.error('Failed to auto-fetch ListenBrainz dashboard', e);
        }
      }

      // B. Load Last.fm personalized top artists if connected
      if (isLfmConnected && (!currentStore.lastfmTopArtists || currentStore.lastfmTopArtists.length === 0)) {
        try {
          await currentStore.fetchLastfmDashboard();
        } catch (e) {
          console.error('Failed to auto-fetch Last.fm dashboard', e);
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
        autoplayAlgorithm: currentStore.autoplayAlgorithm || 'v2',
      });

      setDiscoveryData(resolved);
      if (resolved.mixed_for_you && resolved.mixed_for_you.length > 0) {
        setActiveDiscoveryTab('mixed');
      } else if (resolved.recommendations && resolved.recommendations.length > 0) {
        setActiveDiscoveryTab('recommendations');
      } else if (resolved.global_charts && resolved.global_charts.length > 0) {
        setActiveDiscoveryTab('charts');
      }
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

  const handleOpenWebBypass = (track: any, provider: 'lucida' | 'squid') => {
    const searchString = `${track.artist} - ${track.title}`.trim();
    navigator.clipboard.writeText(searchString).then(() => {
      setCopiedId(`${track.id}-${provider}`);
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

  const handleTogglePreview = async (track: any) => {
    const isCurrentTrack = playback.current_track === track.url;
    const isPlaying = isCurrentTrack && playback.status === 'Playing';
    const isPaused = isCurrentTrack && playback.status === 'Paused';

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



  const renderTrackCarousel = (tracksList: any[]) => {
    if (!tracksList || tracksList.length === 0) return null;
    const isGrid = discoveryViewMode === 'grid';
    
    return (
      <div className={isGrid ? "aideo-discovery-grid-layout" : "aideo-discovery-grid"}>
        {tracksList.map((track) => {
          if (isGrid) {
            return (
              <div key={track.id} className="aideo-discovery-grid-card">
                <div className="discovery-grid-cover-wrap">
                  {track.cover_url ? (
                    <img 
                      src={track.cover_url} 
                      alt="" 
                      referrerPolicy="no-referrer"
                      className="discovery-grid-cover-img"
                      loading="lazy"
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}>
                      <Music size={24} color="var(--text-dim)" />
                    </div>
                  )}
                  <div className="discovery-grid-overlay">
                    <div 
                      className="discovery-grid-play-circle"
                      onClick={() => handleTogglePreview(track)}
                      title={
                        playback.current_track === track.url && playback.status === 'Playing'
                          ? "Pause preview"
                          : "Stream online preview"
                      }
                    >
                      {playback.current_track === track.url && playback.status === 'Playing' ? (
                        <Pause size={14} fill="currentColor" />
                      ) : (
                        <Play size={14} fill="currentColor" style={{ marginLeft: 1 }} />
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
                    <span className={`discovery-source-badge ${getBadgeClass(track.recommendation_source)}`} style={{ fontSize: '7.5px', padding: '2px 6px' }}>
                      {(track.recommendation_source.includes('•') || track.recommendation_source.includes('ΓÇó')) && (
                        <span className="pulse" style={{ display: 'inline-block', width: 3, height: 3, borderRadius: '50%', background: '#10b981', marginRight: 3 }} />
                      )}
                      {track.recommendation_source}
                    </span>
                  )}
                </div>

                <div className="discovery-grid-footer">
                  <span className="discovery-grid-dur-badge">{track.duration_raw}</span>
                  <div className="discovery-grid-badge-row">
                    <button 
                      onClick={() => handleOpenWebBypass(track, 'lucida')}
                      className="discovery-grid-action-btn lucida"
                      title="Copy & search FLAC on Lucida"
                    >
                      {copiedId === `${track.id}-lucida` ? <Check size={10} /> : "L"}
                    </button>
                    <button 
                      onClick={() => handleOpenWebBypass(track, 'squid')}
                      className="discovery-grid-action-btn squid"
                      title="Copy & search FLAC on Squid"
                    >
                      {copiedId === `${track.id}-squid` ? <Check size={10} /> : "S"}
                    </button>
                  </div>

                  {downloadedIds.has(track.id) ? (
                    <div className="discovery-grid-download-btn downloaded" title="Added to Offline Library">
                      <Check size={10} />
                    </div>
                  ) : downloadingIds.has(track.id) ? (
                    <div 
                      className="discovery-grid-download-btn downloading" 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        width: 20, 
                        height: 20,
                        borderRadius: 6,
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.2)',
                        color: '#10b981',
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                    >
                      <Loader2 size={8} className="pulse" />
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleDownloadTrack(track)}
                      className="discovery-grid-download-btn"
                      title="Download stream offline"
                    >
                      <Download size={10} />
                    </button>
                  )}
                </div>
              </div>
            );
          } else {
            return (
              <div 
                key={track.id}
                className="aideo-discovery-list-item"
              >
                <div className="discovery-cover-wrap">
                  {track.cover_url ? (
                    <img 
                      src={track.cover_url} 
                      alt="" 
                      referrerPolicy="no-referrer"
                      className="discovery-cover-img"
                      loading="lazy"
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}>
                      <Music size={24} color="var(--text-dim)" />
                    </div>
                  )}
                  <div className="discovery-overlay">
                    <div 
                      className="discovery-play-circle"
                      onClick={() => handleTogglePreview(track)}
                      title={
                        playback.current_track === track.url && playback.status === 'Playing'
                          ? "Pause preview"
                          : "Stream online preview"
                      }
                    >
                      {playback.current_track === track.url && playback.status === 'Playing' ? (
                        <Pause size={14} fill="currentColor" />
                      ) : (
                        <Play size={14} fill="currentColor" style={{ marginLeft: 1 }} />
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
                        <span className="pulse" style={{ display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: '#10b981', marginRight: 4 }} />
                      )}
                      {track.recommendation_source}
                    </span>
                  )}
                </div>

                <div className="discovery-footer">
                  <span className="discovery-dur-badge">{track.duration_raw}</span>
                  <div className="discovery-badge-row">
                    <button 
                      onClick={() => handleOpenWebBypass(track, 'lucida')}
                      className="discovery-action-btn lucida"
                      title="Copy & search lossless FLAC on Lucida.to"
                    >
                      {copiedId === `${track.id}-lucida` ? <Check size={10} /> : "Lucida"}
                    </button>
                    <button 
                      onClick={() => handleOpenWebBypass(track, 'squid')}
                      className="discovery-action-btn squid"
                      title="Copy & search lossless FLAC on Squid.wtf"
                    >
                      {copiedId === `${track.id}-squid` ? <Check size={10} /> : "Squid"}
                    </button>
                  </div>

                  {downloadedIds.has(track.id) ? (
                    <div className="discovery-download-btn downloaded" title="Added to Offline Library">
                      <Check size={12} />
                    </div>
                  ) : downloadingIds.has(track.id) ? (
                    <div 
                      className="discovery-download-btn downloading" 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 4, 
                        width: 'auto', 
                        padding: '0 6px', 
                        borderRadius: 6,
                        background: 'rgba(16, 185, 129, 0.1)',
                        border: '1px solid rgba(16, 185, 129, 0.2)',
                        color: '#10b981',
                        fontSize: 9,
                        fontWeight: 700,
                        position: 'relative',
                        overflow: 'hidden',
                        height: 24
                      }}
                    >
                      {downloadProgress[track.url] && (
                        <div 
                          style={{ 
                            position: 'absolute', 
                            left: 0, 
                            top: 0, 
                            bottom: 0, 
                            width: `${downloadProgress[track.url].percent}%`, 
                            background: 'rgba(16, 185, 129, 0.18)', 
                            zIndex: 0,
                            transition: 'width 0.2s ease-out'
                          }} 
                        />
                      )}
                      <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Loader2 size={8} className="pulse" />
                        {downloadProgress[track.url] ? (
                          <span>
                            {Math.round(downloadProgress[track.url].percent)}%
                          </span>
                        ) : (
                          <span>...</span>
                        )}
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

  return (
    <div className="aideo-home-wrap">
      {/* Background tint overlay */}
      <div className="aideo-bg-tint"></div>

      {/* Premium Web Search Bar */}
      <div style={{ marginBottom: 36, maxWidth: 640, position: 'relative' }} ref={dropdownRef}>
        <form onSubmit={handleAideoSearch} style={{ display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center' }}>
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
                boxShadow: '0 4px 20px rgba(0,0,0,0.2), inset 0 2px 4px rgba(255,255,255,0.02)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              onFocusCapture={(e) => {
                e.target.style.borderColor = 'rgba(var(--accent-rgb), 0.5)';
                e.target.style.boxShadow = '0 0 20px rgba(var(--accent-rgb), 0.15), inset 0 2px 4px rgba(255,255,255,0.02)';
                e.target.style.background = 'rgba(255,255,255,0.05)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(255,255,255,0.08)';
                e.target.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2), inset 0 2px 4px rgba(255,255,255,0.02)';
                e.target.style.background = 'rgba(255,255,255,0.03)';
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
                  color: 'rgba(255,255,255,0.4)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 4,
                  borderRadius: '50%',
                  transition: 'background 0.2s, color 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'none';
                  e.currentTarget.style.color = 'rgba(255,255,255,0.4)';
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
            border: '1px solid rgba(255, 255, 255, 0.08)',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'rgba(255, 255, 255, 0.85)', fontSize: 13, fontWeight: 500, flex: 1, minWidth: 0 }}>
                  <History size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q}</span>
                </div>
                <button
                  onClick={(e) => handleDeleteHistory(e, q)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.4)',
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
                    e.currentTarget.style.color = 'rgba(255,255,255,0.4)';
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
                  color: 'rgba(255, 255, 255, 0.85)',
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
                  borderTop: '1px solid rgba(255,255,255,0.06)',
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
                      {track.cover_url ? (
                        <img 
                          src={track.cover_url} 
                          alt="" 
                          style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: 6, background: '#1a1a24', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Music size={16} color="var(--text-dim)" />
                        </div>
                      )}
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
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
            >
              <ArrowLeft size={16} />
              Back to Dashboard
            </button>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: 'white', margin: 0 }}>
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
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
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
                  border: '1px solid rgba(255,255,255,0.1)',
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
                    <h2 style={{ fontSize: '40px', fontWeight: 900, color: 'white', margin: '0 0 8px 0', letterSpacing: '-0.5px', lineHeight: 1.1 }}>
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
                        color: 'rgba(255,255,255,0.75)',
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

              {/* Popular Tracks Section */}
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 16 }}>Popular Songs</h3>
                <div style={{
                  background: 'var(--glass)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 20,
                  overflow: 'hidden',
                  backdropFilter: 'blur(20px)'
                }}>
                  {artistProfile.top_tracks && artistProfile.top_tracks.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {artistProfile.top_tracks.map((t: any, idx: number) => (
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
                          totalTracks={artistProfile.top_tracks.length}
                        />
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-dim)' }}>
                      No popular tracks found for this artist.
                    </div>
                  )}
                </div>
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



          {/* Section: Aideo Discovery Hub */}
          <section className="aideo-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 className="aideo-sec-title" style={{ margin: 0 }}>Discovery Hub</h2>
                <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 20, background: 'rgba(139, 92, 246, 0.1)', color: 'var(--accent)', border: '1px solid rgba(139, 92, 246, 0.2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tailored for You</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <button 
                  onClick={() => setDiscoveryViewMode(prev => prev === 'list' ? 'grid' : 'list')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, transition: 'color 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
                  title={discoveryViewMode === 'list' ? "Switch to Grid view" : "Switch to List view"}
                >
                  {discoveryViewMode === 'list' ? <LayoutGrid size={12} /> : <List size={12} />}
                  {discoveryViewMode === 'list' ? "Grid View" : "List View"}
                </button>
                <button 
                  onClick={() => fetchRecommendations(true)} 
                  disabled={isRefreshingRecs || isLoadingRecs}
                  style={{ background: 'none', border: 'none', color: isRefreshingRecs ? 'var(--accent)' : 'var(--text-dim)', cursor: isRefreshingRecs ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, transition: 'color 0.2s' }}
                  onMouseEnter={(e) => { if (!isRefreshingRecs) e.currentTarget.style.color = 'var(--text)'; }}
                  onMouseLeave={(e) => { if (!isRefreshingRecs) e.currentTarget.style.color = 'var(--text-dim)'; }}
                >
                  <RefreshCw size={12} className={isRefreshingRecs || isLoadingRecs ? "spin" : ""} />
                  {isRefreshingRecs ? "Refreshing..." : "Refresh Recommendations"}
                </button>
              </div>
            </div>

            {isLoadingRecs ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: 'var(--text-dim)', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 20 }}>
                <Loader2 className="spin" size={28} style={{ marginBottom: 12, color: 'var(--accent)' }} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>Curating recommendations based on your offline history...</span>
              </div>
            ) : discoveryData ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Permanent Mixed for You Shelf at the Top */}
                {discoveryData.mixed_for_you && discoveryData.mixed_for_you.length > 0 && (
                  <div style={{ marginBottom: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <Layers size={18} color="var(--accent)" />
                      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Mixed for You</h2>
                    </div>
                    <div className="aideo-mix-grid">
                      {discoveryData.mixed_for_you.map((mix: YoutubeMix) => {
                        const isRecap = mix.id.includes('recap');
                        const isDiscovery = mix.id.includes('discovery');
                        const isChill = mix.id.includes('chill');
                        const isArtist = mix.id.includes('artist_mix');
                        const isGenre = mix.id.includes('genre_mix');
                        
                        let iconType = 'sparkles';
                        let iconColorClass = 'sm';
                        if (isRecap) { iconType = 'recap'; iconColorClass = 'rc'; }
                        else if (isDiscovery || isArtist || isGenre) { iconType = 'discovery'; iconColorClass = 'dc'; }
                        else if (isChill) { iconType = 'chill'; iconColorClass = 'ch'; }

                        const renderIcon = () => {
                          switch (iconType) {
                            case 'recap': return <History size={22} />;
                            case 'discovery': return <Compass size={22} />;
                            case 'chill': return <Moon size={22} />;
                            default: return <Sparkles size={22} className="pulse" />;
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{mix.title}</h3>
                                  <span style={{
                                    fontSize: 8,
                                    fontWeight: 800,
                                    padding: '2px 5px',
                                    borderRadius: 10,
                                    background: mix.id.startsWith('local_mix_') ? 'rgba(255,255,255,0.06)' : 'rgba(59, 130, 246, 0.15)',
                                    color: mix.id.startsWith('local_mix_') ? 'var(--text-dim)' : '#60a5fa',
                                    border: mix.id.startsWith('local_mix_') ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(59, 130, 246, 0.2)',
                                    textTransform: 'uppercase',
                                    lineHeight: 1
                                  }}>
                                    {mix.id.startsWith('local_mix_') ? 'Local' : 'Hybrid'}
                                  </span>
                                </div>
                                <p style={{ margin: '2px 0 0 0', fontSize: 11, color: 'var(--text-dim)' }}>{mix.description}</p>
                              </div>
                              <button className="mix-play-btn">
                                <Play size={18} fill="currentColor" />
                              </button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Premium Tab Switched Bar */}
                <div style={{ 
                  display: 'flex', 
                  gap: 8, 
                  padding: 4, 
                  background: 'rgba(255, 255, 255, 0.03)', 
                  border: '1px solid rgba(255, 255, 255, 0.06)', 
                  borderRadius: 12, 
                  marginBottom: 20,
                  width: 'fit-content'
                }}>


                  {discoveryData.recommendations && discoveryData.recommendations.length > 0 && (
                    <button
                      onClick={() => setActiveDiscoveryTab('recommendations')}
                      className={`settings-tab-btn ${activeDiscoveryTab === 'recommendations' ? 'active' : ''}`}
                      style={{
                        padding: '8px 16px',
                        fontSize: 11,
                        fontWeight: 700,
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: activeDiscoveryTab === 'recommendations' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
                        border: 'none',
                        color: activeDiscoveryTab === 'recommendations' ? 'var(--accent)' : 'var(--text-dim)',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <Sparkles size={12} />
                      {tracks.length > 0 ? "Tailored Mix" : "Curated Seeds"}
                    </button>
                  )}

                  {discoveryData.global_charts && discoveryData.global_charts.length > 0 && (
                    <button
                      onClick={() => setActiveDiscoveryTab('charts')}
                      className={`settings-tab-btn ${activeDiscoveryTab === 'charts' ? 'active' : ''}`}
                      style={{
                        padding: '8px 16px',
                        fontSize: 11,
                        fontWeight: 700,
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: activeDiscoveryTab === 'charts' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                        border: 'none',
                        color: activeDiscoveryTab === 'charts' ? '#f87171' : 'var(--text-dim)',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <Compass size={12} />
                      Worldwide Charts
                    </button>
                  )}
                </div>

                {/* Shelf Content */}
                <motion.div
                  key={activeDiscoveryTab === 'mixed' ? 'recommendations' : activeDiscoveryTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {(activeDiscoveryTab === 'recommendations' || activeDiscoveryTab === 'mixed') && (() => {
                    const filteredRecs = activeDiscoveryTab === 'recommendations' ? getFilteredRecommendations() : (discoveryData.recommendations || []);
                    return (
                      <>
                        {activeDiscoveryTab === 'recommendations' && (
                          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                            {[
                              { id: 'all', label: '✨ All Tracks' },
                              { id: 'chill', label: '☕ Relaxed & Chill' },
                              { id: 'energy', label: '⚡ High Energy' },
                              { id: 'acoustic', label: '🎸 Acoustic & Vocal' }
                            ].map(mood => (
                              <button
                                key={mood.id}
                                onClick={() => { setSelectedMood(mood.id as any); setVisibleRecsCount(15); }}
                                style={{
                                  padding: '6px 14px',
                                  borderRadius: 16,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  border: '1px solid rgba(255, 255, 255, 0.06)',
                                  background: selectedMood === mood.id ? 'var(--accent)' : 'rgba(255, 255, 255, 0.02)',
                                  color: selectedMood === mood.id ? 'white' : 'var(--text-dim)',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                }}
                                onMouseEnter={(e) => {
                                  if (selectedMood !== mood.id) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                }}
                                onMouseLeave={(e) => {
                                  if (selectedMood !== mood.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                                }}
                              >
                                {mood.label}
                              </button>
                            ))}
                          </div>
                        )}
                        {filteredRecs.length > 0 ? renderTrackCarousel(filteredRecs.slice(0, visibleRecsCount)) : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', background: 'rgba(255,255,255,0.01)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.05)' }}>
                            <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                              No tracks matched this category in your current recommendations.
                            </span>
                          </div>
                        )}
                        {filteredRecs.length > visibleRecsCount && (
                          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
                            <button
                              onClick={() => setVisibleRecsCount(prev => prev + 15)}
                              style={{
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                color: '#fff',
                                padding: '10px 24px',
                                borderRadius: 20,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                                e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb), 0.35)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                              }}
                            >
                              Load More Recommendations
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {activeDiscoveryTab === 'charts' && (() => {
                    const dislikedPaths = new Set(tracks.filter(t => t.disliked === 1).map(t => t.path));
                    const chartsFiltered = (discoveryData.global_charts || []).filter((t: any) => !dislikedPaths.has(t.url || t.path));
                    return renderTrackCarousel(chartsFiltered);
                  })()}
                </motion.div>
              </div>
            ) : null}
          </section>
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
     
          {/* Section: Recently Played Horizontal Carousel */}
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

          {/* Section: Smart Mix Builder */}
          {showSmartMixWidget && (
          <section className="aideo-section" style={{ marginBottom: 32 }}>
            <h2 className="aideo-sec-title">Smart Mix Builder</h2>
            <p className="aideo-subtitle" style={{ marginBottom: 16 }}>Compile dynamic offline playlists custom-tailored to your listening trends, habits, and mood.</p>
            
            <div style={{
              background: 'var(--glass)',
              border: '1px solid var(--glass-border)',
              borderRadius: 20,
              padding: 24,
              backdropFilter: 'blur(20px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 24,
              alignItems: 'center'
            }}>
              {/* Mood Selector */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Select Mood</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['Energetic', 'Chill', 'Focus', 'Melancholic', 'Happy'].map(m => {
                    const active = activeMood === m;
                    const emoji = m === 'Energetic' ? '⚡' : m === 'Chill' ? '☕' : m === 'Focus' ? '🎯' : m === 'Melancholic' ? '🌧️' : '☀️';
                    return (
                      <button
                        key={m}
                        onClick={() => setActiveMood(m)}
                        style={{
                          background: active ? 'var(--accent)' : 'var(--glass)',
                          border: '1px solid ' + (active ? 'var(--accent)' : 'var(--glass-border)'),
                          borderRadius: 10,
                          padding: '8px 14px',
                          color: active ? 'white' : 'var(--text)',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass-h)'; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass)'; }}
                      >
                        {emoji} {m}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Seed Trend Source Selector */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Seed Trend Source</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {['Library History', 'Last.fm Trends', 'ListenBrainz Scrobbles'].map(s => {
                    const active = activeSource === s;
                    const icon = s.includes('Library') ? '💿' : s.includes('Last.fm') ? '📻' : '🎵';
                    return (
                      <button
                        key={s}
                        onClick={() => setActiveSource(s)}
                        style={{
                          background: active ? 'var(--accent)' : 'var(--glass)',
                          border: '1px solid ' + (active ? 'var(--accent)' : 'var(--glass-border)'),
                          borderRadius: 10,
                          padding: '8px 14px',
                          color: active ? 'white' : 'var(--text)',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass-h)'; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass)'; }}
                      >
                        {icon} {s}
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
                    padding: '14px 28px',
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                    boxShadow: '0 0 20px rgba(168, 85, 247, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    border: 'none',
                    color: 'white',
                    transition: 'transform 0.2s, opacity 0.2s',
                    opacity: generatingMix ? 0.75 : 1
                  }}
                  onMouseEnter={(e) => { if (!generatingMix) e.currentTarget.style.transform = 'scale(1.03)'; }}
                  onMouseLeave={(e) => { if (!generatingMix) e.currentTarget.style.transform = 'scale(1.0)'; }}
                >
                  {generatingMix ? (
                    <>
                      <Loader2 className="spin" size={16} /> Analyzing Patterns...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} /> Generate & Play Smart Mix
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
          )}
        </>
      )}
    </div>
  );
}
