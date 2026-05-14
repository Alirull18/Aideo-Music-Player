import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { motion } from 'framer-motion';
import { Radio, Users, Activity, ExternalLink, RefreshCw } from 'lucide-react';

export function LastfmView() {
  const { 
    lastfmSessionKey, lastfmUser, lastfmRecent, lastfmTopArtists, fetchLastfmDashboard,
    scrobbleEnabled, toggleScrobble
  } = useStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lastfmSessionKey) {
      setLoading(true);
      fetchLastfmDashboard().finally(() => setLoading(false));
    }
  }, [lastfmSessionKey]);

  if (!lastfmSessionKey) {
    return (
      <div className="np-empty">
        <Radio size={64} color="var(--text-dim)" />
        <h2>Last.fm not connected</h2>
        <p>Connect your account in Settings to see your dashboard.</p>
      </div>
    );
  }

  return (
    <div className="lastfm-dashboard" style={{ padding: '40px 60px', overflowY: 'auto', height: '100%' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>Last.fm Dashboard</h1>
          <p style={{ color: 'var(--text-dim)', marginTop: 8 }}>Your listening statistics and history</p>
        </div>
        <button 
          className="btn btn-secondary" 
          onClick={() => { setLoading(true); fetchLastfmDashboard().finally(() => setLoading(false)); }}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} style={{ marginRight: 8 }} />
          Refresh Stats
        </button>
      </header>

      {lastfmUser && (
        <motion.div 
          className="lfm-user-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {lastfmUser.image?.[3]?.['#text'] ? (
            <img src={lastfmUser.image[3]['#text']} alt="avatar" className="lfm-avatar" />
          ) : lastfmUser.image?.[2]?.['#text'] ? (
            <img src={lastfmUser.image[2]['#text']} alt="avatar" className="lfm-avatar" />
          ) : (
            <div className="lfm-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)' }}>
              <Users size={40} color="var(--accent)" />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontSize: 24, margin: 0 }}>{lastfmUser.realname || lastfmUser.name}</h2>
              <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>@{lastfmUser.name}</span>
            </div>
            <p style={{ color: 'var(--text-dim)', margin: '8px 0 16px' }}>{lastfmUser.country || 'Unknown Location'}</p>
            <div className="lfm-stats-grid">
              <div className="stat-card">
                <span className="stat-value">{(parseInt(lastfmUser.playcount) || 0).toLocaleString()}</span>
                <span className="stat-label">Total Scrobbles</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{(parseInt(lastfmUser.artist_count) || 0).toLocaleString()}</span>
                <span className="stat-label">Artists</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{(parseInt(lastfmUser.track_count) || 0).toLocaleString()}</span>
                <span className="stat-label">Tracks</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <div className="dashboard-section">
        {/* Recent Tracks */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <Activity size={20} color="var(--accent)" />
            <h3 style={{ margin: 0, fontSize: 18 }}>Recent Activity</h3>
          </div>
          <div className="lfm-list">
            {(lastfmRecent || []).map((track, i) => (
              <motion.div 
                key={i} 
                className="lfm-item"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                style={{ padding: '14px 16px' }}
              >
                <div className="lfm-item-info">
                  <div className="lfm-item-title" style={{ fontSize: 15 }}>{track.name || 'Unknown Track'}</div>
                  <div className="lfm-item-sub" style={{ fontSize: 13, marginTop: 2 }}>{track.artist?.['#text'] || 'Unknown Artist'}</div>
                </div>
                {track['@attr']?.nowplaying === 'true' ? (
                  <span className="live-badge" style={{ fontSize: 9 }}>NOW PLAYING</span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {track.date?.['#text'] ? track.date['#text'].split(',')[0] : ''}
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        </section>

        {/* Top Artists */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <Users size={20} color="var(--accent)" />
            <h3 style={{ margin: 0, fontSize: 18 }}>Top Artists (7 Days)</h3>
          </div>
          <div className="lfm-list">
            {(lastfmTopArtists || []).map((artist, i) => (
              <motion.div 
                key={i} 
                className="lfm-item"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                style={{ padding: '14px 16px' }}
              >
                <div className="lfm-item-info">
                  <div className="lfm-item-title" style={{ fontSize: 15 }}>{artist.name || 'Unknown Artist'}</div>
                  <div className="lfm-item-sub" style={{ fontSize: 12 }}>{(parseInt(artist.playcount) || 0).toLocaleString()} scrobbles</div>
                </div>
                {lastfmTopArtists[0] && (
                  <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
                    <div style={{ 
                      height: '100%', 
                      width: `${Math.min(100, (parseInt(artist.playcount) / (parseInt(lastfmTopArtists[0].playcount) || 1)) * 100)}%`,
                      background: 'var(--accent)',
                      borderRadius: 2,
                      boxShadow: '0 0 8px rgba(var(--accent-rgb), 0.3)'
                    }} />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
