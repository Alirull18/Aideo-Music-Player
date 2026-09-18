import { useState, useMemo, useRef, memo } from 'react';
import { Play, ChevronLeft, ChevronRight, RefreshCw, Disc3 } from 'lucide-react';
import { useStore } from '../../store';
import {
  AideoHomeProps,
  AideoSearchBar,
  TrackCover,
  tracksForShelf,
  getLosslessTracks,
  ShelfId,
  SongSources,
} from './HomeParts';

type HorizonFilter = 'all' | 'music' | 'lossless' | 'recent';

interface ShelfScrollControlsProps {
  onScrollLeft: () => void;
  onScrollRight: () => void;
}

const ShelfScrollControls = ({ onScrollLeft, onScrollRight }: ShelfScrollControlsProps) => (
  <div className="sp-shelf-arrows" aria-label="Shelf navigation">
    <button
      type="button"
      className="sp-arrow-btn"
      onClick={onScrollLeft}
      aria-label="Scroll shelf left"
      title="Scroll left"
    >
      <ChevronLeft size={16} />
    </button>
    <button
      type="button"
      className="sp-arrow-btn"
      onClick={onScrollRight}
      aria-label="Scroll shelf right"
      title="Scroll right"
    >
      <ChevronRight size={16} />
    </button>
  </div>
);

// Green floating circular play button
const HorizonPlayButton = memo(({ onClick, size = 44 }: { onClick: () => void; size?: number }) => (
  <button
    type="button"
    className="sp-play-badge"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    aria-label="Play track"
    style={{ width: size, height: size }}
  >
    <Play size={Math.round(size * 0.44)} fill="#000000" color="#000000" />
  </button>
));

// Quick-Launch 6-Pack Card
const HorizonQuickCard = memo(({ track, onPlay }: { track: any; onPlay: (t: any) => void }) => (
  <div
    className="sp-quick-card"
    onClick={() => onPlay(track)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay(track); }}
    aria-label={`Quick play ${track.title} by ${track.artist || 'Unknown'}`}
  >
    <div className="sp-quick-art">
      <TrackCover
        src={track.cover_url}
        path={track.path || track.url}
        title={track.title}
        artist={track.artist}
        size={56}
        radius={4}
      />
    </div>
    <div className="sp-quick-info">
      <div className="sp-quick-title" title={track.title}>{track.title}</div>
      <div className="sp-quick-sub">{track.artist || 'Unknown Artist'}</div>
    </div>
    <div className="sp-quick-play-wrap">
      <HorizonPlayButton onClick={() => onPlay(track)} size={40} />
    </div>
  </div>
));

// Square Card for Horizontal Carousel Shelves
const HorizonShelfCard = memo(({ track, onPlay }: { track: any; onPlay: (t: any) => void }) => (
  <div
    className="sp-card"
    onClick={() => onPlay(track)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay(track); }}
    aria-label={`Play ${track.title} by ${track.artist || 'Unknown'}`}
  >
    <div className="sp-card-art-box">
      <TrackCover
        src={track.cover_url}
        path={track.path || track.url}
        title={track.title}
        artist={track.artist}
        size={160}
        radius={6}
      />
      <div className="sp-card-play-hover">
        <HorizonPlayButton onClick={() => onPlay(track)} size={44} />
      </div>
    </div>
    <div className="sp-card-title" title={track.title}>{track.title}</div>
    <div className="sp-card-artist" title={track.artist}>{track.artist || 'Unknown Artist'}</div>
    <div className="sp-card-source">
      <SongSources track={track} />
    </div>
  </div>
));

