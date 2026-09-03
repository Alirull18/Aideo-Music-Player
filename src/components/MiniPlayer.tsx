import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { Play, Pause, SkipBack, SkipForward, Maximize2, Volume2, VolumeX, Heart, ThumbsDown, Music, Lock, Unlock, Pin, PinOff, Tv2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import defaultCover from '../assets/default_cover.png';
import { baseName } from '../utils';

export function MiniPlayer() {
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    return localStorage.getItem('aideo-mini-player-locked') === 'true';
  });

  const [isPinned, setIsPinned] = useState<boolean>(() => {
    return localStorage.getItem('aideo-mini-player-pinned') !== 'false';
  });

  const {
    isMuted,
    toggleMute,
    currentTrack,
    coverArt,
    lyrics,
    lyricOffset,
    showRomaji,
    showTranslation,
    albumArtFit,
    pauseTrack,
    resumeTrack,
    playNext,
    playPrev,
    setVolume,
    setMiniPlayerMode,
    toggleLoveTrack,
    toggleDislikeTrack,
    translateLyrics,
    getRomaji,
    isTranslating,
    desktopLyricsOpen,
    toggleDesktopLyrics,
    desktopLyricsLocked,
    toggleDesktopLyricsLocked,
    playbackPositionSecs,
    playbackCurrentTrack,
    playbackStatus,
    playbackVolume,
    playbackIsBuffering
  } = useStore(useShallow(s => ({
    playbackPositionSecs: s.playback.position_secs,
    playbackCurrentTrack: s.playback.current_track,
    playbackStatus: s.playback.status,
    playbackIsBuffering: Boolean(s.playback.is_buffering),
    playbackVolume: s.playback.volume,
    isMuted: s.isMuted,
    toggleMute: s.toggleMute,
    currentTrack: s.currentTrack,
    coverArt: s.coverArt,
    lyrics: s.lyrics,
    lyricOffset: s.lyricOffset,
    showRomaji: s.showRomaji,
    showTranslation: s.showTranslation,
    albumArtFit: s.albumArtFit,
    pauseTrack: s.pauseTrack,
    resumeTrack: s.resumeTrack,
    playNext: s.playNext,
    playPrev: s.playPrev,
    setVolume: s.setVolume,
    setMiniPlayerMode: s.setMiniPlayerMode,
    toggleLoveTrack: s.toggleLoveTrack,
    toggleDislikeTrack: s.toggleDislikeTrack,
    translateLyrics: s.translateLyrics,
    getRomaji: s.getRomaji,
    isTranslating: s.isTranslating,
    desktopLyricsOpen: s.desktopLyricsOpen,
    toggleDesktopLyrics: s.toggleDesktopLyrics,
    desktopLyricsLocked: s.desktopLyricsLocked,
    toggleDesktopLyricsLocked: s.toggleDesktopLyricsLocked,
  })));

  const current = currentTrack;

  // Auto Translation & Romaji when toggles are enabled
  useEffect(() => {
    if (!currentTrack || lyrics.length === 0 || isTranslating) return;

    const checkAndFetch = async () => {
      if (showTranslation) {
        const hasTranslation = lyrics.some(l => l.translation);
        if (!hasTranslation) {
          try {
            await translateLyrics();
          } catch (err) {
            console.error('Auto-translation failed:', err);
          }
          return;
        }
      }

      if (showRomaji) {
        const hasRomaji = lyrics.some(l => l.romaji);
        if (!hasRomaji) {
          try {
            await getRomaji();
          } catch (err) {
            console.error('Auto-romaji failed:', err);
          }
        }
      }
    };

    checkAndFetch();
  }, [currentTrack?.path, lyrics.length, showRomaji, showTranslation, isTranslating]);

  useEffect(() => {
    if (isLocked) {
      invoke('set_window_resizable', { resizable: false }).catch(() => {});
    }
  }, [isLocked]);

  useEffect(() => {
    invoke('set_window_always_on_top', { alwaysOnTop: isPinned }).catch(() => {
      try {
        getCurrentWindow().setAlwaysOnTop(isPinned).catch(() => {});
      } catch (_) {}
    });
  }, [isPinned]);

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextPinned = !isPinned;
    setIsPinned(nextPinned);
    localStorage.setItem('aideo-mini-player-pinned', nextPinned ? 'true' : 'false');
    invoke('set_window_always_on_top', { alwaysOnTop: nextPinned }).catch(() => {
      try {
        getCurrentWindow().setAlwaysOnTop(nextPinned).catch(() => {});
      } catch (_) {}
    });
  };

  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextLocked = !isLocked;
    setIsLocked(nextLocked);
    localStorage.setItem('aideo-mini-player-locked', nextLocked ? 'true' : 'false');
    invoke('set_window_resizable', { resizable: !nextLocked }).catch(() => {});
  };

  const activeLyric = useMemo(() => {
    if (!lyrics || !lyrics.length) return null;
    const now = playbackPositionSecs + lyricOffset / 1000;
    let currentLine = null;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time_secs <= now) {
        currentLine = lyrics[i];
      } else {
        break;
      }
    }
    return currentLine;
  }, [lyrics, playbackPositionSecs, lyricOffset]);

  // Determine displayed text honoring active Romaji and Translation preferences
  const displayLyricText = useMemo(() => {
    if (!activeLyric) return '';
    if (showTranslation && activeLyric.translation) {
      return activeLyric.translation;
    }
    if (showRomaji && activeLyric.romaji && activeLyric.romaji !== activeLyric.text) {
      return activeLyric.romaji;
    }
    return activeLyric.text;
  }, [activeLyric, showTranslation, showRomaji]);

  const lyricTooltip = useMemo(() => {
    if (!activeLyric) return current?.album || '';
    const parts = [activeLyric.text];
    if (activeLyric.romaji && activeLyric.romaji !== activeLyric.text) {
      parts.push(`🈳 Romaji: ${activeLyric.romaji}`);
    }
    if (activeLyric.translation) {
      parts.push(`🌐 Translation: ${activeLyric.translation}`);
    }
    return parts.join('\n');
  }, [activeLyric, current?.album]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isLocked || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('.mini-vol-slider') || target.closest('.mini-btn-restore')) {
      return;
    }

    try {
      getCurrentWindow().startDragging().catch(() => {});
    } catch (_) {}
  };

  return (
    <div 
      className={`mini-player-container ${isLocked ? 'is-locked' : ''}`}
      data-tauri-drag-region={!isLocked ? "" : undefined}
      onMouseDown={handleMouseDown}
    >
      {/* Background Cover Blur */}
      <div 
        className="mini-player-blur-bg" 
        style={{ backgroundImage: `url(${coverArt || defaultCover})` }} 
      />

      <div className="mini-player-content" data-tauri-drag-region={!isLocked ? "" : undefined}>
        {/* Cover Art Section */}
        <div className={`mini-cover-wrapper ${albumArtFit === 'contain' ? 'contain-mode' : ''}`} data-tauri-drag-region={!isLocked ? "" : undefined}>
          {albumArtFit === 'contain' && (
            <div 
              className="mini-cover-ambient-bg" 
              style={{ backgroundImage: `url(${coverArt || defaultCover})` }} 
            />
          )}
          <img 
            src={coverArt || defaultCover} 
            alt="" 
            className={`mini-cover ${albumArtFit === 'contain' ? 'contain-art' : ''}`} 
            draggable={false} 
          />
          <button 
            className="mini-btn-restore" 
            onClick={() => setMiniPlayerMode(false)}
            title="Restore Player size"
            aria-label="Restore to Normal Player Size"
          >
            <Maximize2 size={13} strokeWidth={2.5} color="#ffffff" />
          </button>
        </div>

        {/* Info & Controls Section */}
        <div className="mini-right-panel">
          <div className="mini-info">
            <div className="mini-title" title={current?.title || baseName(playbackCurrentTrack)}>
              {current?.title || baseName(playbackCurrentTrack) || 'Not Playing'}
            </div>
            <div className="mini-artist" title={current?.artist || 'Unknown Artist'}>
              {current?.artist || 'Unknown Artist'}
            </div>
            <div className="mini-lyric-ticker" title={lyricTooltip}>
              <AnimatePresence mode="wait">
                {activeLyric ? (
                  <motion.div
                    key={`${activeLyric.time_secs}-${showTranslation ? 'tr' : showRomaji ? 'ro' : 'orig'}`}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.15 }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', overflow: 'hidden' }}
                  >
                    <Music size={10} style={{ color: 'var(--dynamic-accent, #8b5cf6)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {displayLyricText}
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="no-lyric"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.6 }}
                    exit={{ opacity: 0 }}
                    style={{ fontSize: 10, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {lyrics.length > 0 ? '♫ Instrumental ♫' : (current?.album || '')}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Controls Row */}
          <div className="mini-controls">
            <button className="mini-btn" onClick={playPrev} title="Previous">
              <SkipBack size={14} fill="currentColor" />
            </button>
            <button 
              className="mini-btn play-pause" 
              onClick={playbackStatus === 'Playing' ? pauseTrack : resumeTrack}
              title={playbackIsBuffering ? 'Buffering stream...' : playbackStatus === 'Playing' ? 'Pause' : 'Play'}
            >
              {playbackIsBuffering ? <Loader2 size={14} className="animate-spin" /> : playbackStatus === 'Playing' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>
            <button className="mini-btn" onClick={playNext} title="Next">
              <SkipForward size={14} fill="currentColor" />
            </button>
          </div>

          {/* Volume & Feedback Row */}
          <div className="mini-bottom-row">
            <div className="mini-feedback">
              {current && (
                <>
                  <button 
                    className={`mini-fb-btn ${current.loved === 1 ? 'loved' : ''}`}
                    onClick={() => toggleLoveTrack(current.path, current)}
                    title="Love track"
                  >
                    <Heart size={11} fill={current.loved === 1 ? '#10b981' : 'transparent'} />
                  </button>
                  <button 
                    className={`mini-fb-btn ${current.disliked === 1 ? 'disliked' : ''}`}
                    onClick={() => toggleDislikeTrack(current.path, current)}
                    title="Dislike track"
                  >
                    <ThumbsDown size={11} fill={current.disliked === 1 ? '#f43f5e' : 'transparent'} />
                  </button>
                </>
              )}
              <button 
                className={`mini-fb-btn ${isPinned ? 'pinned' : ''}`}
                onClick={togglePin}
                title={isPinned ? "Unpin Mini Player (Window layers behind active apps)" : "Pin Mini Player (Always on Top over games and browsers)"}
              >
                {isPinned ? (
                  <Pin size={11} color="var(--accent)" style={{ transform: 'rotate(45deg)' }} />
                ) : (
                  <PinOff size={11} color="var(--text-dim)" />
                )}
              </button>
              <button 
                className={`mini-fb-btn ${isLocked ? 'locked' : ''}`}
                onClick={toggleLock}
                title={isLocked ? "Unlock to move or resize mini player" : "Lock mini player position and size"}
              >
                {isLocked ? (
                  <Lock size={11} color="var(--accent)" />
                ) : (
                  <Unlock size={11} color="var(--text-dim)" />
                )}
              </button>
              <button 
                className={`mini-fb-btn ${desktopLyricsOpen ? 'active' : ''}`}
                onClick={toggleDesktopLyrics}
                onContextMenu={(e) => {
                  e.preventDefault();
                  toggleDesktopLyricsLocked();
                }}
                title={desktopLyricsOpen ? (desktopLyricsLocked ? "Desktop Lyrics: Locked (Right-click to Unlock)" : "Desktop Lyrics: Open (Right-click to Lock)") : "Open Floating Desktop Lyric Bar"}
                style={{ position: 'relative' }}
              >
                <Tv2 size={11} color={desktopLyricsOpen ? "var(--accent)" : "var(--text-dim)"} />
                {desktopLyricsOpen && desktopLyricsLocked && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 1,
                      right: 1,
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      backgroundColor: '#10b981',
                    }}
                  />
                )}
              </button>
            </div>
            <div className="mini-volume">
              <button 
                className="mini-fb-btn" 
                onClick={toggleMute} 
                title={isMuted || playbackVolume === 0 ? "Unmute" : "Mute"}
                style={{ width: 'auto', height: 'auto', padding: 2 }}
              >
                {isMuted || playbackVolume === 0 ? (
                  <VolumeX size={11} color="var(--accent)" />
                ) : (
                  <Volume2 size={11} color="var(--text-dim)" />
                )}
              </button>
              <input 
                className="mini-vol-slider" 
                type="range" 
                min={0} 
                max={1} 
                step={0.05} 
                value={playbackVolume} 
                onChange={e => setVolume(+e.target.value)} 
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
