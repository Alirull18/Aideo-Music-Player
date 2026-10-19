import React, { useMemo, useState } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion } from 'framer-motion';
import { 
  SkipBack, SkipForward, Play, Pause, Square, Shuffle, Repeat, Repeat1, 
  Volume2, Volume1, VolumeX, SlidersHorizontal, X, ListMusic, Activity, 
  Infinity as InfinityIcon, Maximize2, Minimize2, Heart, ThumbsDown, Tv2,
  Loader2
} from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { fmt, parseDuration, baseName, getStreamName, isRadioStream } from '../utils';
import { generateWaveformPeaks } from '../utils/waveform';
import { getAudioPathPresentation } from '../utils/audioPath';
import type { LyricLine } from '../store/types';
import { TheaterSignalPathModal } from './theater/TheaterSignalPathModal';

function PlayerBarLyricPreview({
  lyrics,
  lyricOffset,
  className,
  onClick,
  icon,
}: {
  lyrics: LyricLine[];
  lyricOffset: number;
  className?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
}) {
  const positionSecs = useStore((s) => s.playback.position_secs);
  const activeLyric = useMemo(() => {
    if (!lyrics.length) return null;
    const now = positionSecs + lyricOffset / 1000;
    let current = null;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time_secs <= now) current = lyrics[i];
    }
    return current;
  }, [lyrics, positionSecs, lyricOffset]);

  if (!activeLyric) return null;
  return (
    <div className={className} onClick={onClick}>
      {icon}
      <span>{activeLyric.text}</span>
    </div>
  );
}

function ClassicProgressRow({
  duration,
  isLive,
  waveformPeaks,
  onSeek,
}: {
  duration: number;
  isLive: boolean;
  waveformPeaks: number[];
  onSeek: (pct: number) => void;
}) {
  const positionSecs = useStore((s) => s.playback.position_secs);
  const pct = duration > 0 ? (positionSecs / duration) * 100 : 0;


  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(clickPct * duration);
  };

  return (
    <div className="progress-row">
      <span className="prog-time" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(positionSecs)}</span>
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
      <span className="prog-time" style={{ fontVariantNumeric: 'tabular-nums' }}>{isLive ? 'LIVE' : fmt(duration)}</span>
    </div>
  );
}

