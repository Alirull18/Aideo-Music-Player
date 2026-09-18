import { useState, useMemo, memo } from 'react';
import { Play, ChevronLeft, ChevronRight, RefreshCw, Disc3 } from 'lucide-react';
import { useStore } from '../../store';
import {
  AideoHomeProps,
  AideoSearchBar,
  TrackCover,
  buildTaggedFeed,
  tracksForShelf,
  getLosslessTracks,
  ShelfId,
  SongSources,
} from './HomeParts';

type SpatialTab = 'browse' | 'top' | 'new' | 'lossless';

// Crimson play button for Spatial Glass aesthetic
const SpatialPlayButton = memo(({ onClick, size = 42 }: { onClick: () => void; size?: number }) => (
  <button
    type="button"
    className="am-play-badge"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    aria-label="Play track"
    style={{ width: size, height: size }}
  >
    <Play size={Math.round(size * 0.44)} fill="#ffffff" color="#ffffff" />
  </button>
));

// Multi-Row Track Tile for "Top Songs" / "Quick Listen"
const SpatialTrackRow = memo(({
  track,
  idx,
  onPlay,
}: {
  track: any;
  idx: number;
  onPlay: (t: any) => void;
}) => (
  <div
    className="am-track-row"
    onClick={() => onPlay(track)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay(track); }}
    aria-label={`Play ${track.title} by ${track.artist || 'Unknown'}`}
  >
    <div className="am-row-idx">{(idx + 1).toString().padStart(2, '0')}</div>
    <div className="am-row-art">
      <TrackCover
        src={track.cover_url}
        path={track.path || track.url}
        title={track.title}
        artist={track.artist}
        size={44}
        radius={6}
      />
      <div className="am-row-play-overlay">
        <Play size={16} fill="#ffffff" color="#ffffff" />
      </div>
    </div>
    <div className="am-row-meta">
      <div className="am-row-title" title={track.title}>{track.title}</div>
      <div className="am-row-artist" title={track.artist}>{track.artist || 'Unknown Artist'}</div>
      <SongSources track={track} />
    </div>
    {track.duration_raw && <div className="am-row-duration">{track.duration_raw}</div>}
  </div>
));

// Frosted Album Card for Spatial Glass Shelves
const SpatialAlbumCard = memo(({
  track,
  onPlay,
}: {
  track: any;
  onPlay: (t: any) => void;
}) => (
  <div
    className="am-card"
    onClick={() => onPlay(track)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlay(track); }}
    aria-label={`Play ${track.title} by ${track.artist || 'Unknown'}`}
  >
    <div className="am-card-cover-wrap">
      <TrackCover
        src={track.cover_url}
        path={track.path || track.url}
        title={track.title}
        artist={track.artist}
        size={168}
        radius={10}
      />
      <div className="am-card-play-hover">
        <SpatialPlayButton onClick={() => onPlay(track)} size={44} />
      </div>
    </div>
    <div className="am-card-info">
      <div className="am-card-title" title={track.title}>{track.title}</div>
      <div className="am-card-sub" title={track.artist}>{track.artist || 'Unknown Artist'}</div>
      <div className="am-card-source">
        <SongSources track={track} />
      </div>
    </div>
  </div>
));

