import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { MessageSquare, Activity, Maximize2, Heart, ThumbsDown } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { LyricsPanel } from './LyricsPanel';
import { Visualizer } from './Visualizer';
import { LiquidBackground } from './LiquidBackground';
import { baseName, getStreamName } from '../utils';

const isRadioStream = (track: any): boolean => {
  if (!track) return false;
  const path = track.path || '';
  const format = track.format || '';
  const isUrlFormat = format.toUpperCase() === 'URL';
  const isOnline = path.startsWith('http://') || path.startsWith('https://');
  const isYTMOrTidalOrCloud = format === 'YouTube Direct' || format === 'Tidal FLAC' || format === 'SUBSONIC' || format === 'JELLYFIN' || path.includes('youtube.com') || path.includes('youtu.be') || path.includes('api.tidal.com');
  
  return (isUrlFormat || isOnline) && !isYTMOrTidalOrCloud && (!track.duration || track.duration <= 0);
};

export function NowPlayingView() {
  const { 
    playback, currentDevice, coverArt, accentColor, dsp, 
    liquidBackgroundEnabled, toggleLiquidBackground, currentTrack, autoplayEnabled,
    setView, toggleLoveTrack, toggleDislikeTrack, toggleControlCenter
  } = useStore();
  const current = currentTrack;

  const [showLyrics, setShowLyrics] = useState(true);

  useEffect(() => {
    const themeMode = localStorage.getItem('aideo-theme-mode');
    if (themeMode === 'preset') {
      const pc = localStorage.getItem('aideo-preset-color') || '#8b5cf6';
      const pr = localStorage.getItem('aideo-preset-rgb') || '139, 92, 246';
      document.documentElement.style.setProperty('--dynamic-accent', pc);
      document.documentElement.style.setProperty('--accent-rgb', pr);
      return;
    } else if (themeMode === 'windows') {
      invoke('get_windows_accent_color')
        .then((color: any) => {
          document.documentElement.style.setProperty('--dynamic-accent', color);
          let r = 139, g = 92, b = 246;
          if (color.startsWith('#')) {
            const hex = color.replace('#', '');
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
          }
          document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);
        })
        .catch((err: any) => console.error("Failed to fetch Windows accent color:", err));
      return;
    }

    document.documentElement.style.setProperty('--dynamic-accent', accentColor);
    
    let r = 139, g = 92, b = 246;
    if (accentColor.startsWith('rgb')) {
      const m = accentColor.match(/\d+/g);
      if (m && m.length >= 3) {
        r = parseInt(m[0]); g = parseInt(m[1]); b = parseInt(m[2]);
      }
    } else if (accentColor.startsWith('#')) {
      const hex = accentColor.replace('#', '');
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }
    
    document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);
  }, [accentColor]);

  if (!playback.current_track) {
    return (
      <div className="nowplaying">
        <div className="np-empty" style={{ gridColumn: '1/3' }}>
          <span>💿</span>
          <h2>Nothing playing</h2>
          <p>Select a track from the Library to begin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="nowplaying" style={{ gridTemplateColumns: showLyrics ? '1fr 1fr' : '1fr' }}>
      {/* Dynamic Liquid Art Backdrop / Static Blurred Cover Art */}
      <LiquidBackground />
      {coverArt && (!liquidBackgroundEnabled || dsp.low_spec_mode) && (
        <div className="np-bg" style={{ backgroundImage: `url(${coverArt})` }} />
      )}

      {/* Art + Meta — fixed left column */}
      <div className="np-left" style={{ borderRight: showLyrics ? '1px solid var(--glass-border)' : 'none', position: 'relative' }}>
        {/* Sleek Floating Circle Buttons Group */}
        <div style={{
          position: 'absolute',
          top: 24,
          left: 24,
          display: 'flex',
          gap: 10,
          zIndex: 100
        }}>
          {/* Lyrics Toggle Button */}
          <button
            onClick={() => setShowLyrics(!showLyrics)}
            title={showLyrics ? "Hide Lyrics" : "Show Lyrics"}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: showLyrics ? '1px solid rgba(var(--accent-rgb), 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: showLyrics ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: showLyrics ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              boxShadow: showLyrics ? '0 0 10px rgba(var(--accent-rgb), 0.25)' : 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              if (!showLyrics) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!showLyrics) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.color = 'var(--text-dim)';
              }
            }}
          >
            <MessageSquare size={16} />
          </button>

          {/* Background Visualizer Toggle Button */}
          <button
            onClick={() => toggleLiquidBackground()}
            title={liquidBackgroundEnabled ? "Turn Off Background Visualizer" : "Turn On Background Visualizer"}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: liquidBackgroundEnabled ? '1px solid rgba(var(--accent-rgb), 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: liquidBackgroundEnabled ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: liquidBackgroundEnabled ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              boxShadow: liquidBackgroundEnabled ? '0 0 10px rgba(var(--accent-rgb), 0.25)' : 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              if (!liquidBackgroundEnabled) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!liquidBackgroundEnabled) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.color = 'var(--text-dim)';
              }
            }}
          >
            <Activity size={16} />
          </button>

          {/* Theater Fullscreen Toggle Button */}
          <button
            onClick={() => setView('fullscreen')}
            title="Enter Theater Fullscreen"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(255, 255, 255, 0.03)',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
              e.currentTarget.style.color = 'var(--text-dim)';
            }}
          >
            <Maximize2 size={16} />
          </button>
        </div>

        <div className={`np-art-wrap${coverArt ? ' has-art' : ''}`}>
          <img src={coverArt || defaultCover} alt="cover" className="np-art" />
        </div>
        <div className="np-meta" style={{ minWidth: 0 }}>
          <div className="np-title" style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            justifyContent: 'center',
            width: '100%',
            overflow: 'hidden',
          }}>
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%'
            }}>
              {current?.title || (playback.current_track?.startsWith('http') ? getStreamName(playback.current_track) : baseName(playback.current_track))}
            </span>
            {current && !isRadioStream(current) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLoveTrack(current.path);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: current.loved === 1 ? '#ef4444' : 'rgba(255, 255, 255, 0.45)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.2)';
                    if (current.loved !== 1) e.currentTarget.style.color = '#ef4444';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1.0)';
                    if (current.loved !== 1) e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)';
                  }}
                  title={current.loved === 1 ? "Remove from Loved Streams" : "Add to Loved Streams"}
                >
                  <Heart size={18} fill={current.loved === 1 ? '#ef4444' : 'transparent'} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDislikeTrack(current.path, current);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: current.disliked === 1 ? '#f43f5e' : 'rgba(255, 255, 255, 0.45)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.2)';
                    if (current.disliked !== 1) e.currentTarget.style.color = '#f43f5e';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1.0)';
                    if (current.disliked !== 1) e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)';
                  }}
                  title={current.disliked === 1 ? "Undislike track" : "Dislike track"}
                >
                  <ThumbsDown size={18} fill={current.disliked === 1 ? '#f43f5e' : 'transparent'} />
                </button>
              </div>
            )}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
            width: '100%',
            marginTop: 6
          }}>
            {current?.format && (
              <span 
                className={`quality-tag ${
                  current.format.toLowerCase().includes('flac') || current.format.toLowerCase().includes('wav') ? 'high-res' : ''
                } ${
                  current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd') ? 'dsd-gold' : ''
                } ${
                  current.format.toLowerCase().includes('dolby') || current.format.toLowerCase().includes('atmos') ? 'dolby-atmos' : ''
                }`} 
                style={{ 
                  flexShrink: 0, 
                  fontSize: 10, 
                  padding: '3px 8px',
                  background: current.format.toLowerCase().includes('tidal') 
                    ? 'linear-gradient(135deg, #06b6d4, #0891b2)' 
                    : (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? 'linear-gradient(135deg, #FFE082, #FFB300, #FF8F00)'
                    : undefined,
                  boxShadow: current.format.toLowerCase().includes('tidal') 
                    ? '0 0 10px rgba(6, 182, 212, 0.4)' 
                    : (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? '0 0 14px rgba(255, 179, 0, 0.45)'
                    : undefined,
                  border: current.format.toLowerCase().includes('tidal') 
                    ? '1px solid rgba(6, 182, 212, 0.3)' 
                    : (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? '1px solid rgba(255, 224, 130, 0.4)'
                    : undefined,
                  color: current.format.toLowerCase().includes('tidal') 
                    ? 'white' 
                    : (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? '#0a0a0f'
                    : undefined,
                  fontWeight: (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? 800
                    : undefined
                }}
              >
                {current.format.toUpperCase() === 'YOUTUBE DIRECT' ? 'WEB STREAM' : current.format.toUpperCase()}
              </span>
            )}
            {playback.current_track?.startsWith('http') && !current?.duration && (
              <span className="live-badge" style={{ flexShrink: 0 }}>LIVE</span>
            )}
            {playback.bit_perfect && (
              <span 
                className="bit-badge" 
                onClick={() => toggleControlCenter()}
                style={{ 
                  flexShrink: 0, 
                  background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', 
                  boxShadow: '0 0 12px rgba(6, 182, 212, 0.4)',
                  cursor: 'pointer'
                }}
                title="View Audio Signal Path"
              >
                {currentDevice?.startsWith('[ASIO]') ? 'ASIO BIT-PERFECT' : 'BIT-PERFECT'} {playback.dev_rate > 0 ? `· ${playback.dev_rate / 1000}kHz` : ''} 🎛️
              </span>
            )}
            {dsp.upsample_rate > 0 && !playback.bit_perfect && (
              <span 
                className="bit-badge" 
                onClick={() => toggleControlCenter()}
                style={{ 
                  flexShrink: 0, 
                  background: 'linear-gradient(135deg, #a855f7, #6366f1)', 
                  boxShadow: '0 0 12px rgba(168, 85, 247, 0.4)',
                  cursor: 'pointer'
                }}
                title="View Audio Signal Path"
              >
                HI-RES · {dsp.upsample_rate / 1000}kHz 🎛️
              </span>
            )}
            {!playback.bit_perfect && dsp.upsample_rate <= 0 && (
              <span 
                className="bit-badge" 
                onClick={() => toggleControlCenter()}
                style={{ 
                  flexShrink: 0, 
                  background: 'linear-gradient(135deg, #374151, #4b5563)', 
                  boxShadow: '0 0 8px rgba(0,0,0,0.2)',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: '3px 8px',
                  borderRadius: '4px',
                  color: '#9ca3af',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}
                title="View Audio Signal Path"
              >
                SIGNAL PATH 🎛️
              </span>
            )}
            {autoplayEnabled && (current?.path.startsWith('http') || current?.format === 'Tidal FLAC') && (
              <span 
                className="quality-tag autoplay-active" 
                style={{ 
                  flexShrink: 0, 
                  fontSize: 10, 
                  padding: '3px 8px',
                  fontWeight: 800,
                  letterSpacing: 0.5
                }}
              >
                ∞ AUTOPLAY
              </span>
            )}
          </div>
          <div className="np-artist" style={{
            opacity: 0.7,
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            textDecoration: 'underline'
          }}
            onClick={() => playback.current_track && openUrl(playback.current_track)}>
            {current?.artist || (playback.current_track?.startsWith('http') ? 'Online Stream' : '—')}
          </div>
        </div>
        <div style={{ height: 80, width: '100%', marginTop: 'auto' }}>
          <Visualizer />
        </div>
      </div>

      {/* Lyrics — Right column */}
      {showLyrics && <LyricsPanel />}


    </div>
  );
}
