import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion } from 'framer-motion';
import { 
  SkipBack, SkipForward, Play, Pause, Square, Shuffle, Repeat, Repeat1, 
  Volume2, Volume1, VolumeX, SlidersHorizontal, X, ListMusic, Activity, 
  Infinity as InfinityIcon, Maximize2, Minimize2, Heart, ThumbsDown, Tv2,
  Disc, Sparkles, Loader2
} from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { CastSelector } from './CastSelector';
import { fmt, baseName, getStreamName, isRadioStream } from '../utils';
import { generateWaveformPeaks } from '../utils/waveform';

export function PlayerBar() {
  const {
    view, playback, isMuted, toggleMute, currentDevice, coverArt, lyrics, lyricOffset,
    pauseTrack, resumeTrack, stopTrack, setVolume, seek, setView,
    playNext, playPrev, shuffle, toggleShuffle, repeat, toggleRepeat,
    dsp, currentTrack, showQueue, toggleQueue, toggleControlCenter,
    autoplayEnabled, toggleAutoplay, toggleLoveTrack, toggleDislikeTrack,
    setMiniPlayerMode, desktopLyricsOpen, toggleDesktopLyrics,
    desktopLyricsLocked, toggleDesktopLyricsLocked,
    playerBarDesign
  } = useStore(useShallow(s => ({
    view: s.view,
    playback: s.playback,
    isMuted: s.isMuted,
    toggleMute: s.toggleMute,
    currentDevice: s.currentDevice,
    coverArt: s.coverArt,
    lyrics: s.lyrics,
    lyricOffset: s.lyricOffset,
    pauseTrack: s.pauseTrack,
    resumeTrack: s.resumeTrack,
    stopTrack: s.stopTrack,
    setVolume: s.setVolume,
    seek: s.seek,
    setView: s.setView,
    playNext: s.playNext,
    playPrev: s.playPrev,
    shuffle: s.shuffle,
    toggleShuffle: s.toggleShuffle,
    repeat: s.repeat,
    toggleRepeat: s.toggleRepeat,
    dsp: s.dsp,
    currentTrack: s.currentTrack,
    showQueue: s.showQueue,
    toggleQueue: s.toggleQueue,
    toggleControlCenter: s.toggleControlCenter,
    autoplayEnabled: s.autoplayEnabled,
    toggleAutoplay: s.toggleAutoplay,
    toggleLoveTrack: s.toggleLoveTrack,
    toggleDislikeTrack: s.toggleDislikeTrack,
    setMiniPlayerMode: s.setMiniPlayerMode,
    desktopLyricsOpen: s.desktopLyricsOpen,
    toggleDesktopLyrics: s.toggleDesktopLyrics,
    desktopLyricsLocked: s.desktopLyricsLocked,
    toggleDesktopLyricsLocked: s.toggleDesktopLyricsLocked,
    playerBarDesign: s.playerBarDesign,
  })));

  const [hoverSeekPct, setHoverSeekPct] = useState<number | null>(null);

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
  const isPlaying = playback.status === 'Playing';
  const isBuffering = Boolean(playback.is_buffering);
  const effectiveCover = coverArt || current?.cover_url || defaultCover;

  const waveformPeaks = useMemo(() => {
    const barCount = playerBarDesign === 'waveform' ? 64 : 48;
    return generateWaveformPeaks(current?.path || current?.title || 'aideo', barCount);
  }, [current?.path, current?.title, playerBarDesign]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(clickPct * duration);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverSeekPct(p);
  };

  const handleMouseLeave = () => {
    setHoverSeekPct(null);
  };

  const trackTitle = current?.title || (playback.current_track?.startsWith('http') ? getStreamName(playback.current_track) : baseName(playback.current_track)) || 'No Media Loaded';
  const trackArtist = current?.artist || (playback.current_track?.startsWith('http') ? 'Online Stream' : '—');
  const isLive = isRadioStream(current, playback.current_track, duration);

  // Render Quality Tag Helper
  const renderQualityTag = () => {
    if (!current?.format) return null;
    const fmtLower = current.format.toLowerCase();
    const isHighRes = fmtLower === 'flac' || fmtLower === 'wav';
    const isDsd = fmtLower.includes('dsf') || fmtLower.includes('dff') || fmtLower.includes('dsd');
    const isDolby = fmtLower.includes('dolby') || fmtLower.includes('atmos');

    return (
      <span 
        className={`quality-tag ${isHighRes ? 'high-res' : ''} ${isDsd ? 'dsd-gold' : ''} ${isDolby ? 'dolby-atmos' : ''}`}
        style={{ 
          fontSize: 8, 
          padding: '1px 5px', 
          flexShrink: 0,
          background: isDsd
            ? 'linear-gradient(135deg, #FFE082, #FFB300, #FF8F00)'
            : undefined,
          boxShadow: isDsd
            ? '0 0 10px rgba(255, 179, 0, 0.45)'
            : undefined,
          border: isDsd
            ? '1px solid rgba(255, 224, 130, 0.4)'
            : undefined,
          color: isDsd ? '#0a0a0f' : undefined,
          fontWeight: isDsd ? 800 : undefined
        }}
      >
        {current.format.toUpperCase() === 'YOUTUBE DIRECT' ? 'WEB STREAM' : current.format.toUpperCase()}
      </span>
    );
  };

  // Render Love & Dislike Buttons Helper
  const renderLoveDislike = () => {
    if (!current || isRadioStream(current)) return null;
    return (
      <div className="pb-love-group" style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 4 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLoveTrack(current.path);
          }}
          className="pb-love-btn"
          style={{
            background: 'transparent',
            border: 'none',
            color: current.loved === 1 ? '#ef4444' : 'var(--text-dim)',
            cursor: 'pointer',
            padding: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
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
          className="pb-dislike-btn"
          style={{
            background: 'transparent',
            border: 'none',
            color: current.disliked === 1 ? '#f43f5e' : 'var(--text-dim)',
            cursor: 'pointer',
            padding: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
          }}
          title={current.disliked === 1 ? "Undislike track" : "Dislike track"}
        >
          <ThumbsDown size={16} fill={current.disliked === 1 ? '#f43f5e' : 'transparent'} />
        </button>
      </div>
    );
  };

  // Render Volume Control Helper
  const renderVolume = (compact: boolean = false) => {
    return (
      <div className="pb-vol-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          className="pb-btn pb-btn-vol"
          onClick={toggleMute}
          title={isMuted || playback.volume === 0 ? "Unmute (M)" : "Mute (M)"}
          style={{ padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {isMuted || playback.volume === 0 ? (
            <VolumeX size={16} color="var(--accent, #8b5cf6)" />
          ) : playback.volume < 0.5 ? (
            <Volume1 size={16} color="var(--text-dim)" />
          ) : (
            <Volume2 size={16} color="var(--text-dim)" />
          )}
        </button>
        <input 
          className="vol-slider" 
          type="range" 
          min={0} 
          max={1} 
          step={0.01} 
          style={{ width: compact ? 65 : 85 }}
          value={playback.volume} 
          onChange={e => setVolume(+e.target.value)} 
        />
      </div>
    );
  };

  // Render Audio Badges Helper
  const renderAudioBadges = () => {
    return (
      <>
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
      </>
    );
  };

  // Render Utility Quick-Tools Helper
  const renderQuickTools = (compact: boolean = false) => {
    return (
      <div className="pb-tools-group" style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 12 }}>
        <button className={`pb-btn ${showQueue ? 'active' : ''}`} onClick={toggleQueue} title="Up Next (Queue)">
          <ListMusic size={17} />
        </button>
        {!compact && (
          <button className={`pb-btn ${view === 'aideo_lab' ? 'active' : ''}`} onClick={() => setView(view === 'aideo_lab' ? 'nowplaying' : 'aideo_lab')} title="Aideo Lab DSP Laboratory">
            <Activity size={17} />
          </button>
        )}
        <button
          className={`pb-btn ${desktopLyricsOpen ? 'active' : ''}`}
          onClick={toggleDesktopLyrics}
          onContextMenu={(e) => {
            e.preventDefault();
            toggleDesktopLyricsLocked();
          }}
          title={desktopLyricsOpen ? (desktopLyricsLocked ? "Desktop Lyrics: Locked (Right-click to Unlock)" : "Desktop Lyrics: Unlocked (Right-click to Lock)") : "Floating Transparent Desktop Lyric Bar"}
          style={{ position: 'relative' }}
        >
          <Tv2 size={17} />
          {desktopLyricsOpen && desktopLyricsLocked && (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: '#10b981',
                boxShadow: '0 0 6px #10b981',
              }}
            />
          )}
        </button>
        <CastSelector />
        <button className="pb-btn" onClick={toggleControlCenter} title="Audio Engine Settings">
          <SlidersHorizontal size={17} />
        </button>
        <button className="pb-btn" onClick={() => setMiniPlayerMode(true)} title="Mini Player">
          <Minimize2 size={17} />
        </button>
        <button className="pb-btn" onClick={() => setView('fullscreen')} title="Enter Theater Fullscreen">
          <Maximize2 size={17} />
        </button>
      </div>
    );
  };

  // -------------------------------------------------------------
  // VARIANT 1: CLASSIC STUDIO (Default 3-Column Desktop Layout)
  // -------------------------------------------------------------
  if (playerBarDesign === 'classic' || !playerBarDesign) {
    return (
      <div className="player-bar design-classic">
        {/* LEFT */}
        <div className="pb-left">
          <div className="pb-thumb" onClick={() => setView('nowplaying')}>
            <img src={effectiveCover} alt="" />
            {isLive && <div className="stream-badge-mini">LIVE</div>}
          </div>
          <div className="pb-info" onClick={() => setView('nowplaying')}>
            <div className="pb-title" style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '240px', overflow: 'hidden' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
                {trackTitle}
              </span>
              {renderQualityTag()}
              {isLive && (
                <motion.div 
                  animate={{ opacity: [1, 0.4, 1] }} 
                  transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px #ef4444', flexShrink: 0 }} 
                />
              )}
            </div>
            <div className="pb-artist" style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#a1a1aa' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {trackArtist}
              </span>
              {isLive && (
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
          {renderLoveDislike()}
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
            <button className="pb-btn play" onClick={isPlaying ? pauseTrack : resumeTrack} title={isBuffering ? "Buffering stream..." : isPlaying ? "Pause" : "Play"}>
              {isBuffering ? <Loader2 size={20} className="animate-spin" /> : isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 3 }} />}
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
            {isLive ? (
              <div className="prog-track stream-active">
                <motion.div 
                  className="stream-progress-fill"
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, letterSpacing: 2, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                  Streaming Live
                </div>
              </div>
            ) : (
              <div className="prog-track" onClick={handleSeek} style={{ position: 'relative', overflow: 'hidden' }}>
                {waveformPeaks.length > 0 ? (
                  <div className="waveform-bar-container" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 2, padding: '0 4px', pointerEvents: 'none', zIndex: 1 }}>
                    {waveformPeaks.map((peak, idx) => {
                      const barPct = (idx / waveformPeaks.length) * 100;
                      const isPlayed = barPct <= pct;
                      return (
                        <div
                          key={idx}
                          style={{
                            flex: 1,
                            height: `${Math.max(25, peak * 100)}%`,
                            background: isPlayed ? 'var(--accent)' : 'var(--wave-idle)',
                            borderRadius: 1,
                            transition: 'background 0.1s ease',
                          }}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ position: 'absolute', inset: 0, background: 'var(--wave-idle)' }} />
                )}
                <div className="prog-fill" style={{ width: `${pct}%`, opacity: 0.25 }} />
              </div>
            )}
            <span className="prog-time">{isLive ? 'LIVE' : fmt(duration)}</span>
          </div>
        </div>

        {/* RIGHT */}
        <div className="pb-right" style={{ gap: 16 }}>
          {renderAudioBadges()}
          {renderVolume()}
          {renderQuickTools()}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VARIANT 2: FLOATING DYNAMIC ISLAND (Apple Music / macOS Capsule)
  // -------------------------------------------------------------
  if (playerBarDesign === 'floating') {
    return (
      <div className="player-bar design-floating">
        <div className="floating-island-capsule">
          {/* LEFT: Mini Circular Artwork & Track Info */}
          <div className="floating-island-left" onClick={() => setView('nowplaying')}>
            <div className="floating-thumb-circle">
              <img src={effectiveCover} alt="" />
              {isLive && <div className="floating-live-dot" />}
            </div>
            <div className="floating-info">
              <div className="floating-title-row">
                <span className="floating-title">{trackTitle}</span>
                {renderQualityTag()}
              </div>
              <div className="floating-artist">{trackArtist}</div>
            </div>
            {renderLoveDislike()}
          </div>

          {/* CENTER: Main Floating Controls & Progress */}
          <div className="floating-island-center">
            {activeLyric && view !== 'nowplaying' && (
              <div className="floating-mini-lyric" onClick={() => setView('nowplaying')}>
                <Sparkles size={11} color="var(--accent)" />
                <span>{activeLyric.text}</span>
              </div>
            )}
            <div className="floating-ctrl-row">
              <button className={`pb-btn mini ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle">
                <Shuffle size={14} />
              </button>
              <button className="pb-btn" onClick={playPrev} title="Previous">
                <SkipBack size={17} fill="currentColor" />
              </button>
              <button 
                className="floating-play-btn" 
                onClick={isPlaying ? pauseTrack : resumeTrack}
                title={isBuffering ? "Buffering stream..." : isPlaying ? "Pause" : "Play"}
              >
                {isBuffering ? <Loader2 size={18} className="animate-spin" /> : isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
              </button>
              <button className="pb-btn" onClick={playNext} title="Next">
                <SkipForward size={17} fill="currentColor" />
              </button>
              <button className="pb-btn mini" onClick={stopTrack} title="Stop">
                <Square size={12} fill="currentColor" />
              </button>
              <button className={`pb-btn mini ${repeat !== 'none' ? 'active' : ''}`} onClick={toggleRepeat} title="Repeat">
                {repeat === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
              </button>
              <button className={`pb-btn mini ${autoplayEnabled ? 'active autoplay-active' : ''}`} onClick={toggleAutoplay} title={`Endless Autoplay (Radio): ${autoplayEnabled ? 'On' : 'Off'}`}>
                <InfinityIcon size={15} />
              </button>
            </div>
            <div className="floating-seek-row">
              <span className="floating-time-num">{fmt(playback.position_secs)}</span>
              <div 
                className="floating-progress-track"
                onClick={handleSeek}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
              >
                <div className="floating-progress-fill" style={{ width: `${pct}%` }} />
                {hoverSeekPct !== null && (
                  <div className="floating-hover-indicator" style={{ left: `${hoverSeekPct * 100}%` }} />
                )}
              </div>
              <span className="floating-time-num">{isLive ? 'LIVE' : fmt(duration)}</span>
            </div>
          </div>

          {/* RIGHT: Volume & Floating Tools */}
          <div className="floating-island-right">
            {renderAudioBadges()}
            {renderVolume(true)}
            {renderQuickTools(true)}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VARIANT 3: AUDIOPHILE WAVEFORM DECK (SoundCloud / Tidal / DAW Pro)
  // -------------------------------------------------------------
  if (playerBarDesign === 'waveform') {
    return (
      <div className="player-bar design-waveform">
        {/* UPPER DECK: Full-Width Audio Waveform Scrubber */}
        <div 
          className="waveform-deck-top"
          onClick={handleSeek}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          title="Interactive High-Definition Waveform Scrubber"
        >
          {waveformPeaks.length > 0 ? (
            <div className="waveform-full-bars">
              {waveformPeaks.map((peak, idx) => {
                const barPct = (idx / waveformPeaks.length) * 100;
                const isPlayed = barPct <= pct;
                const isHovered = hoverSeekPct !== null && barPct <= hoverSeekPct * 100;
                return (
                  <div
                    key={idx}
                    className="waveform-peak-bar"
                    style={{
                      height: `${Math.max(18, peak * 100)}%`,
                      background: isPlayed 
                        ? 'linear-gradient(180deg, var(--accent, #8b5cf6), rgba(var(--accent-rgb), 0.7))' 
                        : isHovered 
                        ? 'var(--wave-hover)' 
                        : 'var(--wave-idle)',
                      boxShadow: isPlayed ? '0 0 6px rgba(var(--accent-rgb), 0.35)' : 'none'
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div className="waveform-flat-line" />
          )}
          <div className="waveform-cursor-line" style={{ left: `${pct}%` }} />
          {hoverSeekPct !== null && (
            <div className="waveform-hover-tag" style={{ left: `${hoverSeekPct * 100}%` }}>
              {fmt(hoverSeekPct * duration)}
            </div>
          )}
        </div>

        {/* LOWER DECK: 3-Column Studio Console */}
        <div className="waveform-deck-bottom">
          {/* Left Console */}
          <div className="waveform-deck-left" onClick={() => setView('nowplaying')}>
            <div className="pb-thumb-studio">
              <img src={effectiveCover} alt="" />
            </div>
            <div className="waveform-track-info">
              <div className="waveform-title-row">
                <span className="waveform-title">{trackTitle}</span>
                {renderQualityTag()}
              </div>
              <div className="waveform-artist">{trackArtist}</div>
            </div>
            {renderLoveDislike()}
          </div>

          {/* Center Transport & Studio Clocks */}
          <div className="waveform-deck-center">
            <div className="studio-time-display">
              <span className="studio-time-current">{fmt(playback.position_secs)}</span>
              <span className="studio-time-sep">/</span>
              <span className="studio-time-total">{isLive ? 'LIVE' : fmt(duration)}</span>
            </div>
            <div className="studio-transport-buttons">
              <button className={`pb-btn ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle">
                <Shuffle size={15} />
              </button>
              <button className="pb-btn" onClick={playPrev} title="Previous">
                <SkipBack size={19} fill="currentColor" />
              </button>
              <button className="pb-btn studio-play" onClick={isPlaying ? pauseTrack : resumeTrack} title={isBuffering ? "Buffering stream..." : isPlaying ? "Pause" : "Play"}>
                {isBuffering ? <Loader2 size={20} className="animate-spin" /> : isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />}
              </button>
              <button className="pb-btn" onClick={playNext} title="Next">
                <SkipForward size={19} fill="currentColor" />
              </button>
              <button className="pb-btn" onClick={stopTrack} title="Stop">
                <Square size={13} fill="currentColor" />
              </button>
              <button className={`pb-btn ${repeat !== 'none' ? 'active' : ''}`} onClick={toggleRepeat} title="Repeat">
                {repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
              </button>
              <button className={`pb-btn ${autoplayEnabled ? 'active' : ''}`} onClick={toggleAutoplay} title="Autoplay">
                <InfinityIcon size={16} />
              </button>
            </div>
          </div>

          {/* Right Audiophile HUD & Master Volume */}
          <div className="waveform-deck-right">
            <div className="audiophile-hud-chip" title="Audio Stream Hardware Readout">
              <Activity size={12} color="var(--accent)" />
              <span>{playback.bit_perfect ? 'ASIO / BIT-PERFECT' : playback.exclusive ? 'WASAPI EXCLUSIVE' : 'SHARED ENGINE'}</span>
              {playback.dev_rate > 0 && <span>· {playback.dev_rate / 1000}kHz</span>}
            </div>
            {renderVolume()}
            {renderQuickTools()}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VARIANT 4: MINIMALIST COMPACT (TIDAL Clean / Roon Zen)
  // -------------------------------------------------------------
  if (playerBarDesign === 'minimal') {
    return (
      <div className="player-bar design-minimal">
        {/* Hairline Progress Scrubber on Top Border */}
        <div 
          className="minimal-hairline-scrubber"
          onClick={handleSeek}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          title="Scrub Track"
        >
          <div className="minimal-hairline-fill" style={{ width: `${pct}%` }} />
          {hoverSeekPct !== null && (
            <div className="minimal-hairline-hover" style={{ left: `${hoverSeekPct * 100}%` }} />
          )}
        </div>

        {/* Single Row Minimalist Bar */}
        <div className="minimal-bar-row">
          {/* Left: Mini Cover + Single-line Info */}
          <div className="minimal-left" onClick={() => setView('nowplaying')}>
            <div className="minimal-thumb">
              <img src={effectiveCover} alt="" />
            </div>
            <div className="minimal-meta">
              <span className="minimal-title">{trackTitle}</span>
              <span className="minimal-sep">·</span>
              <span className="minimal-artist">{trackArtist}</span>
              {renderQualityTag()}
            </div>
          </div>

          {/* Center: Clean Transport Controls */}
          <div className="minimal-center">
            <button className={`pb-btn mini ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle">
              <Shuffle size={14} />
            </button>
            <button className="pb-btn mini" onClick={playPrev} title="Previous">
              <SkipBack size={16} fill="currentColor" />
            </button>
            <button className="minimal-play-btn" onClick={isPlaying ? pauseTrack : resumeTrack} title={isBuffering ? "Buffering stream..." : isPlaying ? "Pause" : "Play"}>
              {isBuffering ? <Loader2 size={15} className="animate-spin" /> : isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>
            <button className="pb-btn mini" onClick={playNext} title="Next">
              <SkipForward size={16} fill="currentColor" />
            </button>
            <button className="pb-btn mini" onClick={stopTrack} title="Stop">
              <Square size={11} fill="currentColor" />
            </button>
            <button className={`pb-btn mini ${repeat !== 'none' ? 'active' : ''}`} onClick={toggleRepeat} title="Repeat">
              {repeat === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
            </button>
          </div>

          {/* Right: Tabular Time & Compact Actions */}
          <div className="minimal-right">
            <div className="minimal-time-readout">
              <span>{fmt(playback.position_secs)}</span>
              <span style={{ opacity: 0.4 }}>/</span>
              <span>{isLive ? 'LIVE' : fmt(duration)}</span>
            </div>
            {renderVolume(true)}
            <button className={`pb-btn mini ${showQueue ? 'active' : ''}`} onClick={toggleQueue} title="Queue">
              <ListMusic size={16} />
            </button>
            <button className="pb-btn mini" onClick={() => setMiniPlayerMode(true)} title="Mini Player">
              <Minimize2 size={16} />
            </button>
            <button className="pb-btn mini" onClick={() => setView('fullscreen')} title="Fullscreen">
              <Maximize2 size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // VARIANT 5: RETRO VINYL DECK (Turntable Console & Spinning Record)
  // -------------------------------------------------------------
  if (playerBarDesign === 'vinyl') {
    return (
      <div className="player-bar design-vinyl">
        {/* LEFT: Spinning Vinyl Record & Analog Typography */}
        <div className="vinyl-deck-left">
          <div 
            className={`vinyl-disc-container ${isPlaying ? 'spinning-vinyl' : 'paused-vinyl'}`} 
            onClick={() => setView('nowplaying')}
            title="Vinyl Turntable Deck (Click to open Now Playing)"
          >
            <div className="vinyl-disc-body">
              <div className="vinyl-groove-ring ring-1" />
              <div className="vinyl-groove-ring ring-2" />
              <div className="vinyl-groove-ring ring-3" />
              <div className="vinyl-center-art">
                <img src={effectiveCover} alt="" />
                <div className="vinyl-spindle-hole" />
              </div>
            </div>
          </div>

          <div className="vinyl-info" onClick={() => setView('nowplaying')}>
            <div className="vinyl-title-row">
              <span className="vinyl-title">{trackTitle}</span>
              {renderQualityTag()}
            </div>
            <div className="vinyl-artist">{trackArtist}</div>
          </div>
          {renderLoveDislike()}
        </div>

        {/* CENTER: Vintage Mechanical Buttons & Analog Progress */}
        <div className="vinyl-deck-center">
          <div className="vinyl-status-strip">
            <span className="vinyl-needle-indicator">
              <Disc size={12} color="var(--accent)" className={isPlaying ? 'icon-spin-slow' : ''} />
              <span>{isPlaying ? 'TURNTABLE ROTATING' : 'DECK STANDBY'}</span>
            </span>
            {activeLyric && (
              <span className="vinyl-lyric-glow" onClick={() => setView('nowplaying')}>
                {activeLyric.text}
              </span>
            )}
          </div>

          <div className="vinyl-buttons-row">
            <button className={`vinyl-btn ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle">
              <Shuffle size={15} />
            </button>
            <button className="vinyl-btn" onClick={playPrev} title="Previous">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button className="vinyl-btn play-major" onClick={isPlaying ? pauseTrack : resumeTrack} title={isBuffering ? "Buffering stream..." : isPlaying ? "Pause" : "Play"}>
              {isBuffering ? <Loader2 size={20} className="animate-spin" /> : isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>
            <button className="vinyl-btn" onClick={playNext} title="Next">
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button className="vinyl-btn" onClick={stopTrack} title="Stop">
              <Square size={13} fill="currentColor" />
            </button>
            <button className={`vinyl-btn ${repeat !== 'none' ? 'active' : ''}`} onClick={toggleRepeat} title="Repeat">
              {repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
            </button>
            <button className={`vinyl-btn ${autoplayEnabled ? 'active' : ''}`} onClick={toggleAutoplay} title="Autoplay">
              <InfinityIcon size={16} />
            </button>
          </div>

          <div className="vinyl-progress-row">
            <span className="vinyl-amber-time">{fmt(playback.position_secs)}</span>
            <div className="vinyl-prog-track" onClick={handleSeek} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} title="Scrub Track">
              <div className="vinyl-prog-grooves">
                {Array.from({ length: 32 }).map((_, i) => (
                  <div key={i} className="vinyl-tick" style={{ opacity: (i / 32) * 100 <= pct ? 0.9 : 0.25 }} />
                ))}
              </div>
              <div className="vinyl-prog-fill" style={{ width: `${pct}%` }} />
              {hoverSeekPct !== null && (
                <div className="vinyl-prog-hover" style={{ left: `${hoverSeekPct * 100}%` }} />
              )}
            </div>
            <span className="vinyl-amber-time">{isLive ? 'LIVE' : fmt(duration)}</span>
          </div>
        </div>

        {/* RIGHT: Warm Analog LED Badges & Vintage Master Dial */}
        <div className="vinyl-deck-right">
          <div className="vinyl-led-bank">
            <div className={`vinyl-led-item ${playback.bit_perfect ? 'lit-cyan' : ''}`}>
              <div className="led-dot" />
              <span>BIT-PERFECT</span>
            </div>
            <div className={`vinyl-led-item ${dsp.upsample_rate > 0 || current?.format?.toLowerCase().includes('flac') ? 'lit-gold' : ''}`}>
              <div className="led-dot" />
              <span>HI-RES</span>
            </div>
            <div className={`vinyl-led-item ${playback.exclusive ? 'lit-emerald' : ''}`}>
              <div className="led-dot" />
              <span>EXCLUSIVE</span>
            </div>
          </div>
          {renderVolume(true)}
          {renderQuickTools(true)}
        </div>
      </div>
    );
  }

  return null;
}
