import { motion } from 'framer-motion';
import { Activity, Music } from 'lucide-react';
import { TheaterLayoutProps } from './types';
import { Visualizer } from '../Visualizer';
import { KaraokeActiveLine } from '../KaraokeActiveLine';
import { baseName, getStreamName } from '../../utils';

export function ZenLayout({
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
  vizMode,
  seek,
  scrollRef,
}: TheaterLayoutProps) {
  return (
    <motion.div
      key="zen"
      className="fullscreen-content-zen"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.35 }}
      style={{ position: 'relative' }}
    >
      {/* Centered Circle Visualizer in background for Zen mode */}
      {vizMode === 'circle' && (
        <div style={{ position: 'absolute', width: 600, height: 600, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 0, opacity: 0.12, pointerEvents: 'none' }}>
          <Visualizer mode="circle" />
        </div>
      )}

      {/* Floating artwork chip in top-left */}
      <div className="fullscreen-zen-floating-art">
        <img
          src={effectiveCover}
          alt="Album Cover"
          className="fullscreen-zen-art-thumb"
        />
        <div className="fullscreen-zen-art-info">
          <span className="fullscreen-zen-art-title">
            {currentTrack?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack || ''))}
          </span>
          <span className="fullscreen-zen-art-artist">
            {currentTrack?.artist || (playbackCurrentTrack?.startsWith('http') ? 'Online Stream' : '—')}
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
