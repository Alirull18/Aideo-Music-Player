import { memo } from 'react';
import { RefreshCw } from 'lucide-react';
import { AideoHomeProps, AideoSearchBar, TrackCover, PlayButton, SHELVES, buildTaggedFeed, tracksForShelf, ShelfId, sourceTypeColor } from './HomeParts';

const ShelfRow = memo(({ track, idx, onPlay }: { track: any; idx: number; onPlay: (t: any) => void }) => (
  <div className="ah-row" onClick={() => onPlay(track)}>
    <div className="ah-row-idx">{idx + 1}</div>
    <TrackCover src={track.cover_url} path={track.url} size={46} outline={sourceTypeColor(track)} />
    <div className="ah-row-meta">
      <div className="ah-row-title" title={track.title}>{track.title}</div>
      <div className="ah-row-artist" title={track.artist}>{track.artist}</div>
    </div>
    <span className="ah-row-dur">{track.duration_raw}</span>
    <PlayButton onClick={() => onPlay(track)} />
  </div>
));

const ArtCard = memo(({ track, onPlay }: { track: any; onPlay: (t: any) => void }) => (
  <div className="ah-card" onClick={() => onPlay(track)}>
    <div className="ah-card-cover">
      <TrackCover src={track.cover_url} path={track.url} size={172} radius={12} outline={sourceTypeColor(track)} />
      <PlayButton size={38} onClick={() => onPlay(track)} />
    </div>
    <div className="ah-card-title" title={track.title}>{track.title}</div>
    <div className="ah-card-artist" title={track.artist}>{track.artist}</div>
  </div>
));

export function EditorialHome({ greeting, trackCount, totalPlays, discoveryData, isLoadingRecs, isRefreshingRecs, onRefreshRecs, onPlayTrack, resume, search }: AideoHomeProps) {
  const shelfIds: ShelfId[] = ['recs', 'tidal', 'rotation', 'gems', 'charts'];
  const history = tracksForShelf(discoveryData, 'recent').slice(0, 6);

  return (
    <div className="ah-root ah-editorial">
      <div className="ah-masthead">
        <h1 className="ah-greeting">{greeting}, <span>Listener</span></h1>
        <div className="ah-stats-line"><b>{trackCount.toLocaleString()}</b> tracks<span className="ah-dot">·</span><b>{totalPlays.toLocaleString()}</b> plays</div>
      </div>

      {resume && (
        <div className="ah-resume-bar">
          <TrackCover src={resume.coverUrl} path={resume.coverPath} size={44} outline={resume.accent} />
          <div className="ah-resume-meta">
            <div className="ah-resume-kicker">Continue where you left off · {resume.positionLabel}</div>
            <div className="ah-resume-title">{resume.title}</div>
            <div className="ah-resume-sub">{resume.artist}</div>
          </div>
          <button className="ah-resume-btn" onClick={resume.onResume}>Resume</button>
          <button className="ah-resume-x" onClick={resume.onDismiss}>×</button>
        </div>
      )}

      <div className="ah-editorial-search">
        <AideoSearchBar variant="column" props={search} />
      </div>

      {isLoadingRecs ? (
        <div className="ah-loading"><RefreshCw size={14} className="spin" /> Curating recommendations…</div>
      ) : (
        shelfIds.map(id => {
          const tracks = tracksForShelf(discoveryData, id).slice(0, 10);
          if (tracks.length === 0) return null;
          const meta = SHELVES[id];
          return (
            <section key={id} className="ah-section">
              <div className="ah-section-head">
                <div>
                  <h2>{meta.label}</h2>
                  <p className="ah-section-reason">{meta.reason}</p>
                </div>
                {id === 'recs' && (
                  <button className="ah-see-all" onClick={onRefreshRecs} disabled={isRefreshingRecs}>
                    <RefreshCw size={12} className={isRefreshingRecs ? 'spin' : ''} /> Refresh
                  </button>
                )}
              </div>
              <div className="ah-shelf">
                {tracks.map(t => <ArtCard key={t.id} track={t} onPlay={onPlayTrack} />)}
              </div>
            </section>
          );
        })
      )}

      {history.length > 0 && (
        <section className="ah-section">
          <div className="ah-section-head">
            <div><h2>Pick up where you left off</h2></div>
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
