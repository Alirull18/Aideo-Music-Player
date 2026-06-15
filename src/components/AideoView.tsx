import { useState, useEffect, memo, useRef } from 'react';
import { useStore } from '../store';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Sparkles, History, Compass, Coffee, Play, Pause, Music, Star, Sunrise, Moon, Download, Check, Loader2, RefreshCw, LayoutGrid, List, Search } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';

// Format track duration
function fmt(s: number | null) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// Extract track base name
function baseName(p: string | null) {
  return p ? (p.split(/[\\/]/).pop() ?? p) : '—';
}

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
  const isCloud = path.startsWith('http://') || path.startsWith('https://') || (coverUrl && (coverUrl.startsWith('http://') || coverUrl.startsWith('https://')));
  const isSelfHosted = coverUrl && (coverUrl.startsWith('http://') || coverUrl.includes('/rest/getCoverArt.view') || coverUrl.includes('/Images/Primary'));
  const isRemote = coverUrl && coverUrl.startsWith('https://') && !isSelfHosted;
  const targetPath = isRemote ? coverUrl : (coverUrl || path);
  const [art, setArt] = useState<string | null>(isRemote ? coverUrl : (coverArtCache.get(targetPath) || null));

  useEffect(() => {
    if (isRemote) {
      setArt(coverUrl);
      return;
    }
    if (isCloud && !coverUrl) {
      setArt(null);
      return;
    }
    if (!art && !coverArtCache.has(targetPath)) {
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
        if (resolvedArt) setArt(resolvedArt);
      });
    }
  }, [targetPath, art, isRemote, isCloud, coverUrl]);

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
    playDynamicMix, 
    setView, 
    playStream,
    playback,
    pauseTrack,
    resumeTrack,
    generateSmartMix,
    showSmartMixWidget,
    discoveryData,
    setDiscoveryData,
    isLoadingRecs,
    setIsLoadingRecs,
    activeDiscoveryTab,
    setActiveDiscoveryTab
  } = useStore();
  const [greeting, setGreeting] = useState('Good morning');
  const [timeMix, setTimeMix] = useState({
    title: 'Chill Mix',
    description: 'A relaxing selection designed for peaceful environments',
    iconType: 'chill'
  });
  const [discoveryViewMode, setDiscoveryViewMode] = useState<'list' | 'grid'>('grid');
  const isFetchingRef = useRef(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, { percent: number; downloaded_mb: number; total_mb: number }>>({});

  const [activeMood, setActiveMood] = useState('Chill');
  const [activeSource, setActiveSource] = useState('Library History');
  const [generatingMix, setGeneratingMix] = useState(false);
  const [visibleRecsCount, setVisibleRecsCount] = useState(15);
  const [searchQuery, setSearchQuery] = useState('');

  const handleAideoSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setView('aideo_search');
    const q = searchQuery.trim();
    setSearchQuery('');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('ui-trigger-search', {
        detail: { query: q, provider: 'tidal' }
      }));
    }, 100);
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

  const fetchRecommendations = async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setIsLoadingRecs(true);
    setVisibleRecsCount(15);
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
        if (track.artist && track.artist !== 'Unknown Artist' && track.artist !== 'YouTube Audio') {
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
          if (track.artist && track.artist !== 'Unknown Artist' && track.artist !== 'YouTube Audio') {
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
      const topArtists = Object.entries(artistPlayCounts)
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0])
        .slice(0, 5);

      if (topArtists.length === 0) {
        topArtists.push(...offlineSeedArtists);
      }

      // Find library artists for re-ranking
      const libraryArtists = Array.from(new Set(
        currentTracks
          .map(t => t.artist)
          .filter((a): a is string => !!a && a !== 'Unknown Artist' && a !== 'YouTube Audio')
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
      });

      setDiscoveryData(resolved);
      if (!resolved.recommendations || resolved.recommendations.length === 0) {
        if (resolved.global_charts && resolved.global_charts.length > 0) {
          setActiveDiscoveryTab('charts');
        }
      }
    } catch (err) {
      console.error('Failed to load personalized discovery recommendations:', err);
    } finally {
      setIsLoadingRecs(false);
      isFetchingRef.current = false;
    }
  };

  // Load recommendations when library is loaded
  useEffect(() => {
    if (!discoveryData) {
      if (tracks.length > 0) {
        fetchRecommendations();
      } else {
        const timer = setTimeout(() => {
          if (!discoveryData) {
            fetchRecommendations();
          }
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [tracks.length, discoveryData]);

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
      await invoke('download_track', { url: track.url, quality: 'high' });
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
        detail: { message: `YouTube download failed: ${err}`, type: 'error' } 
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
        const parsedSeconds = (() => {
          const parts = (track.duration_raw || '').split(':').map(Number);
          if (parts.length === 2) return parts[0] * 60 + parts[1];
          if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
          return 0;
        })();
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

  // Personalized Greeting based on local time
  useEffect(() => {
    const hrs = new Date().getHours();
    if (hrs < 12) setGreeting('Good morning');
    else if (hrs < 18) setGreeting('Good afternoon');
    else setGreeting('Good evening');

    // Dynamic Mood Mix based on local time
    if (hrs >= 5 && hrs < 12) {
      setTimeMix({
        title: 'Sunrise Energy Mix',
        description: 'Upbeat tracks to energize your morning routine',
        iconType: 'sunrise'
      });
    } else if (hrs >= 12 && hrs < 17) {
      setTimeMix({
        title: 'Productive Focus Mix',
        description: 'Steady, mid-tempo tracks to keep your flow going',
        iconType: 'focus'
      });
    } else {
      setTimeMix({
        title: 'Chill & Unwind Mix',
        description: 'A relaxing selection designed for peaceful evenings',
        iconType: 'chill'
      });
    }
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
                  <p className="discovery-grid-artist" title={track.artist}>{track.artist}</p>
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
                  <p className="discovery-artist" title={track.artist}>{track.artist}</p>
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

      {/* Premium Tidal Search Bar */}
      <div style={{ marginBottom: 36, maxWidth: 640 }}>
        <form onSubmit={handleAideoSearch} style={{ display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', display: 'flex', alignItems: 'center' }}>
              <Search size={18} />
            </div>
            <input 
              type="text" 
              placeholder="Search Tidal Lossless Cloud..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '14px 20px 14px 48px',
                borderRadius: 14,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                backdropFilter: 'blur(12px)',
                color: 'white',
                fontSize: 14,
                fontWeight: 500,
                outline: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2), inset 0 2px 4px rgba(255,255,255,0.02)',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(6, 182, 212, 0.5)';
                e.target.style.boxShadow = '0 0 20px rgba(6, 182, 212, 0.15), inset 0 2px 4px rgba(255,255,255,0.02)';
                e.target.style.background = 'rgba(255,255,255,0.05)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(255,255,255,0.08)';
                e.target.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2), inset 0 2px 4px rgba(255,255,255,0.02)';
                e.target.style.background = 'rgba(255,255,255,0.03)';
              }}
            />
          </div>
          <button
            type="submit"
            style={{
              padding: '0 24px',
              borderRadius: 14,
              border: '1px solid rgba(6, 182, 212, 0.3)',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.05))',
              color: '#06b6d4',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 15px rgba(6, 182, 212, 0.1)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.3), rgba(6, 182, 212, 0.1))';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(6, 182, 212, 0.2)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(6, 182, 212, 0.05))';
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(6, 182, 212, 0.1)';
            }}
          >
            Search
          </button>
        </form>
      </div>

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

      {/* Section: Your Mixes */}
      <section className="aideo-section">
        <h2 className="aideo-sec-title">Mixed for You</h2>
        <div className="aideo-mix-grid">
          {/* Card: My Supermix */}
          <motion.div 
            whileTap={{ scale: 0.98 }}
            onClick={() => playDynamicMix('supermix')}
            className="aideo-mix-card supermix"
          >
            <div className="mix-card-content">
              <div className="mix-card-icon-wrap sm">
                <Sparkles size={22} className="pulse" />
              </div>
              <div className="mix-card-text">
                <h3>My Supermix</h3>
                <p>Your top tracks blended with random library favorites</p>
              </div>
              <button className="mix-play-btn">
                <Play size={18} fill="currentColor" />
              </button>
            </div>
          </motion.div>

          {/* Card: Aideo Recap */}
          <motion.div 
            whileTap={{ scale: 0.98 }}
            onClick={() => playDynamicMix('recap')}
            className="aideo-mix-card recap"
          >
            <div className="mix-card-content">
              <div className="mix-card-icon-wrap rc">
                <History size={22} />
              </div>
              <div className="mix-card-text">
                <h3>Aideo Recap Mix</h3>
                <p>The ultimate recap of your top-played music</p>
              </div>
              <button className="mix-play-btn">
                <Play size={18} fill="currentColor" />
              </button>
            </div>
          </motion.div>

          {/* Card: Discovery Mix */}
          <motion.div 
            whileTap={{ scale: 0.98 }}
            onClick={() => playDynamicMix('discovery')}
            className="aideo-mix-card discovery"
          >
            <div className="mix-card-content">
              <div className="mix-card-icon-wrap dc">
                <Compass size={22} />
              </div>
              <div className="mix-card-text">
                <h3>Discovery Mix</h3>
                <p>Explore gems in your library that you haven't played much</p>
              </div>
              <button className="mix-play-btn">
                <Play size={18} fill="currentColor" />
              </button>
            </div>
          </motion.div>

          {/* Card: Dynamic Time-of-Day Mix */}
          <motion.div 
            whileTap={{ scale: 0.98 }}
            onClick={() => playDynamicMix('chill')}
            className="aideo-mix-card chill"
          >
            <div className="mix-card-content">
              <div className="mix-card-icon-wrap ch">
                {timeMix.iconType === 'sunrise' ? (
                  <Sunrise size={22} className="pulse" />
                ) : timeMix.iconType === 'focus' ? (
                  <Coffee size={22} />
                ) : (
                  <Moon size={22} />
                )}
              </div>
              <div className="mix-card-text">
                <h3>{timeMix.title}</h3>
                <p>{timeMix.description}</p>
              </div>
              <button className="mix-play-btn">
                <Play size={18} fill="currentColor" />
              </button>
            </div>
          </motion.div>
        </div>
      </section>



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
              onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
              title={discoveryViewMode === 'list' ? "Switch to Grid view" : "Switch to List view"}
            >
              {discoveryViewMode === 'list' ? <LayoutGrid size={12} /> : <List size={12} />}
              {discoveryViewMode === 'list' ? "Grid View" : "List View"}
            </button>
            <button 
              onClick={fetchRecommendations} 
              disabled={isLoadingRecs}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, transition: 'color 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-dim)'}
            >
              <RefreshCw size={12} className={isLoadingRecs ? "spin" : ""} />
              Refresh Recommendations
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
              key={activeDiscoveryTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {activeDiscoveryTab === 'recommendations' && (
                <>
                  {renderTrackCarousel(discoveryData.recommendations.slice(0, visibleRecsCount))}
                  {discoveryData.recommendations.length > visibleRecsCount && (
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
              )}
              {activeDiscoveryTab === 'charts' && renderTrackCarousel(discoveryData.global_charts)}
            </motion.div>
          </div>
        ) : (
          <div className="aideo-empty-box">
            <Compass size={32} style={{ marginBottom: 12, color: 'var(--accent)' }} />
            <p>We searched online but couldn't find any recommendations matching your current library interests. Try expanding your music taste!</p>
          </div>
        )}
      </section>

      {/* Section: Quick Recap Grid */}
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
                    {t.artist || 'Unknown Artist'}
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
                    {t.artist || 'Unknown Artist'}
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

      {/* Section: AI Smart Mix Builder */}
      {showSmartMixWidget && (
      <section className="aideo-section" style={{ marginBottom: 32 }}>
        <h2 className="aideo-sec-title">AI Smart Mix Builder</h2>
        <p className="aideo-subtitle" style={{ marginBottom: 16 }}>Compile dynamic offline mixes custom-tailored to scrobble trends, listening history metrics, and mood parameters.</p>
        
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
                      background: active ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                      border: '1px solid ' + (active ? 'var(--accent)' : 'var(--glass-border)'),
                      borderRadius: 10,
                      padding: '8px 14px',
                      color: 'white',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
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
                      background: active ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                      border: '1px solid ' + (active ? 'var(--accent)' : 'var(--glass-border)'),
                      borderRadius: 10,
                      padding: '8px 14px',
                      color: 'white',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
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
                  <Loader2 className="spin" size={16} /> Compiling AI Patterns...
                </>
              ) : (
                <>
                  <Sparkles size={16} /> Generate & Play AI Mix
                </>
              )}
            </button>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
