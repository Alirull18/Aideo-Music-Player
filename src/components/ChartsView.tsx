import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  Clock3,
  Globe2,
  ListMusic,
  Loader2,
  MapPin,
  Minus,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Tag,
  WifiOff,
} from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { useStore } from '../store';
import {
  buildChartRequest,
  chartEntryToTrack,
  formatChartCount,
  getPlayableChartEntries,
  mergeChartEntries,
  parseChartDuration,
  resolveChartArtwork,
  type ChartEntry,
  type ChartPage,
  type ChartScope,
  type ChartSource,
  type ListenBrainzRange,
} from '../utils/charts';
import './ChartsView.css';

const PAGE_SIZE = 20;
const CACHE_TTL_MS = 10 * 60 * 1000;
const SOURCE_ORDER: ChartSource[] = ['lastfm', 'billboard', 'listenbrainz'];
const chartCache = new Map<string, { page: ChartPage; savedAt: number }>();

const SOURCES: Array<{
  id: ChartSource;
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof Radio;
}> = [
  { id: 'lastfm', label: 'Last.fm', shortLabel: 'Listener momentum', description: 'Worldwide, genre, and country popularity from Last.fm listeners.', icon: Radio },
  { id: 'billboard', label: 'Billboard', shortLabel: 'Hot 100', description: 'The published United States Hot 100 singles ranking.', icon: BarChart3 },
  { id: 'listenbrainz', label: 'ListenBrainz', shortLabel: 'Open listens', description: 'Open, sitewide recording statistics across selectable time ranges.', icon: BrainCircuit },
];

const GENRES = ['pop', 'hip-hop', 'rock', 'electronic', 'k-pop', 'latin', 'r&b', 'indie'];
const COUNTRIES = [
  'Malaysia', 'United States', 'United Kingdom', 'Japan', 'South Korea',
  'Indonesia', 'Philippines', 'Singapore', 'Thailand', 'India', 'Australia',
  'Canada', 'Brazil', 'Mexico', 'Germany', 'France', 'Italy', 'Netherlands',
  'Spain', 'Sweden',
];
const RANGES: Array<{ id: ListenBrainzRange; label: string }> = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
  { id: 'all_time', label: 'All time' },
];

function dispatchToast(message: string, type: 'info' | 'success' | 'error'): void {
  window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message, type } }));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getStoredSource(): ChartSource {
  const stored = localStorage.getItem('aideo-charts-source');
  return SOURCE_ORDER.includes(stored as ChartSource) ? stored as ChartSource : 'lastfm';
}

