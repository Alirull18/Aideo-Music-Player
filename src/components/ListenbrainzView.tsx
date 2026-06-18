import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Users, Activity, RefreshCw, Sparkles, Search, Disc, HelpCircle, ExternalLink } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

export function ListenbrainzView() {
  const { 
    listenbrainzToken, 
    listenbrainzUsername, 
    listenbrainzRecent, 
    listenbrainzRecs, 
    listenbrainzListenCount,
    fetchListenbrainzDashboard,
    setView
  } = useStore();
  
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'recent' | 'recs'>('recent');

  useEffect(() => {
    if (listenbrainzToken && listenbrainzUsername) {
      setLoading(true);
      fetchListenbrainzDashboard().finally(() => setLoading(false));
    }
  }, [listenbrainzToken, listenbrainzUsername]);

  const handleRefresh = () => {
    setLoading(true);
    fetchListenbrainzDashboard().finally(() => setLoading(false));
  };

  const handleSearchSong = (artist: string, title: string) => {
    const searchString = `${artist} - ${title}`;
    navigator.clipboard.writeText(searchString).then(() => {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Copied "${searchString}"! Switching to Aideo...`, type: 'success' } 
      }));
      setView('aideo');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ui-trigger-aideo-search', { detail: { query: searchString } }));
      }, 100);
    });
  };

  if (!listenbrainzToken) {
    return (
      <div className="np-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <Radio size={64} style={{ color: 'rgba(235, 116, 59, 0.4)' }} />
        <h2 style={{ margin: 0, fontSize: 22, color: 'white' }}>ListenBrainz not connected</h2>
        <p style={{ color: 'var(--text-dim)', maxWidth: 400, textAlign: 'center', fontSize: 13, lineHeight: 1.5 }}>
          Connect your ListenBrainz User Token in the Scrobbling settings to load your listening statistics and personalized recommendations.
        </p>
        <button 
          className="btn btn-primary"
          onClick={() => setView('settings')}
          style={{ background: 'linear-gradient(135deg, #eb743b, #ff9e59)', border: 'none', color: 'white', padding: '10px 20px', fontSize: 12, borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
        >
          Open Settings
        </button>
      </div>
    );
  }

  // Safe recommendations extraction
  const recsArray = Array.isArray(listenbrainzRecs)
    ? listenbrainzRecs
    : (listenbrainzRecs && typeof listenbrainzRecs === 'object'
        ? Object.entries(listenbrainzRecs).map(([mbid, val]: [string, any]) => {
            if (val && typeof val === 'object') {
              return { ...val, recording_mbid: mbid };
            }
            return { recording_mbid: mbid };
          })
        : []);

  // Helper for relative scrobble time
  const formatTime = (timestamp: number) => {
    const diff = Math.floor(Date.now() / 1000) - timestamp;
    if (diff < 0) return 'Just now';
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="lastfm-dashboard" style={{ padding: '40px 60px', overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 28 }}>
      
      {/* Premium Gradient Glow Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 2 }}>
        <div>
          <h1 style={{ 
            fontSize: 36, 
            margin: 0, 
            fontWeight: 800,
            background: 'linear-gradient(90deg, #fff, #ff9e59)', 
            WebkitBackgroundClip: 'text', 
            WebkitTextFillColor: 'transparent',
            letterSpacing: -0.5
          }}>
            ListenBrainz Stats
          </h1>
          <p style={{ color: 'var(--text-dim)', marginTop: 6, fontSize: 13 }}>
            Open community-driven scrobbling database integration.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button 
            className="btn btn-secondary"
            onClick={() => openUrl(`https://listenbrainz.org/user/${listenbrainzUsername}/`).catch(() => window.open(`https://listenbrainz.org/user/${listenbrainzUsername}/`, '_blank'))}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', fontSize: 12, borderRadius: 8, height: 38 }}
          >
            <ExternalLink size={14} /> Profile Page
          </button>
          <button 
            className="btn btn-primary" 
            onClick={handleRefresh}
            disabled={loading}
            style={{ 
              background: 'linear-gradient(135deg, #eb743b, #ff9e59)', 
              border: 'none', 
              color: 'white', 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              padding: '10px 16px', 
              fontSize: 12, 
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(235, 116, 59, 0.2)',
              cursor: 'pointer',
              height: 38
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh Stats
          </button>
        </div>
      </header>

      {/* User Connection Banner */}
      <motion.div 
        className="lfm-user-card"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ 
          background: 'rgba(255,255,255,0.02)', 
          border: '1px solid var(--glass-border)',
          borderRadius: 14, 
          padding: '24px 28px',
          display: 'flex',
          alignItems: 'center',
          gap: 20
        }}
      >
        <div className="lfm-avatar" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          background: 'rgba(235, 116, 59, 0.08)',
          border: '1px solid rgba(235, 116, 59, 0.15)',
          borderRadius: '50%',
          width: 56,
          height: 56,
          flexShrink: 0
        }}>
          <Users size={28} style={{ color: '#ff9e59' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontSize: 22, margin: 0, fontWeight: 700, color: 'white' }}>{listenbrainzUsername}</h2>
            <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 12, background: 'rgba(235, 116, 59, 0.12)', color: '#ff9e59', border: '1px solid rgba(235, 116, 59, 0.2)' }}>
              UUID SECURE SESSION
            </span>
          </div>
          <div className="lfm-stats-grid" style={{ marginTop: 12, display: 'flex', gap: 24 }}>
            <div className="stat-card" style={{ background: 'transparent', padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="stat-value" style={{ fontSize: 18, fontWeight: 800, color: 'white' }}>
                {listenbrainzListenCount !== null ? listenbrainzListenCount.toLocaleString() : '...'}
              </span>
              <span className="stat-label" style={{ fontSize: 11, color: 'var(--text-dim)' }}>Total Scrobbles</span>
            </div>
            <div className="stat-card" style={{ background: 'transparent', padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="stat-value" style={{ fontSize: 18, fontWeight: 800, color: 'white' }}>
                {recsArray.length}
              </span>
              <span className="stat-label" style={{ fontSize: 11, color: 'var(--text-dim)' }}>Recommendations Available</span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Tab Selectors */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--glass-border)', paddingBottom: 0 }}>
        <button
          onClick={() => setActiveTab('recent')}
          style={{
            background: 'none',
            border: 'none',
            color: activeTab === 'recent' ? 'white' : 'var(--text-dim)',
            padding: '12px 24px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            position: 'relative',
            transition: 'color 0.2s'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={14} style={{ color: activeTab === 'recent' ? '#ff9e59' : 'inherit' }} />
            <span>Recent Activity</span>
          </div>
          {activeTab === 'recent' && (
            <motion.div 
              layoutId="lb-tab-line" 
              style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #eb743b, #ff9e59)' }} 
            />
          )}
        </button>

        <button
          onClick={() => setActiveTab('recs')}
          style={{
            background: 'none',
            border: 'none',
            color: activeTab === 'recs' ? 'white' : 'var(--text-dim)',
            padding: '12px 24px',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            position: 'relative',
            transition: 'color 0.2s'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={14} style={{ color: activeTab === 'recs' ? '#ff9e59' : 'inherit' }} />
            <span>Recommended for You</span>
          </div>
          {activeTab === 'recs' && (
            <motion.div 
              layoutId="lb-tab-line" 
              style={{ position: 'absolute', bottom: -1, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #eb743b, #ff9e59)' }} 
            />
          )}
        </button>
      </div>

      {/* Content views with AnimatePresence */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <AnimatePresence mode="wait">
          {activeTab === 'recent' ? (
            <motion.div
              key="recent"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              {listenbrainzRecent.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-dim)' }}>
                  <HelpCircle size={36} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.5 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>No recent listens found</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Start playing music to log listens to your profile!</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {listenbrainzRecent.map((listen: any, index: number) => {
                    const meta = listen.track_metadata;
                    if (!meta) return null;
                    return (
                      <motion.div
                        key={`${listen.listened_at}-${index}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(index * 0.03, 0.4) }}
                        style={{
                          background: 'rgba(255,255,255,0.01)',
                          border: '1px solid rgba(255,255,255,0.03)',
                          borderRadius: 8,
                          padding: '12px 18px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 16,
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.01)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.03)';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.03)', width: 32, height: 32, borderRadius: 6 }}>
                            <Disc size={16} color="var(--text-dim)" />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {meta.track_name}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              by {meta.artist_name} {meta.release_name && `• ${meta.release_name}`}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500 }}>
                            {formatTime(listen.listened_at)}
                          </span>
                          <button
                            onClick={() => handleSearchSong(meta.artist_name, meta.track_name)}
                            title="Find track in Aideo Search"
                            style={{
                              background: 'rgba(255,255,255,0.04)',
                              border: '1px solid rgba(255,255,255,0.06)',
                              color: 'white',
                              cursor: 'pointer',
                              padding: 6,
                              borderRadius: 6,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(235, 116, 59, 0.1)';
                              e.currentTarget.style.borderColor = 'rgba(235, 116, 59, 0.2)';
                              e.currentTarget.style.color = '#ff9e59';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                              e.currentTarget.style.color = 'white';
                            }}
                          >
                            <Search size={13} />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="recs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              {recsArray.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-dim)' }}>
                  <Sparkles size={36} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.4, color: '#ff9e59' }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>No recommendations yet</div>
                  <div style={{ fontSize: 12, marginTop: 4, maxWidth: 420, margin: '6px auto 0', lineHeight: 1.5 }}>
                    Collaborative recommendations are computed periodically by ListenBrainz based on your scrobbling habits. Try scrobbling more tracks!
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, padding: '0 4px 6px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                    <Sparkles size={12} style={{ color: '#ff9e59' }} />
                    <span>Personalized algorithmic recommendations based on your listening style</span>
                  </div>
                  {recsArray.map((rec: any, index: number) => {
                    const artist = rec.artist?.name || rec.artist_credit_name || rec.recording?.artist_credit_name || 'Unknown Artist';
                    const title = rec.recording?.name || rec.recording_name || 'Unknown Track';
                    const album = rec.release?.name || rec.releases?.[0]?.release_name || '';

                    return (
                      <motion.div
                        key={`${rec.recording_mbid || index}-${index}`}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(index * 0.03, 0.4) }}
                        style={{
                          background: 'rgba(255,255,255,0.01)',
                          border: '1px solid rgba(255,255,255,0.03)',
                          borderRadius: 8,
                          padding: '12px 18px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 16,
                          transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.01)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.03)';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(235, 116, 59, 0.04)', width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(235, 116, 59, 0.08)' }}>
                            <Sparkles size={14} style={{ color: '#ff9e59' }} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {title}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              by {artist} {album && `• ${album}`}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            onClick={() => handleSearchSong(artist, title)}
                            className="btn btn-secondary"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '6px 12px',
                              fontSize: 11,
                              borderRadius: 6,
                              height: 30,
                              cursor: 'pointer'
                            }}
                          >
                            <Search size={12} />
                            <span>Find Song</span>
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}
