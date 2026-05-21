import React, { useMemo } from 'react';
import { useStore } from '../store';
import { motion } from 'framer-motion';
import { SkipBack, SkipForward, Play, Pause, Square, Shuffle, Volume2, SlidersHorizontal, X, ListMusic, Activity } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { fmt, baseName, getStreamName } from '../utils';

export function PlayerBar() {
  const {
    view, tracks, playback, currentDevice, coverArt, lyrics, lyricOffset,
    pauseTrack, resumeTrack, stopTrack, setVolume, seek, setView,
    playNext, playPrev, shuffle, toggleShuffle, dsp, showProMode, toggleProMode
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

  const current = tracks.find(t => t.path === playback.current_track);
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
          {playback.current_track?.startsWith('http') && (
            <div className="stream-badge-mini">LIVE</div>
          )}
        </div>
        <div className="pb-info" onClick={() => setView('nowplaying')}>
          <div className="pb-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {playback.current_track?.startsWith('http') ? getStreamName(playback.current_track) : (current?.title || baseName(playback.current_track))}
            {playback.current_track?.startsWith('http') && (
              <motion.div 
                animate={{ opacity: [1, 0.4, 1] }} 
                transition={{ duration: 1.5, repeat: Infinity }}
                style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px #ef4444' }} 
              />
            )}
          </div>
          <div className="pb-artist" style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {playback.current_track?.startsWith('http')
                ? (getStreamName(playback.current_track) === playback.current_track ? 'Direct URL Stream' : playback.current_track)
                : (current?.artist || '—')}
            </span>
            {playback.current_track?.startsWith('http') && (
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
        </div>
        <div className="progress-row">
          <span className="prog-time">{fmt(playback.position_secs)}</span>
          {playback.current_track?.startsWith('http') ? (
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
          <span className="prog-time">{playback.current_track?.startsWith('http') ? 'LIVE' : fmt(duration)}</span>
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
        <button className={`pb-btn ${useStore.getState().showQueue ? 'active' : ''}`} onClick={() => useStore.getState().toggleQueue()} title="Up Next (Queue)">
          <ListMusic size={18} />
        </button>
        <button className={`pb-btn ${showProMode ? 'active' : ''}`} onClick={() => toggleProMode()} title="Aideo Pro Audio DSP Console">
          <Activity size={18} />
        </button>
        <button className="pb-btn" onClick={() => useStore.getState().toggleControlCenter()} title="Audio Engine Settings">
          <SlidersHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}
