import React, { useMemo } from 'react';
import { useStore } from '../store';
import { motion } from 'framer-motion';
import { SkipBack, SkipForward, Play, Pause, Square, Shuffle, Repeat, Repeat1, Volume2, SlidersHorizontal, X, ListMusic, Activity, Infinity as InfinityIcon, Maximize2, Heart, ThumbsDown } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { CastSelector } from './CastSelector';
import { fmt, baseName, getStreamName } from '../utils';

const isRadioStream = (track: any): boolean => {
  if (!track) return false;
  const path = track.path || '';
  const format = track.format || '';
  const isUrlFormat = format.toUpperCase() === 'URL';
  const isOnline = path.startsWith('http://') || path.startsWith('https://');
  const isYTMOrTidalOrCloud = format === 'YouTube Direct' || format === 'Tidal FLAC' || format === 'SUBSONIC' || format === 'JELLYFIN' || path.includes('youtube.com') || path.includes('youtu.be') || path.includes('api.tidal.com');
  
  return (isUrlFormat || isOnline) && !isYTMOrTidalOrCloud && (!track.duration || track.duration <= 0);
};

export function PlayerBar() {
  const {
    view, playback, currentDevice, coverArt, lyrics, lyricOffset,
    pauseTrack, resumeTrack, stopTrack, setVolume, seek, setView,
    playNext, playPrev, shuffle, toggleShuffle, repeat, toggleRepeat,
    dsp, currentTrack, showQueue, toggleQueue, toggleControlCenter,
    autoplayEnabled, toggleAutoplay, toggleLoveTrack, toggleDislikeTrack
  } = useStore();

  const activeLyric = useMemo(() => {
    if (!lyrics.length) return null;
    const now = playback.position_secs + lyricOffset / 1000;
    let current = null;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time_secs <= now) current = lyrics[i]; else break;
    }
    return current;
  }, [lyrics, playback.position_secs, lyricOffset]);

  const current = currentTrack;
  const duration = current?.duration ?? 0;
  const pct = duration > 0 ? (playback.position_secs / duration) * 100 : 0;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div className="player-bar">
      {/* LEFT */}
      <div className="pb-left">
        <div className="pb-thumb" onClick={() => setView('nowplaying')}>
          <img src={coverArt || defaultCover} alt="" />
          {playback.current_track?.startsWith('http') && !duration && (
            <div className="stream-badge-mini">LIVE</div>
          )}
        </div>
        <div className="pb-info" onClick={() => setView('nowplaying')}>
          <div className="pb-title" style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '240px', overflow: 'hidden' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
              {current?.title || (playback.current_track?.startsWith('http') ? getStreamName(playback.current_track) : baseName(playback.current_track))}
            </span>
            {current?.format && (
              <span 
                className={`quality-tag ${
                  current.format.toLowerCase() === 'flac' || current.format.toLowerCase() === 'wav' ? 'high-res' : ''
                } ${
                  current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd') ? 'dsd-gold' : ''
                } ${
                  current.format.toLowerCase() === 'dolby' || current.format.toLowerCase() === 'atmos' || current.format.toLowerCase() === 'dolby atmos' ? 'dolby-atmos' : ''
                }`} 
                style={{ 
                  fontSize: 8, 
                  padding: '1px 5px', 
                  flexShrink: 0,
                  background: (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? 'linear-gradient(135deg, #FFE082, #FFB300, #FF8F00)'
                    : undefined,
                  boxShadow: (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? '0 0 10px rgba(255, 179, 0, 0.45)'
                    : undefined,
                  border: (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? '1px solid rgba(255, 224, 130, 0.4)'
                    : undefined,
                  color: (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
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
            {playback.current_track?.startsWith('http') && !duration && (
              <motion.div 
                animate={{ opacity: [1, 0.4, 1] }} 
                transition={{ duration: 1.5, repeat: Infinity }}
                style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px #ef4444', flexShrink: 0 }} 
              />
            )}
          </div>
          <div className="pb-artist" style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {current?.artist || (playback.current_track?.startsWith('http') ? 'Online Stream' : '—')}
            </span>
            {playback.current_track?.startsWith('http') && !duration && (
              <button 
                className="icon-btn-danger" 
                title="Stop and Close Stream"
                onClick={(e) => { e.stopPropagation(); stopTrack(); }}
                style={{ padding: 2, borderRadius: 4, background: 'rgba(239, 68, 68, 0.1)', border: 'none', color: '#ef4444', cursor: 'pointer' }}
              >
                <X size={12} strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
        {/* Heart/Like & Dislike Buttons */}
        {current && !isRadioStream(current) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 4 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleLoveTrack(current.path);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: current.loved === 1 ? '#ef4444' : 'rgba(255, 255, 255, 0.35)',
                cursor: 'pointer',
                padding: 6,
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
                if (current.loved !== 1) e.currentTarget.style.color = 'rgba(255, 255, 255, 0.35)';
              }}
              title={current.loved === 1 ? "Remove from Loved Streams" : "Add to Loved Streams"}
            >
              <Heart size={16} fill={current.loved === 1 ? '#ef4444' : 'transparent'} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleDislikeTrack(current.path, current);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: current.disliked === 1 ? '#f43f5e' : 'rgba(255, 255, 255, 0.35)',
                cursor: 'pointer',
                padding: 6,
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
                if (current.disliked !== 1) e.currentTarget.style.color = 'rgba(255, 255, 255, 0.35)';
              }}
              title={current.disliked === 1 ? "Undislike track" : "Dislike track"}
            >
              <ThumbsDown size={16} fill={current.disliked === 1 ? '#f43f5e' : 'transparent'} />
            </button>
          </div>
        )}
      </div>

      {/* CENTER */}
      <div className="pb-center">
        {activeLyric && view !== 'nowplaying' && (
          <div className="pb-lyric" onClick={() => setView('nowplaying')}>
            {activeLyric.text}
          </div>
        )}
        <div className="pb-buttons">
          <button className={`pb-btn ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle">
            <Shuffle size={16} />
          </button>
          <button className="pb-btn" onClick={playPrev} title="Previous">
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button className="pb-btn play" onClick={playback.status === 'Playing' ? pauseTrack : resumeTrack}>
            {playback.status === 'Playing' ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 3 }} />}
          </button>
          <button className="pb-btn" onClick={playNext} title="Next">
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button className="pb-btn" onClick={stopTrack} title="Stop">
            <Square size={14} fill="currentColor" />
          </button>
          <button className={`pb-btn ${repeat !== 'none' ? 'active' : ''}`} onClick={toggleRepeat} title={`Repeat: ${repeat === 'none' ? 'Off' : repeat === 'all' ? 'All' : 'One'}`}>
            {repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>
          <button className={`pb-btn ${autoplayEnabled ? 'active autoplay-active' : ''}`} onClick={toggleAutoplay} title={`Endless Autoplay (Radio): ${autoplayEnabled ? 'On' : 'Off'}`} style={{ marginLeft: 4 }}>
            <InfinityIcon size={18} />
          </button>
        </div>
        <div className="progress-row">
          <span className="prog-time">{fmt(playback.position_secs)}</span>
          {playback.current_track?.startsWith('http') && !duration ? (
            <div className="prog-track stream-active">
              <motion.div 
                className="stream-progress-fill"
                animate={{ x: ['-100%', '100%'] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>
                Streaming Live
              </div>
            </div>
          ) : (
            <div className="prog-track" onClick={handleSeek}>
              <div className="prog-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
          <span className="prog-time">{playback.current_track?.startsWith('http') && !duration ? 'LIVE' : fmt(duration)}</span>
        </div>
      </div>

      {/* RIGHT */}
      <div className="pb-right" style={{ gap: 16 }}>
        {playback.bit_perfect && (
          <span className="bit-badge" style={{ transform: 'none', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)' }}>
            {currentDevice?.startsWith('[ASIO]') ? 'ASIO' : 'BIT-PERFECT'} {playback.dev_rate > 0 ? `· ${playback.dev_rate / 1000}kHz` : ''}
          </span>
        )}
        {playback.exclusive && !playback.bit_perfect && !dsp.upsample_rate && <span className="bit-badge" style={{ transform: 'none' }}>EXCLUSIVE</span>}
        {dsp.upsample_rate > 0 && !playback.bit_perfect && (
          <span className="bit-badge" style={{ transform: 'none', background: 'linear-gradient(135deg, #a855f7, #6366f1)' }}>
            HI-RES · {dsp.upsample_rate / 1000}kHz
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Volume2 size={16} color="var(--text-dim)" />
          <input className="vol-slider" type="range" min={0} max={1} step={0.01} style={{ width: 80 }}
            value={playback.volume} onChange={e => setVolume(+e.target.value)} />
        </div>
        <button className={`pb-btn ${showQueue ? 'active' : ''}`} onClick={toggleQueue} title="Up Next (Queue)">
          <ListMusic size={18} />
        </button>
        <button className={`pb-btn ${view === 'aideo_lab' ? 'active' : ''}`} onClick={() => setView(view === 'aideo_lab' ? 'nowplaying' : 'aideo_lab')} title="Aideo Lab DSP Laboratory">
          <Activity size={18} />
        </button>
        <CastSelector />
        <button className="pb-btn" onClick={toggleControlCenter} title="Audio Engine Settings">
          <SlidersHorizontal size={18} />
        </button>
        <button className="pb-btn" onClick={() => setView('fullscreen')} title="Enter Theater Fullscreen">
          <Maximize2 size={18} />
        </button>
      </div>
    </div>
  );
}