export function SpatialGlassHome({
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
  const [activeTab, setActiveTab] = useState<SpatialTab>('browse');
  const [heroSlide, setHeroSlide] = useState(0);

  const localTracks = useStore((s) => s.tracks);

  // Compile Hi-Res lossless tracks from Tidal stream pool, discovery feed, and local library files
  const losslessTracks = useMemo(
    () => getLosslessTracks(discoveryData, localTracks),
    [discoveryData, localTracks]
  );

  // Compile featured tracks for the Paged Spatial Hero Marquee (top 4 curated items)
  const heroTracks = useMemo(() => {
    const feed = buildTaggedFeed(discoveryData);
    if (feed.length === 0) return [];
    const priorityShelves: ShelfId[] = ['recs', 'tidal', 'gems', 'rotation', 'recent', 'charts'];
    const candidates: any[] = [];
    for (const s of priorityShelves) {
      candidates.push(...feed.filter(t => t.shelf === s).map(t => t.track));
    }
    const seen = new Set<string>();
    const out: any[] = [];
    for (const t of candidates) {
      const key = `${t.title || ''}::${t.artist || ''}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
      if (out.length >= 4) break;
    }
    return out;
  }, [discoveryData]);

  const currentHeroTrack = heroTracks[heroSlide] || heroTracks[0] || null;

  const nextHeroSlide = () => {
    if (heroTracks.length <= 1) return;
    setHeroSlide((prev) => (prev + 1) % heroTracks.length);
  };

  const prevHeroSlide = () => {
    if (heroTracks.length <= 1) return;
    setHeroSlide((prev) => (prev - 1 + heroTracks.length) % heroTracks.length);
  };

  // Compile Top Picks for multi-row list (6 tracks)
  const topTracks = useMemo(() => {
    const recents = tracksForShelf(discoveryData, 'recent');
    const rotation = tracksForShelf(discoveryData, 'rotation');
    const combined = [...rotation, ...recents];
    const seen = new Set<string>();
    const out: any[] = [];
    for (const t of combined) {
      const key = `${t.title || ''}::${t.artist || ''}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
      if (out.length >= 6) break;
    }
    return out;
  }, [discoveryData]);

  // Compile discovery shelves
  const shelfCategories: Array<{ id: ShelfId; label: string; sub: string }> = [
    { id: 'recs', label: 'Made for You', sub: 'Personalized selections based on your favorites' },
    { id: 'recent', label: 'Recently Played', sub: 'Jump back into your recent sessions' },
    { id: 'rotation', label: 'Heavy Rotation', sub: 'Albums and tracks on repeat' },
    { id: 'tidal', label: 'Spatial & Lossless', sub: 'High-resolution FLAC audio streams' },
    { id: 'gems', label: 'Curator Vault', sub: 'Deep catalog picks and forgotten gems' },
    { id: 'charts', label: 'Top Worldwide', sub: 'Trending across global charts' },
  ];

  const filteredShelves = useMemo(() => {
    if (activeTab === 'top') {
      return shelfCategories.filter((s) => s.id === 'rotation' || s.id === 'charts');
    }
    if (activeTab === 'new') {
      return shelfCategories.filter((s) => s.id === 'recs' || s.id === 'gems');
    }
    if (activeTab === 'lossless') {
      return shelfCategories.filter((s) => s.id === 'tidal');
    }
    return shelfCategories;
  }, [activeTab, shelfCategories]);

  return (
    <div className="ah-root ah-apple ah-spatial">
      {/* ── AMBIENT VIBRANCY LAYER ── */}
      <div className="am-ambient-canvas" aria-hidden="true" />

      {/* ── TOP NAV BAR & SEARCH ── */}
      <div className="am-top-bar">
        <div className="am-search-container">
          <AideoSearchBar variant="pill" props={search} />
        </div>
        <div className="am-top-actions">
          {layoutFilter}
          <button
            type="button"
            className="am-refresh-button"
            onClick={onRefreshRecs}
            disabled={isRefreshingRecs || isLoadingRecs}
            aria-label="Refresh music recommendations"
          >
            <RefreshCw size={14} className={isRefreshingRecs || isLoadingRecs ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── RESUME PLAYBACK BANNER ── */}
      {resume && (
        <div className="am-resume-card">
          <div className="am-resume-art">
            <TrackCover
              src={resume.coverUrl}
              path={resume.coverPath}
              title={resume.title}
              artist={resume.artist}
              size={52}
              radius={8}
            />
          </div>
          <div className="am-resume-info">
            <div className="am-resume-eyebrow">CONTINUE LISTENING · {resume.positionLabel}</div>
            <div className="am-resume-title">{resume.title}</div>
            <div className="am-resume-artist">{resume.artist}</div>
          </div>
          <div className="am-resume-actions">
            <button
              type="button"
              className="am-resume-play"
              onClick={resume.onResume}
              aria-label="Resume playing"
            >
              <Play size={14} fill="#ffffff" color="#ffffff" />
              <span>Resume</span>
            </button>
            <button
              type="button"
              className="am-resume-dismiss"
              onClick={resume.onDismiss}
              aria-label="Dismiss banner"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── HEADER ── */}
      <div className="am-header-section">
        <div className="am-header-titles">
          <span className="am-header-kicker">SPATIAL AUDIO ARCHIVE</span>
          <h1 className="am-header-main">{greeting}</h1>
          <div className="am-header-meta">
            <span>{trackCount.toLocaleString()} tracks in library</span>
            <span className="am-meta-dot">•</span>
            <span>{totalPlays.toLocaleString()} total plays</span>
          </div>
        </div>
      </div>

      {/* ── PAGED SPATIAL HERO MARQUEE ── */}
      {currentHeroTrack && (
        <section className="am-hero-section" aria-label="Featured spotlight carousel">
          <div className="am-hero-card">
            {/* Ambient Blurred Background Art */}
            <div
              className="am-hero-backdrop"
              style={{
                backgroundImage: currentHeroTrack.cover_url
                  ? `url(${currentHeroTrack.cover_url})`
                  : undefined,
              }}
              aria-hidden="true"
            />
            <div className="am-hero-overlay" />

            <div className="am-hero-content">
              <div className="am-hero-text-col">
                <div className="am-hero-kicker">FEATURED DISCOVERY</div>
                <h2 className="am-hero-title" title={currentHeroTrack.title}>
                  {currentHeroTrack.title}
                </h2>
                <div className="am-hero-artist">{currentHeroTrack.artist || 'Unknown Artist'}</div>
                <p className="am-hero-desc">
                  Curated spotlight from your acoustic taste profile. Experience high-fidelity audio resolution and pristine dynamic range.
                </p>

                <div className="am-hero-cta-row">
                  <button
                    type="button"
                    className="am-hero-play-btn"
                    onClick={() => onPlayTrack(currentHeroTrack)}
                    aria-label={`Listen now to ${currentHeroTrack.title}`}
                  >
                    <Play size={16} fill="#ffffff" color="#ffffff" />
                    <span>Listen Now</span>
                  </button>
                  <SongSources track={currentHeroTrack} />
                </div>
              </div>

              <div className="am-hero-art-col">
                <div
                  className="am-hero-art-frame"
                  onClick={() => onPlayTrack(currentHeroTrack)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPlayTrack(currentHeroTrack); }}
                  aria-label={`Play ${currentHeroTrack.title}`}
                >
                  <TrackCover
                    src={currentHeroTrack.cover_url}
                    path={currentHeroTrack.path || currentHeroTrack.url}
                    title={currentHeroTrack.title}
                    artist={currentHeroTrack.artist}
                    size={220}
                    radius={14}
                  />
                  <div className="am-hero-art-play">
                    <Play size={24} fill="#ffffff" color="#ffffff" />
                  </div>
                </div>
              </div>
            </div>

            {/* Carousel Navigation Footer */}
            {heroTracks.length > 1 && (
              <div className="am-hero-footer">
                <div className="am-hero-dots">
                  {heroTracks.map((_, idx) => (
                    <button
                      key={`dot-${idx}`}
                      type="button"
                      className={`am-hero-dot ${idx === heroSlide ? 'active' : ''}`}
                      onClick={() => setHeroSlide(idx)}
                      aria-label={`Go to slide ${idx + 1}`}
                    />
                  ))}
                </div>
                <div className="am-hero-arrows">
                  <button
                    type="button"
                    className="am-hero-arrow-btn"
                    onClick={prevHeroSlide}
                    aria-label="Previous slide"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    className="am-hero-arrow-btn"
                    onClick={nextHeroSlide}
                    aria-label="Next slide"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── TOP PICKS MULTI-ROW GRID ── */}
      {topTracks.length > 0 && (
        <section className="am-top-picks-section" aria-labelledby="am-top-picks-head">
          <div className="am-section-head">
            <div>
              <h2 id="am-top-picks-head" className="am-section-title">Quick Listen</h2>
              <p className="am-section-sub">Your top recent tracks and heavy rotation favorites</p>
            </div>
          </div>

          <div className="am-top-picks-grid">
            {topTracks.map((track, idx) => (
              <SpatialTrackRow
                key={`top-${track.id || track.url || idx}`}
                track={track}
                idx={idx}
                onPlay={onPlayTrack}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── CATEGORY FILTER TABS (BELOW QUICK LISTEN) ── */}
      <div className="am-tabs-wrapper">
        <div className="am-tab-bar" role="tablist" aria-label="Catalog views">
          {(
            [
              { id: 'browse', label: 'Browse' },
              { id: 'top', label: 'Top Picks' },
              { id: 'new', label: 'New Discoveries' },
              { id: 'lossless', label: 'Lossless Hi-Fi' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`am-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── FROSTED GLASS ALBUM GRID SHELVES ── */}
      <div className="am-shelves-stack">
        {activeTab === 'lossless' && losslessTracks.length === 0 && (
          <div className="ah-empty-lossless-state am-empty-lossless" role="status" aria-label="No lossless audio available">
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
          <div className="am-loading-state">
            <RefreshCw size={20} className="spin" />
            <span>Curating music catalogue…</span>
          </div>
        ) : (
          filteredShelves.map((shelf) => {
            const tracks = shelf.id === 'tidal' ? losslessTracks : tracksForShelf(discoveryData, shelf.id);
            if (!tracks || tracks.length === 0) return null;

            return (
              <section key={shelf.id} className="am-shelf-block" aria-labelledby={`am-head-${shelf.id}`}>
                <div className="am-shelf-head">
                  <div>
                    <h2 id={`am-head-${shelf.id}`} className="am-shelf-title">{shelf.label}</h2>
                    <p className="am-shelf-sub">{shelf.sub}</p>
                  </div>
                </div>

                <div className="am-shelf-grid">
                  {tracks.map((track, idx) => (
                    <SpatialAlbumCard
                      key={`am-${shelf.id}-${track.id || track.url || idx}`}
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
