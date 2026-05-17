import { useEffect } from 'react';
import { useStore } from '../store';
import { openUrl } from '@tauri-apps/plugin-opener';
import defaultCover from '../assets/default_cover.png';
import { LyricsPanel } from './LyricsPanel';
import { Visualizer } from './Visualizer';
import { baseName, getStreamName } from '../utils';

export function NowPlayingView() {
  const { tracks, playback, currentDevice, coverArt, accentColor, dsp } = useStore();
  const current = tracks.find(t => t.path === playback.current_track);

  useEffect(() => {
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
    <div className="nowplaying">
      {/* Blurred background */}
      {coverArt && (
        <div className="np-bg" style={{ backgroundImage: `url(${coverArt})` }} />
      )}

      {/* Art + Meta — fixed left column */}
      <div className="np-left" style={{ borderRight: '1px solid var(--glass-border)' }}>
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
              {playback.current_track?.startsWith('http') ? getStreamName(playback.current_track) : (current?.title || baseName(playback.current_track))}
            </span>
            {playback.current_track?.startsWith('http') && (
              <span className="live-badge" style={{ flexShrink: 0 }}>LIVE</span>
            )}
            {playback.bit_perfect && (
              <span className="bit-badge" style={{ flexShrink: 0, background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', boxShadow: '0 0 12px rgba(6, 182, 212, 0.4)' }}>
                {currentDevice?.startsWith('[ASIO]') ? 'ASIO BIT-PERFECT' : 'BIT-PERFECT'} {playback.dev_rate > 0 ? `· ${playback.dev_rate / 1000}kHz` : ''}
              </span>
            )}
            {dsp.upsample_rate > 0 && !playback.bit_perfect && (
              <span className="bit-badge" style={{ flexShrink: 0, background: 'linear-gradient(135deg, #a855f7, #6366f1)', boxShadow: '0 0 12px rgba(168, 85, 247, 0.4)' }}>
                HI-RES · {dsp.upsample_rate / 1000}kHz
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
            {playback.current_track?.startsWith('http')
              ? (getStreamName(playback.current_track) === playback.current_track ? 'Live Stream' : playback.current_track)
              : (current?.artist || 'Unknown Artist')}
          </div>
        </div>
        <div style={{ height: 80, width: '100%', marginTop: 'auto' }}>
          <Visualizer />
        </div>
      </div>

      {/* Lyrics — Right column */}
      <LyricsPanel />
    </div>
  );
}
