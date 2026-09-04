import { useEffect, useState, useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../store';
import type { Track } from '../store/types';
import { useShallow } from 'zustand/react/shallow';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { MessageSquare, Activity, Maximize2, Minimize2, Tv2, Heart, ThumbsDown, CheckCircle2, ListMusic, Sliders, Info, X } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { LyricsPanel } from './LyricsPanel';
import { Visualizer } from './Visualizer';
import { LiquidBackground } from './LiquidBackground';
import { TheaterQueueDrawer } from './theater/TheaterQueueDrawer';
import { TheaterSignalPathModal } from './theater/TheaterSignalPathModal';
import { baseName, getStreamName, isStreamTrack, isRadioStream } from '../utils';

function formatArtworkTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatArtworkRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return 'Unknown';
  return `${(rate / 1000).toFixed(1)} kHz`;
}

function formatArtworkChannels(channels: number | null | undefined): string {
  if (channels == null || !Number.isFinite(channels) || channels <= 0) return 'Unknown';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels} channels`;
}

function formatArtworkRatio(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function getArtworkSourceLabel(format: string | null | undefined, path: string, duration: number | null | undefined): string {
  const normalizedFormat = (format || '').toUpperCase();
  if (normalizedFormat.includes('TIDAL')) return 'Tidal lossless';
  if (normalizedFormat.includes('QOBUZ')) return 'Qobuz lossless';
  if (normalizedFormat === 'SUBSONIC') return 'Subsonic';
  if (normalizedFormat === 'JELLYFIN') return 'Jellyfin';
  if (isRadioStream({ path, format }, path, duration)) return 'Internet radio';
  if (isStreamTrack(path, format)) return 'Online stream';
  return 'Local library';
}

type ArtworkTrackMetadata = Track & {
  bitrate?: number | null;
  sample_rate?: number | null;
  channels?: number | null;
  year?: string | number | null;
  genre?: string | null;
  album_artist?: string | null;
};

export function NowPlayingView() {
  const {
    currentDevice, coverArt, dsp,
    liquidBackgroundEnabled, toggleLiquidBackground, currentTrack, autoplayEnabled,
    setView, toggleLoveTrack, toggleDislikeTrack,
    albumArtFit, cachedCloudHashes, setLibrarySearchQuery,
    desktopLyricsOpen, toggleDesktopLyrics, desktopLyricsLocked, toggleDesktopLyricsLocked,
    setMiniPlayerMode,
    playbackCurrentTrack,
    playbackBitPerfect,
    playbackDevRate,
    playbackPosition,
    playbackFileRate,
    playbackFileChannels,
    playbackFileFormat,
    playbackExclusive,
    playbackDriverType,
    queue
  } = useStore(useShallow(s => ({
    playbackCurrentTrack: s.playback.current_track,
    playbackBitPerfect: s.playback.bit_perfect,
    playbackDevRate: s.playback.dev_rate,
    playbackPosition: s.playback.position_secs,
    playbackFileRate: s.playback.file_rate,
    playbackFileChannels: s.playback.file_ch,
    playbackFileFormat: s.playback.file_format,
    playbackExclusive: s.playback.exclusive,
    playbackDriverType: s.playback.driver_type,
    currentDevice: s.currentDevice,
    coverArt: s.coverArt,
    dsp: s.dsp,
    liquidBackgroundEnabled: s.liquidBackgroundEnabled,
    toggleLiquidBackground: s.toggleLiquidBackground,
    currentTrack: s.currentTrack,
    autoplayEnabled: s.autoplayEnabled,
    setView: s.setView,
    toggleLoveTrack: s.toggleLoveTrack,
    toggleDislikeTrack: s.toggleDislikeTrack,
    albumArtFit: s.albumArtFit,
    cachedCloudHashes: s.cachedCloudHashes,
    setLibrarySearchQuery: s.setLibrarySearchQuery,
    desktopLyricsOpen: s.desktopLyricsOpen,
    toggleDesktopLyrics: s.toggleDesktopLyrics,
    desktopLyricsLocked: s.desktopLyricsLocked,
    toggleDesktopLyricsLocked: s.toggleDesktopLyricsLocked,
    setMiniPlayerMode: s.setMiniPlayerMode,
    queue: s.queue,
  })));
  const current = currentTrack;
  const effectiveCover = coverArt || current?.cover_url || null;
  const artworkMetadata = current as ArtworkTrackMetadata | null;
  const artworkPath = artworkMetadata?.path || playbackCurrentTrack || '';
  const artworkFormat = artworkMetadata?.format || playbackFileFormat || null;
  const artworkSource = getArtworkSourceLabel(artworkFormat, artworkPath, artworkMetadata?.duration);
  const artworkSourceDetail = artworkPath
    ? artworkSource === 'Local library' ? baseName(artworkPath) : getStreamName(artworkPath)
    : 'No source path';
  const artworkDisplayFormat = artworkFormat?.trim()
    ? artworkFormat.toUpperCase()
    : isStreamTrack(artworkPath, artworkFormat) ? 'STREAM' : 'PCM';
  const artworkSourceRate = playbackFileRate || artworkMetadata?.sample_rate || playbackDevRate || null;
  const artworkOutputRate = playbackDevRate || artworkSourceRate;
  const artworkChannels = playbackFileChannels || artworkMetadata?.channels || null;
  const artworkBitrate = artworkMetadata?.bitrate != null && Number.isFinite(artworkMetadata.bitrate)
    ? `${artworkMetadata.bitrate} kbps`
    : 'Lossless';
  const artworkTrackNumber = artworkMetadata?.track_number != null && Number(artworkMetadata.track_number) > 0
    ? Number(artworkMetadata.track_number)
    : null;
  const artworkDiscNumber = artworkMetadata?.disc_number != null && Number(artworkMetadata.disc_number) > 0
    ? Number(artworkMetadata.disc_number)
    : null;
  const artworkReleasePosition = artworkTrackNumber
    ? `${artworkDiscNumber ? `Disc ${artworkDiscNumber} · ` : ''}Track ${String(artworkTrackNumber).padStart(2, '0')}`
    : artworkDiscNumber ? `Disc ${artworkDiscNumber}` : 'Album track';
  const artworkAnalysis = [
    artworkMetadata?.bpm != null ? `${Math.round(artworkMetadata.bpm)} BPM` : null,
    formatArtworkRatio(artworkMetadata?.energy),
  ].filter((value): value is string => Boolean(value));
  const artworkDevice = currentDevice || playbackDriverType || 'WASAPI';
  const artworkRoute = `${artworkDevice} · ${playbackExclusive ? 'Exclusive' : 'Shared'}`;
  const artworkProcessing = playbackBitPerfect ? 'Bit-Perfect' : dsp.enabled ? 'DSP active' : 'Direct output';

  const isCurrentCached = useMemo(() => {
    if (!current || !isStreamTrack(current.path, current.format)) return false;
    if (current.path_hash && cachedCloudHashes.includes(current.path_hash)) return true;
    return false;
  }, [current, cachedCloudHashes]);
  const artworkAvailability = isStreamTrack(artworkPath, artworkFormat)
    ? (isCurrentCached ? 'Cached offline' : 'Live stream')
    : 'On disk';

  const [showLyrics, setShowLyrics] = useState(true);
  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState(false);
  const [isSignalPathOpen, setIsSignalPathOpen] = useState(false);
  const [showArtInfo, setShowArtInfo] = useState(false);
  const [spectrumBands, setSpectrumBands] = useState<number[]>([]);

  useEffect(() => {
    let active = true;
    let lastUpdate = 0;
    const unlistenPromise = listen<number[]>('audio-spectrum', event => {
      const now = performance.now();
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') return;

      if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setIsSignalPathOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleArtworkPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (showArtInfo || dsp.low_spec_mode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const pointerX = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
    const pointerY = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1));
    const style = e.currentTarget.style;

    style.setProperty('--np-art-tilt-x', `${(-pointerY * 7).toFixed(2)}deg`);
    style.setProperty('--np-art-tilt-y', `${(pointerX * 9).toFixed(2)}deg`);
    style.setProperty('--np-art-shift-x', `${(pointerX * 4).toFixed(2)}px`);
    style.setProperty('--np-art-shift-y', `${(pointerY * 4).toFixed(2)}px`);
    style.setProperty('--np-art-light-x', `${((pointerX + 1) * 50).toFixed(1)}%`);
    style.setProperty('--np-art-light-y', `${((pointerY + 1) * 50).toFixed(1)}%`);
  };

  const handleArtworkPointerLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
    const style = e.currentTarget.style;
    style.setProperty('--np-art-tilt-x', '0deg');
    style.setProperty('--np-art-tilt-y', '0deg');
    style.setProperty('--np-art-shift-x', '0px');
    style.setProperty('--np-art-shift-y', '0px');
    style.setProperty('--np-art-light-x', '50%');
    style.setProperty('--np-art-light-y', '50%');
  };

  if (!playbackCurrentTrack) {
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
    <div className="nowplaying" style={{ gridTemplateColumns: showLyrics ? '1fr 1fr' : '1fr' }}>
      {/* Dynamic Liquid Art Backdrop / Static Blurred Cover Art */}
      <LiquidBackground />
      {effectiveCover && (!liquidBackgroundEnabled || dsp.low_spec_mode) && (
        <div className="np-bg" style={{ backgroundImage: `url(${effectiveCover})` }} />
      )}

      {/* Art + Meta — fixed left column */}
      <div className="np-left" style={{ position: 'relative' }}>
        {/* Sleek Floating Circle Buttons Group */}
        <div style={{
          position: 'absolute',
          top: 24,
          left: 24,
          display: 'flex',
          gap: 10,
          zIndex: 100
        }}>
          {/* Lyrics Toggle Button */}
          <button
            onClick={() => setShowLyrics(!showLyrics)}
            title={showLyrics ? "Hide Lyrics" : "Show Lyrics"}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: showLyrics ? '1px solid rgba(var(--accent-rgb), 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: showLyrics ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: showLyrics ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              boxShadow: showLyrics ? '0 0 10px rgba(var(--accent-rgb), 0.25)' : 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              if (!showLyrics) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!showLyrics) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.color = 'var(--text-dim)';
              }
            }}
          >
            <MessageSquare size={16} />
          </button>

          {/* Background Visualizer Toggle Button */}
          <button
            onClick={() => toggleLiquidBackground()}
            title={liquidBackgroundEnabled ? "Turn Off Background Visualizer" : "Turn On Background Visualizer"}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: liquidBackgroundEnabled ? '1px solid rgba(var(--accent-rgb), 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: liquidBackgroundEnabled ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: liquidBackgroundEnabled ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              boxShadow: liquidBackgroundEnabled ? '0 0 10px rgba(var(--accent-rgb), 0.25)' : 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              if (!liquidBackgroundEnabled) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!liquidBackgroundEnabled) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.color = 'var(--text-dim)';
              }
            }}
          >
            <Activity size={16} />
          </button>

          {/* Floating Transparent Desktop Lyric Bar Toggle Button */}
          <button
            onClick={() => toggleDesktopLyrics()}
            onContextMenu={(e) => {
              e.preventDefault();
              toggleDesktopLyricsLocked();
            }}
            title={desktopLyricsOpen ? (desktopLyricsLocked ? "Desktop Lyrics: Locked (Right-click to Unlock)" : "Desktop Lyrics: Open (Right-click to Lock)") : "Open Floating Desktop Lyric Bar"}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: desktopLyricsOpen ? '1px solid rgba(var(--accent-rgb), 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: desktopLyricsOpen ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: desktopLyricsOpen ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              boxShadow: desktopLyricsOpen ? '0 0 10px rgba(var(--accent-rgb), 0.25)' : 'none',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              if (!desktopLyricsOpen) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!desktopLyricsOpen) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.color = 'var(--text-dim)';
              }
            }}
          >
            <Tv2 size={16} />
            {desktopLyricsOpen && desktopLyricsLocked && (
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: '#10b981',
                  boxShadow: '0 0 6px #10b981',
                }}
              />
            )}
          </button>

          {/* Mini Player Toggle Button */}
          <button
            onClick={() => setMiniPlayerMode(true)}
            title="Switch to Mini Player Mode"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(255, 255, 255, 0.03)',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
              e.currentTarget.style.color = 'var(--text-dim)';
            }}
          >
            <Minimize2 size={16} />
          </button>

          {/* Up Next Queue Drawer Toggle Button */}
          <button
            onClick={() => setIsQueueDrawerOpen(!isQueueDrawerOpen)}
            title="Open Up Next Queue"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: isQueueDrawerOpen ? '1px solid rgba(var(--accent-rgb), 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: isQueueDrawerOpen ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: isQueueDrawerOpen ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              boxShadow: isQueueDrawerOpen ? '0 0 10px rgba(var(--accent-rgb), 0.25)' : 'none',
              position: 'relative'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              if (!isQueueDrawerOpen) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!isQueueDrawerOpen) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.color = 'var(--text-dim)';
              }
            }}
          >
            <ListMusic size={16} />
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
                  backgroundColor: 'var(--accent)',
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

          {/* Audio Signal Path & Telemetry Inspector Button */}
          <button
            onClick={() => setIsSignalPathOpen(!isSignalPathOpen)}
            title="Inspect Audio Signal Path & Telemetry"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: isSignalPathOpen ? '1px solid rgba(var(--accent-rgb), 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: isSignalPathOpen ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.03)',
              color: isSignalPathOpen ? 'var(--accent)' : 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              boxShadow: isSignalPathOpen ? '0 0 10px rgba(var(--accent-rgb), 0.25)' : 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              if (!isSignalPathOpen) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              if (!isSignalPathOpen) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.color = 'var(--text-dim)';
              }
            }}
          >
            <Sliders size={16} />
          </button>

          {/* Theater Fullscreen Toggle Button */}
          <button
            onClick={() => setView('fullscreen')}
            title="Enter Theater Fullscreen"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(255, 255, 255, 0.03)',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.08)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)';
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
              e.currentTarget.style.color = 'var(--text-dim)';
            }}
          >
            <Maximize2 size={16} />
          </button>
        </div>

        <div
          className={`np-art-wrap${effectiveCover ? ' has-art' : ''} ${albumArtFit === 'contain' ? 'contain-mode' : ''} np-art-interactive${showArtInfo ? ' np-art-info-open' : ''}${dsp.low_spec_mode ? ' np-art-motion-disabled' : ''}`}
          onClick={() => setShowArtInfo(prev => !prev)}
          title={showArtInfo ? "Click to show artwork" : "Move pointer to explore · click for track details"}
          role="button"
          aria-label={showArtInfo ? 'Hide artwork details' : 'Show artwork details'}
          aria-pressed={showArtInfo}
          tabIndex={0}
          onPointerMove={handleArtworkPointerMove}
          onPointerLeave={handleArtworkPointerLeave}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowArtInfo(prev => !prev);
            }
          }}
        >
          {albumArtFit === 'contain' && (
            <div
              className="np-art-ambient-bg"
              style={{ backgroundImage: `url(${effectiveCover || defaultCover})` }}
            />
          )}
          <img
            src={effectiveCover || defaultCover}
            alt="cover"
            className={`np-art ${albumArtFit === 'contain' ? 'contain-art' : ''}`}
          />

          {/* Floating Info Button on Artwork */}
          <button
            className={`np-art-info-btn ${showArtInfo ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowArtInfo(prev => !prev);
            }}
            title={showArtInfo ? "Show Album Artwork" : "Show Audio Specs & Track Info"}
            aria-label="Toggle Artwork Track Info"
          >
            {showArtInfo ? <X size={15} /> : <Info size={15} />}
          </button>

          {/* Interactive Liner Notes / Audio Specs Overlay */}
          {showArtInfo && (
            <div
              className="np-art-overlay"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="np-art-overlay-header">
                <div className="np-art-overlay-heading">
                  <div className="np-art-overlay-badge">
                    <span className="np-art-dot" />
                    <span>AUDIO SPECS</span>
                  </div>
                  <span className="np-art-source-pill">{artworkSource}</span>
                </div>
                <button
                  className="np-art-overlay-close"
                  onClick={() => setShowArtInfo(false)}
                  title="Close Specs"
                  aria-label="Close Specs"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="np-art-overlay-body">
                <div className="np-art-overlay-title-group">
                  <h3 className="np-art-overlay-title">
                    {current?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack))}
                  </h3>
                  <p className="np-art-overlay-artist">{current?.artist || 'Unknown Artist'}</p>
                  {current?.album && <p className="np-art-overlay-album">{current.album}</p>}
                </div>

                <div className="np-art-progress-row">
                  <span>Track progress</span>
                  <strong>{formatArtworkTime(playbackPosition)} / {formatArtworkTime(artworkMetadata?.duration)}</strong>
                </div>

                <section className="np-art-detail-section" aria-label="Track details">
                  <div className="np-art-detail-heading">
                    <span>Track details</span>
                    <strong>{artworkReleasePosition}</strong>
                  </div>
                  <div className="np-art-detail-list">
                    <div className="np-art-detail-row">
                      <span>Source</span>
                      <strong title={artworkSource}>{artworkSource}</strong>
                    </div>
                    <div className="np-art-detail-row">
                      <span>File</span>
                      <strong title={artworkSourceDetail}>{artworkSourceDetail}</strong>
                    </div>
                    <div className="np-art-detail-row">
                      <span>Availability</span>
                      <strong>{artworkAvailability}</strong>
                    </div>
                  </div>
                </section>

                <section className="np-art-detail-section" aria-label="Audio details">
                  <div className="np-art-detail-heading">
                    <span>Audio</span>
                    <strong className={playbackBitPerfect ? 'is-good' : ''}>{artworkProcessing}</strong>
                  </div>
                  <div className="np-art-detail-list">
                    <div className="np-art-detail-row">
                      <span>Format</span>
                      <strong>{artworkDisplayFormat}</strong>
                    </div>
                    <div className="np-art-detail-row">
                      <span>Source rate</span>
                      <strong>{formatArtworkRate(artworkSourceRate)}</strong>
                    </div>
                    <div className="np-art-detail-row">
                      <span>Output</span>
                      <strong>{formatArtworkRate(artworkOutputRate)} · {formatArtworkChannels(artworkChannels)}</strong>
                    </div>
                    <div className="np-art-detail-row">
                      <span>Route</span>
                      <strong title={artworkRoute}>{artworkRoute}</strong>
                    </div>
                    <div className="np-art-detail-row">
                      <span>Bitrate</span>
                      <strong>{artworkBitrate}</strong>
                    </div>
                  </div>
                </section>

                {artworkAnalysis.length > 0 && (
                  <section className="np-art-detail-section" aria-label="Track analysis">
                    <div className="np-art-detail-heading">
                      <span>Analysis</span>
                      <div className="np-art-analysis-values">
                        {artworkAnalysis.map(value => <strong key={value}>{value}</strong>)}
                      </div>
                    </div>
                    {(artworkMetadata?.bass_ratio != null || artworkMetadata?.treble_ratio != null) && (
                      <div className="np-art-detail-list">
                        {artworkMetadata?.bass_ratio != null && (
                          <div className="np-art-detail-row">
                            <span>Bass profile</span>
                            <strong>{formatArtworkRatio(artworkMetadata.bass_ratio)}</strong>
                          </div>
                        )}
                        {artworkMetadata?.treble_ratio != null && (
                          <div className="np-art-detail-row">
                            <span>Treble profile</span>
                            <strong>{formatArtworkRatio(artworkMetadata.treble_ratio)}</strong>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}
              </div>

              <div className="np-art-overlay-footer">
                <button
                  className="np-art-signal-btn"
                  onClick={() => setIsSignalPathOpen(true)}
                  title="Inspect Full Signal Path (I)"
                >
                  <Activity size={13} />
                  <span>Signal Path & Telemetry</span>
                </button>
              </div>
            </div>
          )}
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
              {current?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack))}
            </span>
            {current && !isRadioStream(current) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLoveTrack(current.path);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: current.loved === 1 ? '#ef4444' : 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: 4,
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
                    if (current.loved !== 1) e.currentTarget.style.color = 'var(--text-dim)';
                  }}
                  title={current.loved === 1 ? "Remove from Loved Streams" : "Add to Loved Streams"}
                >
                  <Heart size={18} fill={current.loved === 1 ? '#ef4444' : 'transparent'} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDislikeTrack(current.path, current);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: current.disliked === 1 ? '#f43f5e' : 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: 4,
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
                    if (current.disliked !== 1) e.currentTarget.style.color = 'var(--text-dim)';
                  }}
                  title={current.disliked === 1 ? "Undislike track" : "Dislike track"}
                >
                  <ThumbsDown size={18} fill={current.disliked === 1 ? '#f43f5e' : 'transparent'} />
                </button>
              </div>
            )}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            flexWrap: 'wrap',
            width: '100%',
            marginTop: 6
          }}>
            {current?.format && (
              <span
                className={`quality-tag ${
                  current.format.toLowerCase().includes('flac') || current.format.toLowerCase().includes('wav') ? 'high-res' : ''
                } ${
                  current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd') ? 'dsd-gold' : ''
                } ${
                  current.format.toLowerCase().includes('dolby') || current.format.toLowerCase().includes('atmos') ? 'dolby-atmos' : ''
                }`}
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  padding: '3px 8px',
                  background: current.format.toLowerCase().includes('tidal')
                    ? 'linear-gradient(135deg, #06b6d4, #0891b2)'
                    : (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? 'linear-gradient(135deg, #FFE082, #FFB300, #FF8F00)'
                    : undefined,
                  boxShadow: current.format.toLowerCase().includes('tidal')
                    ? '0 0 10px rgba(6, 182, 212, 0.4)'
                    : (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? '0 0 14px rgba(255, 179, 0, 0.45)'
                    : undefined,
                  border: current.format.toLowerCase().includes('tidal')
                    ? '1px solid rgba(6, 182, 212, 0.3)'
                    : (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
                    ? '1px solid rgba(255, 224, 130, 0.4)'
                    : undefined,
                  color: current.format.toLowerCase().includes('tidal')
                    ? 'white'
                    : (current.format.toLowerCase().includes('dsf') || current.format.toLowerCase().includes('dff') || current.format.toLowerCase().includes('dsd'))
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
            {isCurrentCached && (
              <span
                className="offline-cached-badge"
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 12,
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4
                }}
                title="This track is fully cached locally on your device and will play without internet connection."
              >
                <CheckCircle2 size={10} /> OFFLINE CACHED
              </span>
            )}
            {isRadioStream(current, playbackCurrentTrack, current?.duration) && (
              <span className="live-badge" style={{ flexShrink: 0 }}>LIVE</span>
            )}
            {playbackBitPerfect && (
              <span
                className="bit-badge"
                onClick={() => setIsSignalPathOpen(true)}
                style={{
                  flexShrink: 0,
                  background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                  boxShadow: '0 0 12px rgba(6, 182, 212, 0.4)',
                  cursor: 'pointer'
                }}
                title="Inspect Audio Signal Path & Telemetry"
              >
                {currentDevice?.startsWith('[ASIO]') ? 'ASIO BIT-PERFECT' : 'BIT-PERFECT'} {playbackDevRate > 0 ? `· ${playbackDevRate / 1000}kHz` : ''} 🎛️
              </span>
            )}
            {dsp.upsample_rate > 0 && !playbackBitPerfect && (
              <span
                className="bit-badge"
                onClick={() => setIsSignalPathOpen(true)}
                style={{
                  flexShrink: 0,
                  background: 'linear-gradient(135deg, #a855f7, #6366f1)',
                  boxShadow: '0 0 12px rgba(168, 85, 247, 0.4)',
                  cursor: 'pointer'
                }}
                title="Inspect Audio Signal Path & Telemetry"
              >
                HI-RES · {dsp.upsample_rate / 1000}kHz 🎛️
              </span>
            )}
            {!playbackBitPerfect && dsp.upsample_rate <= 0 && (
              <span
                className="bit-badge"
                onClick={() => setIsSignalPathOpen(true)}
                style={{
                  flexShrink: 0,
                  background: 'linear-gradient(135deg, #374151, #4b5563)',
                  boxShadow: '0 0 8px rgba(0,0,0,0.2)',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: '3px 8px',
                  borderRadius: '4px',
                  color: '#9ca3af',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}
                title="View Audio Signal Path"
              >
                SIGNAL PATH 🎛️
              </span>
            )}
            {autoplayEnabled && (current?.path.startsWith('http') || current?.format === 'Tidal FLAC' || current?.format === 'Qobuz FLAC') && (
              <span
                className="quality-tag autoplay-active"
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  padding: '3px 8px',
                  fontWeight: 800,
                  letterSpacing: 0.5
                }}
              >
                ∞ AUTOPLAY
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
            onClick={() => {
              if (!playbackCurrentTrack) return;
              const isWebStream = playbackCurrentTrack.startsWith('http://') || playbackCurrentTrack.startsWith('https://');
              if (isWebStream) {
                openUrl(playbackCurrentTrack);
              } else if (current?.artist) {
                setLibrarySearchQuery(current.artist);
                setView('library');
              }
            }}>
            {current?.artist || (playbackCurrentTrack?.startsWith('http') ? 'Online Stream' : '—')}
          </div>
        </div>
        <div style={{ height: 60, width: '100%', flexShrink: 0, marginTop: 8 }}>
          <Visualizer />
        </div>
      </div>

      {/* Lyrics — Right column */}
      {showLyrics && <LyricsPanel />}

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
