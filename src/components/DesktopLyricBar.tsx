import React, { useState, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Lock, 
  Unlock, 
  X, 
  Minus, 
  Plus, 
  Languages,
  Music,
  Move,
  Mic,
  AlignLeft,
  FileText
} from 'lucide-react';
import { baseName } from '../utils';
import { safeGetStorage, safeSetStorage } from '../utils/storage';
import { LyricLine, Track, LyricsDisplayMode } from '../store/types';

export function DesktopLyricBar() {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<'Playing' | 'Paused' | 'Stopped'>('Stopped');
  const [positionSecs, setPositionSecs] = useState<number>(0);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricOffset, setLyricOffset] = useState<number>(0);
  const [showRomaji, setShowRomaji] = useState<boolean>(true);
  const [showTranslation, setShowTranslation] = useState<boolean>(true);
  const [lyricsDisplayMode, setLyricsDisplayMode] = useState<LyricsDisplayMode>(() => {
    return (safeGetStorage('aideo-lyrics-display-mode', 'karaoke') as LyricsDisplayMode) || 'karaoke';
  });
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [accentColor, setAccentColor] = useState<string>('#8b5cf6');

  const [fontSize, setFontSize] = useState<number>(() => {
    return parseInt(localStorage.getItem('aideo-desktop-lyric-fontsize') || '22', 10);
  });

  const [showSecondary, setShowSecondary] = useState<boolean>(() => {
    return localStorage.getItem('aideo-desktop-lyric-secondary') !== 'false';
  });

  const [isHovered, setIsHovered] = useState(false);

  // ── Ensure transparent background on window ──────────────────────────────
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('desktop-lyrics-window');
      document.body.classList.add('desktop-lyrics-window');
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('desktop-lyrics-window');
        document.body.classList.remove('desktop-lyrics-window');
      }
    };
  }, []);

  // ── 1. Real-time Backend Querying & State Polling ──────────────────────────
  useEffect(() => {
    let active = true;
    let lastTrackPath: string | null = null;

    const poll = async () => {
      try {
        const status: any = await invoke('get_playback_status');
        if (!active || !status) return;

        setPlaybackStatus(status.status);
        setPositionSecs(status.position_secs || 0);

        if (status.current_track && status.current_track !== lastTrackPath) {
          lastTrackPath = status.current_track;
          try {
            const track: any = await invoke('get_track_by_path', { path: status.current_track });
            if (active && track) {
              setCurrentTrack(track);
              setLyricOffset(track.lyric_offset || 0);
            }
          } catch (_) {
            if (active) {
              setCurrentTrack({
                id: 0,
                path: status.current_track,
                title: baseName(status.current_track),
                artist: 'Unknown Artist',
                album: 'Unknown Album',
                duration: 0,
                format: 'FLAC',
                loved: 0,
                disliked: 0,
                lyric_offset: 0,
              });
            }
          }

          try {
            const lrc: any = await invoke('get_lyrics', { path: status.current_track });
            if (active && Array.isArray(lrc)) {
              setLyrics(lrc);
            }
          } catch (_) {}
        } else if (!status.current_track) {
          lastTrackPath = null;
          setCurrentTrack(null);
          setLyrics([]);
        }
      } catch (_) {}
    };

    const interval = setInterval(poll, 150);
    poll();

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // ── 2. Global Event Listener from Main Window ──────────────────────────────
  useEffect(() => {
    const unlistenSync = listen<any>('desktop-lyrics-sync', (event) => {
      const data = event.payload;
      if (!data) return;
      if (data.currentTrack) setCurrentTrack(data.currentTrack);
      if (data.playback) {
        setPlaybackStatus(data.playback.status);
        setPositionSecs(data.playback.position_secs || 0);
      }
      if (data.lyrics) setLyrics(data.lyrics);
      if (typeof data.lyricOffset === 'number') setLyricOffset(data.lyricOffset);
      if (typeof data.showRomaji === 'boolean') setShowRomaji(data.showRomaji);
      if (typeof data.showTranslation === 'boolean') setShowTranslation(data.showTranslation);
      if (data.lyricsDisplayMode) setLyricsDisplayMode(data.lyricsDisplayMode);
      if (data.accentColor) setAccentColor(data.accentColor);
      if (typeof data.desktopLyricsLocked === 'boolean') setIsLocked(data.desktopLyricsLocked);
    });

    const unlistenLock = listen<any>('toggle-desktop-lyrics-lock', () => {
      handleToggleLock();
    });

    return () => {
      unlistenSync.then(u => u());
      unlistenLock.then(u => u());
    };
  }, [isLocked]);

  // ── 3. Keyboard Shortcut Alt+L to Unlock Anytime ───────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        handleToggleLock();
      } else if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocked]);

  // ── 4. Sub-frame Syllable Interpolation ─────────────────────────────────────
  const hasWordSync = useMemo(() => lyrics.some(l => l.words && l.words.length > 0), [lyrics]);
  const isKaraokeActive = hasWordSync && lyricsDisplayMode === 'karaoke';
  const [smoothedTime, setSmoothedTime] = useState(positionSecs);
  const lastPositionRef = useRef(positionSecs);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    lastPositionRef.current = positionSecs;
    lastTimeRef.current = performance.now();
    if (isKaraokeActive) {
      setSmoothedTime(positionSecs);
    }
  }, [positionSecs, isKaraokeActive]);

  useEffect(() => {
    if (!isKaraokeActive || playbackStatus !== 'Playing') return;

    let frameId: number;
    const update = () => {
      const now = performance.now();
      const delta = (now - lastTimeRef.current) / 1000;
      const interpolated = lastPositionRef.current + Math.max(0, delta);
      setSmoothedTime(interpolated);
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [playbackStatus, isKaraokeActive]);

  const currentTime = (isKaraokeActive ? smoothedTime : positionSecs) + lyricOffset / 1000;

  // Active lyric calculation
  const activeIdx = useMemo(() => {
    if (!lyrics.length) return -1;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time_secs <= currentTime) idx = i; else break;
    }
    return idx;
  }, [lyrics, currentTime]);

  const currentLine = activeIdx >= 0 ? lyrics[activeIdx] : null;
  const nextLine = (activeIdx >= 0 && activeIdx + 1 < lyrics.length) ? lyrics[activeIdx + 1] : null;

  // ── 5. Actions ────────────────────────────────────────────────────────────
  const handleMouseDown = async (e: React.MouseEvent) => {
    if (isLocked) return;
    if (e.button === 0 && !(e.target as HTMLElement).closest('button, input, [data-no-drag]')) {
      try {
        await getCurrentWindow().startDragging();
      } catch (_) {
        try {
          await invoke('start_dragging');
        } catch (_) {}
      }
    }
  };

  const handleFontSizeChange = (delta: number) => {
    const next = Math.max(14, Math.min(36, fontSize + delta));
    setFontSize(next);
    localStorage.setItem('aideo-desktop-lyric-fontsize', String(next));
  };

  const handleToggleLock = async () => {
    const nextLocked = !isLocked;
    setIsLocked(nextLocked);
    try {
      await invoke('set_desktop_lyrics_ignore_cursor', { ignore: nextLocked });
      await emit('desktop-lyrics-lock-status', nextLocked);
    } catch (e) {
      console.error('Failed to set ignore cursor:', e);
    }
  };

  const handleTogglePlay = async () => {
    try {
      if (playbackStatus === 'Playing') {
        await invoke('pause_track');
        await emit('media-pause');
        setPlaybackStatus('Paused');
      } else {
        await invoke('resume_track');
        await emit('media-play');
        setPlaybackStatus('Playing');
      }
    } catch (e) {
      console.error('Failed to toggle playback:', e);
    }
  };

  const handlePlayNext = async () => {
    await emit('media-next').catch(() => {});
  };

  const handlePlayPrev = async () => {
    await emit('media-prev').catch(() => {});
  };

  const handleClose = async () => {
    try {
      await invoke('toggle_desktop_lyrics', { show: false });
      await emit('desktop-lyrics-closed');
    } catch (e) {
      console.error('Failed to close desktop lyrics:', e);
    }
  };

  // Secondary text resolution (Translation > Romaji > Next Line)
  const secondaryText = useMemo(() => {
    if (!showSecondary) return null;
    if (showTranslation && currentLine?.translation) return currentLine.translation;
    if (showRomaji && currentLine?.romaji) return currentLine.romaji;
    if (nextLine) return nextLine.text;
    return null;
  }, [showSecondary, showTranslation, showRomaji, currentLine, nextLine]);

  return (
    <div 
      id="desktop-lyric-bar-root"
      onMouseDown={handleMouseDown}
      onMouseEnter={() => !isLocked && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '6px 16px',
        background: isHovered 
          ? 'rgba(12, 12, 20, 0.92)' 
          : (isLocked ? 'transparent' : 'rgba(10, 10, 16, 0.7)'),
        backdropFilter: isLocked ? 'none' : 'blur(20px)',
        WebkitBackdropFilter: isLocked ? 'none' : 'blur(20px)',
        border: isLocked ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 14,
        boxShadow: isLocked ? 'none' : '0 12px 36px rgba(0, 0, 0, 0.5)',
        userSelect: 'none',
        position: 'relative',
        transition: 'background 0.2s ease, border-color 0.2s ease',
        overflow: 'hidden',
        cursor: isLocked ? 'default' : 'grab',
      }}
    >
      {/* Top Floating Control Bar (Shows on Hover when not locked) */}
      <div 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 28,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isHovered ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
          opacity: isHovered ? 1 : 0,
          pointerEvents: isHovered && !isLocked ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)', fontSize: 11, fontWeight: 700 }}>
          <Move size={12} />
          <Music size={12} style={{ color: accentColor }} />
          <span style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentTrack ? (currentTrack.title || baseName(currentTrack.path)) : 'Aideo Desktop Lyrics'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-no-drag>
          {/* Font Controls */}
          <button
            onClick={() => handleFontSizeChange(-2)}
            title="Decrease Font Size"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
          >
            <Minus size={13} />
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 700 }}>{fontSize}px</span>
          <button
            onClick={() => handleFontSizeChange(2)}
            title="Increase Font Size"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
          >
            <Plus size={13} />
          </button>

          {/* Subtitle Toggle */}
          <button
            onClick={() => {
              const next = !showSecondary;
              setShowSecondary(next);
              localStorage.setItem('aideo-desktop-lyric-secondary', String(next));
            }}
            title="Toggle Subtitle / Next Line"
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: showSecondary ? accentColor : 'var(--text-dim)', 
              cursor: 'pointer', 
              padding: 2 
            }}
          >
            <Languages size={13} />
          </button>

          {/* Display Mode Toggle */}
          <button
            onClick={() => {
              const nextMode: LyricsDisplayMode =
                lyricsDisplayMode === 'karaoke' ? 'line_sync' :
                lyricsDisplayMode === 'line_sync' ? 'static' : 'karaoke';
              setLyricsDisplayMode(nextMode);
              safeSetStorage('aideo-lyrics-display-mode', nextMode);
            }}
            title={`Display Mode: ${lyricsDisplayMode === 'karaoke' ? '🎤 Karaoke' : lyricsDisplayMode === 'line_sync' ? '⏱️ Line Sync' : '📄 Static Text'} (Click to switch)`}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: lyricsDisplayMode === 'karaoke' ? accentColor : 'var(--text-dim)', 
              cursor: 'pointer', 
              padding: 2 
            }}
          >
            {lyricsDisplayMode === 'karaoke' && <Mic size={13} />}
            {lyricsDisplayMode === 'line_sync' && <AlignLeft size={13} />}
            {lyricsDisplayMode === 'static' && <FileText size={13} />}
          </button>

          {/* Lock Click-Through Toggle */}
          <button
            onClick={handleToggleLock}
            title={isLocked ? "Locked (Click-Through HUD mode)" : "Lock into Click-Through Mode (Press Alt+L to Unlock)"}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: isLocked ? '#10b981' : 'var(--text-dim)', 
              cursor: 'pointer', 
              padding: 2 
            }}
          >
            {isLocked ? <Lock size={13} /> : <Unlock size={13} />}
          </button>

          {/* Close */}
          <button
            onClick={handleClose}
            title="Close Desktop Lyrics"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Main Active Lyric Display */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        width: '100%',
        paddingTop: isHovered ? 10 : 0,
      }}>
        {currentLine ? (
          <div style={{
            fontSize: fontSize,
            fontWeight: 800,
            color: 'white',
            letterSpacing: -0.3,
            lineHeight: 1.2,
            textShadow: '0 2px 12px rgba(0, 0, 0, 0.9), 0 0 24px rgba(139, 92, 246, 0.5)',
            maxWidth: '96%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}>
            {/* Word-by-word karaoke syllable rendering if available */}
            {lyricsDisplayMode === 'karaoke' && currentLine.words && currentLine.words.length > 0 ? (
              currentLine.words.map((w, idx) => {
                const nextWord = currentLine.words![idx + 1];
                const duration = w.duration_secs && w.duration_secs > 0
                  ? w.duration_secs
                  : (nextWord && nextWord.time_secs > w.time_secs ? (nextWord.time_secs - w.time_secs) : 0.8);
                const isStarted = currentTime >= w.time_secs;
                const isFinished = (w.duration_secs && w.duration_secs > 0)
                  ? currentTime >= (w.time_secs + w.duration_secs)
                  : (nextWord ? currentTime >= nextWord.time_secs : currentTime >= (w.time_secs + duration));
                
                let progress = 0;
                if (isFinished) {
                  progress = 100;
                } else if (isStarted) {
                  progress = Math.min(100, Math.max(0, ((currentTime - w.time_secs) / duration) * 100));
                }

                return (
                  <span
                    key={idx}
                    className="desktop-lyric-word"
                    style={{
                      '--word-progress': `${progress}%`,
                      '--desktop-accent': accentColor,
                    } as React.CSSProperties}
                  >
                    {w.text}
                  </span>
                );
              })
            ) : (
              <span style={{ color: 'white' }}>{currentLine.text}</span>
            )}
          </div>
        ) : (
          <div style={{
            fontSize: Math.max(14, fontSize - 4),
            fontWeight: 600,
            color: 'rgba(255, 255, 255, 0.5)',
            letterSpacing: 0.2,
          }}>
            {currentTrack ? (currentTrack.title || baseName(currentTrack.path)) : 'No song currently playing'}
          </div>
        )}

        {/* Secondary Subtitle Line (Translation / Romaji / Next Line) */}
        {secondaryText && (
          <div style={{
            fontSize: Math.max(12, fontSize - 6),
            fontWeight: 600,
            color: 'rgba(255, 255, 255, 0.75)',
            marginTop: 4,
            textShadow: '0 2px 8px rgba(0, 0, 0, 0.8)',
            maxWidth: '92%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {secondaryText}
          </div>
        )}
      </div>

      {/* Mini Playback Transport Bar (Shows on Hover when not locked) */}
      {isHovered && !isLocked && (
        <div 
          data-no-drag
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginTop: 6,
          }}
        >
          <button
            onClick={handlePlayPrev}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: 4 }}
            title="Previous Track"
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={handleTogglePlay}
            style={{
              background: accentColor,
              border: 'none',
              borderRadius: '50%',
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
            }}
            title={playbackStatus === 'Playing' ? 'Pause' : 'Play'}
          >
            {playbackStatus === 'Playing' ? <Pause size={12} /> : <Play size={12} style={{ marginLeft: 1 }} />}
          </button>
          <button
            onClick={handlePlayNext}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: 4 }}
            title="Next Track"
          >
            <SkipForward size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
