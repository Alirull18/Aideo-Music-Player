import { useState, useMemo } from 'react';
import { RefreshCw, Play, Sparkles, Radio, Moon, Coffee, Disc, Flame, Waves } from 'lucide-react';
import { AideoHomeProps, AideoSearchBar, TrackCover, PlayButton, SHELVES, buildTaggedFeed, tracksForShelf, ShelfId, SongSources } from './HomeParts';

type AmbientMood = 'all' | 'midnight' | 'focus' | 'warmth' | 'lossless';

interface MoodConfig {
  id: AmbientMood;
  label: string;
  icon: any;
  shelfFilter?: ShelfId[];
  color: string;
}

const AMBIENT_MOODS: MoodConfig[] = [
  { id: 'all', label: 'All Frequencies', icon: Sparkles, color: 'var(--ah-primary)' },
  { id: 'midnight', label: 'Midnight Drift', icon: Moon, shelfFilter: ['recs', 'gems'], color: '#a78bfa' },
  { id: 'focus', label: 'Deep Focus', icon: Waves, shelfFilter: ['recs', 'charts'], color: '#38bdf8' },
  { id: 'warmth', label: 'Acoustic Warmth', icon: Coffee, shelfFilter: ['rotation', 'gems'], color: '#fbbf24' },
  { id: 'lossless', label: 'Lossless Hi-Fi', icon: Flame, shelfFilter: ['tidal'], color: '#22d3ee' },
];

