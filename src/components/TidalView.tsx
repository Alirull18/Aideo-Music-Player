import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Search, Download, Check, LogOut, Loader2, Music2, ExternalLink, Settings2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

interface TidalTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url: string;
  quality: string;
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const REGIONS = [
  { code: 'AUTO', label: 'Auto (From Account)' },
  { code: 'MY', label: 'Malaysia' },
  { code: 'SG', label: 'Singapore' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'JP', label: 'Japan' },
  { code: 'AU', label: 'Australia' },
];

export function TidalView() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [userCode, setUserCode] = useState('');
  const [activationUrl, setActivationUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Custom credentials panel
  const [showCreds, setShowCreds] = useState(false);
  const [customClientId, setCustomClientId] = useState('');
  const [customClientSecret, setCustomClientSecret] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Search
  const [selectedRegion, setSelectedRegion] = useState(localStorage.getItem('tidal_region') || 'AUTO');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TidalTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, 'downloading' | 'done' | 'error'>>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, { percent: number; downloaded_mb: number; total_mb: number }>>({});

  useEffect(() => {
    invoke<boolean>('tidal_login_poll_status')
      .then(s => { setLoggedIn(s); setLoading(false); })
      .catch(() => setLoading(false));

    invoke<any>('tidal_get_credentials')
      .then(c => { setCustomClientId(c.client_id); setCustomClientSecret(c.client_secret); })
      .catch(() => {});

    const subs: Array<() => void> = [];

    listen('tidal-login-success', () => {
      setLoggedIn(true); setPolling(false); setUserCode(''); setActivationUrl('');
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Successfully logged in to Tidal!', type: 'success' } }));
    }).then(u => subs.push(u));

    listen('tidal-login-expired', () => {
      setPolling(false); setUserCode(''); setActivationUrl('');
      setErrorMsg('Authorization link expired. Please try again.');
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Tidal pairing code expired', type: 'error' } }));
    }).then(u => subs.push(u));

    listen<any>('tidal-download-complete', e => {
      const { track_id, filename } = e.payload;
      setDownloads(p => ({ ...p, [track_id]: 'done' }));
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Downloaded: ${filename}`, type: 'success' } }));
    }).then(u => subs.push(u));

    listen<any>('tidal-download-error', e => {
      const { track_id, filename } = e.payload;
      setDownloads(p => ({ ...p, [track_id]: 'error' }));
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Download failed: ${filename}`, type: 'error' } }));
    }).then(u => subs.push(u));

    listen<any>('tidal-download-progress', e => {
      const { track_id, percent, downloaded_mb, total_mb } = e.payload;
      setDownloadProgress(p => ({
        ...p,
        [track_id]: { percent, downloaded_mb, total_mb }
      }));
    }).then(u => subs.push(u));

    return () => subs.forEach(u => u());
  }, []);

  const handleStartLogin = async () => {
    setErrorMsg(null);
    setPolling(true);
    try {
      const res = await invoke<any>('tidal_login_start');
      setUserCode(res.userCode);
      setActivationUrl(res.verificationUriComplete);
    } catch (err: any) {
      setErrorMsg(err.toString());
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Login initialization failed: ${err}`, type: 'error' } }));
      setPolling(false);
    }
  };

  const handleSaveCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await invoke('tidal_save_credentials', { clientId: customClientId.trim(), clientSecret: customClientSecret.trim() });
      setSaveSuccess(true);
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Tidal API Credentials saved', type: 'success' } }));
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to save credentials: ${err}`, type: 'error' } }));
    }
  };

  const handleLogout = async () => {
    try {
      await invoke('tidal_logout');
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Logged out of Tidal', type: 'info' } }));
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Logout error: ${err}`, type: 'error' } }));
    }
    setLoggedIn(false);
    setResults([]);
    setQuery('');
    setErrorMsg(null);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !loggedIn) return;
    setSearching(true);
    setErrorMsg(null);
    try {
      const res = await invoke<TidalTrack[]>('tidal_search', { query, region: selectedRegion === 'AUTO' ? null : selectedRegion });
      setResults(res);
      if (res.length === 0) setErrorMsg('No tracks found. Try a different query or region.');
    } catch (err: any) {
      setErrorMsg(err.toString());
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Search error: ${err}`, type: 'error' } }));
    } finally {
      setSearching(false);
    }
  };

  const handleDownload = async (track: TidalTrack) => {
    if (downloads[track.id]) return;
    setDownloads(p => ({ ...p, [track.id]: 'downloading' }));
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Downloading: ${track.title}...`, type: 'info' } }));
    try {
      await invoke('tidal_download', { 
        trackId: track.id, 
        filename: `${track.artist} - ${track.title}`,
        title: track.title,
        artist: track.artist,
        album: track.album,
        duration: track.duration
      });
    } catch (err: any) {
      setDownloads(p => ({ ...p, [track.id]: 'error' }));
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Download failed: ${err}`, type: 'error' } }));
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={28} className="pulse" style={{ color: 'var(--text-dim)' }} />
      </div>
    );
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <div style={{ height: '100%', overflowY: 'auto', padding: '48px 56px' }}>
        <h1 style={{ 
          fontSize: 44, 
          fontWeight: 800, 
          letterSpacing: '-1px', 
          marginBottom: 8,
          color: 'white'
        }}>
          Tidal Lossless
        </h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 40 }}>
          Link your Tidal account to search and download CD-quality FLAC tracks.
        </p>

        {/* Connect card */}
        <div style={{ maxWidth: 480, background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', padding: 32, marginBottom: 24 }}>
          {!polling ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(var(--accent-rgb),0.12)', border: '1px solid rgba(var(--accent-rgb),0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Music2 size={22} color="var(--accent)" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>Connect Tidal Account</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 2 }}>Uses OAuth device pairing — no passwords needed</div>
                </div>
              </div>

              {errorMsg && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, marginBottom: 20 }}>
                  <AlertCircle size={15} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.5 }}>{errorMsg}</span>
                </div>
              )}

              <button className="btn btn-primary" onClick={handleStartLogin}>
                Connect with Tidal
              </button>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <Loader2 size={32} className="pulse" style={{ color: 'var(--accent)', marginBottom: 16 }} />
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Waiting for authorization…</div>
                <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                  Open the link below on any device and enter the code to authorize Aideo.
                </p>
              </div>

              {userCode && (
                <>
                  <div style={{ textAlign: 'center', marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 8 }}>Your Pairing Code</div>
                    <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 12, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{userCode}</div>
                  </div>
                  <a
                    href={activationUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', background: 'var(--glass-h)', border: '1px solid var(--glass-border)', borderRadius: 10, color: 'var(--text)', fontSize: 13, fontWeight: 600, textDecoration: 'none', marginBottom: 16 }}
                  >
                    <ExternalLink size={14} />
                    {activationUrl}
                  </a>
                </>
              )}

              <button className="btn btn-secondary" onClick={() => { setPolling(false); setUserCode(''); setActivationUrl(''); }}>
                Cancel
              </button>
            </>
          )}
        </div>

        {/* Custom credentials panel */}
        <div style={{ maxWidth: 480, background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <button
            onClick={() => setShowCreds(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '16px 20px', background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Settings2 size={15} color="var(--text-dim)" /> Custom API Credentials</span>
            {showCreds ? <ChevronUp size={15} color="var(--text-dim)" /> : <ChevronDown size={15} color="var(--text-dim)" />}
          </button>

          {showCreds && (
            <form onSubmit={handleSaveCreds} style={{ padding: '0 20px 20px', borderTop: '1px solid var(--glass-border)' }}>
              <p style={{ color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.6, marginTop: 14, marginBottom: 16 }}>
                Override the built-in Fire TV credentials with your own registered Tidal Developer app keys. Leave blank to use defaults.
              </p>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-dim)', marginBottom: 6 }}>Client ID</label>
                <input
                  type="text"
                  value={customClientId}
                  onChange={e => setCustomClientId(e.target.value)}
                  placeholder="e.g. 4N3n6Q1x95LL5K7p"
                  style={{ width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-dim)', marginBottom: 6 }}>Client Secret</label>
                <input
                  type="password"
                  value={customClientSecret}
                  onChange={e => setCustomClientSecret(e.target.value)}
                  placeholder="••••••••••••••••"
                  style={{ width: '100%', padding: '10px 14px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: 10, color: 'var(--text)', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                />
              </div>
              <button type="submit" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%' }}>
                {saveSuccess ? <><Check size={14} /> Saved!</> : 'Save Credentials'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ── Logged in: Search screen ──────────────────────────────────────────────
  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '40px 56px 20px', flexShrink: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.4), transparent)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <h1 style={{ 
                fontSize: 42, 
                fontWeight: 900, 
                letterSpacing: '-1px',
                color: 'white'
              }}>
                Tidal Lossless
              </h1>
              <span className="quality-tag high-res" style={{ fontSize: 11 }}>FLAC</span>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>Search and download CD-quality lossless tracks to your library.</p>
          </div>
          <button
            onClick={handleLogout}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: 'var(--glass)', border: '1px solid var(--glass-border)', borderRadius: 10, color: 'var(--text-dim)', fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0, marginTop: 8, transition: 'color 0.15s, border-color 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.3)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-border)'; }}
          >
            <LogOut size={14} /> Logout
          </button>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <div style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }}>
              <Search size={17} />
            </div>
            <input
              type="text"
              placeholder="Search tracks, artists, albums…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '14px 20px 14px 48px',
                borderRadius: 14,
                border: '1px solid var(--glass-border)',
                background: 'rgba(0,0,0,0.3)',
                color: 'var(--text)',
                fontSize: 15,
                fontWeight: 500,
                outline: 'none',
                fontFamily: 'inherit',
                boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.2)',
              }}
            />
          </div>

          <select
            value={selectedRegion}
            onChange={e => { setSelectedRegion(e.target.value); localStorage.setItem('tidal_region', e.target.value); }}
            style={{
              padding: '14px 36px 14px 16px',
              borderRadius: 14,
              border: '1px solid var(--glass-border)',
              background: 'rgba(0,0,0,0.3)',
              color: 'var(--text)',
              fontSize: 13,
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%237b8ba8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
              minWidth: 130,
            }}
          >
            {REGIONS.map(r => (
              <option key={r.code} value={r.code} style={{ background: '#0c0c14' }}>{r.label}</option>
            ))}
          </select>
        </form>

        {/* Error banner */}
        {errorMsg && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, marginTop: 12 }}>
            <AlertCircle size={15} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.5 }}>{errorMsg}</span>
          </div>
        )}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 56px 40px', scrollbarWidth: 'thin', scrollbarColor: 'var(--glass-border) transparent' }}>
        {searching ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16, color: 'var(--text-dim)' }}>
            <Loader2 size={28} className="pulse" />
            <span style={{ fontSize: 14 }}>Scanning Tidal catalog…</span>
          </div>
        ) : results.length > 0 ? (
          <table className="track-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}></th>
                <th>Title</th>
                <th>Album</th>
                <th style={{ width: 70 }}>Quality</th>
                <th style={{ width: 60, textAlign: 'right' }}>Time</th>
                <th style={{ width: 52, textAlign: 'center' }}>Get</th>
              </tr>
            </thead>
            <tbody>
              {results.map(track => {
                const dlState = downloads[track.id];
                const isHiRes = track.quality === 'HI_RES' || track.quality === 'HI_RES_LOSSLESS';
                return (
                  <tr key={track.id} className="track-row">
                    <td>
                      <div style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                        {track.cover_url
                          ? <img src={track.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Music2 size={14} color="var(--text-dim)" /></div>
                        }
                      </div>
                    </td>
                    <td>
                      <div className="track-name" style={{ fontSize: 14 }}>{track.title}</div>
                      <div className="track-sub">{track.artist}</div>
                    </td>
                    <td>
                      <div className="track-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{track.album}</div>
                    </td>
                    <td>
                      <span className={`quality-tag${isHiRes ? ' high-res' : ''}`}>
                        {isHiRes ? 'HI-RES' : 'LOSSLESS'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="track-sub">{fmt(track.duration)}</div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {dlState === 'done' ? (
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <Check size={15} style={{ color: '#10b981' }} />
                        </div>
                      ) : dlState === 'downloading' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 100 }}>
                          <Loader2 size={12} className="pulse" style={{ color: 'var(--accent)', marginBottom: 4 }} />
                          {downloadProgress[track.id] ? (
                            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                                {Math.round(downloadProgress[track.id].percent)}%
                              </span>
                              {/* Horizontal Progress Bar */}
                              <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${downloadProgress[track.id].percent}%`, background: 'var(--accent)', transition: 'width 0.2s ease-out' }} />
                              </div>
                              <span style={{ fontSize: 8, color: 'var(--text-dim)', fontWeight: 500, textAlign: 'center' }}>
                                {downloadProgress[track.id].downloaded_mb.toFixed(1)}/{downloadProgress[track.id].total_mb.toFixed(1)} MB
                              </span>
                            </div>
                          ) : (
                            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 600 }}>Connecting...</span>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDownload(track)}
                          className="icon-btn"
                          title={`Download ${track.title}`}
                          style={{ background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-dim)', cursor: 'pointer', width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', margin: '0 auto' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--glass-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; }}
                        >
                          <Download size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16, opacity: 0.4 }}>
            <Search size={44} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Search Tidal's lossless catalog</div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Try "Daft Punk", "Katy Perry Roar", or an album name.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
