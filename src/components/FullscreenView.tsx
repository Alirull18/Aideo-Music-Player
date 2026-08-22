import { useEffect, useState, useRef, useMemo } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  X,
  Maximize2,
  Minimize2,
  Sparkles,
  LayoutGrid,
  Music,
  Activity,
  Languages,
  Type,
  Mic,
  AlignLeft,
  FileText
} from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { LiquidBackground } from './LiquidBackground';
import { Visualizer } from './Visualizer';
import { generateWaveformPeaks } from '../utils/waveform';
import { baseName, getStreamName } from '../utils';
import { LyricsDisplayMode } from '../store/types';

export function FullscreenView() {
  const {
    playback,
    isMuted,
    toggleMute,
    currentTrack,
    coverArt,
    lyrics,
    lyricOffset,
    lyricStatus,
    lyricsDisplayMode,
    setLyricsDisplayMode,
    accentColor,
    dsp,
    currentDevice,
    setView,
    seek,
    setVolume,
    playNext,
    playPrev,
    pauseTrack,
    resumeTrack,
    liquidBackgroundEnabled,
    toggleLiquidBackground,
    showRomaji,
    showTranslation,
    translateLyrics,
    isTranslating,
    getRomaji,
    albumArtFit
  } = useStore();

  // Syllable word-by-word sync detection: only run 60fps rAF timer if track has word-level karaoke data and karaoke mode is active
  const hasWordSync = useMemo(() => lyrics.some(l => l.words && l.words.length > 0), [lyrics]);
  const isKaraokeActive = hasWordSync && lyricsDisplayMode === 'karaoke';
  const [smoothedTime, setSmoothedTime] = useState(playback.position_secs);
  const lastPositionRef = useRef(playback.position_secs);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    lastPositionRef.current = playback.position_secs;
    lastTimeRef.current = performance.now();
    if (isKaraokeActive) {
      setSmoothedTime(playback.position_secs);
    }
  }, [playback.position_secs, isKaraokeActive]);

  useEffect(() => {
    if (!isKaraokeActive || playback.status !== 'Playing') return;

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
  }, [playback.status, isKaraokeActive]);

  const currentTime = (isKaraokeActive ? smoothedTime : playback.position_secs) + lyricOffset / 1000;
  const trackDuration = currentTrack?.duration || 0;

  const [layout, setLayout] = useState<'stage' | 'zen'>(() => {
    return (localStorage.getItem('aideo-fullscreen-layout') as 'stage' | 'zen') || 'stage';
  });

  const [isNativeFullscreen, setIsNativeFullscreen] = useState(true);
  const [isHUDHidden, setIsHUDHidden] = useState(false);

  // Persistent Visualizer Mode Preference
  const [vizMode, setVizMode] = useState<'baseline' | 'circle' | 'wave'>(() => {
    return (localStorage.getItem('aideo-fullscreen-viz-mode') as 'baseline' | 'circle' | 'wave') || 'baseline';
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const activityTimer = useRef<number | null>(null);

  // Sync Layout preference
  useEffect(() => {
    localStorage.setItem('aideo-fullscreen-layout', layout);
  }, [layout]);

  // Sync Visualizer preference
  useEffect(() => {
    localStorage.setItem('aideo-fullscreen-viz-mode', vizMode);
  }, [vizMode]);

  // Auto-fetch Romaji and Translations for the new track if enabled
  useEffect(() => {
    if (!currentTrack || lyrics.length === 0 || isTranslating) return;

    const checkAndFetch = async () => {
      // 1. Auto Translation
      if (showTranslation) {
        const hasTranslation = lyrics.some(l => l.translation);
        if (!hasTranslation) {
          try {
            await translateLyrics();
          } catch (err) {
            console.error("Auto-translation failed:", err);
          }
          return;
        }
      }

      // 2. Auto Romaji
      if (showRomaji) {
        const hasRomaji = lyrics.some(l => l.romaji);
        if (!hasRomaji) {
          try {
            await getRomaji();
          } catch (err) {
            console.error("Auto-romaji failed:", err);
          }
        }
      }
    };

    checkAndFetch();
  }, [currentTrack?.path, lyrics.length, showRomaji, showTranslation, isTranslating, getRomaji, translateLyrics]);

  // Native Fullscreen on mount, restore on unmount
  useEffect(() => {
    const appWindow = getCurrentWindow();
    invoke('enter_borderless_fullscreen', { fullscreen: true }).catch(() => {
      appWindow.setFullscreen(true).catch(err => console.error("Tauri fullscreen error:", err));
    });

    // Check initial native fullscreen status
    appWindow.isFullscreen().then(setIsNativeFullscreen).catch(() => { });

    return () => {
      invoke('enter_borderless_fullscreen', { fullscreen: false }).catch(() => {
        appWindow.setFullscreen(false).catch(err => console.error("Tauri restore window error:", err));
      });
    };
  }, []);

  // Keyboard navigation & ambient hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') return;

      const state = useStore.getState();
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        e.preventDefault();
        setView('nowplaying');
      } else if (key === 'f' || e.key === 'F11') {
        e.preventDefault();
        const appWindow = getCurrentWindow();
        appWindow.isFullscreen().then(isFS => {
          const nextFS = !isFS;
          invoke('enter_borderless_fullscreen', { fullscreen: nextFS }).catch(() => {
            appWindow.setFullscreen(nextFS).catch(() => {});
          });
          setIsNativeFullscreen(nextFS);
        });
      } else if (e.code === 'Space' || key === ' ') {
        e.preventDefault();
        if (state.playback.status === 'Playing') {
          state.pauseTrack();
        } else {
          state.resumeTrack();
        }
      } else if (key === 'l') {
        e.preventDefault();
        setLayout(prev => prev === 'stage' ? 'zen' : 'stage');
      } else if (key === 'v') {
        e.preventDefault();
        const modes: ('baseline' | 'circle' | 'wave')[] = ['baseline', 'circle', 'wave'];
        setVizMode(prev => {
          const nextIdx = (modes.indexOf(prev) + 1) % modes.length;
          return modes[nextIdx];
        });
      } else if (key === 't') {
        e.preventDefault();
        handleTranslate();
      } else if (key === 'r') {
        e.preventDefault();
        handleRomajiToggle();
      } else if (key === 'm') {
        e.preventDefault();
        state.toggleMute();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        state.seek(Math.max(0, state.playback.position_secs - 5));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const duration = state.currentTrack?.duration || 0;
        state.seek(Math.min(duration, state.playback.position_secs + 5));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const nextVol = Math.min(1, Math.round((state.playback.volume + 0.05) * 100) / 100);
        state.setVolume(nextVol);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextVol = Math.max(0, Math.round((state.playback.volume - 0.05) * 100) / 100);
        state.setVolume(nextVol);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setView]);

  // Autohide HUD timer: 3.5 seconds of inactivity
  useEffect(() => {
    const resetTimer = () => {
      setIsHUDHidden(false);
      if (activityTimer.current) {
        clearTimeout(activityTimer.current);
      }
      activityTimer.current = window.setTimeout(() => {
        setIsHUDHidden(true);
      }, 3500);
    };

    window.addEventListener('mousemove', resetTimer, { passive: true });
    window.addEventListener('pointermove', resetTimer, { passive: true });
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('wheel', resetTimer, { passive: true });
    window.addEventListener('click', resetTimer);

    // Initial trigger
    resetTimer();

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('pointermove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('wheel', resetTimer);
      window.removeEventListener('click', resetTimer);
      if (activityTimer.current) {
        clearTimeout(activityTimer.current);
      }
    };
  }, []);

  // Audio spectrum/DSD/Upsampler format badge computation
  const telemetryText = useMemo(() => {
    if (currentTrack?.format) {
      const fmtLower = currentTrack.format.toLowerCase();
      if (fmtLower.includes('dsf') || fmtLower.includes('dff') || fmtLower.includes('dsd')) {
        return `DSD NATIVE · ${currentTrack.format.toUpperCase()}`;
      }
      if (playback.bit_perfect) {
        const rate = playback.dev_rate > 0 ? `· ${playback.dev_rate / 1000}kHz` : '';
        return `BIT-PERFECT ${currentDevice?.startsWith('[ASIO]') ? 'ASIO' : 'WASAPI'} ${rate}`;
      }
      if (dsp.upsample_rate > 0) {
        return `TRANSCODED · ${dsp.upsample_rate / 1000}kHz`;
      }
      const upperFmt = currentTrack.format.toUpperCase();
      return upperFmt === 'YOUTUBE DIRECT' ? 'WEB STREAM' : upperFmt;
    }
    return 'STANDARD AUDIO';
  }, [currentTrack, playback.bit_perfect, playback.dev_rate, currentDevice, dsp.upsample_rate]);

  // Lyrics indexing & smooth scroll
  const activeIdx = useMemo(() => {
    if (!lyrics.length) return -1;
    const now = playback.position_secs + lyricOffset / 1000;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time_secs <= now) idx = i; else break;
    }
    return idx;
  }, [lyrics, playback.position_secs, lyricOffset]);

  useEffect(() => {
    if (lyricsDisplayMode === 'static' || !scrollRef.current || activeIdx === -1) return;
    const el = scrollRef.current.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    if (el) {
      const container = scrollRef.current;
      const targetTop = el.offsetTop - (container.clientHeight / 2) + (el.clientHeight / 2);
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }, [activeIdx, layout, lyricsDisplayMode]);

  // Play/Pause handler
  const handlePlayPause = () => {
    if (playback.status === 'Playing') {
      pauseTrack();
    } else {
      resumeTrack();
    }
  };

  // Mute volume helper
  const handleMuteToggle = () => {
    toggleMute();
  };

  // Romaji toggle handler
  const handleRomajiToggle = async () => {
    const s = useStore.getState();
    const hasRomaji = s.lyrics.some(l => l.romaji);
    if (!hasRomaji && s.lyrics.length > 0) {
      try {
        await s.getRomaji();
        s.setShowRomaji(true);
      } catch (err) {
        console.error("Failed to fetch Romaji:", err);
      }
    } else {
      s.setShowRomaji(!s.showRomaji);
    }
  };

  // Translate toggle handler
  const handleTranslate = async () => {
    const s = useStore.getState();
    const hasTranslation = s.lyrics.some(l => l.translation);
    if (!hasTranslation && s.lyrics.length > 0) {
      try {
        await s.translateLyrics();
        s.setShowTranslation(true);
      } catch (err) {
        console.error("Translation failed:", err);
      }
    } else {
      s.setShowTranslation(!s.showTranslation);
    }
  };

  // Safe track progress values
  const progressPercent = trackDuration > 0 ? (playback.position_secs / trackDuration) * 100 : 0;

  const waveformPeaks = useMemo(() => {
    return generateWaveformPeaks(currentTrack?.path || currentTrack?.title || 'aideo-fs', 60);
  }, [currentTrack?.path, currentTrack?.title]);

  // Simple formatting helper
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className={`fullscreen-overlay ${isHUDHidden ? 'hud-hidden' : ''}`}>
      {/* Immersive backdrop visualizer */}
      <LiquidBackground />

      {/* Floating Exit Button */}
      <button
        className="fullscreen-exit-btn"
        onClick={() => setView('nowplaying')}
        title="Exit Fullscreen Mode"
      >
        <X size={20} />
      </button>

      {/* Floating Layout Toggle */}
      <button
        className="fullscreen-layout-toggle"
        onClick={() => setLayout(layout === 'stage' ? 'zen' : 'stage')}
        title={`Switch to ${layout === 'stage' ? 'Zen Mode' : 'Stage Mode'}`}
      >
        <LayoutGrid size={16} />
        <span>{layout === 'stage' ? 'Zen View' : 'Stage View'}</span>
      </button>

      {/* Main Content Pane */}
      <AnimatePresence mode="wait">
        {layout === 'stage' ? (
          <motion.div
            key="stage"
            className="fullscreen-content-stage"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.4 }}
          >
            {/* Left Column: Artwork and Meta */}
            <div className="fullscreen-stage-left">
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 440, height: 440 }}>
                {/* Dynamic Ambient Glow Aura */}
                <div 
                  className="fullscreen-cover-glow-aura" 
                  style={{
                    background: `radial-gradient(circle, ${accentColor || 'var(--dynamic-accent)'} 0%, rgba(var(--accent-rgb, 139, 92, 246), 0.35) 45%, transparent 70%)`
                  }} 
                />
                {vizMode === 'circle' && (
                  <div style={{ position: 'absolute', width: 620, height: 620, zIndex: 1, pointerEvents: 'none' }}>
                    <Visualizer mode="circle" />
                  </div>
                )}
                <div className={`fullscreen-cover-art-wrap ${albumArtFit === 'contain' ? 'contain-mode' : ''}`} style={{ zIndex: 2, margin: 0 }}>
                  {albumArtFit === 'contain' && (
                    <div 
                      className="fullscreen-cover-ambient-bg" 
                      style={{ backgroundImage: `url(${coverArt || defaultCover})` }} 
                    />
                  )}
                  <img
                    src={coverArt || defaultCover}
                    alt="Album Artwork"
                    className={`fullscreen-cover-art ${albumArtFit === 'contain' ? 'contain-art' : ''}`}
                  />
                </div>
              </div>

              <div className="fullscreen-track-meta">
                <h1 className="fullscreen-track-title">
                  {currentTrack?.title || (playback.current_track?.startsWith('http') ? getStreamName(playback.current_track) : baseName(playback.current_track || ''))}
                </h1>
                <p className="fullscreen-track-artist">
                  {currentTrack?.artist || (playback.current_track?.startsWith('http') ? 'Online Stream' : '—')}
                </p>

                {/* Telemetry Badge */}
                <div className="fullscreen-telemetry-badge">
                  <span className="fullscreen-telemetry-dot" style={{ backgroundColor: accentColor, boxShadow: `0 0 8px ${accentColor}` }}></span>
                  <span>{telemetryText}</span>
                </div>
              </div>
            </div>

            {/* Right Column: Synced scrolling lyrics */}
            <div className="fullscreen-lyrics-column">
              <div className={`fullscreen-lyrics-fade-wrap ${lyricsDisplayMode === 'static' ? 'plain-mode' : ''}`}>
                <div className="fullscreen-lyrics-scroll" ref={scrollRef}>
                  <div className="fullscreen-lyric-spacer" />
                  {lyrics.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 18, padding: '100px 0' }}>
                      {lyricStatus === 'loading' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                          <Activity size={32} className="spin" style={{ color: accentColor }} />
                          <div>Loading Synced Lyrics...</div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                          <Music size={32} style={{ color: 'var(--text-dim)' }} />
                          <div>Instrumental or No Lyrics Available</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    lyrics.map((l, i) => (
                      <div
                        key={i}
                        data-idx={i}
                        className={`fullscreen-lyric-line ${lyricsDisplayMode !== 'static' && i === activeIdx ? 'active' : ''}`}
                        style={{ cursor: lyricsDisplayMode !== 'static' ? 'pointer' : 'default' }}
                        onClick={() => {
                          if (lyricsDisplayMode !== 'static') {
                            seek(l.time_secs - lyricOffset / 1000);
                          }
                        }}
                      >
                        <div>
                          {lyricsDisplayMode === 'karaoke' && i === activeIdx && l.words && l.words.length > 0 ? (
                            l.words.map((word, wordIdx) => {
                              const nextWord = l.words![wordIdx + 1];
                              const duration = word.duration_secs && word.duration_secs > 0
                                ? word.duration_secs
                                : (nextWord && nextWord.time_secs > word.time_secs ? (nextWord.time_secs - word.time_secs) : 0.8);
                              const isStarted = currentTime >= word.time_secs;
                              const isFinished = (word.duration_secs && word.duration_secs > 0)
                                ? currentTime >= (word.time_secs + word.duration_secs)
                                : (nextWord ? currentTime >= nextWord.time_secs : currentTime >= (word.time_secs + duration));
                              
                              let progress = 0;
                              if (isFinished) {
                                progress = 100;
                              } else if (isStarted) {
                                progress = Math.min(100, Math.max(0, ((currentTime - word.time_secs) / duration) * 100));
                              }

                              return (
                                <span 
                                  key={wordIdx} 
                                  className="lyric-word"
                                  style={{ '--word-progress': `${progress}%` } as React.CSSProperties}
                                >
                                  {word.text}
                                </span>
                              );
                            })
                          ) : (
                            l.text || '♪'
                          )}
                        </div>
                        {showRomaji && l.romaji && l.romaji !== l.text && (
                          <div className="fullscreen-lyric-romaji">{l.romaji}</div>
                        )}
                        {showTranslation && l.translation && (
                          <div className="fullscreen-lyric-translation">{l.translation}</div>
                        )}
                      </div>
                    ))
                  )}
                  <div className="fullscreen-lyric-spacer" />
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="zen"
            className="fullscreen-content-zen"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.4 }}
            style={{ position: 'relative' }}
          >
            {/* Centered Circle Visualizer in background for Zen mode */}
            {vizMode === 'circle' && (
              <div style={{ position: 'absolute', width: 600, height: 600, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 0, opacity: 0.12, pointerEvents: 'none' }}>
                <Visualizer mode="circle" />
              </div>
            )}
            {/* Small floating artwork in top-left */}
            <div className="fullscreen-zen-floating-art">
              <img
                src={coverArt || defaultCover}
                alt="Album Cover"
                className="fullscreen-zen-art-thumb"
              />
              <div className="fullscreen-zen-art-info">
                <span className="fullscreen-zen-art-title">
                  {currentTrack?.title || (playback.current_track?.startsWith('http') ? getStreamName(playback.current_track) : baseName(playback.current_track || ''))}
                </span>
                <span className="fullscreen-zen-art-artist">
                  {currentTrack?.artist || (playback.current_track?.startsWith('http') ? 'Online Stream' : '—')}
                </span>
              </div>
            </div>

            {/* Immersive Centered Lyrics */}
            <div className="fullscreen-lyrics-column">
              <div className={`fullscreen-lyrics-fade-wrap ${lyricsDisplayMode === 'static' ? 'plain-mode' : ''}`}>
                <div className="fullscreen-zen-lyrics-scroll" ref={scrollRef}>
                  <div className="fullscreen-lyric-spacer" />
                  {lyrics.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 20, padding: '100px 0' }}>
                      {lyricStatus === 'loading' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                          <Activity size={32} className="spin" style={{ color: accentColor }} />
                          <div>Loading Synced Lyrics...</div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                          <Music size={32} style={{ color: 'var(--text-dim)' }} />
                          <div>Instrumental or No Lyrics Available</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    lyrics.map((l, i) => (
                      <div
                        key={i}
                        data-idx={i}
                        className={`fullscreen-zen-lyric-line ${lyricsDisplayMode !== 'static' && i === activeIdx ? 'active' : ''}`}
                        style={{ cursor: lyricsDisplayMode !== 'static' ? 'pointer' : 'default' }}
                        onClick={() => {
                          if (lyricsDisplayMode !== 'static') {
                            seek(l.time_secs - lyricOffset / 1000);
                          }
                        }}
                      >
                        <div>
                          {lyricsDisplayMode === 'karaoke' && i === activeIdx && l.words && l.words.length > 0 ? (
                            l.words.map((word, wordIdx) => {
                              const nextWord = l.words![wordIdx + 1];
                              const duration = word.duration_secs && word.duration_secs > 0
                                ? word.duration_secs
                                : (nextWord && nextWord.time_secs > word.time_secs ? (nextWord.time_secs - word.time_secs) : 0.8);
                              const isStarted = currentTime >= word.time_secs;
                              const isFinished = (word.duration_secs && word.duration_secs > 0)
                                ? currentTime >= (word.time_secs + word.duration_secs)
                                : (nextWord ? currentTime >= nextWord.time_secs : currentTime >= (word.time_secs + duration));
                              
                              let progress = 0;
                              if (isFinished) {
                                progress = 100;
                              } else if (isStarted) {
                                progress = Math.min(100, Math.max(0, ((currentTime - word.time_secs) / duration) * 100));
                              }

                              return (
                                <span 
                                  key={wordIdx} 
                                  className="lyric-word"
                                  style={{ '--word-progress': `${progress}%` } as React.CSSProperties}
                                >
                                  {word.text}
                                </span>
                              );
                            })
                          ) : (
                            l.text || '♪'
                          )}
                        </div>
                        {showRomaji && l.romaji && l.romaji !== l.text && (
                          <div className="fullscreen-lyric-romaji">{l.romaji}</div>
                        )}
                        {showTranslation && l.translation && (
                          <div className="fullscreen-lyric-translation">{l.translation}</div>
                        )}
                      </div>
                    ))
                  )}
                  <div className="fullscreen-lyric-spacer" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sharp Glowing Neon Visualizer Baseline / Wave */}
      {vizMode !== 'circle' && (
        <div className="fullscreen-visualizer-container">
          <Visualizer mode={vizMode} />
        </div>
      )}

      {/* Floating Premium Playback HUD */}
      <div className="fullscreen-hud">
        {/* Progress Bar & Durations */}
        <div className="fullscreen-hud-progress-wrap">
          <span className="fullscreen-hud-time">{formatTime(playback.position_secs)}</span>
          <div style={{ flex: 1, position: 'relative', height: 24, display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 2, pointerEvents: 'none', padding: '0 2px' }}>
              {waveformPeaks.map((peak, idx) => {
                const barPct = (idx / waveformPeaks.length) * 100;
                const isPlayed = barPct <= progressPercent;
                return (
                  <div
                    key={idx}
                    style={{
                      flex: 1,
                      height: `${Math.max(25, peak * 100)}%`,
                      background: isPlayed ? accentColor : 'rgba(255, 255, 255, 0.22)',
                      borderRadius: 1,
                      transition: 'background 0.1s ease',
                    }}
                  />
                );
              })}
            </div>
            <input
              type="range"
              min={0}
              max={trackDuration || 100}
              value={playback.position_secs}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="fullscreen-hud-progress-bar"
              style={{
                width: '100%',
                opacity: 0,
                cursor: 'pointer',
                position: 'relative',
                zIndex: 2,
              }}
            />
          </div>
          <span className="fullscreen-hud-time">{formatTime(trackDuration)}</span>
        </div>

        {/* Buttons Controls */}
        <div className="fullscreen-hud-controls">
          {/* Metadata Display in control bar */}
          <div className="fullscreen-hud-left">
            {layout === 'zen' && (
              <div className="fullscreen-telemetry-badge">
                <span className="fullscreen-telemetry-dot" style={{ backgroundColor: accentColor }}></span>
                <span>{telemetryText}</span>
              </div>
            )}
          </div>

          {/* Central Playback buttons */}
          <div className="fullscreen-hud-center">
            <button className="fullscreen-hud-btn" onClick={playPrev} title="Previous Track">
              <SkipBack size={24} />
            </button>

            <button
              className="fullscreen-hud-btn fullscreen-hud-btn-play"
              onClick={handlePlayPause}
              title={playback.status === 'Playing' ? 'Pause' : 'Play'}
            >
              {playback.status === 'Playing' ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" style={{ marginLeft: 4 }} />}
            </button>

            <button className="fullscreen-hud-btn" onClick={playNext} title="Next Track">
              <SkipForward size={24} />
            </button>
          </div>

          {/* Right utility buttons */}
          <div className="fullscreen-hud-right">
            {/* Display Mode Toggle */}
            <button
              className={`fullscreen-hud-btn ${lyricsDisplayMode === 'karaoke' ? 'active' : ''}`}
              onClick={() => {
                const nextMode: LyricsDisplayMode =
                  lyricsDisplayMode === 'karaoke' ? 'line_sync' :
                  lyricsDisplayMode === 'line_sync' ? 'static' : 'karaoke';
                setLyricsDisplayMode(nextMode);
              }}
              title={`Display Mode: ${lyricsDisplayMode === 'karaoke' ? '🎤 Karaoke (Word-by-word wipe)' : lyricsDisplayMode === 'line_sync' ? '⏱️ Line Sync (Smooth highlight)' : '📄 Static Text (Plain reading)'} (Click to switch)`}
            >
              {lyricsDisplayMode === 'karaoke' && <Mic size={18} />}
              {lyricsDisplayMode === 'line_sync' && <AlignLeft size={18} />}
              {lyricsDisplayMode === 'static' && <FileText size={18} />}
            </button>

            {/* Romaji Characters Toggle */}
            <button
              className={`fullscreen-hud-btn ${showRomaji ? 'active' : ''}`}
              onClick={handleRomajiToggle}
              disabled={isTranslating}
              title={isTranslating ? 'Translating...' : showRomaji ? 'Hide Romaji Characters' : 'Show Romaji Characters'}
            >
              <Type size={18} />
            </button>

            {/* Translation Action Toggle */}
            <button
              className={`fullscreen-hud-btn ${showTranslation ? 'active' : ''}`}
              onClick={handleTranslate}
              disabled={isTranslating}
              title={isTranslating ? 'Translating...' : showTranslation ? 'Hide Translation' : 'Translate Lyrics'}
            >
              <Languages size={18} />
            </button>

            {/* Visualizer Mode Toggle */}
            <button
              className="fullscreen-hud-btn"
              onClick={() => {
                const modes: ('baseline' | 'circle' | 'wave')[] = ['baseline', 'circle', 'wave'];
                const nextIdx = (modes.indexOf(vizMode) + 1) % modes.length;
                setVizMode(modes[nextIdx]);
              }}
              title={`Switch Visualizer Mode (Current: ${vizMode.toUpperCase()})`}
            >
              <Activity size={18} style={{ color: vizMode !== 'baseline' ? 'var(--accent)' : 'inherit' }} />
            </button>

            {/* Liquid Backdrop Toggle */}
            <button
              className={`fullscreen-hud-btn ${liquidBackgroundEnabled ? 'active' : ''}`}
              onClick={toggleLiquidBackground}
              title={liquidBackgroundEnabled ? 'Disable Dynamic Visualizer Aura' : 'Enable Dynamic Visualizer Aura'}
            >
              <Sparkles size={18} />
            </button>

            {/* Volume slider */}
            <div className="fullscreen-hud-volume-wrap">
              <button className="fullscreen-hud-btn" onClick={handleMuteToggle} title="Mute/Unmute">
                {isMuted || playback.volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isMuted ? 0 : playback.volume}
                onChange={(e) => {
                  const vol = parseFloat(e.target.value);
                  setVolume(vol);
                }}
                className="fullscreen-hud-volume-slider"
                style={{
                  background: `linear-gradient(to right, ${accentColor} ${(isMuted ? 0 : playback.volume) * 100}%, rgba(255, 255, 255, 0.15) ${(isMuted ? 0 : playback.volume) * 100}%)`
                }}
              />
            </div>

            {/* Native Fullscreen Toggle Button */}
            <button
              className="fullscreen-hud-btn"
              onClick={async () => {
                const appWindow = getCurrentWindow();
                const isFS = await appWindow.isFullscreen();
                await appWindow.setFullscreen(!isFS);
                setIsNativeFullscreen(!isFS);
              }}
              title="Toggle Native OS Fullscreen"
            >
              {isNativeFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
