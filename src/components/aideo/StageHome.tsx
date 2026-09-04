import { RefreshCw } from 'lucide-react';
import { AideoHomeProps, AideoSearchBar, TrackCover, PlayButton, SHELVES, buildTaggedFeed, tracksForShelf, sourceTypeColor } from './HomeParts';

export function StageHome({ greeting, trackCount, totalPlays, discoveryData, isLoadingRecs, isRefreshingRecs, onRefreshRecs, onPlayTrack, resume, search }: AideoHomeProps) {
  const feed = buildTaggedFeed(discoveryData).filter(t => t.shelf !== 'recent');
  const grouped = (['tidal', 'recs', 'rotation', 'gems', 'charts'] as const)
    .map(id => ({ id, items: feed.filter(t => t.shelf === id).slice(0, 4) }))
    .filter(g => g.items.length > 0);
  const history = tracksForShelf(discoveryData, 'recent').slice(0, 8);

  return (
    <div className="ah-root ah-stage-root">
      <div className="ah-stage">
        <div className="ah-stage-inner">
          <h1 className="ah-stage-title">{greeting},<br />Listener</h1>
          <div className="ah-stats-line"><b>{trackCount.toLocaleString()}</b> tracks<span className="ah-dot">·</span><b>{totalPlays.toLocaleString()}</b> plays</div>
          <div className="ah-stage-search">
            <AideoSearchBar variant="pill" props={search} />
          </div>
        </div>
        {resume && (
          <div className="ah-resume-card" onClick={resume.onResume}>
            <TrackCover src={resume.coverUrl} path={resume.coverPath} size={56} radius={9} outline={resume.accent} />
            <div className="ah-resume-meta">
              <div className="ah-resume-kicker">Resume · {resume.positionLabel}</div>
              <div className="ah-resume-title">{resume.title}</div>
              <div className="ah-resume-sub">{resume.artist}</div>
            </div>
            <PlayButton size={38} onClick={resume.onResume} />
            <button className="ah-resume-x" onClick={e => { e.stopPropagation(); resume.onDismiss(); }}>×</button>
          </div>
        )}
      </div>

      <div className="ah-stage-content">
        <section className="ah-section">
          <div className="ah-section-head">
            <div>
              <h2>Discovery</h2>
              <p className="ah-section-reason">{feed.length} tracks picked from your connected sources</p>
            </div>
            <button className="ah-see-all" onClick={onRefreshRecs} disabled={isRefreshingRecs || isLoadingRecs}>
              <RefreshCw size={12} className={isRefreshingRecs || isLoadingRecs ? 'spin' : ''} /> Refresh feed
            </button>
          </div>

          {isLoadingRecs ? (
            <div className="ah-loading"><RefreshCw size={14} className="spin" /> Curating recommendations…</div>
          ) : (
            grouped.map(g => (
              <div key={g.id}>
                <div className="ah-group-label">
                  <i style={{ background: SHELVES[g.id].color }} />
                  {SHELVES[g.id].label}
                </div>
                <div className="ah-grid2">
                  {g.items.map(item => (
                    <div key={item.track.id} className="ah-row" onClick={() => onPlayTrack(item.track)}>
                      <TrackCover src={item.track.cover_url} path={item.track.url} title={item.track.title} artist={item.track.artist} size={46} outline={sourceTypeColor(item.track)} />
                      <div className="ah-row-meta">
                        <div className="ah-row-title" title={item.track.title}>{item.track.title}</div>
                        <div className="ah-row-artist" title={item.track.artist}>{item.track.artist}</div>
                      </div>
                      <PlayButton onClick={() => onPlayTrack(item.track)} />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          {!isLoadingRecs && feed.length === 0 && (
            <div className="ah-empty">Nothing curated yet. Search above or refresh the feed.</div>
          )}
        </section>

        {history.length > 0 && (
          <section className="ah-section">
            <div className="ah-section-head">
              <div><h2>Recently played</h2></div>
            </div>
            <div className="ah-strip">
              {history.map(t => (
                <div key={t.id} className="ah-hist" onClick={() => onPlayTrack(t)}>
                  <TrackCover src={t.cover_url} path={t.url} title={t.title} artist={t.artist} size={128} radius={10} outline={sourceTypeColor(t)} />
                  <div className="ah-card-title" title={t.title}>{t.title}</div>
                  <div className="ah-card-artist" title={t.artist}>{t.artist}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
