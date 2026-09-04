import { motion } from 'framer-motion';
import { Activity, Music } from 'lucide-react';
import { TheaterLayoutProps } from './types';
import { Visualizer } from '../Visualizer';
import { KaraokeActiveLine } from '../KaraokeActiveLine';
import { baseName, getStreamName } from '../../utils';

export function StageLayout({
  currentTrack,
  effectiveCover,
  playbackCurrentTrack,
  lyrics,
  lyricStatus,
  lyricsDisplayMode,
  activeIdx,
  playbackPositionSecs,
  playbackStatus,
  lyricOffset,
  showRomaji,
  showTranslation,
  accentColor,
  telemetryText,
  albumArtFit,
  vizMode,
  seek,
  scrollRef,
}: TheaterLayoutProps) {
  return (
    <motion.div
      key="stage"
      className="fullscreen-content-stage"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.35 }}
    >
      {/* Left Column: Artwork and Meta */}
      <div className="fullscreen-stage-left">
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 440, height: 440 }}>
          {/* Subtle Ambient Glow Aura */}
          <div
            className="fullscreen-cover-glow-aura"
            style={{
              background: `radial-gradient(circle, ${accentColor || 'var(--dynamic-accent)'} 0%, rgba(var(--accent-rgb, 139, 92, 246), 0.25) 45%, transparent 70%)`
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
                style={{ backgroundImage: `url(${effectiveCover})` }}
              />
            )}
            <img
              src={effectiveCover}
              alt="Album Artwork"
              className={`fullscreen-cover-art ${albumArtFit === 'contain' ? 'contain-art' : ''}`}
            />
          </div>
        </div>

        <div className="fullscreen-track-meta">
          <h1 className="fullscreen-track-title">
            {currentTrack?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack || ''))}
          </h1>
          <p className="fullscreen-track-artist">
            {currentTrack?.artist || (playbackCurrentTrack?.startsWith('http') ? 'Online Stream' : '—')}
          </p>

          {/* Telemetry Badge */}
          <div className="fullscreen-telemetry-badge">
            <span className="fullscreen-telemetry-dot" style={{ backgroundColor: accentColor, boxShadow: `0 0 8px ${accentColor}` }} />
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
                      <KaraokeActiveLine
                        words={l.words}
                        positionSecs={playbackPositionSecs}
                        lyricOffset={lyricOffset}
                        isPlaying={playbackStatus === 'Playing'}
                      />
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
  );
}
