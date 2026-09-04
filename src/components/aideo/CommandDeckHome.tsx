import { useState, useMemo } from 'react';
import { RefreshCw, Play, Radio, Activity } from 'lucide-react';
import { useStore } from '../../store';
import { pathsEqual } from '../../utils';
import { AideoHomeProps, AideoSearchBar, TrackCover, PlayButton, SHELVES, buildTaggedFeed, sourceTypeColor, ShelfId } from './HomeParts';

type FeedTab = 'all' | ShelfId;

// Short mono quality label for the technical Quality column.
function qualitySpec(track: any): string {
  const allTracks = useStore.getState().tracks || [];
  const localMatch = allTracks.find(t =>
    (track?.path && pathsEqual(t.path, track.path)) ||
    (track?.url && pathsEqual(t.path, track.url)) ||
    (Boolean(track?.title && track?.artist) &&
     Boolean(t.title && t.artist) &&
     (t.title ?? '').trim().toLowerCase() === String(track.title).trim().toLowerCase() &&
     (t.artist ?? '').trim().toLowerCase() === String(track.artist).trim().toLowerCase())
  );
  if (localMatch) {
    const fmt = (localMatch.format || '').toUpperCase();
    if (fmt === 'FLAC' || fmt === 'WAV' || fmt === 'ALAC' || fmt === 'DSD') return `${fmt} · Local`;
    return fmt ? `${fmt} · Local` : 'FLAC · Local';
  }
  const p = String(track.url || track.path || '').toLowerCase();
  const q = String((track as any).quality || '').toUpperCase();
  if (track.url && track.url.startsWith('http')) {
    if (/tidal/i.test(track.recommendation_source || '') || /flac/i.test(String((track as any).format || ''))) return 'FLAC · Lossless';
    return 'Stream';
  }
  if (q === 'HI_RES_192') return 'FLAC 24/192';
  if (q === 'HI_RES') return 'FLAC · Hi-Res';
  if (/\.(flac|wav|alac|aiff|dsd)$/.test(p)) return 'FLAC · Local';
  const ext = p.split('.').pop()?.toUpperCase();
  return ext ? `${ext} · Local` : 'Local';
}

