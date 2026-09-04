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
  Activity,
  Languages,
  Type,
  Mic,
  AlignLeft,
  FileText,
  Loader2,
  ListMusic
} from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { LiquidBackground } from './LiquidBackground';
import { Visualizer } from './Visualizer';
import { generateWaveformPeaks } from '../utils/waveform';
import { LyricsDisplayMode, TheaterModeDesign } from '../store/types';
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
    playbackPositionSecs,
    playbackCurrentTrack,
    playbackStatus,
    playbackVolume,
    playbackBitPerfect,
    playbackDevRate,
    playbackIsBuffering,
    queue
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
    queue: s.queue,
  })));

  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState(false);
  const [isSignalPathOpen, setIsSignalPathOpen] = useState(false);

  const effectiveCover = coverArt || currentTrack?.cover_url || defaultCover;
  const trackDuration = currentTrack?.duration || 0;

  const [spectrumBands, setSpectrumBands] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    const unlistenPromise = listen<number[]>('audio-spectrum', event => {
      if (active) setSpectrumBands(event.payload);
    });
    return () => {
      active = false;
      unlistenPromise.then(fn => fn()).catch(() => {});
    };
  }, []);

  const [isNativeFullscreen, setIsNativeFullscreen] = useState(true);
  const [isHUDHidden, setIsHUDHidden] = useState(false);

  // Persistent Visualizer Mode Preference
  const [vizMode, setVizMode] = useState<'baseline' | 'circle' | 'wave'>(() => {
    return (localStorage.getItem('aideo-fullscreen-viz-mode') as 'baseline' | 'circle' | 'wave') || 'baseline';
  });

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
        onClick={() => {
          const order: TheaterModeDesign[] = ['stage', 'zen', 'studio', 'vinyl', 'poster', 'scope'];
          const next = order[(order.indexOf(theaterModeDesign) + 1) % order.length];
          setTheaterModeDesign(next);
        }}
        title={`Current: ${THEATER_NAMES[theaterModeDesign]} (Click to cycle persona)`}
      >
        <LayoutGrid size={16} />
        <span>{THEATER_NAMES[theaterModeDesign]}</span>
      </button>

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
      {vizMode !== 'circle' && (
        <div className="fullscreen-visualizer-container">
          <Visualizer mode={vizMode} />
        </div>
      )}

      {/* Floating Premium Playback HUD */}
      <div className="fullscreen-hud">
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
              value={playbackPositionSecs}
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
          {/* Metadata Display / Telemetry in control bar */}
          <div className="fullscreen-hud-left">
            <button
              className="fullscreen-telemetry-badge"
              onClick={() => setIsSignalPathOpen(true)}
              title="Inspect Audio Signal Path & Telemetry (I)"
              style={{
                cursor: 'pointer',
                background: isSignalPathOpen ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                border: isSignalPathOpen ? `1px solid ${accentColor}` : '1px solid rgba(255, 255, 255, 0.08)',
                transition: 'all 0.15s ease',
              }}
            >
              <span className="fullscreen-telemetry-dot" style={{ backgroundColor: accentColor }}></span>
              <span>{telemetryText}</span>
            </button>
          </div>

          {/* Central Playback buttons */}
          <div className="fullscreen-hud-center">
            <button className="fullscreen-hud-btn" onClick={playPrev} title="Previous Track">
              <SkipBack size={24} />
            </button>

            <button
              className="fullscreen-hud-btn fullscreen-hud-btn-play"
              onClick={handlePlayPause}
              title={playbackIsBuffering ? 'Buffering stream...' : playbackStatus === 'Playing' ? 'Pause' : 'Play'}
            >
              {playbackIsBuffering ? <Loader2 size={24} className="animate-spin" /> : playbackStatus === 'Playing' ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" style={{ marginLeft: 4 }} />}
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
                    top: 2,
                    right: 2,
                    minWidth: 14,
                    height: 14,
                    padding: '0 3px',
                    borderRadius: 7,
                    fontSize: 9,
                    fontWeight: 700,
                    backgroundColor: accentColor,
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1
                  }}
                >
                  {queue.length > 99 ? '99+' : queue.length}
                </span>
              )}
            </button>

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
