import { useEffect, useState, useRef, useMemo } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
  Languages,
  Type,
  Mic,
  AlignLeft,
  FileText,
  Loader2,
  ListMusic,
  Sliders,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Activity,
  Infinity as InfinityIcon
} from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { LiquidBackground } from './LiquidBackground';
import { Visualizer, VisualizerMode } from './Visualizer';

import { generateWaveformPeaks } from '../utils/waveform';
import { TheaterModeDesign, TheaterHudStyle, LyricsDisplayMode } from '../store/types';

import { TheaterLayoutSwitch } from './theater/TheaterLayoutSwitch';
import { TheaterQueueDrawer } from './theater/TheaterQueueDrawer';
import { TheaterSignalPathModal } from './theater/TheaterSignalPathModal';

const THEATER_NAMES: Record<TheaterModeDesign, string> = {
  stage: 'Stage View',
  zen: 'Zen View',
  studio: 'Studio Deck',
  vinyl: 'Turntable',
  poster: 'Poster View',
  scope: 'Pure Scope',
};

export const THEATER_HUD_NAMES: Record<TheaterHudStyle, string> = {
  capsule: 'Floating Capsule',
  master: 'Master Deck',
  minimal: 'Zen Minimal',
  analog: 'Vintage Analog',
};

export function FullscreenView() {
  const {
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
    albumArtFit,
    theaterModeDesign,
    setTheaterModeDesign,
    theaterHudStyle,
    setTheaterHudStyle,
    playbackPositionSecs,
    playbackCurrentTrack,
    playbackStatus,
    playbackVolume,
    playbackBitPerfect,
    playbackDevRate,
    playbackIsBuffering,
    queue,
    shuffle,
    toggleShuffle,
    repeat,
    toggleRepeat,
    autoplayEnabled,
    toggleAutoplay,
    toggleLoveTrack,
  } = useStore(useShallow(s => ({
    playbackPositionSecs: s.playback.position_secs,
    playbackCurrentTrack: s.playback.current_track,
    playbackStatus: s.playback.status,
    playbackIsBuffering: Boolean(s.playback.is_buffering),
    playbackVolume: s.playback.volume,
    playbackBitPerfect: s.playback.bit_perfect,
    playbackDevRate: s.playback.dev_rate,
    isMuted: s.isMuted,
    toggleMute: s.toggleMute,
    currentTrack: s.currentTrack,
    coverArt: s.coverArt,
    lyrics: s.lyrics,
    lyricOffset: s.lyricOffset,
    lyricStatus: s.lyricStatus,
    lyricsDisplayMode: s.lyricsDisplayMode,
    setLyricsDisplayMode: s.setLyricsDisplayMode,
    accentColor: s.accentColor,
    dsp: s.dsp,
    currentDevice: s.currentDevice,
    setView: s.setView,
    seek: s.seek,
    setVolume: s.setVolume,
    playNext: s.playNext,
    playPrev: s.playPrev,
    pauseTrack: s.pauseTrack,
    resumeTrack: s.resumeTrack,
    liquidBackgroundEnabled: s.liquidBackgroundEnabled,
    toggleLiquidBackground: s.toggleLiquidBackground,
    showRomaji: s.showRomaji,
    showTranslation: s.showTranslation,
    translateLyrics: s.translateLyrics,
    isTranslating: s.isTranslating,
    getRomaji: s.getRomaji,
    albumArtFit: s.albumArtFit,
    theaterModeDesign: s.theaterModeDesign,
    setTheaterModeDesign: s.setTheaterModeDesign,
    theaterHudStyle: s.theaterHudStyle,
    setTheaterHudStyle: s.setTheaterHudStyle,
    queue: s.queue,
    shuffle: s.shuffle,
    toggleShuffle: s.toggleShuffle,
    repeat: s.repeat,
    toggleRepeat: s.toggleRepeat,
    autoplayEnabled: s.autoplayEnabled,
    toggleAutoplay: s.toggleAutoplay,
    toggleLoveTrack: s.toggleLoveTrack,
  })));

  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState(false);
  const [isSignalPathOpen, setIsSignalPathOpen] = useState(false);

  const effectiveCover = coverArt || currentTrack?.cover_url || defaultCover;
  const trackDuration = currentTrack?.duration || 0;

  const [spectrumBands, setSpectrumBands] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    let lastUpdate = 0;
    const unlistenPromise = listen<number[]>('audio-spectrum', event => {
      const now = performance.now();
      // Throttle telemetry/meter state updates to ~15fps to eliminate React render thrashing
      if (active && now - lastUpdate >= 65) {
        lastUpdate = now;
        setSpectrumBands(event.payload);
      }
    });
    return () => {
      active = false;
      unlistenPromise.then(fn => fn()).catch(() => {});
    };
  }, []);

  const [isNativeFullscreen, setIsNativeFullscreen] = useState(true);
  const [isHUDHidden, setIsHUDHidden] = useState(false);

  // Persistent Visualizer Mode Preference
  const [vizMode, setVizMode] = useState<VisualizerMode>(() => {
    return (localStorage.getItem('aideo-fullscreen-viz-mode') as VisualizerMode) || 'baseline';
  });

  const hudRef = useRef<HTMLDivElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const activityTimer = useRef<number | null>(null);

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
        if (isSignalPathOpen) {
          setIsSignalPathOpen(false);
        } else if (isQueueDrawerOpen) {
          setIsQueueDrawerOpen(false);
        } else {
          setView('nowplaying');
        }
      } else if (key === 'i') {
        e.preventDefault();
        setIsSignalPathOpen(prev => !prev);
      } else if (key === 'q') {
        e.preventDefault();
        setIsQueueDrawerOpen(prev => !prev);
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
        const order: TheaterModeDesign[] = ['stage', 'zen', 'studio', 'vinyl', 'poster', 'scope'];
        const cur = useStore.getState().theaterModeDesign;
        const next = order[(order.indexOf(cur) + 1) % order.length];
        useStore.getState().setTheaterModeDesign(next);
        window.dispatchEvent(new CustomEvent('ui-toast', {
          detail: { message: `Theater Persona: ${THEATER_NAMES[next]}`, type: 'info' }
        }));
      } else if (key === 'h') {
        e.preventDefault();
        const hudOrder: TheaterHudStyle[] = ['capsule', 'master', 'minimal', 'analog'];
        const curHud = useStore.getState().theaterHudStyle;
        const nextHud = hudOrder[(hudOrder.indexOf(curHud) + 1) % hudOrder.length];
        useStore.getState().setTheaterHudStyle(nextHud);
        window.dispatchEvent(new CustomEvent('ui-toast', {
          detail: { message: `Theater HUD: ${THEATER_HUD_NAMES[nextHud]}`, type: 'info' }
        }));
      } else if (key === 'v') {
        e.preventDefault();
        const modes: ('baseline' | 'circle' | 'wave')[] = ['baseline', 'circle', 'wave'];
        setVizMode((prev: 'baseline' | 'circle' | 'wave') => {
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
      } else if (key === 's') {
        e.preventDefault();
        state.toggleShuffle();
      } else if (key === 'p') {
        e.preventDefault();
        state.toggleRepeat();
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
  }, [setView, isQueueDrawerOpen, isSignalPathOpen]);

  // Autohide HUD timer: 3.5 seconds of inactivity
  useEffect(() => {
    const resetTimer = () => {
      setIsHUDHidden(false);
      if (activityTimer.current) {
        clearTimeout(activityTimer.current);
      }
      if (!isQueueDrawerOpen && !isSignalPathOpen) {
        activityTimer.current = window.setTimeout(() => {
          setIsHUDHidden(true);
        }, 3500);
      }
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
        return `DSD · ${currentTrack.format.toUpperCase()}`;
      }
      if (playbackBitPerfect) {
        const rate = playbackDevRate > 0 ? `· ${playbackDevRate / 1000}kHz` : '';
        return `BIT-PERFECT ${currentDevice?.startsWith('[ASIO]') ? 'ASIO' : 'WASAPI'} ${rate}`;
      }
      if (dsp.upsample_rate > 0) {
        return `TRANSCODED · ${dsp.upsample_rate / 1000}kHz`;
      }
      const upperFmt = currentTrack.format.toUpperCase();
      return upperFmt === 'YOUTUBE DIRECT' ? 'WEB STREAM' : upperFmt;
    }
    return 'STANDARD AUDIO';
  }, [currentTrack, playbackBitPerfect, playbackDevRate, currentDevice, dsp.upsample_rate]);

  // Lyrics indexing & smooth scroll
  const activeIdx = useMemo(() => {
    if (!lyrics.length) return -1;
    const now = playbackPositionSecs + lyricOffset / 1000;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time_secs <= now) idx = i; else break;
    }
    return idx;
  }, [lyrics, playbackPositionSecs, lyricOffset]);

  useEffect(() => {
    if (lyricsDisplayMode === 'static' || !scrollRef.current || activeIdx === -1) return;
    const el = scrollRef.current.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    if (el) {
      const container = scrollRef.current;
      const targetTop = el.offsetTop - (container.clientHeight / 2) + (el.clientHeight / 2);
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }, [activeIdx, theaterModeDesign, lyricsDisplayMode]);

  // Play/Pause handler
  const handlePlayPause = () => {
    if (playbackStatus === 'Playing') {
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
  const progressPercent = trackDuration > 0 ? (playbackPositionSecs / trackDuration) * 100 : 0;

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
      {/* Immersive backdrop visualizer (disabled in pure focus scope mode for edge-to-edge pitch black) */}
      {theaterModeDesign !== 'scope' && <LiquidBackground />}

      {/* Floating Top Actions Bar */}
      <div className="fullscreen-top-bar">
        {/* Floating HUD Style Toggle */}
        <button
          className="fullscreen-layout-toggle fullscreen-hud-toggle"
          onClick={() => {
            const hudOrder: TheaterHudStyle[] = ['capsule', 'master', 'minimal', 'analog'];
            const nextHud = hudOrder[(hudOrder.indexOf(theaterHudStyle) + 1) % hudOrder.length];
            setTheaterHudStyle(nextHud);
            window.dispatchEvent(new CustomEvent('ui-toast', {
              detail: { message: `Theater HUD: ${THEATER_HUD_NAMES[nextHud]}`, type: 'info' }
            }));
          }}
          title={`HUD: ${THEATER_HUD_NAMES[theaterHudStyle]} (Click or press H to cycle style)`}
        >
          <Sliders size={16} />
          <span>{THEATER_HUD_NAMES[theaterHudStyle]}</span>
        </button>

        {/* Floating Layout Toggle */}
        <button
          className="fullscreen-layout-toggle"
          onClick={() => {
            const order: TheaterModeDesign[] = ['stage', 'zen', 'studio', 'vinyl', 'poster', 'scope'];
            const next = order[(order.indexOf(theaterModeDesign) + 1) % order.length];
            setTheaterModeDesign(next);
          }}
          title={`Current: ${THEATER_NAMES[theaterModeDesign]} (Click or press L to cycle persona)`}
        >
          <LayoutGrid size={16} />
          <span>{THEATER_NAMES[theaterModeDesign]}</span>
        </button>

        {/* Floating Exit Button */}
        <button
          className="fullscreen-exit-btn"
          onClick={() => setView('nowplaying')}
          title="Exit Fullscreen Mode"
        >
          <X size={20} />
        </button>
      </div>

      {/* Main Content Pane */}
      <TheaterLayoutSwitch
        design={theaterModeDesign}
        currentTrack={currentTrack}
        effectiveCover={effectiveCover}
        playbackCurrentTrack={playbackCurrentTrack}
        lyrics={lyrics}
        lyricStatus={lyricStatus}
        lyricsDisplayMode={lyricsDisplayMode}
        activeIdx={activeIdx}
        playbackPositionSecs={playbackPositionSecs}
        playbackStatus={playbackStatus}
        lyricOffset={lyricOffset}
        showRomaji={showRomaji}
        showTranslation={showTranslation}
        accentColor={accentColor}
        telemetryText={telemetryText}
        albumArtFit={albumArtFit}
        vizMode={vizMode}
        seek={seek}
        scrollRef={scrollRef}
        spectrumBands={spectrumBands}
        lowSpecMode={dsp.low_spec_mode}
      />

      {/* Sharp Glowing Neon Visualizer Baseline / Wave */}
      {vizMode !== 'circle' && theaterModeDesign !== 'scope' && (
        <div className="fullscreen-visualizer-container">
          <Visualizer mode={vizMode} />
        </div>
      )}

      {/* Floating Premium Playback HUD */}
      <div ref={hudRef} className={`fullscreen-hud hud-${theaterHudStyle}`}>
        {/* Master Deck Hardware Screws */}
        {theaterHudStyle === 'master' && (
          <>
            <div className="hud-master-screw top-left" aria-hidden="true" />
            <div className="hud-master-screw top-right" aria-hidden="true" />
            <div className="hud-master-screw bottom-left" aria-hidden="true" />
            <div className="hud-master-screw bottom-right" aria-hidden="true" />
          </>
        )}

        {/* Progress Bar & Durations */}
        <div className="fullscreen-hud-progress-wrap">
          <span className="fullscreen-hud-time">{formatTime(playbackPositionSecs)}</span>
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
                      height: `${Math.max(15, peak * 100)}%`,
                      backgroundColor: isPlayed ? accentColor : 'rgba(255, 255, 255, 0.15)',
                      borderRadius: 1,
                      transition: 'background-color 0.1s ease'
                    }}
                  />
                );
              })}
            </div>
            <input
              type="range"
              min={0}
              max={trackDuration || 100}
              step={0.1}
              value={playbackPositionSecs}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                seek(val);
              }}
              className="fullscreen-hud-progress-bar"
              style={{
                background: 'transparent',
                zIndex: 2,
                opacity: 0,
                position: 'relative'
              }}
            />
          </div>
          <span className="fullscreen-hud-time">{formatTime(trackDuration)}</span>
        </div>

        {/* HUD Controls Row */}
        <div className="fullscreen-hud-controls">
          {/* Left info snippet & telemetry button */}
          <div className="fullscreen-hud-left">
            <button
              className="fullscreen-telemetry-btn"
              onClick={() => setIsSignalPathOpen(true)}
              title="Inspect Audio Signal Path & Telemetry (I)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '6px 12px',
                borderRadius: 20,
                color: '#ffffff',
                fontSize: 12,
                cursor: 'pointer',
                maxWidth: 200,
                minWidth: 0,
                flexShrink: 1,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.borderColor = accentColor;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              }}
            >
              <span className="fullscreen-telemetry-dot" style={{ backgroundColor: accentColor, flexShrink: 0 }}></span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{telemetryText}</span>
            </button>

            {theaterHudStyle === 'master' && (
              <div className="hud-master-led-meter" title="Precision Output Level">
                <span className={`hud-meter-dot green ${playbackStatus === 'Playing' ? 'lit' : ''}`} />
                <span className={`hud-meter-dot green ${playbackStatus === 'Playing' ? 'lit' : ''}`} />
                <span className={`hud-meter-dot green ${playbackStatus === 'Playing' ? 'lit' : ''}`} />
                <span className={`hud-meter-dot yellow ${playbackStatus === 'Playing' && playbackVolume > 0.35 ? 'lit' : ''}`} />
                <span className={`hud-meter-dot yellow ${playbackStatus === 'Playing' && playbackVolume > 0.7 ? 'lit' : ''}`} />
                <span className={`hud-meter-dot red ${playbackStatus === 'Playing' && playbackVolume > 0.9 ? 'lit' : ''}`} />
              </div>
            )}

            {theaterHudStyle === 'analog' && (
              <div className="hud-analog-tube-badge" title="Analog Vacuum Stage Active">
                <span className="hud-analog-tube-glow" />
                <span className="hud-analog-badge-text">TUBE STAGE</span>
              </div>
            )}

            {currentTrack && (
              <button
                className={`fullscreen-hud-btn fullscreen-love-btn ${currentTrack.loved === 1 ? 'loved' : ''}`}
                onClick={() => toggleLoveTrack(currentTrack.path, currentTrack)}
                title={currentTrack.loved === 1 ? "Remove from Loved Tracks" : "Add to Loved Tracks"}
                aria-label={currentTrack.loved === 1 ? "Remove from Loved Tracks" : "Add to Loved Tracks"}
              >
                <Heart size={18} fill={currentTrack.loved === 1 ? '#ef4444' : 'transparent'} />
              </button>
            )}
          </div>

          {/* Central Playback buttons */}
          <div className="fullscreen-hud-center">
            <button
              className={`fullscreen-hud-btn fullscreen-hud-btn-sub ${shuffle ? 'active' : ''}`}
              onClick={toggleShuffle}
              title={`Shuffle: ${shuffle ? 'On' : 'Off'} (S)`}
              aria-label={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
            >
              <Shuffle size={18} />
            </button>

            <button className="fullscreen-hud-btn" onClick={playPrev} title="Previous Track" aria-label="Previous Track">
              <SkipBack size={22} fill="currentColor" />
            </button>

            <button
              className="fullscreen-hud-btn fullscreen-hud-btn-play"
              onClick={handlePlayPause}
              title={playbackIsBuffering ? 'Buffering stream...' : playbackStatus === 'Playing' ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={playbackIsBuffering ? 'Buffering stream' : playbackStatus === 'Playing' ? 'Pause' : 'Play'}
            >
              {playbackIsBuffering ? (
                <Loader2 size={24} className="animate-spin" />
              ) : playbackStatus === 'Playing' ? (
                <Pause size={24} fill="currentColor" />
              ) : (
                <Play size={24} fill="currentColor" style={{ marginLeft: 3 }} />
              )}
            </button>

            <button className="fullscreen-hud-btn" onClick={playNext} title="Next Track" aria-label="Next Track">
              <SkipForward size={22} fill="currentColor" />
            </button>

            <button
              className={`fullscreen-hud-btn fullscreen-hud-btn-sub ${repeat !== 'none' ? 'active' : ''}`}
              onClick={toggleRepeat}
              title={`Repeat: ${repeat === 'none' ? 'Off' : repeat === 'all' ? 'All' : 'One'} (P)`}
              aria-label={`Repeat: ${repeat === 'none' ? 'Off' : repeat === 'all' ? 'All' : 'One'}`}
            >
              {repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>

            <button
              className={`fullscreen-hud-btn fullscreen-hud-btn-sub ${autoplayEnabled ? 'active' : ''}`}
              onClick={toggleAutoplay}
              title={`Endless Radio Autoplay: ${autoplayEnabled ? 'On' : 'Off'}`}
              aria-label={`Endless Radio Autoplay: ${autoplayEnabled ? 'On' : 'Off'}`}
            >
              <InfinityIcon size={18} />
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
                {isMuted || playbackVolume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isMuted ? 0 : playbackVolume}
                onChange={(e) => {
                  const vol = parseFloat(e.target.value);
                  setVolume(vol);
                }}
                className="fullscreen-hud-volume-slider"
                style={{
                  background: `linear-gradient(to right, ${accentColor} ${(isMuted ? 0 : playbackVolume) * 100}%, rgba(255, 255, 255, 0.15) ${(isMuted ? 0 : playbackVolume) * 100}%)`
                }}
              />
            </div>

            {/* Up Next Queue Drawer Toggle */}
            <button
              className={`fullscreen-hud-btn ${isQueueDrawerOpen ? 'active' : ''}`}
              onClick={() => setIsQueueDrawerOpen(prev => !prev)}
              title="Up Next Queue (Q)"
              style={{ position: 'relative' }}
            >
              <ListMusic size={18} />
              {queue.length > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -6,
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    borderRadius: 8,
                    fontSize: 9,
                    fontWeight: 700,
                    backgroundColor: accentColor,
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                    border: '1.5px solid rgba(14, 14, 22, 0.9)',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.4)',
                    pointerEvents: 'none',
                    zIndex: 3,
                  }}
                >
                  {queue.length > 99 ? '99+' : queue.length}
                </span>
              )}
            </button>

            {/* Native OS Fullscreen Toggle */}
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
              {isNativeFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Up Next Queue Drawer */}
      <TheaterQueueDrawer
        isOpen={isQueueDrawerOpen}
        onClose={() => setIsQueueDrawerOpen(false)}
      />

      {/* Audio Signal Path & Telemetry Inspector */}
      <TheaterSignalPathModal
        isOpen={isSignalPathOpen}
        onClose={() => setIsSignalPathOpen(false)}
        spectrumBands={spectrumBands}
      />
    </div>
  );
}
