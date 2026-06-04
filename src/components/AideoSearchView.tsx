import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Search, Download, Loader2, Music, CheckCircle2, Globe, Check, ExternalLink, Info, Play, Pause, AlertCircle, Music2, Settings2, ChevronDown, ChevronUp, LogOut } from 'lucide-react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';

interface YoutubeTrack {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  duration_raw: string;
  url: string;
}

interface TidalTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url: string;
  quality: string;
}

const REGIONS = [
  { code: 'AUTO', label: 'Auto (From Account)' },
  { code: 'MY', label: 'Malaysia' },
  { code: 'SG', label: 'Singapore' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'JP', label: 'Japan' },
  { code: 'AU', label: 'Australia' },
];

export function AideoSearchView() {
  const { 
    playback, playStream, pauseTrack, resumeTrack
  } = useStore();

  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  
  // Tabs State
  const [searchTab, setSearchTab] = useState<'youtube' | 'tidal'>('youtube');
  
  // Results States
  const [youtubeResults, setYoutubeResults] = useState<YoutubeTrack[]>([]);
  const [tidalResults, setTidalResults] = useState<TidalTrack[]>([]);

  // Tidal Session & Connection State
  const [tidalLoggedIn, setTidalLoggedIn] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState(localStorage.getItem('tidal_region') || 'AUTO');
  const [polling, setPolling] = useState(false);
  const [userCode, setUserCode] = useState('');
  const [activationUrl, setActivationUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Custom credentials panel
  const [showCreds, setShowCreds] = useState(false);
  const [customClientId, setCustomClientId] = useState('');
  const [customClientSecret, setCustomClientSecret] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, { percent: number; downloaded_mb: number; total_mb: number }>>({});
  
  // Copy state to show a checkmark temporarily
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadingTidalPreviewId, setLoadingTidalPreviewId] = useState<string | null>(null);

  useEffect(() => {
    // Check Tidal session
    invoke<boolean>('tidal_login_poll_status')
      .then(s => setTidalLoggedIn(s))
      .catch(() => {});

    invoke<any>('tidal_get_credentials')
      .then(c => { setCustomClientId(c.client_id || ''); setCustomClientSecret(c.client_secret || ''); })
      .catch(() => {});

    const subs: Array<Promise<any>> = [];

    subs.push(listen<any>('ytdlp-download-progress', (event) => {
      const { url, percent, downloaded_mb, total_mb } = event.payload;
      setDownloadProgress(prev => ({
        ...prev,
        [url]: { percent, downloaded_mb, total_mb }
      }));
    }));

    subs.push(listen<any>('tidal-download-progress', (event) => {
      const { track_id, percent, downloaded_mb, total_mb } = event.payload;
      if (track_id) {
        setDownloadProgress(prev => ({
          ...prev,
          [track_id]: { percent, downloaded_mb, total_mb }
        }));
      }
    }));

    subs.push(listen<any>('tidal-download-complete', (event) => {
      const { track_id } = event.payload;
      if (track_id) {
        setDownloadedIds(prev => {
          const next = new Set(prev);
          next.add(track_id);
          return next;
        });
        setDownloadingIds(prev => {
          const next = new Set(prev);
          next.delete(track_id);
          return next;
        });
        useStore.getState().loadLibrary(); // Rescan database immediately
      }
    }));

    subs.push(listen<any>('tidal-download-error', (event) => {
      const { track_id } = event.payload;
      if (track_id) {
        setDownloadingIds(prev => {
          const next = new Set(prev);
          next.delete(track_id);
          return next;
        });
      }
    }));

    subs.push(listen('tidal-login-success', () => {
      setTidalLoggedIn(true);
      setPolling(false);
      setUserCode('');
      setActivationUrl('');
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Successfully logged in to Lossless Cloud!', type: 'success' } }));
    }));

    subs.push(listen('tidal-login-expired', () => {
      setPolling(false);
      setUserCode('');
      setActivationUrl('');
      setErrorMsg('Authorization link expired. Please try again.');
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Lossless Cloud pairing code expired', type: 'error' } }));
    }));

    const handleTriggerSearch = (e: any) => {
      const { query: searchQ, provider } = e.detail || {};
      if (searchQ) {
        setSearchTab(provider || 'youtube');
        triggerInstantSearch(searchQ, provider || 'youtube');
      }
    };
    window.addEventListener('ui-trigger-search', handleTriggerSearch);

    return () => {
      subs.forEach(subPromise => {
        subPromise.then(unsub => unsub());
      });
      window.removeEventListener('ui-trigger-search', handleTriggerSearch);
    };
  }, []);

  const handleStartLogin = async () => {
    setErrorMsg(null);
    setPolling(true);
    try {
      const res = await invoke<any>('tidal_login_start');
      setUserCode(res.userCode);
      setActivationUrl(res.verificationUriComplete);
    } catch (err: any) {
      setErrorMsg(err.toString());
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Login initialization failed: ${err}`, type: 'error' } }));
      setPolling(false);
    }
  };

  const handleSaveCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await invoke('tidal_save_credentials', { clientId: customClientId.trim(), clientSecret: customClientSecret.trim() });
      setSaveSuccess(true);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Lossless Cloud API Credentials saved', type: 'success' } }));
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to save credentials: ${err}`, type: 'error' } }));
    }
  };

  const handleLogout = async () => {
    try {
      await invoke('tidal_logout');
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Logged out of Lossless Cloud', type: 'info' } }));
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Logout error: ${err}`, type: 'error' } }));
    }
    setTidalLoggedIn(false);
    setTidalResults([]);
    setQuery('');
    setErrorMsg(null);
  };

  const handleTogglePreview = async (track: YoutubeTrack) => {
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
          cover_url: track.cover_url,
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

  const handleTogglePreviewTidal = async (track: TidalTrack) => {
    const isPlaying = playback.current_track && playback.status === 'Playing' && useStore.getState().currentTrack?.id === -20000 - Number(track.id);
    const isPaused = playback.current_track && playback.status === 'Paused' && useStore.getState().currentTrack?.id === -20000 - Number(track.id);

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
      setLoadingTidalPreviewId(track.id);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Acquiring direct secure FLAC stream for ${track.title}...`, type: 'info' } 
      }));
      try {
        const cdnUrl = await invoke<string>('tidal_get_stream_url', { trackId: track.id });
        
        await playStream(cdnUrl, {
          title: track.title,
          artist: track.artist,
          cover_url: track.cover_url || null,
          duration: track.duration
        });

        useStore.setState({
          currentTrack: {
            id: -20000 - Number(track.id),
            path: cdnUrl,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            format: 'Tidal FLAC',
            lyric_offset: 0,
            cover_url: track.cover_url || null
          }
        });
        
        invoke('update_media_metadata', {
          title: track.title,
          artist: track.artist,
          coverUrl: track.cover_url || null,
          duration: track.duration,
        }).catch(() => {});
      } catch (e) {
        console.error('Failed to acquire Tidal stream:', e);
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Tidal stream error: ${e}`, type: 'error' } 
        }));
      } finally {
        setLoadingTidalPreviewId(null);
      }
    }
  };

  const triggerInstantSearch = async (q: string, tab: 'youtube' | 'tidal') => {
    setQuery(q);
    setIsSearching(true);
    try {
      if (tab === 'youtube') {
        const tracks = await invoke<YoutubeTrack[]>('search_youtube', { query: q });
        setYoutubeResults(tracks);
      } else if (tab === 'tidal') {
        if (!tidalLoggedIn) {
          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Please log in to Lossless Cloud first!', type: 'warning' } }));
          setIsSearching(false);
          return;
        }
        const tracks = await invoke<TidalTrack[]>('tidal_search', { query: q, region: selectedRegion === 'AUTO' ? null : selectedRegion });
        setTidalResults(tracks);
      }
    } catch (err) {
      console.error("Instant search error", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Search failed: ${err}`, type: 'error' } }));
    } finally {
      setIsSearching(false);
    }
  };

  const discoverSuggestions = {
    youtube: [
      { id: 'yt-lofi', label: 'Lofi Chill Café ☕', q: 'lofi chill beats for study', color: '150, 60%, 50%', desc: 'Relaxing, ambient lofi tracks for focus and work.' },
      { id: 'yt-synth', label: 'Retro Synthwave 🌌', q: 'retro synthwave music', color: '280, 80%, 65%', desc: 'High-octane outrun and retrowave instrumental synthesizers.' },
      { id: 'yt-gaming', label: 'Gaming Energy 🎮', q: 'gaming dubstep electro energy mix', color: '340, 85%, 60%', desc: 'Intense beats and bass to supercharge your sessions.' },
      { id: 'yt-acoustic', label: 'Sunset Acoustic 🌅', q: 'acoustic soft pop sunshine sunset', color: '30, 90%, 60%', desc: 'Warm vocals and organic acoustic strings for chilling out.' },
      { id: 'yt-jazz', label: 'Midnight Jazz Lounge 🎷', q: 'smooth jazz night lounge', color: '200, 75%, 55%', desc: 'Velvet saxophones and late-night smooth jazz lounge.' },
      { id: 'yt-dnb', label: 'Liquid Drum & Bass ⚡', q: 'liquid drum and bass focus mix', color: '180, 70%, 50%', desc: 'Rapid, atmospheric breakbeats and soothing deep sub-bass.' },
    ],
    tidal: [
      { id: 'td-lofi', label: 'Lossless Chillhop ☕', q: 'lofi beats chillhop', color: '150, 60%, 50%', desc: 'Studio-master lofi instrumentals.' },
      { id: 'td-synth', label: 'Cyberpunk Retrowave 🌌', q: 'synthwave retro', color: '280, 80%, 65%', desc: 'Pristine 24-bit analog synthesizer wave.' },
      { id: 'td-acoustic', label: 'Acoustic Folk Gold 🌅', q: 'acoustic folk singer songwriter', color: '30, 90%, 60%', desc: 'Pure vocal recordings and bright guitar transients.' },
      { id: 'td-jazz', label: 'Hi-Fi Jazz Legends 🎷', q: 'jazz blue note legends', color: '200, 75%, 55%', desc: 'Mastered direct analog tape jazz recordings.' },
      { id: 'td-classical', label: 'Orchestral Hall 🎻', q: 'orchestra symphonic classical masterpiece', color: '340, 85%, 60%', desc: 'Ultra-wide dynamic range symphonic audio masters.' },
      { id: 'td-electronic', label: 'Lossless Ambient Space 🍃', q: 'ambient electronic chillout spacerock', color: '180, 70%, 50%', desc: 'Subtle soundscapes and clean electronic transients.' },
    ]
  };

  const trendingCharts = [
    { label: 'Global Top Hits Today', q: 'billboard hot 100 today', color: '#10b981', provider: 'youtube' },
    { label: 'R&B / Hip-Hop Hotlist', q: 'hot new hip hop songs today', color: '#06b6d4', provider: 'youtube' },
    { label: 'Indie & Alternative Essentials', q: 'indie rock alternative essentials', color: '#a855f7', provider: 'youtube' }
  ];

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);

    try {
      const finalQuery = query.trim();

      if (searchTab === 'youtube') {
        const tracks = await invoke<YoutubeTrack[]>('search_youtube', { query: finalQuery });
        setYoutubeResults(tracks);
      } else if (searchTab === 'tidal') {
        if (!tidalLoggedIn) {
          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Please log in to Lossless Cloud first!', type: 'warning' } }));
          setIsSearching(false);
          return;
        }
        const tracks = await invoke<TidalTrack[]>('tidal_search', { query: finalQuery, region: selectedRegion === 'AUTO' ? null : selectedRegion });
        setTidalResults(tracks);
      }
    } catch (err) {
      console.error("Search error", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Search failed: ${err}`, type: 'error' } }));
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownloadYoutube = async (track: YoutubeTrack) => {
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
      useStore.getState().loadLibrary(); // Rescan database immediately
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Successfully added to offline library: ${track.title}!`, type: 'success' } 
      }));
    } catch (err) {
      console.error("Download error", err);
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Web Stream download failed: ${err}`, type: 'error' } 
      }));
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  const handleDownloadTidal = async (track: TidalTrack) => {
    if (downloadingIds.has(track.id) || downloadedIds.has(track.id)) return;
    
    setDownloadingIds(prev => {
      const next = new Set(prev);
      next.add(track.id);
      return next;
    });
    
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Downloading lossless FLAC from Lossless Cloud: ${track.title}...`, type: 'info' } 
    }));
    
    try {
      await invoke('tidal_download', { 
        trackId: track.id, 
        filename: `${track.artist} - ${track.title}`,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration
      });
    } catch (err) {
      console.error("Tidal download error", err);
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Lossless Cloud download failed: ${err}`, type: 'error' } 
      }));
    }
  };

  const handleOpenWebBypass = (trackName: string, provider: 'lucida' | 'squid') => {
    const searchString = trackName.trim();
    navigator.clipboard.writeText(searchString).then(() => {
      setCopiedId(`${searchString}-${provider}`);
      setTimeout(() => setCopiedId(null), 2000);
      
      const targetUrl = provider === 'lucida' 
        ? `https://lucida.to` 
        : `https://squid.wtf`;
      
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Copied "${searchString}"! Opening ${provider} in browser...`, type: 'success' } 
      }));
      
      openUrl(targetUrl).catch(() => {
        window.open(targetUrl, '_blank');
      });
    });
  };

  const fmtDuration = (s: number) => {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // Determine active tab theme colors dynamically
  let activeColor = '#10b981';
  let activePlaceholder = 'Search YouTube Music for high-fidelity streams...';
  let activeDescription = 'Download studio-grade YouTube Music streams directly into your offline library.';

  if (searchTab === 'youtube') {
    activeColor = '#10b981';
    activePlaceholder = 'Search Web Streams for high-fidelity audio...';
    activeDescription = 'Download high-fidelity community web streams directly into your offline library.';
  } else if (searchTab === 'tidal') {
    activeColor = '#06b6d4';
    activePlaceholder = 'Search Lossless Hi-Fi Cloud for studio FLAC tracks...';
    activeDescription = 'Search & download studio-master CD-quality lossless FLAC files from Lossless Hi-Fi Cloud.';
  }

  // Dynamic active tab headers based on active connections
  const activeTabs = [
    { id: 'youtube', label: 'Web Streams', color: '#10b981' },
    { id: 'tidal', label: 'Lossless Hi-Fi Cloud', color: '#06b6d4' }
  ];

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header Panel */}
      <div className="section-header" style={{ padding: '40px 40px 20px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ 
              fontSize: 42, 
              fontWeight: 900, 
              marginBottom: 8, 
              color: 'white'
            }}>
              Aideo Search
            </h1>
            <p style={{ color: 'var(--text-dim)', fontSize: 14, transition: 'color 0.3s' }}>
              {activeDescription}
            </p>
          </div>
          
          {/* Quick Manual Lossless Web Downloader Badges */}
          <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: 12, border: '1px solid var(--glass-border)', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Lossless FLAC:</span>
            <button 
              onClick={() => openUrl('https://lucida.to').catch(() => window.open('https://lucida.to', '_blank'))}
              style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#10b981', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
            >
              lucida.to <ExternalLink size={10} />
            </button>
            <button 
              onClick={() => openUrl('https://squid.wtf').catch(() => window.open('https://squid.wtf', '_blank'))}
              style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: '#3b82f6', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
            >
              squid.wtf <ExternalLink size={10} />
            </button>
          </div>
        </div>

        {/* Dynamic Source Switcher Tabs */}
        <div style={{ display: 'flex', gap: 16, marginTop: 24, paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
          <AnimatePresence>
            {activeTabs.map(tab => (
              <motion.button
                key={tab.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                onClick={() => {
                  setSearchTab(tab.id as any);
                  setQuery('');
                }}
                style={{
                  position: 'relative',
                  padding: '8px 16px',
                  background: 'transparent',
                  border: 'none',
                  color: searchTab === tab.id ? 'white' : 'var(--text-dim)',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {searchTab === tab.id && (
                  <motion.div
                    layoutId="activeSearchTab"
                    style={{
                      position: 'absolute',
                      bottom: -5,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: tab.color,
                      borderRadius: 1
                    }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                {tab.label}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>

        {/* Tidal Session Active Info / Region / Disconnect Bar */}
        {searchTab === 'tidal' && tidalLoggedIn && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} 
            animate={{ opacity: 1, y: 0 }}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              padding: '10px 16px', 
              background: 'rgba(6, 182, 212, 0.04)', 
              border: '1px solid rgba(6, 182, 212, 0.1)', 
              borderRadius: 12, 
              marginTop: 16,
              gap: 16,
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#06b6d4' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>Lossless Cloud Session Active</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500 }}>Region:</span>
                <select
                  value={selectedRegion}
                  onChange={e => { setSelectedRegion(e.target.value); localStorage.setItem('tidal_region', e.target.value); }}
                  style={{
                    padding: '4px 24px 4px 10px',
                    borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(0,0,0,0.3)',
                    color: 'white',
                    fontSize: 11,
                    fontWeight: 600,
                    outline: 'none',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    appearance: 'none',
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%237b8ba8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 6px center',
                  }}
                >
                  {REGIONS.map(r => (
                    <option key={r.code} value={r.code} style={{ background: '#0c0c14' }}>{r.label}</option>
                  ))}
                </select>
              </div>
              
              <button
                onClick={handleLogout}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 4, 
                  padding: '4px 10px', 
                  background: 'rgba(239, 68, 68, 0.08)', 
                  border: '1px solid rgba(239, 68, 68, 0.15)', 
                  borderRadius: 6, 
                  color: '#fca5a5', 
                  fontSize: 11, 
                  fontWeight: 600, 
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'; }}
              >
                <LogOut size={11} /> Disconnect
              </button>
            </div>
          </motion.div>
        )}

        {/* Search Input Bar */}
        <form onSubmit={handleSearch} style={{ marginTop: 20, display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }}>
              <Search size={18} />
            </div>
            <input 
              type="text" 
              placeholder={activePlaceholder}
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%',
                padding: /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/.test(query) ? '16px 170px 16px 48px' : '16px 20px 16px 48px',
                borderRadius: 14,
                border: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(0,0,0,0.35)',
                color: 'white',
                fontSize: 15,
                fontWeight: 500,
                outline: 'none',
                boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.3)',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = `rgba(${searchTab === 'youtube' ? '16, 185, 129' : searchTab === 'tidal' ? '6, 182, 212' : searchTab === 'subsonic' ? '99, 102, 241' : '245, 158, 11'}, 0.4)`}
              onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.06)'}
            />
            {/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/.test(query) && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                type="button"
                onClick={async () => {
                  const match = query.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/);
                  if (match && match[1]) {
                    const videoId = match[1];
                    const directPlayUrl = `https://www.youtube.com/watch?v=${videoId}`;
                    
                    window.dispatchEvent(new CustomEvent('ui-toast', { 
                      detail: { message: `Streaming direct YouTube link: ${videoId}...`, type: 'success' } 
                    }));

                    await playStream(directPlayUrl, {
                      title: `Direct Stream (${videoId})`,
                      artist: 'YouTube Video Link',
                      cover_url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                      duration: 0
                    });

                    useStore.setState({
                      currentTrack: {
                        id: -30000,
                        path: directPlayUrl,
                        title: `Direct Stream (${videoId})`,
                        artist: 'YouTube Video Link',
                        duration: null,
                        format: 'YouTube Direct',
                        lyric_offset: 0,
                        cover_url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                      }
                    });
                  }
                }}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#10b981',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  zIndex: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 0 10px rgba(16, 185, 129, 0.2)'
                }}
              >
                <Globe size={11} className="pulse" />
                Stream Link Instantly
              </motion.button>
            )}
          </div>
          
          <button 
            type="submit"
            style={{
              padding: '0 28px',
              borderRadius: 14,
              background: `linear-gradient(135deg, ${activeColor}dd, ${activeColor})`,
              color: 'white',
              border: 'none',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: `0 4px 15px rgba(${searchTab === 'youtube' ? '16, 185, 129' : searchTab === 'tidal' ? '6, 182, 212' : searchTab === 'subsonic' ? '99, 102, 241' : '245, 158, 11'}, 0.25)`,
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            {isSearching ? <Loader2 size={16} className="pulse" /> : <Search size={16} />}
            Search
          </button>
        </form>
      </div>

      {/* Results Panel */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 40px 40px' }}>
        {isSearching ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80%', color: 'var(--text-dim)' }}>
            <Loader2 className="pulse" size={32} style={{ marginBottom: 16, color: activeColor }} />
            <span>Scanning the digital airwaves...</span>
          </div>
        ) : (() => {
          if (searchTab === 'youtube') {
            return youtubeResults.length > 0 ? (
              <div className="track-list" style={{ marginTop: 12 }}>
                <div className="track-list-header" style={{ display: 'grid', gridTemplateColumns: '48px 1.2fr 0.8fr 80px 240px', padding: '0 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-dim)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <div></div>
                  <div>Title</div>
                  <div>Channel</div>
                  <div>Duration</div>
                  <div style={{ textAlign: 'center' }}>Actions</div>
                </div>
                
                <AnimatePresence>
                  {youtubeResults.map((track) => {
                    const isOfficial = track.artist.toLowerCase().includes('topic') || 
                                      track.artist.toLowerCase().includes('vevo') || 
                                      track.artist.toLowerCase().includes('official');
                    
                    return (
                      <motion.div 
                        key={track.id} 
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="track-item" 
                        style={{ display: 'grid', gridTemplateColumns: '48px 1.2fr 0.8fr 80px 240px', padding: '12px 16px', alignItems: 'center', borderRadius: 8, transition: 'background 0.2s', borderBottom: '1px solid rgba(255,255,255,0.02)' }}
                      >
                        {/* Cover Art / Interactive Preview */}
                        <div 
                          onClick={() => handleTogglePreview(track)}
                          style={{ 
                            width: 36, 
                            height: 36, 
                            borderRadius: 6, 
                            overflow: 'hidden', 
                            background: 'rgba(255,255,255,0.05)', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            position: 'relative',
                            cursor: 'pointer'
                          }}
                          onMouseEnter={(e) => {
                            const overlay = e.currentTarget.querySelector('.play-hover-overlay') as HTMLElement;
                            if (overlay) overlay.style.opacity = '1';
                          }}
                          onMouseLeave={(e) => {
                            const overlay = e.currentTarget.querySelector('.play-hover-overlay') as HTMLElement;
                            if (overlay) overlay.style.opacity = '0';
                          }}
                        >
                          {track.cover_url ? (
                            <img src={track.cover_url} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <Music size={16} color="var(--text-dim)" />
                          )}
                          
                          {/* Play/Pause Hover Overlay */}
                          <div 
                            className="play-hover-overlay"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              background: 'rgba(0,0,0,0.55)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              opacity: playback.current_track === track.url && playback.status === 'Playing' ? 1 : 0,
                              transition: 'opacity 0.2s',
                            }}
                          >
                            {playback.current_track === track.url && playback.status === 'Playing' ? (
                              <Pause size={14} fill="currentColor" color="white" />
                            ) : (
                              <Play size={14} fill="currentColor" color="white" style={{ marginLeft: 2 }} />
                            )}
                          </div>
                        </div>
                        
                        {/* Title */}
                        <div style={{ paddingRight: 16, overflow: 'hidden' }}>
                          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 8 }}>
                            {track.title}
                            {isOfficial ? (
                              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                                STUDIO MASTER
                              </span>
                            ) : (
                              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 4, background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
                                AAC HQ
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {/* Channel */}
                        <div style={{ color: 'var(--text-dim)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 16 }}>
                          {track.artist}
                        </div>
                        
                        {/* Duration */}
                        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                          {track.duration_raw}
                        </div>
                        
                        {/* Actions Grid */}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                          {/* Play / Preview Button */}
                          <button
                            onClick={() => handleTogglePreview(track)}
                            title={playback.current_track === track.url && playback.status === 'Playing' ? "Pause preview" : "Stream preview"}
                            style={{
                              background: playback.current_track === track.url && playback.status === 'Playing'
                                ? 'rgba(16,185,129,0.15)'
                                : 'rgba(255,255,255,0.03)',
                              border: playback.current_track === track.url && playback.status === 'Playing'
                                ? '1px solid rgba(16,185,129,0.3)'
                                : '1px solid rgba(255,255,255,0.06)',
                              color: playback.current_track === track.url && playback.status === 'Playing' ? '#10b981' : 'white',
                              cursor: 'pointer',
                              padding: '6px 8px',
                              borderRadius: 8,
                              fontSize: 11,
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              transition: 'all 0.2s'
                            }}
                          >
                            {playback.current_track === track.url && playback.status === 'Playing' ? (
                              <>
                                <Pause size={11} fill="currentColor" />
                                <span>Playing</span>
                              </>
                            ) : (
                              <>
                                <Play size={11} fill="currentColor" style={{ marginLeft: 1 }} />
                                <span>Preview</span>
                              </>
                            )}
                          </button>

                          {/* Lucida Bypass Copy Shortcut */}
                          <button
                            onClick={() => handleOpenWebBypass(`${track.artist.replace(' - Topic', '')} - ${track.title}`, 'lucida')}
                            title="Copy & Open in Lucida.to (Pristine Lossless FLAC)"
                            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#10b981', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
                          >
                            {copiedId === `${track.artist.replace(' - Topic', '')} - ${track.title}-lucida` ? <Check size={11} /> : <Globe size={11} />}
                            Lucida
                          </button>
    
                          {/* Squid Bypass Copy Shortcut */}
                          <button
                            onClick={() => handleOpenWebBypass(`${track.artist.replace(' - Topic', '')} - ${track.title}`, 'squid')}
                            title="Copy & Open in Squid.wtf (Lossless FLAC)"
                            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#3b82f6', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
                          >
                            {copiedId === `${track.artist.replace(' - Topic', '')} - ${track.title}-squid` ? <Check size={11} /> : <Globe size={11} />}
                            Squid
                          </button>
    
                          {/* Download to Library */}
                          {downloadedIds.has(track.id) ? (
                            <div style={{ color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: 'rgba(16, 185, 129, 0.1)' }}>
                              <CheckCircle2 size={14} />
                            </div>
                          ) : downloadingIds.has(track.id) ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 80, color: '#10b981' }}>
                              <Loader2 size={12} className="pulse" style={{ marginBottom: 4 }} />
                              {downloadProgress[track.url] ? (
                                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                                    {Math.round(downloadProgress[track.url].percent)}%
                                  </span>
                                  <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${downloadProgress[track.url].percent}%`, background: '#10b981', transition: 'width 0.2s ease-out' }} />
                                  </div>
                                  <span style={{ fontSize: 8, fontWeight: 500, opacity: 0.6, textAlign: 'center' }}>
                                    {downloadProgress[track.url].total_mb > 0 ? `${downloadProgress[track.url].downloaded_mb.toFixed(1)}/${downloadProgress[track.url].total_mb.toFixed(1)} MB` : ''}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ fontSize: 8, fontWeight: 600, opacity: 0.8 }}>Connecting...</span>
                              )}
                            </div>
                          ) : (
                            <button 
                              onClick={() => handleDownloadYoutube(track)}
                              title="Download premium stream via robust yt-dlp"
                              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(16,185,129,0.2)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(16,185,129,0.1)';
                              }}
                            >
                              <Download size={13} />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            ) : (
              <div style={{ marginTop: 20 }}>
                {/* Suggestions Grid */}
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'white' }}>
                  <span style={{ width: 3, height: 16, borderRadius: 2, background: activeColor }} />
                  Discover Online Stations
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
                  {discoverSuggestions.youtube.map(s => (
                    <motion.div
                      key={s.id}
                      whileHover={{ y: -4, scale: 1.01 }}
                      onClick={() => triggerInstantSearch(s.q, 'youtube')}
                      style={{
                        background: `linear-gradient(135deg, rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.05), rgba(255,255,255,0.02))`,
                        border: `1px solid rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.15)`,
                        borderRadius: 14,
                        padding: '20px 24px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 12,
                        minHeight: 120,
                        position: 'relative',
                        overflow: 'hidden',
                        transition: 'border-color 0.2s',
                        boxShadow: `0 4px 20px rgba(0,0,0,0.15)`,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = `rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.4)`;
                        const glow = e.currentTarget.querySelector('.card-glow') as HTMLElement;
                        if (glow) glow.style.opacity = '0.12';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = `rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.15)`;
                        const glow = e.currentTarget.querySelector('.card-glow') as HTMLElement;
                        if (glow) glow.style.opacity = '0';
                      }}
                    >
                      {/* Dynamic Ambient Background Glow */}
                      <div 
                        className="card-glow"
                        style={{
                          position: 'absolute',
                          top: '-50%',
                          left: '-50%',
                          right: '-50%',
                          bottom: '-50%',
                          background: `radial-gradient(circle, rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.5) 0%, transparent 70%)`,
                          opacity: 0,
                          pointerEvents: 'none',
                          zIndex: 0,
                          transition: 'opacity 0.3s'
                        }}
                      />
                      
                      <div style={{ position: 'relative', zIndex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'white', marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>{s.desc}</div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', zIndex: 1 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: `rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.15)`, color: `rgba(${s.color.split(',')[0]}, 100%, 75%, 1)` }}>
                          STREAM NOW
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Charts Segment */}
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'white' }}>
                  <span style={{ width: 3, height: 16, borderRadius: 2, background: activeColor }} />
                  Daily Trending Charts
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {trendingCharts.map((c, idx) => (
                    <button
                      key={idx}
                      onClick={() => triggerInstantSearch(c.q, 'youtube')}
                      style={{
                        padding: '12px 20px',
                        borderRadius: 12,
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid var(--glass-border)',
                        color: 'white',
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        transition: 'all 0.2s',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = c.color;
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--glass-border)';
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                        e.currentTarget.style.transform = 'none';
                      }}
                    >
                      <Globe size={13} style={{ color: c.color }} />
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          } else {
            // Tidal Tab
            return !tidalLoggedIn ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400, padding: '40px 20px', overflowY: 'auto' }}>
                {/* Connect Card */}
                <div style={{ width: '100%', maxWidth: 450, background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 16, padding: 32, boxShadow: '0 12px 40px rgba(0,0,0,0.3)', marginBottom: 24 }}>
                  {!polling ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(6, 182, 212, 0.12)', border: '1px solid rgba(6, 182, 212, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Music2 size={20} color="#06b6d4" />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: 'white' }}>Connect Lossless Cloud Account</div>
                          <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 2 }}>Uses secure OAuth device pairing</div>
                        </div>
                      </div>
                      
                      <p style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6 }}>
                        Search and download pristine studio CD-quality lossless FLAC tracks directly to your offline library from the Lossless Cloud catalog.
                      </p>

                      {errorMsg && (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10 }}>
                          <AlertCircle size={15} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                          <span style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.5 }}>{errorMsg}</span>
                        </div>
                      )}

                      <button 
                        className="btn btn-primary" 
                        onClick={handleStartLogin}
                        style={{ background: 'linear-gradient(135deg, #06b6d4, #0891b2)', color: 'white', border: 'none', padding: '12px 20px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 4px 15px rgba(6, 182, 212, 0.25)' }}
                      >
                        Connect with Lossless Cloud
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                      <div style={{ textAlign: 'center', marginBottom: 8 }}>
                        <Loader2 size={32} className="pulse" style={{ color: '#06b6d4', margin: '0 auto 16px' }} />
                        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6, color: 'white' }}>Waiting for authorization…</div>
                        <p style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.5 }}>
                          Open the link below on any device and enter the code to authorize Aideo.
                        </p>
                      </div>

                      {userCode && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
                          <div style={{ width: '100%', textAlign: 'center', padding: '14px', background: 'rgba(0,0,0,0.2)', borderRadius: 10, border: '1px solid var(--glass-border)' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6 }}>Your Pairing Code</div>
                            <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: 8, color: '#06b6d4', fontVariantNumeric: 'tabular-nums' }}>{userCode}</div>
                          </div>
                          
                          <button
                            onClick={() => openUrl(activationUrl).catch(() => window.open(activationUrl, '_blank'))}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', background: 'var(--glass-h)', border: '1px solid var(--glass-border)', borderRadius: 10, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }}
                          >
                            <ExternalLink size={14} /> Open Activation Link
                          </button>
                        </div>
                      )}

                      <button 
                        className="btn btn-secondary" 
                        onClick={() => { setPolling(false); setUserCode(''); setActivationUrl(''); }}
                        style={{ padding: '10px 16px', borderRadius: 10, fontWeight: 600, fontSize: 13 }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Custom API Credentials panel */}
                <div style={{ width: '100%', maxWidth: 450, background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }}>
                  <button
                    onClick={() => setShowCreds(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '16px 20px', background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Settings2 size={15} color="var(--text-dim)" /> Custom API Credentials</span>
                    {showCreds ? <ChevronUp size={15} color="var(--text-dim)" /> : <ChevronDown size={15} color="var(--text-dim)" />}
                  </button>

                  {showCreds && (
                    <form onSubmit={handleSaveCreds} style={{ padding: '0 20px 20px', borderTop: '1px solid var(--glass-border)' }}>
                      <p style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.6, marginTop: 14, marginBottom: 16 }}>
                        Override the built-in Fire TV credentials with your own registered Tidal Developer app keys. Leave blank to use defaults.
                      </p>
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-dim)', marginBottom: 6 }}>Client ID</label>
                        <input
                          type="text"
                          value={customClientId}
                          onChange={e => setCustomClientId(e.target.value)}
                          placeholder="e.g. 4N3n6Q1x95LL5K7p"
                          style={{ width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: 10, color: 'white', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                        />
                      </div>
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-dim)', marginBottom: 6 }}>Client Secret</label>
                        <input
                          type="password"
                          value={customClientSecret}
                          onChange={e => setCustomClientSecret(e.target.value)}
                          placeholder="••••••••••••••••"
                          style={{ width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: 10, color: 'white', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                        />
                      </div>
                      <button 
                        type="submit" 
                        className="btn btn-secondary" 
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '10px', borderRadius: 10, fontWeight: 600, fontSize: 13 }}
                      >
                        {saveSuccess ? <><Check size={14} /> Saved!</> : 'Save Credentials'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ) : tidalResults.length > 0 ? (
              <div className="track-list" style={{ marginTop: 12 }}>
                <div className="track-list-header" style={{ display: 'grid', gridTemplateColumns: '48px 1.2fr 0.8fr 80px 240px', padding: '0 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-dim)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <div></div>
                  <div>Title</div>
                  <div>Album</div>
                  <div>Duration</div>
                  <div style={{ textAlign: 'center' }}>Actions</div>
                </div>
                
                <AnimatePresence>
                  {tidalResults.map((track) => {
                    const isMQA = track.quality === 'HI_RES' || track.quality === 'HI_RES_LOSSLESS';
                    
                    return (
                      <motion.div 
                        key={track.id} 
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="track-item" 
                        style={{ display: 'grid', gridTemplateColumns: '48px 1.2fr 0.8fr 80px 240px', padding: '12px 16px', alignItems: 'center', borderRadius: 8, transition: 'background 0.2s', borderBottom: '1px solid rgba(255,255,255,0.02)' }}
                      >
                        {/* Cover Art */}
                        <div 
                          style={{ 
                            width: 36, 
                            height: 36, 
                            borderRadius: 6, 
                            overflow: 'hidden', 
                            background: 'rgba(255,255,255,0.05)', 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                          }}
                        >
                          {track.cover_url ? (
                            <img src={track.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <Music size={16} color="var(--text-dim)" />
                          )}
                        </div>
                        
                        {/* Title */}
                        <div style={{ paddingRight: 16, overflow: 'hidden' }}>
                          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 8 }}>
                            {track.title}
                            {isMQA ? (
                              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 4, background: 'rgba(6, 182, 212, 0.1)', color: '#06b6d4', border: '1px solid rgba(6, 182, 212, 0.2)' }}>
                                HI-RES FLAC
                              </span>
                            ) : (
                              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                                LOSSLESS CD
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {track.artist}
                          </div>
                        </div>
                        
                        {/* Album */}
                        <div style={{ color: 'var(--text-dim)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 16 }}>
                          {track.album}
                        </div>
                        
                        {/* Duration */}
                        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                          {fmtDuration(track.duration)}
                        </div>
                        
                        {/* Actions Grid */}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                          {/* Play / Preview Button */}
                          <button
                            onClick={() => handleTogglePreviewTidal(track)}
                            disabled={loadingTidalPreviewId === track.id}
                            title={
                              playback.status === 'Playing' && useStore.getState().currentTrack?.id === -20000 - Number(track.id)
                                ? "Pause preview"
                                : "Stream direct lossless preview"
                            }
                            style={{
                              background: playback.status === 'Playing' && useStore.getState().currentTrack?.id === -20000 - Number(track.id)
                                ? 'rgba(6,182,212,0.15)'
                                : 'rgba(255,255,255,0.03)',
                              border: playback.status === 'Playing' && useStore.getState().currentTrack?.id === -20000 - Number(track.id)
                                ? '1px solid rgba(6,182,212,0.3)'
                                : '1px solid rgba(255,255,255,0.06)',
                              color: playback.status === 'Playing' && useStore.getState().currentTrack?.id === -20000 - Number(track.id) ? '#06b6d4' : 'white',
                              cursor: 'pointer',
                              padding: '6px 8px',
                              borderRadius: 8,
                              fontSize: 11,
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              transition: 'all 0.2s'
                            }}
                          >
                            {loadingTidalPreviewId === track.id ? (
                              <Loader2 size={11} className="pulse" />
                            ) : playback.status === 'Playing' && useStore.getState().currentTrack?.id === -20000 - Number(track.id) ? (
                              <Pause size={11} fill="currentColor" />
                            ) : (
                              <Play size={11} fill="currentColor" style={{ marginLeft: 1 }} />
                            )}
                            <span>{loadingTidalPreviewId === track.id ? 'Connecting' : playback.status === 'Playing' && useStore.getState().currentTrack?.id === -20000 - Number(track.id) ? 'Playing' : 'Preview'}</span>
                          </button>

                          {/* Lucida Bypass Copy Shortcut */}
                          <button
                            onClick={() => handleOpenWebBypass(`${track.artist} - ${track.title}`, 'lucida')}
                            title="Copy & Open in Lucida.to (Pristine Lossless FLAC)"
                            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#10b981', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
                          >
                            {copiedId === `${track.artist} - ${track.title}-lucida` ? <Check size={11} /> : <Globe size={11} />}
                            Lucida
                          </button>
    
                          {/* Squid Bypass Copy Shortcut */}
                          <button
                            onClick={() => handleOpenWebBypass(`${track.artist} - ${track.title}`, 'squid')}
                            title="Copy & Open in Squid.wtf (Lossless FLAC)"
                            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#3b82f6', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s' }}
                          >
                            {copiedId === `${track.artist} - ${track.title}-squid` ? <Check size={11} /> : <Globe size={11} />}
                            Squid
                          </button>
    
                          {/* Download to Library */}
                          {downloadedIds.has(track.id) ? (
                            <div style={{ color: '#06b6d4', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: 'rgba(6, 182, 212, 0.1)' }}>
                              <CheckCircle2 size={14} />
                            </div>
                          ) : downloadingIds.has(track.id) ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 80, color: '#06b6d4' }}>
                              <Loader2 size={12} className="pulse" style={{ marginBottom: 4 }} />
                              {downloadProgress[track.id] ? (
                                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  <span style={{ fontSize: 9, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                                    {Math.round(downloadProgress[track.id].percent)}%
                                  </span>
                                  <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${downloadProgress[track.id].percent}%`, background: '#06b6d4', transition: 'width 0.2s ease-out' }} />
                                  </div>
                                  <span style={{ fontSize: 8, fontWeight: 500, opacity: 0.6, textAlign: 'center' }}>
                                    {downloadProgress[track.id].total_mb > 0 ? `${downloadProgress[track.id].downloaded_mb.toFixed(1)}/${downloadProgress[track.id].total_mb.toFixed(1)} MB` : ''}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ fontSize: 8, fontWeight: 600, opacity: 0.8 }}>Connecting...</span>
                              )}
                            </div>
                          ) : (
                            <button 
                              onClick={() => handleDownloadTidal(track)}
                              title="Download lossless FLAC directly from Lossless Cloud"
                              style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)', color: '#06b6d4', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(6,182,212,0.2)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgba(6,182,212,0.1)';
                              }}
                            >
                              <Download size={13} />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            ) : (
              <div style={{ marginTop: 20 }}>
                {/* Suggestions Grid */}
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'white' }}>
                  <span style={{ width: 3, height: 16, borderRadius: 2, background: activeColor }} />
                  Discover Lossless Rooms
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
                  {discoverSuggestions.tidal.map(s => (
                    <motion.div
                      key={s.id}
                      whileHover={{ y: -4, scale: 1.01 }}
                      onClick={() => {
                        if (!tidalLoggedIn) {
                          window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Please log in to Tidal first!', type: 'warning' } }));
                          return;
                        }
                        triggerInstantSearch(s.q, 'tidal');
                      }}
                      style={{
                        background: `linear-gradient(135deg, rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.05), rgba(255,255,255,0.02))`,
                        border: `1px solid rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.15)`,
                        borderRadius: 14,
                        padding: '20px 24px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 12,
                        minHeight: 120,
                        position: 'relative',
                        overflow: 'hidden',
                        transition: 'border-color 0.2s',
                        boxShadow: `0 4px 20px rgba(0,0,0,0.15)`,
                        opacity: tidalLoggedIn ? 1 : 0.6,
                      }}
                      onMouseEnter={(e) => {
                        if (!tidalLoggedIn) return;
                        e.currentTarget.style.borderColor = `rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.4)`;
                        const glow = e.currentTarget.querySelector('.card-glow') as HTMLElement;
                        if (glow) glow.style.opacity = '0.12';
                      }}
                      onMouseLeave={(e) => {
                        if (!tidalLoggedIn) return;
                        e.currentTarget.style.borderColor = `rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.15)`;
                        const glow = e.currentTarget.querySelector('.card-glow') as HTMLElement;
                        if (glow) glow.style.opacity = '0';
                      }}
                    >
                      <div 
                        className="card-glow"
                        style={{
                          position: 'absolute',
                          top: '-50%',
                          left: '-50%',
                          right: '-50%',
                          bottom: '-50%',
                          background: `radial-gradient(circle, rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.5) 0%, transparent 70%)`,
                          opacity: 0,
                          pointerEvents: 'none',
                          zIndex: 0,
                          transition: 'opacity 0.3s'
                        }}
                      />
                      
                      <div style={{ position: 'relative', zIndex: 1 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'white', marginBottom: 4 }}>{s.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>{s.desc}</div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', zIndex: 1 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: `rgba(${s.color.split(',')[0]}, ${s.color.split(',')[1].replace('%', '')}%, ${s.color.split(',')[2].replace('%', '')}%, 0.15)`, color: `rgba(${s.color.split(',')[0]}, 100%, 75%, 1)` }}>
                          {tidalLoggedIn ? 'PLAY LOSSLESS' : 'CONNECT FIRST'}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          }
        })()}
      </div>

      {/* Information Banner */}
      <div style={{ margin: '0 40px 24px', padding: '12px 16px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.1)', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Info size={16} color="#10b981" />
        <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          <strong>Aideo Multi-Source Search Suite</strong>: Downloads pristine high-fidelity streams across multiple online indices. For independent web downloading, click <strong>Lucida</strong> or <strong>Squid</strong> on any card to copy the search string and download manually from the web.
        </span>
      </div>
    </div>
  );
}
