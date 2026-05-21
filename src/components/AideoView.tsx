import { useState, useEffect, memo } from 'react';
import { useStore } from '../store';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Sparkles, History, Compass, Coffee, Play, Pause, Music, Star, Sunrise, Moon, Download, Check, Loader2, RefreshCw } from 'lucide-react';
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

const TrackCardThumbnail = memo(({ path }: { path: string }) => {
  const [art, setArt] = useState<string | null>(coverArtCache.get(path) || null);

  useEffect(() => {
    if (!art && !coverArtCache.has(path)) {
      if (!pendingArtRequests.has(path)) {
        const req = invoke('get_cover_art', { path }).then((res: any) => {
          const artUrl = (res && typeof res === 'string') ? res : null;
          coverArtCache.set(path, artUrl);
          return artUrl;
        }).catch(() => {
          coverArtCache.set(path, null);
          return null;
        }).finally(() => {
          pendingArtRequests.delete(path);
        });
        pendingArtRequests.set(path, req);
      }
      
      pendingArtRequests.get(path)?.then(resolvedArt => {
        if (resolvedArt) setArt(resolvedArt);
      });
    }
  }, [path, art]);

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
    toggleSettings, 
    playStream,
    playback,
    pauseTrack,
    resumeTrack
  } = useStore();
  const [greeting, setGreeting] = useState('Good morning');
  const [timeMix, setTimeMix] = useState({
    title: 'Chill Mix',
    description: 'A relaxing selection designed for peaceful environments',
    iconType: 'chill'
  });

  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [isLoadingRecs, setIsLoadingRecs] = useState(true);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchRecommendations = async () => {
    setIsLoadingRecs(true);
    try {
      // 1. Calculate top artists from library
      const artistPlayCounts: Record<string, number> = {};
      tracks.forEach(track => {
        if (track.artist && track.artist !== 'Unknown Artist' && track.artist !== 'YouTube Audio') {
          const count = playCounts[track.path] || 0;
          if (count > 0) {
            artistPlayCounts[track.artist] = (artistPlayCounts[track.artist] || 0) + count;
          }
        }
      });

      const topArtists = Object.entries(artistPlayCounts)
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0])
        .slice(0, 5);

      if (topArtists.length === 0) {
        const artistFrequencies: Record<string, number> = {};
        tracks.forEach(track => {
          if (track.artist && track.artist !== 'Unknown Artist' && track.artist !== 'YouTube Audio') {
            artistFrequencies[track.artist] = (artistFrequencies[track.artist] || 0) + 1;
          }
        });
        const mostFrequent = Object.entries(artistFrequencies)
          .sort((a, b) => b[1] - a[1])
          .map(entry => entry[0])
          .slice(0, 5);
        topArtists.push(...mostFrequent);
      }

      // 2. Query Tauri command
      const rawRecs = await invoke<any[]>('get_aideo_recommendations', {
        topArtists,
        excludeIds: []
      });

      // 3. Dual-layer filter (exclude tracks matching existing library titles)
      const libraryTitles = new Set(tracks.map(t => (t.title || '').toLowerCase().trim()));
      const filtered = rawRecs.filter(rec => !libraryTitles.has(rec.title.toLowerCase().trim()));

      setRecommendations(filtered);
    } catch (err) {
      console.error('Failed to load aideo recommendations:', err);
    } finally {
      setIsLoadingRecs(false);
    }
  };

  // Load recommendations when library is loaded
  useEffect(() => {
    fetchRecommendations();
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
      await invoke('download_track', { url: track.url, quality: 'high' });
      setDownloadedIds(prev => {
        const next = new Set(prev);
        next.add(track.id);
        return next;
      });
      // Refresh the library store immediately so it updates the downloaded state
      await useStore.getState().loadLibrary();
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
        await playStream(track.url);
        
        // Update OS media metadata specifically for this stream with its title and artist info
        invoke('update_media_metadata', {
          title: track.title,
          artist: track.artist,
          coverUrl: track.cover_url || null,
          duration: 0,
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
  const recentTracks = playHistory
    .map(path => tracks.find(t => t.path === path))
    .filter((t): t is typeof tracks[0] => !!t)
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

  return (
    <div className="aideo-home-wrap">
      {/* Background tint overlay */}
      <div className="aideo-bg-tint"></div>

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
            whileHover={{ y: -6, scale: 1.02 }}
            onClick={() => playDynamicMix('supermix')}
            className="aideo-mix-card supermix"
          >
            <div className="mix-gradient-bg sm" />
            <div className="mix-card-content">
              <div className="mix-card-icon-wrap">
                <Sparkles size={24} className="pulse" />
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
            whileHover={{ y: -6, scale: 1.02 }}
            onClick={() => playDynamicMix('recap')}
            className="aideo-mix-card recap"
          >
            <div className="mix-gradient-bg rc" />
            <div className="mix-card-content">
              <div className="mix-card-icon-wrap">
                <History size={24} />
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
            whileHover={{ y: -6, scale: 1.02 }}
            onClick={() => playDynamicMix('discovery')}
            className="aideo-mix-card discovery"
          >
            <div className="mix-gradient-bg dc" />
            <div className="mix-card-content">
              <div className="mix-card-icon-wrap">
                <Compass size={24} />
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
            whileHover={{ y: -6, scale: 1.02 }}
            onClick={() => playDynamicMix('chill')}
            className="aideo-mix-card chill"
          >
            <div className="mix-gradient-bg ch" />
            <div className="mix-card-content">
              <div className="mix-card-icon-wrap">
                {timeMix.iconType === 'sunrise' ? (
                  <Sunrise size={24} className="pulse" />
                ) : timeMix.iconType === 'focus' ? (
                  <Coffee size={24} />
                ) : (
                  <Moon size={24} />
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

      {/* Section: Aideo AI Discovery Hub */}
      <section className="aideo-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="aideo-sec-title" style={{ margin: 0 }}>AI Discovery Hub</h2>
            <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 20, background: 'rgba(139, 92, 246, 0.1)', color: 'var(--accent)', border: '1px solid rgba(139, 92, 246, 0.2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tailored for You</span>
          </div>
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

        {isLoadingRecs ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: 'var(--text-dim)', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 20 }}>
            <Loader2 className="spin" size={28} style={{ marginBottom: 12, color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Curating recommendations based on your offline history...</span>
          </div>
        ) : recommendations.length > 0 ? (
          <div className="aideo-discovery-carousel">
            {recommendations.map((track) => (
              <motion.div 
                key={track.id}
                whileHover={{ scale: 1.02 }}
                className="aideo-discovery-card"
              >
                <div className="discovery-cover-wrap">
                  {track.cover_url ? (
                    <img 
                      src={track.cover_url} 
                      alt="" 
                      referrerPolicy="no-referrer"
                      className="discovery-cover-img"
                    />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}>
                      <Music size={40} color="var(--text-dim)" />
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
                        <Pause size={22} fill="currentColor" />
                      ) : (
                        <Play size={22} fill="currentColor" style={{ marginLeft: 3 }} />
                      )}
                    </div>
                  </div>
                  <span className="discovery-dur-badge">{track.duration_raw}</span>
                </div>

                <div className="discovery-meta">
                  <h4 className="discovery-title" title={track.title}>{track.title}</h4>
                  <p className="discovery-artist" title={track.artist}>{track.artist}</p>
                </div>

                <div className="discovery-footer">
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
                    <div className="discovery-download-btn downloading">
                      <Loader2 size={12} className="spin" />
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
              </motion.div>
            ))}
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
                  <TrackCardThumbnail path={t.path} />
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
            <button className="btn btn-primary" onClick={toggleSettings} style={{ padding: '8px 16px', fontSize: 12 }}>
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
                  <TrackCardThumbnail path={t.path} />
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
    </div>
  );
}
