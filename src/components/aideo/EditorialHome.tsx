import { memo, useMemo } from 'react';
import { RefreshCw, Play, Disc, Sparkles, BookOpen } from 'lucide-react';
import { AideoHomeProps, AideoSearchBar, TrackCover, PlayButton, SHELVES, buildTaggedFeed, tracksForShelf, ShelfId, sourceTypeColor } from './HomeParts';

const ShelfRow = memo(({ track, idx, onPlay }: { track: any; idx: number; onPlay: (t: any) => void }) => (
  <div className="ah-row ah-editorial-row" onClick={() => onPlay(track)}>
    <div className="ah-row-idx">{idx + 1}</div>
    <TrackCover src={track.cover_url} path={track.url} title={track.title} artist={track.artist} size={48} radius={8} outline={sourceTypeColor(track)} />
    <div className="ah-row-meta">
      <div className="ah-row-title" title={track.title}>{track.title}</div>
      <div className="ah-row-artist" title={track.artist}>{track.artist}</div>
    </div>
    <div className="ah-editorial-tag">VOL. {(idx + 1).toString().padStart(2, '0')}</div>
    <span className="ah-row-dur">{track.duration_raw}</span>
    <PlayButton onClick={() => onPlay(track)} />
  </div>
));

const ArtCard = memo(({ track, onPlay, badge }: { track: any; onPlay: (t: any) => void; badge?: string }) => (
  <div className="ah-card ah-editorial-card" onClick={() => onPlay(track)}>
    <div className="ah-card-cover">
      <TrackCover src={track.cover_url} path={track.url} title={track.title} artist={track.artist} size={176} radius={14} outline={sourceTypeColor(track)} />
      {badge && <span className="ah-editorial-badge">{badge}</span>}
      <div className="ah-editorial-vinyl-peek">
        <Disc size={64} className="ah-vinyl-groove" />
      </div>
      <PlayButton size={40} onClick={() => onPlay(track)} />
    </div>
    <div className="ah-card-title" title={track.title}>{track.title}</div>
    <div className="ah-card-artist" title={track.artist}>{track.artist}</div>
  </div>
));

