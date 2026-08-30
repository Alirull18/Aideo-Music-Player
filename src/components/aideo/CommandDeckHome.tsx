import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AideoHomeProps, AideoSearchBar, TrackCover, PlayButton, SHELVES, buildTaggedFeed, sourceTypeColor, ShelfId } from './HomeParts';

type FeedTab = 'all' | ShelfId;

// Short mono quality label for the technical Quality column.
function qualitySpec(track: any): string {
  const p = String(track.url || '').toLowerCase();
  const q = String((track as any).quality || '').toUpperCase();
  if (track.url && track.url.startsWith('http')) {
    if (/tidal/i.test(track.recommendation_source || '') || /flac/i.test(String((track as any).format || ''))) return 'FLAC · Lossless';
    return 'Stream';
  }
  if (q === 'HI_RES_192') return 'FLAC 24/192';
  if (q === 'HI_RES') return 'FLAC · Hi-Res';
  if (/\.(flac|wav|alac|aiff|dsd)$/.test(p)) return 'FLAC · Local';
  return 'Local';
}

export function CommandDeckHome({ greeting, trackCount, totalPlays, discoveryData, isLoadingRecs, isRefreshingRecs, onRefreshRecs, onPlayTrack, renderDownloadAction, resume, search }: AideoHomeProps) {
  const [feed, setFeed] = useState<FeedTab>('all');
  const feedItems = buildTaggedFeed(discoveryData);
  const visible = feed === 'all' ? feedItems : feedItems.filter(t => t.shelf === feed);

  const tabs: Array<{ id: FeedTab; label: string; count: number }> = [
    { id: 'all', label: 'All', count: feedItems.length },
    ...(['recs', 'tidal', 'recent' as ShelfId, 'rotation', 'gems', 'charts'] as ShelfId[])
      .map(id => ({ id, label: SHELVES[id].label, count: feedItems.filter(t => t.shelf === id).length }))
      .filter(t => t.count > 0 || t.id === 'recs'),
  ];

  return (
    <div className="ah-root ah-deck">
      <aside className="ah-rail">
        <div className="ah-rail-head">
          <h1>Command Deck</h1>
          <p className="ah-rail-sub">{greeting}, Listener</p>
        </div>

        <AideoSearchBar variant="rail" props={search} />

        <div className="ah-rail-group">
          <h3>Feeds</h3>
          <ul className="ah-filter-list">
            {tabs.map(t => (
              <li key={t.id} className={feed === t.id ? 'active' : ''} onClick={() => setFeed(t.id)}>
                <i style={{ background: t.id === 'all' ? 'var(--ah-primary)' : SHELVES[t.id as ShelfId].color }} />
                {t.label}
                <span className="ah-cnt">{t.count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="ah-rail-stats">
          <div className="ah-stat"><div className="ah-stat-v">{trackCount.toLocaleString()}</div><div className="ah-stat-k">tracks</div></div>
          <div className="ah-stat"><div className="ah-stat-v">{totalPlays.toLocaleString()}</div><div className="ah-stat-k">plays</div></div>
        </div>
      </aside>

      <main className="ah-deckmain">
        <div className="ah-deck-head">
          <h2>Discovery feed</h2>
          <button className="ah-see-all" onClick={onRefreshRecs} disabled={isRefreshingRecs || isLoadingRecs}>
            <RefreshCw size={12} className={isRefreshingRecs || isLoadingRecs ? 'spin' : ''} />
            {isRefreshingRecs || isLoadingRecs ? 'Curating…' : 'Refresh'}
          </button>
        </div>

        {resume && (
          <div className="ah-resume-bar ah-resume-deck">
            <TrackCover src={resume.coverUrl} path={resume.coverPath} size={40} outline={resume.accent} />
            <div className="ah-resume-meta">
              <div className="ah-resume-title">{resume.title}</div>
              <div className="ah-resume-sub">{resume.artist} · {resume.positionLabel}</div>
            </div>
            <button className="ah-resume-btn" onClick={resume.onResume}>Resume</button>
            <button className="ah-resume-x" onClick={resume.onDismiss}>×</button>
          </div>
        )}

        {isLoadingRecs ? (
          <div className="ah-loading"><RefreshCw size={14} className="spin" /> Curating recommendations…</div>
        ) : (
          <>
            <div className="ah-thead">
              <div>#</div><div></div><div>Track</div><div>Reason</div><div>Quality</div>
            </div>
            {visible.map((item, i) => (
              <div key={`${item.track.id}-${i}`} className="ah-trow">
                <div className="ah-row-idx">{i + 1}</div>
                <TrackCover src={item.track.cover_url} path={item.track.url} size={46} outline={sourceTypeColor(item.track)} />
                <div className="ah-row-meta">
                  <div className="ah-row-title" title={item.track.title}>{item.track.title}</div>
                  <div className="ah-row-artist" title={item.track.artist}>{item.track.artist}</div>
                </div>
                <div className="ah-src">{SHELVES[item.shelf].label}</div>
                <div className="ah-spec">{qualitySpec(item.track)}</div>
                <div className="ah-row-actions">
                  {renderDownloadAction(item.track)}
                  <PlayButton onClick={() => onPlayTrack(item.track)} />
                </div>
              </div>
            ))}
            {visible.length === 0 && (
              <div className="ah-empty">This feed is empty. Refresh discovery or connect more sources.</div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
