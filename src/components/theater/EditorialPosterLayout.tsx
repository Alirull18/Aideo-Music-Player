import { motion } from 'framer-motion';
import { FileText, Music } from 'lucide-react';
import { TheaterLayoutProps } from './types';
import { KaraokeActiveLine } from '../KaraokeActiveLine';
import { baseName, getStreamName } from '../../utils';

export function EditorialPosterLayout({
  currentTrack,
  effectiveCover,
  playbackCurrentTrack,
  lyrics,
  activeIdx,
  playbackPositionSecs,
  playbackStatus,
  lyricOffset,
  showRomaji,
  showTranslation,
  accentColor,
  telemetryText,
  seek,
  scrollRef,
  lyricsDisplayMode,
}: TheaterLayoutProps) {
  return (
    <motion.div
      key="poster"
      className="fullscreen-content-stage editorial-poster-container"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.35 }}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(340px, 480px) 1fr',
        gap: 64,
        alignItems: 'center',
        padding: '50px 8%',
        maxWidth: 1300,
        margin: '0 auto',
      }}
    >
      {/* Left Column: Swiss Broadsheet Artwork & Typography */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Editorial Eyebrow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
          <FileText size={13} style={{ color: accentColor }} />
          <span>EDITORIAL ARCHIVE · VOL. 26</span>
        </div>

        {/* Hero Title & Artist */}
        <div>
          <h1
            style={{
              fontSize: 'clamp(2.4rem, 4.2vw, 3.8rem)',
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: '-0.035em',
              color: '#ffffff',
              marginBottom: 10,
              textWrap: 'balance',
            }}
          >
            {currentTrack?.title || (playbackCurrentTrack?.startsWith('http') ? getStreamName(playbackCurrentTrack) : baseName(playbackCurrentTrack || ''))}
          </h1>
          <p
            style={{
              fontSize: '1.25rem',
              fontWeight: 500,
              color: 'var(--text-dim)',
              letterSpacing: '-0.01em',
            }}
          >
            {currentTrack?.artist || 'Unknown Artist'}
          </p>
        </div>

        {/* Clean Editorial Artwork Plate */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: 380,
            aspectRatio: '1',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 20px 45px rgba(0, 0, 0, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          <img
            src={effectiveCover}
            alt="Editorial Plate"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>

        {/* Liner Notes Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            padding: '14px 18px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: 6,
            border: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: 12,
          }}
        >
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>Album</div>
            <div style={{ fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentTrack?.album || 'Single Release'}
            </div>
          </div>
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>Signal Path</div>
            <div style={{ fontWeight: 600, color: accentColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {telemetryText || 'BIT-PERFECT DIRECT'}
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Synced Editorial Lyric Broadsheet */}
      <div className="fullscreen-lyrics-column" style={{ height: '70vh' }}>
        <div className="fullscreen-lyrics-fade-wrap">
          <div className="fullscreen-lyrics-scroll" ref={scrollRef}>
            <div className="fullscreen-lyric-spacer" />
            {lyrics.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 18, padding: '100px 0' }}>
                <Music size={32} style={{ color: 'var(--text-dim)', margin: '0 auto 12px' }} />
                <div>Instrumental or No Lyrics Available</div>
              </div>
            ) : (
              lyrics.map((l, i) => (
                <div
                  key={i}
                  data-idx={i}
                  className={`fullscreen-lyric-line ${lyricsDisplayMode !== 'static' && i === activeIdx ? 'active' : ''}`}
                  style={{
                    cursor: lyricsDisplayMode !== 'static' ? 'pointer' : 'default',
                    fontSize: '1.4rem',
                    lineHeight: 1.45,
                    fontFamily: 'inherit',
                  }}
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
