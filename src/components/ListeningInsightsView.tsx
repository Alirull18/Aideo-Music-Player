import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Track } from '../store/types';
import { invoke } from '@tauri-apps/api/core';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clock, PlayCircle, RefreshCw, BarChart3, Sparkles, Play, 
  History, Calendar, X, Music, AlertCircle, Headphones, Award
} from 'lucide-react';

interface TopSong {
  title: string;
  artist: string;
  track_path: string;
  play_count: number;
}

interface TopArtist {
  artist: string;
  play_count: number;
}

interface TopGenre {
  genre: string;
  play_count: number;
}

interface HourActivity {
  hour: number;
  play_count: number;
}

interface DayActivity {
  day: number;
  play_count: number;
}

interface ListeningInsightsPayload {
  total_listening_time_secs: number;
  total_plays: number;
  skip_count: number;
  skip_rate: number;
  top_songs: TopSong[];
  top_artists: TopArtist[];
  top_genres: TopGenre[];
  hourly_activity: HourActivity[];
  daily_activity: DayActivity[];
}

const formatDuration = (secs: number) => {
  if (secs <= 0) return '0 mins';
  const hrs = Math.floor(secs / 3600);
  const mins = Math.round((secs % 3600) / 60);
  if (hrs > 0) {
    return `${hrs} hr${hrs > 1 ? 's' : ''} ${mins} min${mins > 1 ? 's' : ''}`;
  }
  return `${mins} min${mins > 1 ? 's' : ''}`;
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ListeningInsightsView() {
  const { setView, playTrack } = useStore();
  const [range, setRange] = useState<'today' | 'last_7_days' | 'last_30_days' | 'all_time'>('last_30_days');
  const [insights, setInsights] = useState<ListeningInsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wrappedActive, setWrappedActive] = useState(false);
  const [wrappedSlide, setWrappedSlide] = useState(0);

  // Timer reference for slide transitions
  const slideTimerRef = useRef<number | null>(null);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<ListeningInsightsPayload>('get_listening_insights', { range });
      setInsights(res);
    } catch (err: any) {
      console.error(err);
      setError(err?.toString() || 'Failed to aggregate listening data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, [range]);

  // Handle Wrapped Auto-Advance
  useEffect(() => {
    if (wrappedActive) {
      if (slideTimerRef.current) window.clearTimeout(slideTimerRef.current);
      
      // Auto advance to next slide after 5 seconds, up to Slide 4 (index 4)
      if (wrappedSlide < 4) {
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
    const fakeTrack: Track = {
      id: 0,
      path,
      title,
      artist,
      cover_url: null,
      loved: 0,
      disliked: 0,
      duration: 0,
      format: 'local',
      lyric_offset: 0
    };
    playTrack(fakeTrack);
    setView('nowplaying');
  };

  // Music Personality Engine
  const getPersonality = () => {
    if (!insights || insights.total_plays === 0) {
      return { title: 'The Silent Observer', desc: 'You haven\'t played enough music yet to discover your musical personality!' };
    }
    
    // 1. Check skip rate
    if (insights.skip_rate > 35) {
      return { 
        title: 'The Impatient Explorer', 
        desc: 'You love discovering new music but have a short fuse for intros. If a track doesn\'t grab you within 10 seconds, it\'s on to the next adventure!' 
      };
    }

    // 2. Check peak listening hours
    // Find hour with max count
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
        desc: 'You wake up with the sun and lock into high-energy beats immediately. Music is your fuel to conquer the morning!' 
      };
    }

    // 3. Stan check (more than 40% of total plays is the top artist)
    if (insights.top_artists.length > 0 && insights.total_plays > 5) {
      const topArtist = insights.top_artists[0];
      const ratio = topArtist.play_count / insights.total_plays;
      if (ratio > 0.4) {
        return { 
          title: `The ${topArtist.artist} Devotee`, 
          desc: `You find an artist you love and you stay locked in. You accounted for a massive ${Math.round(ratio * 100)}% of your plays listening to ${topArtist.artist}!` 
        };
      }
    }

    // 4. Default
    return { 
      title: 'The Deep Listener', 
      desc: 'A highly balanced scrobbler. You explore multiple genres, split your listening times evenly, and give every track a fair chance!' 
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

    // Auto play the top song if available when entering Wrapped!
    if (insights && insights.top_songs.length > 0) {
      const top = insights.top_songs[0];
      const fakeTrack: Track = {
        id: 0,
        path: top.track_path,
        title: top.title,
        artist: top.artist,
        cover_url: null,
        loved: 0,
        disliked: 0,
        duration: 0,
        format: 'local',
        lyric_offset: 0
      };
      playTrack(fakeTrack);
    }
  };

  return (
    <div className="insights-view-wrap">
      {/* Header */}
      <div className="insights-header">
        <h1 className="insights-main-title">Aideo Insights</h1>
        <p className="insights-main-subtitle">Your personal scrobbler dashboard, computed completely locally.</p>
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

              {/* Right column: Top Artists & Genres */}
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
              </div>
            </div>

            {/* Hourly & Daily Distribution Charts */}
            <div className="insights-charts-grid">
              {/* Hourly Chart */}
              <div className="insights-widget-card">
                <h3 className="insights-widget-title">
                  <Clock size={16} className="text-accent" />
                  <span>Hourly Listening Peaks</span>
                </h3>
                <div className="svg-chart-container">
                  <svg width="100%" height="100%" viewBox="0 0 540 140" style={{ overflow: 'visible' }}>
                    {/* Grid lines */}
                    <line x1="40" y1="20" x2="520" y2="20" className="svg-grid-line" />
                    <line x1="40" y1="60" x2="520" y2="60" className="svg-grid-line" />
                    <line x1="40" y1="100" x2="520" y2="100" className="svg-grid-line" />
                    
                    {/* Axis */}
                    <line x1="40" y1="110" x2="520" y2="110" className="svg-axis-line" />

                    {/* Bars */}
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
                    {/* Grid lines */}
                    <line x1="40" y1="20" x2="320" y2="20" className="svg-grid-line" />
                    <line x1="40" y1="60" x2="320" y2="60" className="svg-grid-line" />
                    <line x1="40" y1="100" x2="320" y2="100" className="svg-grid-line" />
                    
                    {/* Axis */}
                    <line x1="40" y1="110" x2="320" y2="110" className="svg-axis-line" />

                    {/* Bars */}
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
            {/* Ambient Blurred Background Blobs */}
            <div className="wrapped-liquid-bg">
              <div className="wrapped-liquid-blob" style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 60%)', width: '380px', height: '380px', left: '10%', top: '10%' }} />
              <div className="wrapped-liquid-blob" style={{ background: 'radial-gradient(circle, #ec4899 0%, transparent 60%)', width: '420px', height: '420px', right: '10%', bottom: '10%', animationDelay: '-8s' }} />
            </div>

            {/* Exit button */}
            <button className="wrapped-close-btn" onClick={() => setWrappedActive(false)} title="Close Wrapped">
              <X size={20} />
            </button>

            {/* Card Deck */}
            <div className="wrapped-card-container">
              {/* Progress segments indicator */}
              <div className="wrapped-progress-bar">
                {Array.from({ length: 5 }).map((_, stepIdx) => {
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
              <div className="wrapped-nav-overlay-right" onClick={() => setWrappedSlide(prev => Math.min(prev + 1, 4))} />

              {/* Slide content stage */}
              <div className="wrapped-slide-content">
                <AnimatePresence mode="wait">
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
                        Your Music Journey<br />on Aideo
                      </h2>
                      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 14 }}>
                        Let's take a look at your listening stats, calculated completely locally on your device.
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
                      <h2 style={{ fontSize: 26, fontWeight: 900, marginTop: 10, letterSpacing: -0.5 }}>You lived inside the beats.</h2>
                      <div className="wrapped-big-number">
                        {Math.round(insights!.total_listening_time_secs / 60)}
                      </div>
                      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>
                        total minutes of playback recorded locally. That's {insights!.total_plays} individual scrobbles with a skip rate of {insights!.skip_rate.toFixed(0)}%!
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
                          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 8, lineHeight: 1.5 }}>
                            was your top listened artist. You scrobbled them {insights!.top_artists[0].play_count} times!
                          </p>
                        </div>
                      ) : (
                        <p style={{ color: 'rgba(255,255,255,0.5)', marginTop: 20 }}>No artist metadata recorded.</p>
                      )}
                    </motion.div>
                  )}

                  {wrappedSlide === 3 && (
                    <motion.div 
                      key="s3"
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

                  {wrappedSlide === 4 && (
                    <motion.div 
                      key="s4"
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