export function HorizonHome({
  greeting,
  trackCount,
  totalPlays,
  discoveryData,
  isLoadingRecs,
  isRefreshingRecs,
  onRefreshRecs,
  onPlayTrack,
  resume,
  search,
  layoutFilter,
}: AideoHomeProps) {
  const [filter, setFilter] = useState<HorizonFilter>('all');

  // Horizontal scroll container refs
  const shelfRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const scrollShelf = (shelfId: string, direction: 'left' | 'right') => {
    const el = shelfRefs.current[shelfId];
    if (!el) return;
    const scrollAmount = direction === 'left' ? -560 : 560;
    el.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  };

  // Top 6 Quick Launch items (Hybrid Smart Mix: 3 recent + 3 heavy rotation / gems)
  const quickTracks = useMemo(() => {
    const recents = tracksForShelf(discoveryData, 'recent').slice(0, 3);
    const rotations = tracksForShelf(discoveryData, 'rotation').slice(0, 3);
    const gems = tracksForShelf(discoveryData, 'gems').slice(0, 3);
    const recs = tracksForShelf(discoveryData, 'recs').slice(0, 3);

    const candidates = [...recents, ...rotations, ...gems, ...recs];
    const seen = new Set<string>();
    const out: any[] = [];
    for (const t of candidates) {
      const key = `${t.title || ''}::${t.artist || ''}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
      if (out.length >= 6) break;
    }
    return out;
  }, [discoveryData]);

  const localTracks = useStore((s) => s.tracks);

  // Compile Hi-Res lossless tracks from Tidal stream pool, discovery feed, and local library files
  const losslessTracks = useMemo(
    () => getLosslessTracks(discoveryData, localTracks),
    [discoveryData, localTracks]
  );

  // Extract shelf tracks
  const shelvesConfig: Array<{ id: ShelfId; title: string; desc: string }> = [
    { id: 'recs', title: 'Made For You', desc: 'Curated directly from your taste profile and favorites' },
    { id: 'recent', title: 'Jump Back In', desc: 'Pick up right where you left off' },
    { id: 'rotation', title: 'Heavy Rotation', desc: 'Your most played tracks this month' },
    { id: 'gems', title: 'Forgotten Gems', desc: 'Beloved tracks waiting to be revisited' },
    { id: 'tidal', title: 'Lossless Hi-Fi', desc: 'Pure studio master and CD quality lossless streams' },
    { id: 'charts', title: 'Trending Global', desc: 'Top charting tracks right now' },
  ];

  // Filter shelves according to filter pill
  const activeShelves = useMemo(() => {
    if (filter === 'recent') {
      return shelvesConfig.filter((s) => s.id === 'recent' || s.id === 'rotation');
    }
    if (filter === 'lossless') {
      return [{ id: 'tidal' as ShelfId, title: 'Hi-Res Lossless', desc: 'Bit-perfect studio master streams and local lossless FLAC/ALAC library tracks' }];
    }
    if (filter === 'music') {
      return shelvesConfig.filter((s) => s.id !== 'charts');
    }
    return shelvesConfig;
  }, [filter, shelvesConfig]);

  return (
    <div className="ah-root ah-spotify ah-horizon">
      {/* ── AMBIENT GRADIENT OVERLAY ── */}
      <div className="sp-ambient-glow" aria-hidden="true" />

      {/* ── TOP NAV & SEARCH ── */}
      <div className="sp-top-bar">
        <div className="sp-search-box">
          <AideoSearchBar variant="pill" props={search} />
        </div>
        <div className="sp-top-actions">
          {layoutFilter}
          <button
            type="button"
            className="sp-refresh-btn"
            onClick={onRefreshRecs}
            disabled={isRefreshingRecs || isLoadingRecs}
            aria-label="Refresh curated recommendations"
            title="Refresh recommendations"
          >
            <RefreshCw size={14} className={isRefreshingRecs || isLoadingRecs ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── RESUME PROMPT PILL ── */}
      {resume && (
        <div className="sp-resume-banner">
          <div className="sp-resume-art">
            <TrackCover
              src={resume.coverUrl}
              path={resume.coverPath}
              title={resume.title}
              artist={resume.artist}
              size={48}
              radius={4}
            />
          </div>
          <div className="sp-resume-text">
            <span className="sp-resume-kicker">RESUME PLAYBACK · {resume.positionLabel}</span>
            <span className="sp-resume-title">{resume.title}</span>
            <span className="sp-resume-artist">{resume.artist}</span>
          </div>
          <button
            type="button"
            className="sp-resume-play-btn"
            onClick={resume.onResume}
            aria-label="Resume playback"
          >
            <Play size={14} fill="#000000" color="#000000" />
            <span>Resume</span>
          </button>
          <button
            type="button"
            className="sp-resume-dismiss"
            onClick={resume.onDismiss}
            aria-label="Dismiss resume prompt"
          >
            ×
          </button>
        </div>
      )}

      {/* ── GREETING & FILTER PILLS ── */}
      <div className="sp-header-row">
        <div className="sp-greeting-wrap">
          <h1 className="sp-greeting-text">{greeting}</h1>
          <div className="sp-library-stats">
            <span>{trackCount.toLocaleString()} tracks in library</span>
            <span className="sp-stat-dot">•</span>
            <span>{totalPlays.toLocaleString()} total plays</span>
          </div>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="sp-filter-pills" role="tablist" aria-label="Music categories">
        {(
          [
            { id: 'all', label: 'All' },
            { id: 'music', label: 'Music' },
            { id: 'lossless', label: 'Hi-Res Lossless' },
            { id: 'recent', label: 'Recently Played' },
          ] as const
        ).map((pill) => (
          <button
            key={pill.id}
            type="button"
            role="tab"
            aria-selected={filter === pill.id}
            className={`sp-pill ${filter === pill.id ? 'active' : ''}`}
            onClick={() => setFilter(pill.id)}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* ── TOP 6 QUICK-LAUNCH GRID ── */}
      {quickTracks.length > 0 && (
        <section className="sp-quick-section" aria-label="Quick launch favorites">
          <div className="sp-quick-grid">
            {quickTracks.map((track) => (
              <HorizonQuickCard
                key={`quick-${track.id || track.url || track.title}`}
                track={track}
                onPlay={onPlayTrack}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── HORIZONTAL SHELVES ── */}
      <div className="sp-shelves-container">
        {filter === 'lossless' && losslessTracks.length === 0 && (
          <div className="ah-empty-lossless-state sp-empty-lossless" role="status" aria-label="No lossless audio available">
            <div className="ah-empty-lossless-icon">
              <Disc3 size={28} />
            </div>
            <div className="ah-empty-lossless-content">
              <h3 className="ah-empty-lossless-title">No Hi-Res Lossless Audio Found</h3>
              <p className="ah-empty-lossless-desc">
                No lossless tracks were found in your active rotation or local library. Connect your Tidal account in Settings &gt; Library or import local FLAC, WAV, or ALAC files to enable bit-perfect studio streaming.
              </p>
            </div>
          </div>
        )}

        {isLoadingRecs ? (
          <div className="sp-loading-box">
            <RefreshCw size={18} className="spin" />
            <span>Curating your personalized shelves…</span>
          </div>
        ) : (
          activeShelves.map((shelf) => {
            const tracks = shelf.id === 'tidal' ? losslessTracks : tracksForShelf(discoveryData, shelf.id);
            if (!tracks || tracks.length === 0) return null;

            return (
              <section key={shelf.id} className="sp-shelf-section" aria-labelledby={`sp-shelf-head-${shelf.id}`}>
                <div className="sp-shelf-header">
                  <div className="sp-shelf-title-wrap">
                    <h2 id={`sp-shelf-head-${shelf.id}`} className="sp-shelf-title">{shelf.title}</h2>
                    <p className="sp-shelf-desc">{shelf.desc}</p>
                  </div>
                  <ShelfScrollControls
                    onScrollLeft={() => scrollShelf(shelf.id, 'left')}
                    onScrollRight={() => scrollShelf(shelf.id, 'right')}
                  />
                </div>

                <div
                  className="sp-shelf-row"
                  ref={(el) => { shelfRefs.current[shelf.id] = el; }}
                  tabIndex={0}
                  aria-label={`${shelf.title} tracks list`}
                >
                  {tracks.map((track, idx) => (
                    <HorizonShelfCard
                      key={`sp-${shelf.id}-${track.id || track.url || idx}`}
                      track={track}
                      onPlay={onPlayTrack}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