export function StageHome({ greeting, trackCount, totalPlays, discoveryData, isLoadingRecs, isRefreshingRecs, onRefreshRecs, onPlayTrack, resume, search, layoutFilter }: AideoHomeProps) {
  const [activeMood, setActiveMood] = useState<AmbientMood>('all');

  const feed = useMemo(() => buildTaggedFeed(discoveryData).filter(t => t.shelf !== 'recent'), [discoveryData]);

  // Filter groups according to active mood
  const filteredFeed = useMemo(() => {
    if (activeMood === 'all') return feed;
    if (activeMood === 'lossless') return feed.filter(item => item.track.source_context?.sources.some(source => source.catalog_quality?.lossless || source.provider === 'tidal' || source.provider === 'qobuz') || item.shelf === 'tidal');
    const moodCfg = AMBIENT_MOODS.find(m => m.id === activeMood);
    if (!moodCfg?.shelfFilter) return feed;
    const filtered = feed.filter(t => moodCfg.shelfFilter!.includes(t.shelf));
    return filtered.length > 0 ? filtered : feed;
  }, [activeMood, feed]);

  const grouped = useMemo(() => {
    const shelfList: ShelfId[] = activeMood === 'lossless'
      ? ['tidal', 'recs', 'rotation', 'gems', 'charts']
      : ['tidal', 'recs', 'rotation', 'gems', 'charts'];

    return shelfList
      .map(id => ({ id, items: filteredFeed.filter(t => t.shelf === id).slice(0, 4) }))
      .filter(g => g.items.length > 0);
  }, [activeMood, filteredFeed]);

  const history = useMemo(() => tracksForShelf(discoveryData, 'recent').slice(0, 8), [discoveryData]);

  // Centerpiece spotlight track for the floating soundstage
  const spotlightTrack = useMemo(() => {
    return filteredFeed[0]?.track || null;
  }, [filteredFeed]);

  return (
    <div className="ah-root ah-stage-root">
      {/* ── LIVING AMBIENT AURORA BACKDROP ── */}
      <div className="ah-ambient-aurora-canvas" aria-hidden="true">
        <div className="ah-ambient-orb ah-orb-primary" />
        <div className="ah-ambient-orb ah-orb-secondary" />
        <div className="ah-ambient-orb ah-orb-tertiary" />
      </div>

      {/* ── AMBIENT STAGE HEADER & FLOATING SOUNDSTAGE ── */}
      <div className="ah-stage">
        <div className="ah-stage-inner">
          <div className="ah-stage-header-top">
            <div>
              <div className="ah-stage-kicker">
                <Radio size={12} className="ah-stage-pulse-dot" />
                <span>ATMOSPHERIC SOUNDSTAGE · 32-BIT FLOAT</span>
              </div>
              <h1 className="ah-stage-title">{greeting},<br />Listener</h1>
              <div className="ah-stats-line">
                <b>{trackCount.toLocaleString()}</b> tracks<span className="ah-dot">·</span><b>{totalPlays.toLocaleString()}</b> plays
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {layoutFilter}
              {/* Resume Capsule */}
              {resume && (
                <div className="ah-resume-card" onClick={resume.onResume}>
                  <TrackCover src={resume.coverUrl} path={resume.coverPath} size={56} radius={10} />
                  <div className="ah-resume-meta">
                    <div className="ah-resume-kicker">Resume · {resume.positionLabel}</div>
                    <div className="ah-resume-title">{resume.title}</div>
                    <div className="ah-resume-sub">{resume.artist}</div>
                  </div>
                  <PlayButton size={38} onClick={resume.onResume} />
                  <button className="ah-resume-x" onClick={e => { e.stopPropagation(); resume.onDismiss(); }} title="Dismiss">×</button>
                </div>
              )}
            </div>
          </div>

          {/* Pill Search */}
          <div className="ah-stage-search">
            <AideoSearchBar variant="pill" props={search} />
          </div>

          {/* ── AMBIENT MOOD SELECTOR BAR ── */}
          <nav className="ah-stage-mood-bar" aria-label="Ambient Moods">
            {AMBIENT_MOODS.map(mood => {
              const Icon = mood.icon;
              const isActive = activeMood === mood.id;
              return (
                <button
                  key={mood.id}
                  type="button"
                  className={`ah-mood-pill ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveMood(mood.id)}
                  style={{ '--mood-color': mood.color } as any}
                >
                  <Icon size={13} className="ah-mood-icon" />
                  <span>{mood.label}</span>
                </button>
              );
            })}
          </nav>

          {/* ── FLOATING GLASS SOUNDSTAGE (CENTERPIECE) ── */}
          {!isLoadingRecs && spotlightTrack && (
            <div className="ah-soundstage-centerpiece" onClick={() => onPlayTrack(spotlightTrack)}>
              <div className="ah-soundstage-art-wrap">
                <TrackCover
                  src={spotlightTrack.cover_url}
                  path={spotlightTrack.path || spotlightTrack.url}
                  title={spotlightTrack.title}
                  artist={spotlightTrack.artist}
                  size={120}
                  radius={16}
                />
                <div className="ah-soundstage-vinyl-orbit">
                  <Disc size={96} className="ah-orbit-disc" />
                </div>
              </div>
              <div className="ah-soundstage-meta">
                <div className="ah-soundstage-badge">
                  <Sparkles size={12} />
                  <span>NOW STAGED SPOTLIGHT</span>
                </div>
                <h2 className="ah-soundstage-title">
                  Staged Spotlight: {spotlightTrack.title}
                </h2>
                <div className="ah-soundstage-artist">{spotlightTrack.artist}</div>
                <div className="ah-soundstage-aura-line">Immersive acoustic presence · Resonating on current stage</div>
              </div>
              <div className="ah-soundstage-action">
                <button
                  type="button"
                  className="ah-soundstage-play-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayTrack(spotlightTrack);
                  }}
                >
                  <Play size={18} fill="currentColor" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── STAGE CONTENT: GROUPED DISCOVERY & RECENT STRIP ── */}
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
              <div key={g.id} className="ah-stage-group-section">
                <div className="ah-group-label">
                  <i style={{ background: SHELVES[g.id].color }} />
                  {SHELVES[g.id].label}
                </div>
                <div className="ah-grid2">
                  {g.items.map(item => (
                    <div key={item.track.id} className="ah-row ah-stage-glass-row" onClick={() => onPlayTrack(item.track)}>
                      <TrackCover
                        src={item.track.cover_url}
                        path={item.track.path || item.track.url}
                        title={item.track.title}
                        artist={item.track.artist}
                        size={52}
                        radius={10}
                      />
                      <div className="ah-row-meta">
                        <div className="ah-row-title" title={item.track.title}>{item.track.title}</div>
                        <div className="ah-row-artist" title={item.track.artist}>{item.track.artist}</div>
                        <SongSources track={item.track} />
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
          <section className="ah-section ah-stage-history-section">
            <div className="ah-section-head">
              <div><h2>Recently played</h2></div>
            </div>
            <div className="ah-strip">
              {history.map(t => (
                <div key={t.id} className="ah-hist ah-stage-hist" onClick={() => onPlayTrack(t)}>
                  <div className="ah-stage-hist-art">
                    <TrackCover src={t.cover_url} path={t.path || t.url} title={t.title} artist={t.artist} size={132} radius={12} />
                    <PlayButton size={34} onClick={() => onPlayTrack(t)} />
                  </div>
                  <div className="ah-card-title" title={t.title}>{t.title}</div>
                  <div className="ah-card-artist" title={t.artist}>{t.artist}</div>
                  <SongSources track={t} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
