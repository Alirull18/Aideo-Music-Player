import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { Play, Plus, RefreshCw, Loader2, Globe } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { extractDominantColor } from '../utils/colorExtractor';

function parseDuration(raw: string | null | undefined): number {
  if (!raw) return 180;
  const parts = raw.split(':').map(Number);
  if (parts.some(isNaN)) return 180;
  let secs = 0;
  if (parts.length === 3) {
    secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    secs = parts[0] * 60 + parts[1];
  } else {
    secs = parts[0] || 0;
  }
  return secs > 0 ? secs : 180;
}

export function ChartsView() {
  const { playStream, addToQueue } = useStore();

  const [selectedGenre, setSelectedGenre] = useState<string>('global');
  const [selectedCountry, setSelectedCountry] = useState<string>('global');
  const [chartSource, setChartSource] = useState<'lastfm' | 'billboard' | 'listenbrainz'>('lastfm');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [heroColor, setHeroColor] = useState<string>('rgba(168, 85, 247, 0.25)');

  const chartSources = [
    { id: 'lastfm', label: '📻 Last.fm Realtime' },
    { id: 'billboard', label: '🇺🇸 Billboard Hot 100' },
    { id: 'listenbrainz', label: '🧠 ListenBrainz Open' },
  ];

  const genres = [
    { id: 'global', label: '🌐 All Genres' },
    { id: 'pop', label: '🎤 Pop' },
    { id: 'hip-hop', label: '🎧 Hip-Hop' },
    { id: 'rock', label: '🎸 Rock' },
    { id: 'electronic', label: '🎹 Electronic' },
    { id: 'k-pop', label: '🇰🇷 K-Pop' },
    { id: 'latin', label: '💃 Latin' },
    { id: 'r&b', label: '🎷 R&B' },
    { id: 'indie', label: '🌿 Indie' },
  ];

  const continents = [
    { id: 'global', label: '🌐 Worldwide (Global)' },
    { id: 'asia', label: '🌏 Asia' },
    { id: 'europe', label: '🌍 Europe' },
    { id: 'north america', label: '🌎 North America' },
    { id: 'south america', label: '🌎 South America' },
    { id: 'africa', label: '🌍 Africa' },
    { id: 'oceania', label: '🌏 Oceania' },
  ];

  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const fetchLeaderboard = async () => {
    setLoading(true);
    setHasMore(true);
    try {
      const res: any[] = await invoke('get_worldwide_leaderboard', {
        genre: selectedGenre === 'global' ? '' : selectedGenre,
        country: selectedCountry === 'global' ? '' : selectedCountry,
        source: chartSource,
        offset: 0,
        limit: 15,
      });
      setLeaderboard(res || []);
      if (!res || res.length < 15) {
        setHasMore(false);
      }

      if (res && res.length > 0 && res[0].cover_url) {
        extractDominantColor(res[0].cover_url).then(setHeroColor);
      } else {
        setHeroColor('rgba(168, 85, 247, 0.25)');
      }
    } catch (e) {
      console.error('Failed to fetch leaderboard:', e);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to load charts: ${e}`, type: 'error' } }));
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextBatch: any[] = await invoke('get_worldwide_leaderboard', {
        genre: selectedGenre === 'global' ? '' : selectedGenre,
        country: selectedCountry === 'global' ? '' : selectedCountry,
        source: chartSource,
        offset: leaderboard.length,
        limit: 15,
      });

      if (nextBatch && nextBatch.length > 0) {
        setLeaderboard(prev => {
          const seen = new Set(prev.map(p => p.id));
          const filtered = nextBatch.filter(nb => !seen.has(nb.id));
          return [...prev, ...filtered];
        });
        if (nextBatch.length < 15) {
          setHasMore(false);
        }
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.error('Failed to load more chart tracks:', e);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, [selectedGenre, selectedCountry, chartSource]);

  const handlePlayTrack = async (t: any) => {
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Playing: ${t.title}...`, type: 'info' } 
    }));
    try {
      const parsedSeconds = parseDuration(t.duration_raw);
      await playStream(t.url, {
        title: t.title,
        artist: t.artist,
        cover_url: t.cover_url,
        duration: parsedSeconds
      });
    } catch (err) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Playback failed: ${err}`, type: 'error' } 
      }));
    }
  };

  const handlePlayAll = async () => {
    if (leaderboard.length === 0) return;
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Queued all ${leaderboard.length} chart tracks!`, type: 'success' } 
    }));
    await handlePlayTrack(leaderboard[0]);
    for (let i = 1; i < leaderboard.length; i++) {
      const t = leaderboard[i];
      const parsedSeconds = parseDuration(t.duration_raw);
      addToQueue({
        id: i + 1,
        path: t.url,
        title: t.title,
        artist: t.artist,
        cover_url: t.cover_url,
        duration: parsedSeconds,
        format: 'YouTube Web Stream',
        lyric_offset: 0
      });
    }
  };

  const top1 = leaderboard[0];

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32, background: 'var(--bg)', boxSizing: 'border-box' }}>
      
      {/* 🔮 Dynamic Spotify-Style Hero Header */}
      <div style={{
        background: `linear-gradient(180deg, ${heroColor} 0%, rgba(15, 15, 25, 0.95) 100%)`,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 24,
        padding: 32,
        marginBottom: 32,
        boxShadow: `0 20px 50px ${heroColor.replace('0.25', '0.15')}`,
        display: 'flex',
        alignItems: 'center',
        gap: 32,
        flexWrap: 'wrap',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Top 1 Hero Thumbnail */}
        <div style={{ width: 180, height: 180, borderRadius: 16, overflow: 'hidden', boxShadow: '0 12px 36px rgba(0,0,0,0.6)', flexShrink: 0, background: '#111' }}>
          <img 
            src={top1?.cover_url || defaultCover} 
            alt={top1?.title || 'Top Track'} 
            loading="lazy" 
            decoding="async" 
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
          />
        </div>

        {/* Hero Meta Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, color: '#f59e0b', background: 'rgba(245, 158, 11, 0.15)', padding: '4px 10px', borderRadius: 20, border: '1px solid rgba(245, 158, 11, 0.3)' }}>
              Official Worldwide Leaderboard
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Updated Live</span>
          </div>

          <h1 style={{ fontSize: 36, fontWeight: 900, color: 'white', margin: 0, letterSpacing: -0.5 }}>
            Top Songs — {selectedCountry !== 'global' ? continents.find(c => c.id === selectedCountry)?.label : 'Global'}
          </h1>

          <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0, maxWidth: 520 }}>
            Real-time global stream rankings across millions of listeners. Explore top tracks by genre or country.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
            <button
              onClick={handlePlayAll}
              disabled={leaderboard.length === 0}
              style={{
                padding: '12px 28px',
                borderRadius: 28,
                fontSize: 14,
                fontWeight: 800,
                background: '#10b981',
                color: '#000',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                boxShadow: '0 6px 20px rgba(16, 185, 129, 0.4)',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.04)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
            >
              <Play size={18} fill="#000" />
              Play All Charts
            </button>

            <button
              onClick={fetchLeaderboard}
              disabled={loading}
              style={{
                padding: '12px 20px',
                borderRadius: 28,
                fontSize: 13,
                fontWeight: 700,
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* 🎛️ Data Provider & Category Filters */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
        {/* Source Provider Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 }}>Chart Engine:</span>
          {chartSources.map(s => {
            const isSel = chartSource === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setChartSource(s.id as any)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: isSel ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  color: isSel ? '#ffffff' : 'var(--text-dim)',
                  border: isSel ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                  transition: 'all 0.2s ease',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Only show Genre and Continent filters when Last.fm Realtime engine is active */}
        {chartSource === 'lastfm' ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {/* Genre Pills */}
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
              {genres.map(g => {
                const isSel = selectedGenre === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGenre(g.id)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 20,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      background: isSel ? 'var(--accent)' : 'rgba(255, 255, 255, 0.05)',
                      color: isSel ? '#ffffff' : 'var(--text-dim)',
                      border: isSel ? '1px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
                      transition: 'all 0.2s ease',
                      boxShadow: isSel ? '0 4px 14px rgba(139, 92, 246, 0.35)' : 'none',
                    }}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>

            {/* Continent Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Globe size={14} color="var(--text-dim)" />
              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '8px 12px',
                  borderRadius: 12,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {continents.map(c => (
                  <option key={c.id} value={c.id} style={{ background: '#141420', color: 'white' }}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            {chartSource === 'billboard' 
              ? '🇺🇸 Showing United States Billboard Hot 100 Singles Chart.' 
              : '🧠 Showing global ListenBrainz sitewide top recordings.'}
          </div>
        )}
      </div>

      {/* 📊 Ranked Leaderboard Table (1 to 50) */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: 'var(--text-dim)' }}>
          <Loader2 className="spin" size={32} style={{ marginBottom: 12, color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Loading Realtime Leaderboards...</span>
        </div>
      ) : leaderboard.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-dim)', fontSize: 14 }}>
          No chart data returned for this selection. Try selecting another category above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {leaderboard.map((t, idx) => {
            const rank = idx + 1;
            const isGold = rank === 1;
            const isSilver = rank === 2;
            const isBronze = rank === 3;

            return (
              <motion.div
                key={t.id || idx}
                whileHover={{ background: 'rgba(255, 255, 255, 0.05)' }}
                onClick={() => handlePlayTrack(t)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderRadius: 12,
                  background: isGold ? 'rgba(255, 215, 0, 0.08)' : isSilver ? 'rgba(192, 192, 192, 0.05)' : isBronze ? 'rgba(205, 127, 50, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                  border: isGold ? '1px solid rgba(255, 215, 0, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  gap: 16
                }}
              >
                {/* Rank Number & Badge */}
                <div style={{ width: 44, textAlign: 'center', fontWeight: 900, fontSize: isGold ? 16 : 14 }}>
                  {isGold ? (
                    <span style={{ color: '#FFD700' }}>🥇 #1</span>
                  ) : isSilver ? (
                    <span style={{ color: '#E0E0E0' }}>🥈 #2</span>
                  ) : isBronze ? (
                    <span style={{ color: '#CD7F32' }}>🥉 #3</span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)' }}>#{rank}</span>
                  )}
                </div>

                {/* Cover Art */}
                <div style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', background: '#181824', flexShrink: 0, position: 'relative' }}>
                  <img 
                    src={t.cover_url || defaultCover} 
                    alt={t.title || ''} 
                    loading="lazy"
                    decoding="async"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                  />
                </div>

                {/* Title & Artist */}
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.artist}
                  </span>
                </div>

                {/* Source Badge */}
                <div style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 12, background: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-dim)' }}>
                  {t.recommendation_source || 'Trending'}
                </div>

                {/* Duration */}
                <div style={{ fontSize: 12, color: 'var(--text-dim)', width: 60, textAlign: 'right' }}>
                  {t.duration_raw}
                </div>

                {/* Action controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      const parsedSeconds = parseDuration(t.duration_raw);
                      addToQueue({
                        id: idx + 1,
                        path: t.url,
                        title: t.title,
                        artist: t.artist,
                        cover_url: t.cover_url,
                        duration: parsedSeconds,
                        format: 'YouTube Web Stream',
                        lyric_offset: 0
                      });
                      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Added to queue: ${t.title}`, type: 'success' } }));
                    }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 6 }}
                    title="Add to queue"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </motion.div>
            );
          })}

          {/* Load More Button */}
          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20, marginBottom: 20 }}>
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={{
                  padding: '12px 28px',
                  borderRadius: 24,
                  fontSize: 13,
                  fontWeight: 700,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  transition: 'all 0.2s',
                  opacity: loadingMore ? 0.7 : 1
                }}
                onMouseEnter={(e) => { if (!loadingMore) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
                onMouseLeave={(e) => { if (!loadingMore) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="spin" size={16} style={{ color: 'var(--accent)' }} />
                    Fetching More Rankings...
                  </>
                ) : (
                  <>
                    Load More Charts (# {leaderboard.length + 1} - #{leaderboard.length + 15})
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