export function EditorialHome({ greeting, trackCount, totalPlays, discoveryData, isLoadingRecs, isRefreshingRecs, onRefreshRecs, onPlayTrack, resume, search }: AideoHomeProps) {
  const shelfIds: ShelfId[] = ['recs', 'tidal', 'rotation', 'gems', 'charts'];
  const history = tracksForShelf(discoveryData, 'recent').slice(0, 6);

  // Curate lead cover story from top recommendation or first available shelf
  const leadTrack = useMemo(() => {
    for (const id of shelfIds) {
      const tracks = tracksForShelf(discoveryData, id);
      if (tracks.length > 0) return tracks[0];
    }
    return null;
  }, [discoveryData]);

  return (
    <div className="ah-root ah-editorial">
      {/* ── MASTHEAD & PUBLICATION HEADER ── */}
      <header className="ah-editorial-masthead">
        <div className="ah-masthead-folio">
          <div className="ah-masthead-stamp">
            <BookOpen size={13} />
            <span>AIDEO EDITORIAL ARCHIVE · ISSUE VOL. 28</span>
          </div>
          <div className="ah-masthead-edition">CURATED LISTENING DIGEST</div>
        </div>

        <div className="ah-masthead-main">
          <div className="ah-masthead-lead">
            <h1 className="ah-greeting">{greeting}, <span>Listener</span></h1>
            <p className="ah-masthead-desc">Daily curations, high-fidelity pressings, and acoustic liner notes tailored to your library.</p>
          </div>
          <div className="ah-stats-line">
            <b>{trackCount.toLocaleString()}</b> tracks<span className="ah-dot">·</span><b>{totalPlays.toLocaleString()}</b> plays
          </div>
        </div>
      </header>

      {/* ── RESUME EDITORIAL BOOKMARK ── */}
      {resume && (
        <div className="ah-resume-bar ah-editorial-resume">
          <TrackCover src={resume.coverUrl} path={resume.coverPath} size={48} radius={8} outline={resume.accent} />
          <div className="ah-resume-meta">
            <div className="ah-resume-kicker">EDITORIAL BOOKMARK · {resume.positionLabel}</div>
            <div className="ah-resume-title">{resume.title}</div>
            <div className="ah-resume-sub">{resume.artist}</div>
          </div>
          <button className="ah-resume-btn" onClick={resume.onResume}>
            <Play size={13} fill="currentColor" /> Resume
          </button>
          <button className="ah-resume-x" onClick={resume.onDismiss} title="Dismiss">×</button>
        </div>
      )}

      {/* ── EDITORIAL SEARCH BAR ── */}
      <div className="ah-editorial-search">
        <AideoSearchBar variant="column" props={search} />
      </div>

      {/* ── COVER STORY / LEAD FEATURE SPREAD ── */}
      {!isLoadingRecs && leadTrack && (
        <section className="ah-editorial-cover-story" onClick={() => onPlayTrack(leadTrack)}>
          <div className="ah-cover-story-plate">
            <div className="ah-cover-story-art">
              <TrackCover
                src={leadTrack.cover_url}
                path={leadTrack.url}
                title={leadTrack.title}
                artist={leadTrack.artist}
                size={220}
                radius={16}
                outline={sourceTypeColor(leadTrack)}
              />
              <div className="ah-cover-vinyl-disc">
                <Disc size={180} />
              </div>
            </div>
            <div className="ah-cover-story-content">
              <div className="ah-cover-story-kicker">
                <Sparkles size={13} />
                <span>COVER STORY · CURATOR'S SELECTION</span>
                <span className="ah-cover-story-badge">FEATURED</span>
              </div>
              <h2 className="ah-cover-story-title" title={leadTrack.title}>
                Featured Record: {leadTrack.title}
              </h2>
              <div className="ah-cover-story-artist">{leadTrack.artist}</div>
              <p className="ah-cover-story-quote">
                "An essential pressing pulled from your acoustic resonance profile. Balanced dynamics with striking presence across the soundstage."
              </p>
              <div className="ah-cover-story-footer">
                <button
                  type="button"
                  className="ah-cover-play-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayTrack(leadTrack);
                  }}
                >
                  <Play size={15} fill="currentColor" /> Listen Now
                </button>
                {leadTrack.duration_raw && (
                  <span className="ah-cover-story-meta">Duration {leadTrack.duration_raw}</span>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── CURATED SHELVES ── */}
      {isLoadingRecs ? (
        <div className="ah-loading"><RefreshCw size={15} className="spin" /> Curating recommendations…</div>
      ) : (
        shelfIds.map((id, shelfIdx) => {
          const tracks = tracksForShelf(discoveryData, id).slice(0, 10);
          if (tracks.length === 0) return null;
          const meta = SHELVES[id];
          return (
            <section key={id} className="ah-section ah-editorial-section">
              <div className="ah-section-head">
                <div>
                  <div className="ah-section-num">VOL. {(shelfIdx + 1).toString().padStart(2, '0')}</div>
                  <h2>{meta.label}</h2>
                  <p className="ah-section-reason">{meta.reason}</p>
                </div>
                {id === 'recs' && (
                  <button className="ah-see-all ah-editorial-refresh" onClick={onRefreshRecs} disabled={isRefreshingRecs}>
                    <RefreshCw size={13} className={isRefreshingRecs ? 'spin' : ''} /> Refresh
                  </button>
                )}
              </div>
              <div className="ah-shelf">
                {tracks.map((t, idx) => (
                  <ArtCard
                    key={t.id}
                    track={t}
                    onPlay={onPlayTrack}
                    badge={idx === 0 ? 'ESSENTIAL' : idx === 1 ? 'DEEP CUT' : undefined}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {/* ── PICK UP WHERE YOU LEFT OFF (HISTORY ROWS) ── */}
      {history.length > 0 && (
        <section className="ah-section ah-editorial-history">
          <div className="ah-section-head">
            <div>
              <div className="ah-section-num">ARCHIVE</div>
              <h2>Pick up where you left off</h2>
              <p className="ah-section-reason">Recently traversed tracks from your personal archive</p>
            </div>
          </div>
          <div className="ah-rows">
            {history.map((t, i) => <ShelfRow key={t.id} track={t} idx={i} onPlay={onPlayTrack} />)}
          </div>
        </section>
      )}

      {buildTaggedFeed(discoveryData).length === 0 && !isLoadingRecs && (
        <div className="ah-empty">Nothing curated yet. Refresh the feed or search the web above.</div>
      )}
    </div>
  );
}