function formatUpdatedAt(value: string | null): string | null {
  if (!value) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 1_000_000 ? new Date(numeric * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function MovementIndicator({ entry }: { entry: ChartEntry }) {
  const previousRank = entry.previous_rank;
  if (previousRank === null) return <span className="charts-movement is-new">NEW</span>;
  if (previousRank > entry.rank) {
    return <span className="charts-movement is-up" aria-label={`Up ${previousRank - entry.rank} places`}><ArrowUpRight aria-hidden="true" />{previousRank - entry.rank}</span>;
  }
  if (previousRank < entry.rank) {
    return <span className="charts-movement is-down" aria-label={`Down ${entry.rank - previousRank} places`}><ArrowDownRight aria-hidden="true" />{entry.rank - previousRank}</span>;
  }
  return <span className="charts-movement is-steady" aria-label="No rank change"><Minus aria-hidden="true" /></span>;
}

function ChartArtwork({ entry, featured = false }: { entry: ChartEntry; featured?: boolean }) {
  const artwork = resolveChartArtwork(entry) ?? defaultCover;
  return (
    <div className={featured ? 'charts-artwork is-featured' : 'charts-artwork'}>
      <img
        src={artwork}
        alt={`Cover art for ${entry.title}`}
        loading={featured ? 'eager' : 'lazy'}
        decoding="async"
        onError={(event) => { event.currentTarget.src = defaultCover; }}
      />
    </div>
  );
}

function ProviderTabs({ value, onChange }: { value: ChartSource; onChange: (source: ChartSource) => void }) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = SOURCE_ORDER.indexOf(value);
    if (event.key === 'Home') return onChange(SOURCE_ORDER[0]);
    if (event.key === 'End') return onChange(SOURCE_ORDER[SOURCE_ORDER.length - 1]);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    onChange(SOURCE_ORDER[(currentIndex + direction + SOURCE_ORDER.length) % SOURCE_ORDER.length]);
  };

  return (
    <div className="charts-provider-tabs" role="tablist" aria-label="Chart provider" onKeyDown={handleKeyDown}>
      {SOURCES.map((source) => {
        const Icon = source.icon;
        const selected = value === source.id;
        return (
          <button
            key={source.id}
            id={`chart-tab-${source.id}`}
            className="charts-provider-tab"
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(source.id)}
          >
            <Icon aria-hidden="true" /><span>{source.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChartRow({ entry, isPlaying, onPlay, onQueue }: {
  entry: ChartEntry;
  isPlaying: boolean;
  onPlay: (entry: ChartEntry) => void;
  onQueue: (entry: ChartEntry) => void;
}) {
  const playbackTrack = entry.playback_track;
  const metric = entry.listen_count !== null
    ? `${formatChartCount(entry.listen_count)} plays`
    : entry.weeks_on_chart !== null
      ? `${entry.weeks_on_chart} wk${entry.weeks_on_chart === 1 ? '' : 's'}`
      : 'Published rank';

  return (
    <li className={`charts-row${isPlaying ? ' is-playing' : ''}${playbackTrack ? '' : ' is-unavailable'}`}>
      <div className="charts-row-rank" aria-label={`Rank ${entry.rank}`}><span>{String(entry.rank).padStart(2, '0')}</span><MovementIndicator entry={entry} /></div>
      <ChartArtwork entry={entry} />
      <div className="charts-row-title"><strong>{entry.title}</strong><span>{entry.artist}</span></div>
      <span className="charts-row-metric">{metric}</span>
      <span className="charts-row-duration">{playbackTrack?.duration_raw ?? '—'}</span>
      <div className="charts-row-actions">
        <button
          className="charts-icon-button"
          type="button"
          aria-label={playbackTrack ? `Play ${entry.title}` : `Playback unavailable for ${entry.title}`}
          title={playbackTrack ? `Play ${entry.title}` : 'No reliable playback match found'}
          disabled={!playbackTrack}
          onClick={() => onPlay(entry)}
        >
          {isPlaying ? <span className="charts-playing-bars" aria-hidden="true"><i /><i /><i /></span> : <Play aria-hidden="true" />}
        </button>
        <button className="charts-icon-button charts-queue-button" type="button" aria-label={`Add ${entry.title} to queue`} title="Add to queue" disabled={!playbackTrack} onClick={() => onQueue(entry)}>
          <Plus aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function ChartsSkeleton() {
  return (
    <div className="charts-skeleton" aria-label="Loading chart ranks" aria-busy="true">
      <div className="charts-skeleton-feature" />
      <div className="charts-skeleton-ledger">{Array.from({ length: 7 }, (_, index) => <div key={index} />)}</div>
    </div>
  );
}

export function ChartsView() {
  const playStream = useStore((state) => state.playStream);
  const addToQueue = useStore((state) => state.addToQueue);
  const currentTrackPath = useStore((state) => state.currentTrack?.path ?? null);
  const [source, setSource] = useState<ChartSource>(getStoredSource);
  const [scope, setScope] = useState<ChartScope>('global');
  const [genre, setGenre] = useState('pop');
  const [country, setCountry] = useState('Malaysia');
  const [range, setRange] = useState<ListenBrainzRange>('week');
  const [page, setPage] = useState<ChartPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [queueProgress, setQueueProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const requestSequence = useRef(0);
  const selectedSource = SOURCES.find((item) => item.id === source) ?? SOURCES[0];
  const cacheKey = `${source}:${scope}:${genre}:${country}:${range}`;

  const requestPage = useCallback(async (isManualRefresh = false) => {
    const sequence = ++requestSequence.current;
    const cached = chartCache.get(cacheKey);
    if (cached && !isManualRefresh) {
      setPage(cached.page);
      setLoading(false);
      setRefreshing(Date.now() - cached.savedAt > CACHE_TTL_MS);
    } else {
      setLoading(true);
      setRefreshing(isManualRefresh);
    }
    setError(null);

    try {
      const nextPage = await invoke<ChartPage>('get_worldwide_leaderboard', buildChartRequest({ source, scope, genre, country, range, offset: 0, limit: PAGE_SIZE }));
      if (sequence !== requestSequence.current) return;
      chartCache.set(cacheKey, { page: nextPage, savedAt: Date.now() });
      setPage(nextPage);
    } catch (requestError) {
      if (sequence !== requestSequence.current) return;
      setError(getErrorMessage(requestError));
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [cacheKey, country, genre, range, scope, source]);

  useEffect(() => { void requestPage(); }, [requestPage]);
  useEffect(() => {
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  const entries = page?.entries ?? [];
  const featured = entries[0] ?? null;
  const rankedEntries = entries.slice(1);
  const playableEntries = useMemo(() => getPlayableChartEntries(entries), [entries]);

  const changeSource = (nextSource: ChartSource) => {
    if (nextSource === source) return;
    localStorage.setItem('aideo-charts-source', nextSource);
    setSource(nextSource);
    setPage(null);
    setError(null);
  };

  const changeScope = (nextScope: ChartScope) => { setScope(nextScope); setPage(null); };

  const handlePlay = async (entry: ChartEntry): Promise<boolean> => {
    const playbackTrack = entry.playback_track;
    if (!playbackTrack) return false;
    try {
      await playStream(playbackTrack.url, {
        title: entry.title,
        artist: entry.artist,
        cover_url: resolveChartArtwork(entry) ?? playbackTrack.cover_url,
        duration: parseChartDuration(playbackTrack.duration_raw),
      });
      return true;
    } catch (playbackError) {
      dispatchToast(`Couldn't play ${entry.title}: ${getErrorMessage(playbackError)}`, 'error');
      return false;
    }
  };

  const handleQueue = async (entry: ChartEntry) => {
    const track = chartEntryToTrack(entry);
    if (!track) return;
    try {
      await addToQueue(track);
      dispatchToast(`Added to queue: ${entry.title}`, 'success');
    } catch (queueError) {
      dispatchToast(`Couldn't queue ${entry.title}: ${getErrorMessage(queueError)}`, 'error');
    }
  };

  const handlePlayChart = async () => {
    if (playableEntries.length === 0 || queueing) return;
    setQueueing(true);
    let queued = 0;
    let failed = 0;
    try {
      setQueueProgress(`Starting 1 of ${playableEntries.length}`);
      const started = await handlePlay(playableEntries[0]);
      for (let index = 1; index < playableEntries.length; index += 1) {
        setQueueProgress(`Queueing ${index + 1} of ${playableEntries.length}`);
        const track = chartEntryToTrack(playableEntries[index]);
        if (!track) continue;
        try { await addToQueue(track); queued += 1; } catch { failed += 1; }
      }
      const unavailable = entries.length - playableEntries.length;
      const summary = [started ? 'Playing 1' : 'Playback failed', `${queued} queued`];
      if (unavailable > 0) summary.push(`${unavailable} unavailable`);
      if (failed > 0) summary.push(`${failed} failed`);
      dispatchToast(summary.join(' · '), failed > 0 || !started ? 'info' : 'success');
    } finally {
      setQueueProgress('');
      setQueueing(false);
    }
  };

  const handleLoadMore = async () => {
    if (!page || loadingMore || !page.has_more) return;
    const sequence = ++requestSequence.current;
    setLoadingMore(true);
    try {
      const nextPage = await invoke<ChartPage>('get_worldwide_leaderboard', buildChartRequest({ source, scope, genre, country, range, offset: page.offset + page.entries.length, limit: PAGE_SIZE }));
      if (sequence !== requestSequence.current) return;
      const mergedPage = { ...nextPage, offset: page.offset, entries: mergeChartEntries(page.entries, nextPage.entries) };
      chartCache.set(cacheKey, { page: mergedPage, savedAt: Date.now() });
      setPage(mergedPage);
    } catch (requestError) {
      if (sequence !== requestSequence.current) return;
      dispatchToast(`Couldn't load more ranks: ${getErrorMessage(requestError)}`, 'error');
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false);
    }
  };

  const formattedUpdate = page ? formatUpdatedAt(page.updated_at) : null;

  return (
    <div className="charts-page" role="region" aria-labelledby="charts-title">
      <div className="charts-shell">
        <header className="charts-header">
          <div className="charts-heading">
            <h1 id="charts-title">Top charts</h1>
            <p>Published rank first. Reliable playback where Aideo can find it.</p>
          </div>
          <ProviderTabs value={source} onChange={changeSource} />
        </header>

        <section className="charts-context" aria-label="Chart controls">
          <div className="charts-context-source">
            <selectedSource.icon aria-hidden="true" />
            <span><strong>{selectedSource.shortLabel}</strong>{selectedSource.description}</span>
          </div>

          {source === 'lastfm' && (
            <div className="charts-filter-group">
              <div className="charts-segmented" aria-label="Last.fm chart scope">
                {(['global', 'genre', 'country'] as ChartScope[]).map((option) => (
                  <button key={option} type="button" aria-pressed={scope === option} onClick={() => changeScope(option)}>
                    {option === 'global' && <Globe2 aria-hidden="true" />}
                    {option === 'genre' && <Tag aria-hidden="true" />}
                    {option === 'country' && <MapPin aria-hidden="true" />}
                    {option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
              {scope === 'genre' && (
                <label className="charts-select"><span>Genre</span><select value={genre} onChange={(event) => { setGenre(event.target.value); setPage(null); }}>{GENRES.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}</select></label>
              )}
              {scope === 'country' && (
                <label className="charts-select"><span>Country</span><select value={country} onChange={(event) => { setCountry(event.target.value); setPage(null); }}>{COUNTRIES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
              )}
            </div>
          )}

          {source === 'listenbrainz' && (
            <div className="charts-segmented charts-range" aria-label="ListenBrainz range">
              {RANGES.map((option) => <button key={option.id} type="button" aria-pressed={range === option.id} onClick={() => { setRange(option.id); setPage(null); }}>{option.label}</button>)}
            </div>
          )}
          {source === 'billboard' && <div className="charts-fixed-scope"><MapPin aria-hidden="true" /> United States · weekly</div>}
          <button className="charts-refresh-button" type="button" onClick={() => void requestPage(true)} disabled={loading || refreshing}>
            <RefreshCw className={refreshing ? 'is-spinning' : ''} aria-hidden="true" />{refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </section>

        {!isOnline && <div className="charts-notice is-offline" role="status"><WifiOff aria-hidden="true" />Offline. Cached chart ranks remain available; playback may fail until you're connected.</div>}
        {page?.fallback && <div className="charts-notice is-warning" role="status"><AlertTriangle aria-hidden="true" /><span><strong>Source changed for this view.</strong>{page.fallback.message}</span></div>}
        {error && page && <div className="charts-notice is-warning" role="status"><AlertTriangle aria-hidden="true" /><span><strong>Showing saved ranks.</strong>The latest refresh failed: {error}</span></div>}

        {error && !page && (
          <section className="charts-state" role="alert"><AlertTriangle aria-hidden="true" /><h2>Chart signal unavailable</h2><p>We couldn't reach {selectedSource.label}. Check your connection, then try again.</p><button type="button" onClick={() => void requestPage(true)}>Try again</button><small>{error}</small></section>
        )}
        {loading && !page && <ChartsSkeleton />}
        {!loading && !error && page && entries.length === 0 && <section className="charts-state"><ListMusic aria-hidden="true" /><h2>No ranks in this view</h2><p>Choose a different scope or refresh the current source.</p></section>}

        {page && featured && (
          <>
            <div className="charts-data-line">
              <div><span>{page.source_label}</span><strong>{page.scope_label}</strong><span>{page.period_label}</span></div>
              <div>
                {refreshing && <span className="charts-live-status"><Loader2 className="is-spinning" aria-hidden="true" /> Updating ranks</span>}
                {formattedUpdate && <span><Clock3 aria-hidden="true" /> Updated {formattedUpdate}</span>}
                <span>{page.total ? `${page.total} published positions` : `${entries.length}${page.has_more ? '+' : ''} positions loaded`}</span>
              </div>
            </div>

            <section className="charts-board" aria-label={`${page.source_label} ${page.scope_label} ranking`}>
              <article className="charts-number-one">
                <div className="charts-number-one-art"><ChartArtwork entry={featured} featured /><span>NO. 01</span></div>
                <div className="charts-number-one-copy">
                  <span className="charts-number-one-label">CURRENT LEADER</span><h2>{featured.title}</h2><p>{featured.artist}</p>
                  <div className="charts-number-one-facts">
                    <MovementIndicator entry={featured} />
                    {featured.listen_count !== null && <span>{formatChartCount(featured.listen_count)} plays</span>}
                    {featured.weeks_on_chart !== null && <span>{featured.weeks_on_chart} weeks charting</span>}
                    {!featured.playback_track && <span className="is-unavailable">Playback match unavailable</span>}
                  </div>
                  <div className="charts-number-one-actions">
                    <button className="charts-primary-button" type="button" disabled={!featured.playback_track || queueing} aria-label={featured.playback_track ? `Play ${featured.title}` : `Playback unavailable for ${featured.title}`} onClick={() => void handlePlay(featured)}><Play aria-hidden="true" /> Play number one</button>
                    <button className="charts-secondary-button" type="button" disabled={playableEntries.length === 0 || queueing} onClick={() => void handlePlayChart()}>{queueing ? <Loader2 className="is-spinning" aria-hidden="true" /> : <ListMusic aria-hidden="true" />}{queueing ? queueProgress : `Play chart · ${playableEntries.length}`}</button>
                  </div>
                </div>
              </article>

              <div className="charts-ledger">
                <div className="charts-ledger-head" aria-hidden="true"><span>RANK</span><span>TRACK</span><span>SIGNAL</span><span>TIME</span><span>ACTION</span></div>
                {rankedEntries.length > 0 ? (
                  <ol start={rankedEntries[0].rank}>
                    {rankedEntries.map((entry) => <ChartRow key={entry.chart_id} entry={entry} isPlaying={entry.playback_track?.url === currentTrackPath} onPlay={(item) => void handlePlay(item)} onQueue={(item) => void handleQueue(item)} />)}
                  </ol>
                ) : <p className="charts-ledger-empty">This source returned one published position.</p>}
                {page.has_more && <button className="charts-load-more" type="button" disabled={loadingMore} onClick={() => void handleLoadMore()}>{loadingMore ? <Loader2 className="is-spinning" aria-hidden="true" /> : <Plus aria-hidden="true" />}{loadingMore ? 'Loading more ranks' : `Load positions ${entries.length + 1}–${entries.length + PAGE_SIZE}`}</button>}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