export function CommandDeckHome({ greeting, trackCount, totalPlays, discoveryData, isLoadingRecs, isRefreshingRecs, onRefreshRecs, onPlayTrack, renderDownloadAction, resume, search }: AideoHomeProps) {
  const [feed, setFeed] = useState<FeedTab>('all');
  const feedItems = useMemo(() => buildTaggedFeed(discoveryData), [discoveryData]);
  const visible = useMemo(() => feed === 'all' ? feedItems : feedItems.filter(t => t.shelf === feed), [feed, feedItems]);

  const tabs: Array<{ id: FeedTab; label: string; count: number }> = useMemo(() => [
    { id: 'all', label: 'All Signals', count: feedItems.length },
    ...(['recs', 'tidal', 'recent' as ShelfId, 'rotation', 'gems', 'charts'] as ShelfId[])
      .map(id => ({ id, label: SHELVES[id].label, count: feedItems.filter(t => t.shelf === id).length }))
      .filter(t => t.count > 0 || t.id === 'recs'),
  ], [feedItems]);

  // Top 3 spotlight tracks for current feed view
  const spotlightItems = useMemo(() => visible.slice(0, 3), [visible]);

  return (
    <div className="ah-root ah-deck">
      {/* ── TOP TACTICAL HUD & TELEMETRY ── */}
      <header className="ah-deck-hud">
        <div className="ah-deck-hud-top">
          <div className="ah-deck-title-block">
            <div className="ah-deck-kicker">
              <Activity size={12} className="ah-deck-pulse" />
              <span>STUDIO CONSOLE · COMMAND DECK</span>
            </div>
            <h1 className="ah-deck-heading">Command Deck</h1>
            <p className="ah-deck-sub">{greeting}, Listener · Precision audio curation & active signal stream</p>
          </div>

          <div className="ah-deck-telemetry">
            <div className="ah-deck-stat">
              <span className="ah-deck-stat-num">{trackCount.toLocaleString()}</span>
              <span className="ah-deck-stat-lbl">TRACKS</span>
            </div>
            <div className="ah-deck-stat-sep" />
            <div className="ah-deck-stat">
              <span className="ah-deck-stat-num">{totalPlays.toLocaleString()}</span>
              <span className="ah-deck-stat-lbl">PLAYS</span>
            </div>
            <div className="ah-deck-stat-sep" />
            <div className="ah-deck-stat">
              <span className="ah-deck-stat-num">{visible.length}</span>
              <span className="ah-deck-stat-lbl">SIGNALS</span>
            </div>

            <button
              className="ah-deck-refresh-btn"
              onClick={onRefreshRecs}
              disabled={isRefreshingRecs || isLoadingRecs}
              title="Curate recommendations"
            >
              <RefreshCw size={13} className={isRefreshingRecs || isLoadingRecs ? 'spin' : ''} />
              <span>{isRefreshingRecs || isLoadingRecs ? 'Curating…' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Tactical Search Bar */}
        <div className="ah-deck-search-wrap">
          <AideoSearchBar variant="column" props={search} />
        </div>
      </header>

      {/* ── RESUME SIGNAL COCKPIT (when paused track exists) ── */}
      {resume && (
        <section className="ah-deck-resume">
          <div className="ah-deck-resume-glass">
            <TrackCover src={resume.coverUrl} path={resume.coverPath} size={52} radius={10} outline={resume.accent} />
            <div className="ah-deck-resume-meta">
              <div className="ah-deck-resume-kicker">
                <Radio size={11} className="pulse" />
                <span>SIGNAL RESTORATION · {resume.positionLabel}</span>
              </div>
              <div className="ah-deck-resume-title">{resume.title}</div>
              <div className="ah-deck-resume-sub">{resume.artist}</div>
            </div>
            <div className="ah-deck-resume-actions">
              <button className="ah-deck-resume-btn" onClick={resume.onResume}>
                <Play size={14} fill="currentColor" />
                <span>Resume</span>
              </button>
              <button className="ah-deck-resume-x" onClick={resume.onDismiss} title="Dismiss resume banner">×</button>
            </div>
          </div>
        </section>
      )}

      {/* ── HORIZONTAL FEED CONTROLLER RIBBON ── */}
      <nav className="ah-deck-ribbon" aria-label="Signal Feeds">
        <div className="ah-deck-ribbon-pills">
          {tabs.map(t => {
            const color = t.id === 'all' ? 'var(--ah-primary)' : SHELVES[t.id as ShelfId].color;
            const isActive = feed === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={`ah-deck-pill ${isActive ? 'active' : ''}`}
                onClick={() => setFeed(t.id)}
              >
                <span className="ah-deck-pill-dot" style={{ background: color }} />
                <span className="ah-deck-pill-label">{t.label}</span>
                <span className="ah-deck-pill-count">{t.count}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── RADAR SPOTLIGHT (Top Featured Signals in Active Feed) ── */}
      {!isLoadingRecs && spotlightItems.length > 0 && (
        <section className="ah-deck-spotlight">
          <div className="ah-deck-section-title">
            <div className="ah-deck-section-title-left">
              <Radio size={14} className="ah-accent-icon" />
              <span>Radar Spotlight</span>
            </div>
            <span className="ah-deck-section-sub">Highest affinity audio signals in active feed</span>
          </div>

          <div className="ah-deck-spotlight-grid">
            {spotlightItems.map((item, idx) => {
              const shelfColor = SHELVES[item.shelf]?.color || 'var(--ah-primary)';
              return (
                <div
                  key={`spotlight-${item.track.id}-${idx}`}
                  className="ah-spotlight-card"
                  onClick={() => onPlayTrack(item.track)}
                >
                  <div className="ah-spotlight-cover-container">
                    <TrackCover src={item.track.cover_url} path={item.track.url} title={item.track.title} artist={item.track.artist} size={74} radius={10} outline={sourceTypeColor(item.track)} />
                    <div className="ah-spotlight-play-overlay">
                      <PlayButton size={34} onClick={() => onPlayTrack(item.track)} />
                    </div>
                  </div>
                  <div className="ah-spotlight-info">
                    <span className="ah-spotlight-tag" style={{ color: shelfColor, borderColor: `${shelfColor}35` }}>
                      {SHELVES[item.shelf].label}
                    </span>
                    <div className="ah-spotlight-title" title={item.track.title}>{item.track.title}</div>
                    <div className="ah-spotlight-artist" title={item.track.artist}>{item.track.artist}</div>
                    <div className="ah-spotlight-spec">{qualitySpec(item.track)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── SIGNAL STREAM (Table Stream) ── */}
      <main className="ah-deckmain">
        <div className="ah-deck-head">
          <div className="ah-deck-head-left">
            <h2>Discovery feed</h2>
            <span className="ah-deck-signal-count">{visible.length} signals active</span>
          </div>
        </div>

        {isLoadingRecs ? (
          <div className="ah-loading">
            <RefreshCw size={15} className="spin" />
            <span>Curating recommendations…</span>
          </div>
        ) : (
          <>
            <div className="ah-thead">
              <div className="ah-th-idx">#</div>
              <div className="ah-th-art"></div>
              <div className="ah-th-track">Track</div>
              <div className="ah-th-reason">Reason</div>
              <div className="ah-th-spec">Quality</div>
              <div className="ah-th-actions">Action</div>
            </div>

            <div className="ah-tbody">
              {visible.map((item, i) => (
                <div key={`${item.track.id}-${i}`} className="ah-trow" onClick={() => onPlayTrack(item.track)}>
                  <div className="ah-row-idx">{i + 1}</div>
                  <div className="ah-row-cover">
                    <TrackCover src={item.track.cover_url} path={item.track.url} title={item.track.title} artist={item.track.artist} size={42} radius={7} outline={sourceTypeColor(item.track)} />
                  </div>
                  <div className="ah-row-meta">
                    <div className="ah-row-title" title={item.track.title}>{item.track.title}</div>
                    <div className="ah-row-artist" title={item.track.artist}>{item.track.artist}</div>
                  </div>
                  <div className="ah-src">
                    <span className="ah-src-pill" style={{ color: SHELVES[item.shelf].color, borderColor: `${SHELVES[item.shelf].color}35` }}>
                      {SHELVES[item.shelf].label}
                    </span>
                  </div>
                  <div className="ah-spec">
                    <span className="ah-spec-pill">{qualitySpec(item.track)}</span>
                  </div>
                  <div className="ah-row-actions" onClick={e => e.stopPropagation()}>
                    {renderDownloadAction(item.track)}
                    <PlayButton size={32} onClick={() => onPlayTrack(item.track)} />
                  </div>
                </div>
              ))}
            </div>

            {visible.length === 0 && (
              <div className="ah-empty">This feed is empty. Refresh discovery or connect more sources.</div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