export function PlayerBar() {
  const {
    view, isMuted, toggleMute, coverArt, lyrics, lyricOffset,
    pauseTrack, resumeTrack, stopTrack, setVolume, seek, setView,
    playNext, playPrev, shuffle, toggleShuffle, repeat, toggleRepeat,
    dsp, currentTrack, showQueue, toggleQueue,
    autoplayEnabled, toggleAutoplay, toggleLoveTrack, toggleDislikeTrack,
    setMiniPlayerMode, desktopLyricsOpen, toggleDesktopLyrics,
    desktopLyricsLocked, toggleDesktopLyricsLocked,
    playbackStatus,
    playbackCurrentTrack,
    playbackIsBuffering,
    playbackVolume,
    playbackEffectiveAudioPath,
  } = useStore(useShallow(s => ({
    view: s.view,
    isMuted: s.isMuted,
    toggleMute: s.toggleMute,
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
    autoplayEnabled: s.autoplayEnabled,
    toggleAutoplay: s.toggleAutoplay,
    toggleLoveTrack: s.toggleLoveTrack,
    toggleDislikeTrack: s.toggleDislikeTrack,
    setMiniPlayerMode: s.setMiniPlayerMode,
    desktopLyricsOpen: s.desktopLyricsOpen,
    toggleDesktopLyrics: s.toggleDesktopLyrics,
    desktopLyricsLocked: s.desktopLyricsLocked,
    toggleDesktopLyricsLocked: s.toggleDesktopLyricsLocked,
    playbackStatus: s.playback.status,
    playbackCurrentTrack: s.playback.current_track,
    playbackIsBuffering: s.playback.is_buffering,
    playbackVolume: s.playback.volume,
    playbackEffectiveAudioPath: s.playback.effective_audio_path,
  })));

  const [showSignalPathModal, setShowSignalPathModal] = useState(false);

  const audioPathPresentation = getAudioPathPresentation({
    effective_audio_path: playbackEffectiveAudioPath,
    status: playbackStatus,
  } as any);

  const current = currentTrack;
  const duration = current?.duration || (current?.duration_raw ? parseDuration(current.duration_raw) : 0);
  const isPlaying = playbackStatus === 'Playing';
  const isBuffering = Boolean(playbackIsBuffering);
  const effectiveCover = coverArt || current?.cover_url || defaultCover;

  const waveformPeaks = useMemo(() => {
    return generateWaveformPeaks(current?.path || current?.title || 'aideo', 48);
  }, [current?.path, current?.title]);

  const trackTitle = current?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack)) || 'No Media Loaded';
  const trackArtist = current?.artist || (playbackCurrentTrack?.startsWith('http') ? 'Online Stream' : '—');
  const isLive = isRadioStream(current, playbackCurrentTrack, duration);

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
            transition: 'color 0.2s ease, transform 0.2s ease',
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
            transition: 'color 0.2s ease, transform 0.2s ease',
          }}
          title={current.disliked === 1 ? "Undislike track" : "Dislike track"}
        >
          <ThumbsDown size={16} fill={current.disliked === 1 ? '#f43f5e' : 'transparent'} />
        </button>
      </div>
    );
  };

  const renderVolume = () => {
    return (
      <div className="pb-vol-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          className="pb-btn pb-btn-vol"
          onClick={toggleMute}
          title={isMuted || playbackVolume === 0 ? "Unmute (M)" : "Mute (M)"}
          style={{ padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {isMuted || playbackVolume === 0 ? (
            <VolumeX size={16} color="var(--accent, #8b5cf6)" />
          ) : playbackVolume < 0.5 ? (
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
          style={{ width: 85 }}
          value={playbackVolume} 
          onChange={e => setVolume(+e.target.value)} 
        />
      </div>
    );
  };

  const renderAudioBadges = () => {
    const { badge } = audioPathPresentation;
    const hasBadge = Boolean(badge || (playbackEffectiveAudioPath?.active && playbackEffectiveAudioPath.resampling && dsp.upsample_rate > 0));
    if (!hasBadge) return null;
    return (
      <button
        type="button"
        onClick={() => setShowSignalPathModal(true)}
        title="Inspect Audio Signal Path"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6
        }}
      >
        {badge && (
          <span
            className="bit-badge"
            style={badge.kind === 'bit-perfect'
              ? { transform: 'none', background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', cursor: 'pointer' }
              : { transform: 'none', cursor: 'pointer' }}
          >
            {badge.label}
          </span>
        )}
        {!badge && playbackEffectiveAudioPath?.active && playbackEffectiveAudioPath.resampling && dsp.upsample_rate > 0 && (
          <span className="bit-badge" style={{ transform: 'none', background: 'linear-gradient(135deg, #a855f7, #6366f1)', cursor: 'pointer' }}>
            HI-RES · {audioPathPresentation.outputRate / 1000}kHz
          </span>
        )}
      </button>
    );
  };

  const renderQuickTools = () => {
    return (
      <div className="pb-tools-group" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className={`pb-btn ${showQueue ? 'active' : ''}`} onClick={toggleQueue} title="Up Next (Queue)">
          <ListMusic size={17} />
        </button>
        <button className={`pb-btn ${view === 'aideo_lab' || (view as string) === 'aideolab' ? 'active' : ''}`} onClick={() => setView(view === 'aideo_lab' || (view as string) === 'aideolab' ? 'nowplaying' : 'aideo_lab')} title="Equalizer and DSP">
          <Activity size={17} />
        </button>
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
        <button className="pb-btn" onClick={() => setView('aideolab' as any)} title="Audio Engine Settings">
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

  return (
    <>
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
          {view !== 'nowplaying' && (
            <PlayerBarLyricPreview
              lyrics={lyrics}
              lyricOffset={lyricOffset}
              className="pb-lyric"
              onClick={() => setView('nowplaying')}
            />
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
          <ClassicProgressRow duration={duration} isLive={isLive} waveformPeaks={waveformPeaks} onSeek={seek} />
        </div>

        {/* RIGHT */}
        <div className="pb-right" style={{ gap: 16 }}>
          {renderAudioBadges()}
          {renderVolume()}
          {renderQuickTools()}
        </div>
      </div>
      <TheaterSignalPathModal
        isOpen={showSignalPathModal}
        onClose={() => setShowSignalPathModal(false)}
      />
    </>
  );
}
