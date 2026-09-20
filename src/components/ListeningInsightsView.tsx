import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { 
  Track, 
  ListeningInsightsPayload 
} from '../store/types';
import { invoke } from '@tauri-apps/api/core';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clock, PlayCircle, RefreshCw, BarChart3, Sparkles, Play, 
  History, Calendar, X, Music, AlertCircle, Headphones, Award,
  Disc, Zap, ShieldCheck, Radio
} from 'lucide-react';

const formatDuration = (secs: number) => {
  if (secs <= 0) return '0 mins';
  const hrs = Math.floor(secs / 3600);
  const mins = Math.round((secs % 3600) / 60);
  if (hrs > 0) {
    if (mins === 0) return `${hrs} hr${hrs > 1 ? 's' : ''}`;
    return `${hrs} hr${hrs > 1 ? 's' : ''} ${mins} min${mins > 1 ? 's' : ''}`;
  }
  return `${mins} min${mins > 1 ? 's' : ''}`;
};

const formatSampleRate = (rate: number) => {
  if (!rate || rate <= 0) return '44.1 kHz';
  if (rate >= 1000) {
    return `${(rate / 1000).toFixed(1)} kHz`;
  }
  return `${rate} Hz`;
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ListeningInsightsView() {
  const setView = useStore((s) => s.setView);
  const playTrack = useStore((s) => s.playTrack);
  const [range, setRange] = useState<'today' | 'last_7_days' | 'last_30_days' | 'all_time'>('last_30_days');
  const [insights, setInsights] = useState<ListeningInsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wrappedActive, setWrappedActive] = useState(false);
  const [wrappedSlide, setWrappedSlide] = useState(0);

  // Timer reference for slide transitions
  const slideTimerRef = useRef<number | null>(null);
  const fetchSeq = useRef(0);

  const fetchInsights = async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<ListeningInsightsPayload>('get_listening_insights', { range });
      if (seq !== fetchSeq.current) return;
      setInsights(res);
    } catch (err: any) {
      if (seq !== fetchSeq.current) return;
      console.error(err);
      setError(err?.toString() || 'Failed to aggregate listening data.');
    } finally {
      if (seq === fetchSeq.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchInsights();
  }, [range]);

  // Handle Wrapped Auto-Advance (7 slides: indices 0..6)
  useEffect(() => {
    if (wrappedActive) {
      if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current);
      
      // Auto advance to next slide after 5 seconds, up to Slide 5 (index 5)
      if (wrappedSlide < 6) {
        slideTimerRef.current = window.setTimeout(() => {
          setWrappedSlide(prev => prev + 1);
        }, 5000);
      }
    } else {
      if (slideTimerRef.current) {
        window.clearTimeout(slideTimerRef.current);
        slideTimerRef.current = null;
      }
    }
    return () => {
      if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current);
    };
  }, [wrappedActive, wrappedSlide]);

  const handleSongPlay = (path: string, title: string, artist: string) => {
    const realTrack = useStore.getState().tracks.find(t => t.path === path);
    if (realTrack) {
      playTrack(realTrack);
    } else {
      const fallbackTrack: Track = {
        id: 0,
        path,
        title,
        artist,
        cover_url: null,
        loved: 0,
        disliked: 0,
        duration: null,
        format: 'FLAC',
        lyric_offset: 0,
      };
      playTrack(fallbackTrack);
    }
    setView('nowplaying');
  };

  // Music Personality Engine
  const getPersonality = () => {
    if (!insights || insights.total_plays === 0) {
      return { title: 'The Silent Observer', desc: 'You have not played enough music yet to discover your musical personality.' };
    }
    
    // 1. Audiophile check (over 70% bit-perfect or hi-res)
    if (insights.audiophile && (insights.audiophile.bit_perfect_rate > 70 || insights.audiophile.hires_count > insights.total_plays * 0.5)) {
      return {
        title: 'The Master Tape Purist',
        desc: 'You care deeply about bit-perfect fidelity and uncompromised dynamic range. Only the purest bitstreams grace your signal path.'
      };
    }

    // 2. Check skip rate
    if (insights.skip_rate > 35) {
      return { 
        title: 'The Impatient Explorer', 
        desc: 'You love discovering new music but move quickly when an intro fails to connect. On to the next sonic adventure.' 
      };
    }

    // 3. Check peak listening hours
    let maxHour = -1;
    let maxHourCount = -1;
    for (const h of insights.hourly_activity) {
      if (h.play_count > maxHourCount) {
        maxHourCount = h.play_count;
        maxHour = h.hour;
      }
    }

    if (maxHour >= 22 || maxHour <= 4) {
      return { 
        title: 'The Midnight Wanderer', 
        desc: 'Your music tastes peak when the world goes quiet. Late-night synths, lo-fi beats, or cozy acoustic tracks are your comfort zone.' 
      };
    } else if (maxHour >= 5 && maxHour <= 9) {
      return { 
        title: 'The Sunriser', 
        desc: 'You wake up with the sun and lock into high-energy beats immediately. Music is your fuel to conquer the morning.' 
      };
    }

    // 4. Stan check (more than 40% of total plays is the top artist)
    if (insights.top_artists.length > 0 && insights.total_plays > 5) {
      const topArtist = insights.top_artists[0];
      const ratio = topArtist.play_count / insights.total_plays;
      if (ratio > 0.4) {
        return { 
          title: `The ${topArtist.artist} Devotee`, 
          desc: `You find an artist you love and you stay locked in. You accounted for ${Math.round(ratio * 100)}% of your plays listening to ${topArtist.artist}.` 
        };
      }
    }

    // 5. Default
    return { 
      title: 'The Deep Listener', 
      desc: 'A balanced scrobbler. You explore multiple genres, split your listening times evenly, and give every track a fair chance.' 
    };
  };

  const personality = getPersonality();

  // Find Peak Listening Hour String
  const getPeakListeningHour = () => {
    if (!insights || insights.hourly_activity.length === 0) return 'N/A';
    let maxHour = -1;
    let maxHourCount = -1;
    for (const h of insights.hourly_activity) {
      if (h.play_count > maxHourCount) {
        maxHourCount = h.play_count;
        maxHour = h.hour;
      }
    }
    if (maxHour === -1) return 'N/A';
    const ampm = maxHour >= 12 ? 'PM' : 'AM';
    const displayHour = maxHour % 12 === 0 ? 12 : maxHour % 12;
    return `${displayHour}:00 ${ampm}`;
  };

  const startWrapped = () => {
    setWrappedSlide(0);
    setWrappedActive(true);

    // Auto play the top song if available when entering Wrapped
    if (insights && insights.top_songs.length > 0) {
      const top = insights.top_songs[0];
      const realTrack = useStore.getState().tracks.find(t => t.path === top.track_path);
      if (realTrack) {
        playTrack(realTrack);
      } else {
        const fallbackTrack: Track = {
          id: 0,
          path: top.track_path,
          title: top.title,
          artist: top.artist,
          cover_url: null,
          loved: 0,
          disliked: 0,
          duration: null,
          format: 'FLAC',
          lyric_offset: 0,
        };
        playTrack(fallbackTrack);
      }
    }
  };

  return (
    <div className="insights-view-wrap" data-scroll-container="true">
      {/* Header */}
      <div className="insights-header">
        <h1 className="insights-main-title">Aideo Insights</h1>
        <p className="insights-main-subtitle">Your personal scrobbler and telemetry dashboard, computed completely locally.</p>
      </div>

      {/* Date Filter & Wrapped Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
        <div className="insights-range-selector">
          <button className={`insights-range-btn ${range === 'today' ? 'active' : ''}`} onClick={() => setRange('today')}>Today</button>
          <button className={`insights-range-btn ${range === 'last_7_days' ? 'active' : ''}`} onClick={() => setRange('last_7_days')}>7 Days</button>
          <button className={`insights-range-btn ${range === 'last_30_days' ? 'active' : ''}`} onClick={() => setRange('last_30_days')}>30 Days</button>
          <button className={`insights-range-btn ${range === 'all_time' ? 'active' : ''}`} onClick={() => setRange('all_time')}>All Time</button>
        </div>

        {insights && insights.total_plays > 0 && (
          <button className="settings-btn settings-btn-primary" onClick={startWrapped} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 12 }}>
            <Sparkles size={14} />
            <span>Generate Wrapped</span>
          </button>
        )}
      </div>

      {/* Loading/Error states */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', color: 'var(--text-dim)' }}>
          <History size={40} className="spin-slow" style={{ marginBottom: 12 }} />
          <span>Aggregating your local playback logs...</span>
        </div>
      )}

      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>
          <AlertCircle size={40} style={{ color: '#f43f5e', marginBottom: 12 }} />
          <h3>Database Query Failed</h3>
          <p style={{ maxWidth: 400, fontSize: 12 }}>{error}</p>
        </div>
      )}

      {/* Main dashboard content */}
      {!loading && !error && insights && (
        insights.total_plays === 0 ? (
          <div className="insights-empty">
            <Headphones size={48} style={{ opacity: 0.4 }} />
            <h3>Your play log is empty</h3>
            <p style={{ maxWidth: 360, fontSize: 12, margin: '8px auto 16px', lineHeight: 1.5 }}>
              We keep track of your plays, skipped tracks, and total minutes automatically. Play a few songs from your Library to populate your dashboard!
            </p>
            <button className="btn btn-primary" onClick={() => setView('library')} style={{ padding: '8px 18px', fontSize: 12 }}>
              Go to Library
            </button>
          </div>
        ) : (
          <div>
            {/* Core Metrics Grid */}
            <div className="insights-metrics-grid">
              <div className="insights-metric-card">
                <div className="insights-metric-icon-wrap">
                  <Clock size={20} />
                </div>
                <div className="insights-metric-info">
                  <div className="insights-metric-label">Listening Time</div>
                  <div className="insights-metric-value">{formatDuration(insights.total_listening_time_secs)}</div>
                </div>
              </div>

              <div className="insights-metric-card">
                <div className="insights-metric-icon-wrap">
                  <PlayCircle size={20} />
                </div>
                <div className="insights-metric-info">
                  <div className="insights-metric-label">Tracks Played</div>
                  <div className="insights-metric-value">{insights.total_plays}</div>
                </div>
              </div>

              <div className="insights-metric-card">
                <div className="insights-metric-icon-wrap">
                  <RefreshCw size={20} />
                </div>
                <div className="insights-metric-info">
                  <div className="insights-metric-label">Skip Rate</div>
                  <div className="insights-metric-value">{insights.skip_rate.toFixed(1)}%</div>
                </div>
              </div>

              <div className="insights-metric-card">
                <div className="insights-metric-icon-wrap">
                  <ShieldCheck size={20} />
                </div>
                <div className="insights-metric-info">
                  <div className="insights-metric-label">Bit-Perfect Share</div>
                  <div className="insights-metric-value">{insights.audiophile?.bit_perfect_rate.toFixed(1) || 0}%</div>
                </div>
              </div>

              <div className="insights-metric-card">
                <div className="insights-metric-icon-wrap">
                  <Calendar size={20} />
                </div>
                <div className="insights-metric-info">
                  <div className="insights-metric-label">Peak Hour</div>
                  <div className="insights-metric-value">{getPeakListeningHour()}</div>
                </div>
              </div>
            </div>

            {/* Widget layout grids */}
            <div className="insights-two-col">
              {/* Left column: Top Songs */}
              <div className="insights-widget-card">
                <h3 className="insights-widget-title">
                  <Music size={16} className="text-accent" />
                  <span>Top Songs</span>
                </h3>
                <div className="insights-list">
                  {insights.top_songs.map((song, idx) => (
                    <div key={idx} className="insights-list-item">
                      <div className="insights-item-media">
                        <div className="insights-item-rank">{idx + 1}</div>
                        <div className="insights-item-info">
                          <div className="insights-item-name">{song.title}</div>
                          <div className="insights-item-sub">{song.artist}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <button 
                          className="insights-item-play-btn"
                          onClick={() => handleSongPlay(song.track_path, song.title, song.artist)}
                          title="Play Track"
                        >
                          <Play size={12} fill="white" color="white" />
                        </button>
                        <div className="insights-item-stat">{song.play_count} plays</div>
                      </div>
                    </div>
                  ))}
                  {insights.top_songs.length === 0 && (
                    <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 10 }}>No song metadata found.</div>
                  )}
                </div>
              </div>

              {/* Right column: Top Artists & Top Albums */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {/* Top Artists */}
                <div className="insights-widget-card" style={{ flex: 1 }}>
                  <h3 className="insights-widget-title">
                    <Headphones size={16} className="text-accent" />
                    <span>Top Artists</span>
                  </h3>
                  <div className="insights-list">
                    {insights.top_artists.map((art, idx) => (
                      <div key={idx} className="insights-list-item">
                        <div className="insights-item-media">
                          <div className="insights-item-rank">{idx + 1}</div>
                          <div className="insights-item-name">{art.artist}</div>
                        </div>
                        <div className="insights-item-stat">{art.play_count} plays</div>
                      </div>
                    ))}
                    {insights.top_artists.length === 0 && (
                      <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 10 }}>No artist metadata found.</div>
                    )}
                  </div>
                </div>

                {/* Top Albums */}
                <div className="insights-widget-card" style={{ flex: 1 }}>
                  <h3 className="insights-widget-title">
                    <Disc size={16} className="text-accent" />
                    <span>Top Albums</span>
                  </h3>
                  <div className="insights-list">
                    {insights.top_albums?.map((alb, idx) => (
                      <div key={idx} className="insights-list-item">
                        <div className="insights-item-media">
                          <div className="insights-item-rank">{idx + 1}</div>
                          {alb.cover_url ? (
                            <img 
                              src={alb.cover_url} 
                              alt={alb.album} 
                              className="insights-album-thumb"
                            />
                          ) : (
                            <div className="insights-album-thumb-placeholder">
                              <Disc size={14} />
                            </div>
                          )}
                          <div className="insights-item-info">
                            <div className="insights-item-name">{alb.album}</div>
                            <div className="insights-item-sub">{alb.artist}</div>
                          </div>
                        </div>
                        <div className="insights-item-stat">{alb.play_count} plays</div>
                      </div>
                    ))}
                    {(!insights.top_albums || insights.top_albums.length === 0) && (
                      <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 10 }}>No album metadata found.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Audiophile Telemetry & Source Distribution Grid */}
            <div className="insights-audiophile-grid">
              {/* Audiophile Quality Card */}
              <div className="insights-widget-card">
                <h3 className="insights-widget-title">
                  <Zap size={16} className="text-accent" />
                  <span>Audiophile Fidelity</span>
                </h3>
                <div className="insights-audio-metrics">
                  <div className="insights-audio-stat-block">
                    <span className="insights-audio-stat-val">{insights.audiophile?.hires_count || 0}</span>
                    <span className="insights-audio-stat-label">Hi-Res Plays</span>
                  </div>
                  <div className="insights-audio-stat-block">
                    <span className="insights-audio-stat-val">{insights.audiophile?.lossless_count || 0}</span>
                    <span className="insights-audio-stat-label">Lossless Plays</span>
                  </div>
                  <div className="insights-audio-stat-block">
                    <span className="insights-audio-stat-val">{insights.audiophile?.standard_count || 0}</span>
                    <span className="insights-audio-stat-label">Standard</span>
                  </div>
                  <div className="insights-audio-stat-block">
                    <span className="insights-audio-stat-val">{formatSampleRate(insights.audiophile?.avg_sample_rate || 0)}</span>
                    <span className="insights-audio-stat-label">Avg Sample Rate</span>
                  </div>
                </div>
                {insights.audiophile?.top_resolution && (
                  <div className="insights-resolution-badge">
                    <span>Highest Native Format:</span>
                    <strong>{insights.audiophile.top_resolution}</strong>
                  </div>
                )}
              </div>

              {/* Playback Source Distribution */}
              <div className="insights-widget-card">
                <h3 className="insights-widget-title">
                  <Radio size={16} className="text-accent" />
                  <span>Playback Sources</span>
                </h3>
                {(() => {
                  const rawSources = insights.sources;
                  const sourceDist = (insights as any).source_distribution;
                  let localCount = rawSources?.local_count ?? 0;
                  let tidalCount = rawSources?.tidal_count ?? 0;
                  let qobuzCount = rawSources?.qobuz_count ?? 0;
                  let webstreamCount = rawSources?.webstream_count ?? rawSources?.youtube_count ?? 0;

                  if (Array.isArray(sourceDist)) {
                    for (const item of sourceDist) {
                      const src = (item.source || '').toLowerCase();
                      if (src === 'local') localCount += item.play_count || 0;
                      else if (src === 'tidal') tidalCount += item.play_count || 0;
                      else if (src === 'qobuz') qobuzCount += item.play_count || 0;
                      else if (src === 'youtube' || src === 'webstream') webstreamCount += item.play_count || 0;
                    }
                  }

                  const total = (localCount + tidalCount + qobuzCount + webstreamCount) || 1;
                  const localPct = (localCount / total) * 100;
                  const tidalPct = (tidalCount / total) * 100;
                  const qobuzPct = (qobuzCount / total) * 100;
                  const webstreamPct = (webstreamCount / total) * 100;

                  return (
                    <div>
                      <div className="insights-source-bar-track">
                        {localPct > 0 && <div className="insights-source-segment local" style={{ width: `${localPct}%` }} title={`Local: ${localCount}`} />}
                        {tidalPct > 0 && <div className="insights-source-segment tidal" style={{ width: `${tidalPct}%` }} title={`Tidal: ${tidalCount}`} />}
                        {qobuzPct > 0 && <div className="insights-source-segment qobuz" style={{ width: `${qobuzPct}%` }} title={`Qobuz: ${qobuzCount}`} />}
                        {webstreamPct > 0 && <div className="insights-source-segment webstream youtube" style={{ width: `${webstreamPct}%` }} title={`Webstream: ${webstreamCount}`} />}
                      </div>
                      <div className="insights-source-legend">
                        <div className="insights-source-pill">
                          <span className="source-dot local" />
                          <span>Local: <strong>{localCount}</strong></span>
                        </div>
                        <div className="insights-source-pill">
                          <span className="source-dot tidal" />
                          <span>Tidal: <strong>{tidalCount}</strong></span>
                        </div>
                        <div className="insights-source-pill">
                          <span className="source-dot qobuz" />
                          <span>Qobuz: <strong>{qobuzCount}</strong></span>
                        </div>
                        <div className="insights-source-pill">
                          <span className="source-dot webstream youtube" />
                          <span>Webstream: <strong>{webstreamCount}</strong></span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Genre Breakdown & Hourly / Daily Activity */}
            <div className="insights-bottom-grid">
              {/* Top Genres */}
              <div className="insights-widget-card">
                <h3 className="insights-widget-title">
                  <Award size={16} className="text-accent" />
                  <span>Genre Breakdown</span>
                </h3>
                <div>
                  {insights.top_genres.map((g, idx) => {
                    const maxPlays = insights.top_genres[0]?.play_count || 1;
                    const percentage = (g.play_count / maxPlays) * 100;
                    return (
                      <div key={idx} className="insights-genre-row">
                        <div className="insights-genre-meta">
                          <span>{g.genre}</span>
                          <span>{g.play_count} plays</span>
                        </div>
                        <div className="insights-genre-bar-track">
                          <div className="insights-genre-bar-fill" style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {insights.top_genres.length === 0 && (
                    <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 10 }}>No genre tags loaded.</div>
                  )}
                </div>
              </div>

              {/* Hourly Chart */}
              <div className="insights-widget-card">
                <h3 className="insights-widget-title">
                  <Clock size={16} className="text-accent" />
                  <span>Hourly Listening Peaks</span>
                </h3>
                <div className="svg-chart-container">
                  <svg width="100%" height="100%" viewBox="0 0 540 140" style={{ overflow: 'visible' }}>
                    <line x1="40" y1="20" x2="520" y2="20" className="svg-grid-line" />
                    <line x1="40" y1="60" x2="520" y2="60" className="svg-grid-line" />
                    <line x1="40" y1="100" x2="520" y2="100" className="svg-grid-line" />
                    <line x1="40" y1="110" x2="520" y2="110" className="svg-axis-line" />

                    {Array.from({ length: 24 }).map((_, hour) => {
                      const match = insights.hourly_activity.find(h => h.hour === hour);
                      const val = match ? match.play_count : 0;
                      const maxVal = Math.max(...insights.hourly_activity.map(h => h.play_count), 1);
                      const barHeight = (val / maxVal) * 80;
                      const x = 40 + hour * 20;
                      const y = 110 - barHeight;

                      return (
                        <g key={hour}>
                          <rect 
                            x={x} 
                            y={y} 
                            width="12" 
                            height={Math.max(barHeight, 1)} 
                            rx="2"
                            className="svg-bar"
                          >
                            <title>{`${hour}:00: ${val} plays`}</title>
                          </rect>
                          {hour % 4 === 0 && (
                            <text x={x + 6} y="125" className="svg-text" textAnchor="middle">{hour}</text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Weekly Activity */}
              <div className="insights-widget-card">
                <h3 className="insights-widget-title">
                  <BarChart3 size={16} className="text-accent" />
                  <span>Weekly Heatmap</span>
                </h3>
                <div className="svg-chart-container">
                  <svg width="100%" height="100%" viewBox="0 0 340 140" style={{ overflow: 'visible' }}>
                    <line x1="40" y1="20" x2="320" y2="20" className="svg-grid-line" />
                    <line x1="40" y1="60" x2="320" y2="60" className="svg-grid-line" />
                    <line x1="40" y1="100" x2="320" y2="100" className="svg-grid-line" />
                    <line x1="40" y1="110" x2="320" y2="110" className="svg-axis-line" />

                    {DAY_LABELS.map((label, dayIdx) => {
                      const match = insights.daily_activity.find(d => d.day === dayIdx);
                      const val = match ? match.play_count : 0;
                      const maxVal = Math.max(...insights.daily_activity.map(d => d.play_count), 1);
                      const barHeight = (val / maxVal) * 80;
                      const x = 46 + dayIdx * 38;
                      const y = 110 - barHeight;

                      return (
                        <g key={dayIdx}>
                          <rect 
                            x={x} 
                            y={y} 
                            width="20" 
                            height={Math.max(barHeight, 1)} 
                            rx="3"
                            className="svg-bar"
                          >
                            <title>{`${label}: ${val} plays`}</title>
                          </rect>
                          <text x={x + 10} y="125" className="svg-text" textAnchor="middle">{label}</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {/* Spotify Wrapped Slide Deck Overlay */}
      <AnimatePresence>
        {wrappedActive && (
          <motion.div 
            className="wrapped-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Ambient Background */}
            <div className="wrapped-ambient-bg" />

            {/* Exit button */}
            <button className="wrapped-close-btn" onClick={() => setWrappedActive(false)} title="Close Wrapped">
              <X size={20} />
            </button>

            {/* Card Deck */}
            <div className="wrapped-card-container">
              {/* Progress segments indicator (7 slides) */}
              <div className="wrapped-progress-bar">
                {Array.from({ length: 7 }).map((_, stepIdx) => {
                  let fillClass = '';
                  if (stepIdx < wrappedSlide) fillClass = 'completed';
                  else if (stepIdx === wrappedSlide) fillClass = 'active';

                  return (
                    <div key={stepIdx} className="wrapped-progress-step">
                      <div className={`wrapped-progress-fill ${fillClass}`} />
                    </div>
                  );
                })}
              </div>

              {/* Navigation overlays */}
              <div className="wrapped-nav-overlay-left" onClick={() => setWrappedSlide(prev => Math.max(prev - 1, 0))} />
              <div className="wrapped-nav-overlay-right" onClick={() => setWrappedSlide(prev => Math.min(prev + 1, 6))} />

              {/* Slide content stage */}
              <div className="wrapped-slide-content" data-testid="wrapped-slide-stage" data-slide={wrappedSlide}>
                <AnimatePresence>
                  {wrappedSlide === 0 && (
                    <motion.div 
                      key="s0"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                      style={{ textAlign: 'center' }}
                    >
                      <Sparkles size={48} style={{ color: 'var(--accent)', margin: '0 auto 20px' }} />
                      <h2 style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.5, lineHeight: 1.2 }}>
                        Your Sound Profile<br />on Aideo
                      </h2>
                      <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 14 }}>
                        A private look at your listening habits, high-fidelity statistics, and sonic footprint.
                      </p>
                      <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', fontWeight: 800, marginTop: 40, letterSpacing: 1.5 }}>
                        Click right side of card to advance
                      </div>
                    </motion.div>
                  )}

                  {wrappedSlide === 1 && (
                    <motion.div 
                      key="s1"
                      initial={{ opacity: 0, x: 50 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -50 }}
                      transition={{ duration: 0.3 }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>The Stats</span>
                      <h2 style={{ fontSize: 26, fontWeight: 900, marginTop: 10, letterSpacing: -0.5 }}>You lived inside the music.</h2>
                      <div className="wrapped-big-number">
                        {Math.round(insights!.total_listening_time_secs / 60)}
                      </div>
                      <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        total minutes of playback recorded locally. That represents {insights!.total_plays} individual plays with an intentional skip rate of {insights!.skip_rate.toFixed(0)}%.
                      </p>
                    </motion.div>
                  )}

                  {wrappedSlide === 2 && (
                    <motion.div 
                      key="s2"
                      initial={{ opacity: 0, y: 50 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -50 }}
                      transition={{ duration: 0.3 }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>Top Artist</span>
                      <h2 style={{ fontSize: 26, fontWeight: 900, marginTop: 10, letterSpacing: -0.5 }}>Your ultimate companion.</h2>
                      {insights!.top_artists.length > 0 ? (
                        <div style={{ marginTop: 24 }}>
                          <div style={{ fontSize: 36, fontWeight: 900, color: '#fff', letterSpacing: -1 }}>
                            {insights!.top_artists[0].artist}
                          </div>
                          <p style={{ fontSize: 14, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>
                            was your most played artist. You returned to their discography {insights!.top_artists[0].play_count} times.
                          </p>
                        </div>
                      ) : (
                        <p style={{ color: 'var(--text-dim)', marginTop: 20 }}>No artist metadata recorded.</p>
                      )}
                    </motion.div>
                  )}

                  {wrappedSlide === 3 && (
                    <motion.div 
                      key="s3"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.05 }}
                      transition={{ duration: 0.3 }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>Top Album</span>
                      <h2 style={{ fontSize: 24, fontWeight: 900, marginTop: 8, letterSpacing: -0.5, marginBottom: 16 }}>The full experience.</h2>
                      {insights!.top_albums && insights!.top_albums.length > 0 ? (
                        <div className="wrapped-album-card">
                          {insights!.top_albums[0].cover_url ? (
                            <img 
                              src={insights!.top_albums[0].cover_url} 
                              alt={insights!.top_albums[0].album}
                              className="wrapped-album-art"
                            />
                          ) : (
                            <div className="wrapped-album-art-placeholder">
                              <Disc size={36} />
                            </div>
                          )}
                          <div style={{ marginTop: 16, textAlign: 'center' }}>
                            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>
                              {insights!.top_albums[0].album}
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
                              {insights!.top_albums[0].artist}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700, marginTop: 12 }}>
                              {insights!.top_albums[0].play_count} plays
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p style={{ color: 'var(--text-dim)', marginTop: 20 }}>No album metadata recorded.</p>
                      )}
                    </motion.div>
                  )}

                  {wrappedSlide === 4 && (
                    <motion.div 
                      key="s4"
                      initial={{ opacity: 0, scale: 1.05 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, x: -50 }}
                      transition={{ duration: 0.3 }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>Top Songs</span>
                      <h2 style={{ fontSize: 24, fontWeight: 900, marginTop: 8, letterSpacing: -0.5, marginBottom: 16 }}>Your heavy rotations.</h2>
                      <div className="wrapped-meta-list">
                        {insights!.top_songs.slice(0, 4).map((song, sidx) => (
                          <div key={sidx} className="wrapped-meta-item">
                            <div className="wrapped-meta-rank">{sidx + 1}</div>
                            <div className="wrapped-meta-info">
                              <div className="wrapped-meta-title">{song.title}</div>
                              <div className="wrapped-meta-sub">{song.artist}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {wrappedSlide === 5 && (
                    <motion.div 
                      key="s5"
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -30 }}
                      transition={{ duration: 0.3 }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>Audiophile Signature</span>
                      <h2 style={{ fontSize: 24, fontWeight: 900, marginTop: 8, letterSpacing: -0.5, marginBottom: 16 }}>Sound without compromises.</h2>
                      <div className="wrapped-audiophile-card">
                        <div className="wrapped-audio-row">
                          <span>Bit-Perfect Accuracy</span>
                          <strong>{insights!.audiophile?.bit_perfect_rate.toFixed(1) || 0}%</strong>
                        </div>
                        <div className="wrapped-audio-row">
                          <span>Hi-Res Streams</span>
                          <strong>{insights!.audiophile?.hires_count || 0} tracks</strong>
                        </div>
                        <div className="wrapped-audio-row">
                          <span>Lossless Master Plays</span>
                          <strong>{insights!.audiophile?.lossless_count || 0} tracks</strong>
                        </div>
                        <div className="wrapped-audio-row">
                          <span>Average Sample Rate</span>
                          <strong>{formatSampleRate(insights!.audiophile?.avg_sample_rate || 0)}</strong>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {wrappedSlide === 6 && (
                    <motion.div 
                      key="s6"
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      style={{ textAlign: 'center' }}
                    >
                      <Award size={40} style={{ color: 'var(--accent)', margin: '0 auto 16px' }} />
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>Your Persona</span>
                      <h2 style={{ fontSize: 24, fontWeight: 900, marginTop: 8, letterSpacing: -0.5 }}>The verdict is in.</h2>
                      <div className="wrapped-personality-card">
                        <div className="wrapped-personality-title">{personality.title}</div>
                        <p className="wrapped-personality-desc">{personality.desc}</p>
                      </div>
                      
                      <button 
                        className="btn btn-secondary" 
                        onClick={() => setWrappedActive(false)}
                        style={{ marginTop: 32, padding: '10px 24px', fontSize: 12, borderRadius: 12, width: '100%' }}
                      >
                        Back to Insights
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
