import { useEffect, useRef, useState, useMemo } from 'react';
import { useStore } from './store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Library, Headphones, SlidersHorizontal, Settings2, Settings, Play, Pause, SkipBack, SkipForward, Shuffle, Square, FolderSearch, Volume2, X, Activity, RefreshCw, Radio } from 'lucide-react';
import './App.css';
import defaultCover from './assets/default_cover.png';

/* ─── helpers ───────────────────────────────────────── */
function fmt(s: number | null) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function baseName(p: string | null) {
  return p ? (p.split(/[\\/]/).pop() ?? p) : '—';
}

/* ─── Sidebar ────────────────────────────────────────── */
function Sidebar() {
  const { view, setView, toggleSettings } = useStore();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-name">Aideo</span>
      </div>

      {/* Navigation */}
      <div className={`nav-item ${view === 'library' ? 'active' : ''}`} onClick={() => setView('library')}>
        <Library size={18} /> Library
      </div>
      <div className={`nav-item ${view === 'nowplaying' ? 'active' : ''}`} onClick={() => setView('nowplaying')}>
        <Headphones size={18} /> Now Playing
      </div>

      {/* Settings */}
      <div style={{ marginTop: 'auto' }} className={`nav-item`} onClick={toggleSettings}>
        <Settings size={18} /> Settings
      </div>
    </aside>
  );
}

/* ─── Smart Thumbnail ────────────────────────────────── */
function TrackThumbnail({ path }: { path: string }) {
  const [art, setArt] = useState<string | null>(null);

  useEffect(() => {
    // Only fetch if not already loaded
    if (!art) {
      invoke('get_cover_art', { path }).then((res: any) => {
        if (res && typeof res === 'string') setArt(res);
      }).catch(() => { });
    }
  }, [path]);

  return (
    <div className="lib-thumb-mini">
      <img src={art || defaultCover} alt="" />
    </div>
  );
}

/* ─── Library ────────────────────────────────────────── */
function LibraryView() {
  const { tracks, playback, playTrack, setView } = useStore();
  return (
    <div className="library-wrap">
      <h1 className="library-title">Music Library</h1>
      {tracks.length === 0 && (
        <p style={{ color: 'var(--text-dim)' }}>No tracks yet. Select a folder and press "Scan Library".</p>
      )}
      {tracks.length > 0 && (
        <table className="track-table">
          <thead>
            <tr>
              <th style={{ width: 48, textAlign: 'center' }}>#</th>
              <th style={{ width: 48 }}></th>
              <th>Title</th>
              <th>Artist</th>
              <th style={{ width: 80 }}>Quality</th>
              <th style={{ width: 72, textAlign: 'right' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t, i) => {
              const active = playback.current_track === t.path;
              const isHighRes = t.format?.toLowerCase() === 'flac' || t.format?.toLowerCase() === 'wav';

              return (
                <tr key={t.id} className={`track-row${active ? ' playing' : ''}`}
                  onClick={() => { playTrack(t); setView('nowplaying'); }}>
                  <td style={{ textAlign: 'center', color: active ? 'var(--accent)' : 'var(--text-dim)', fontSize: 12 }}>
                    {active ? '▶' : i + 1}
                  </td>
                  <td>
                    <TrackThumbnail path={t.path} />
                  </td>
                  <td>
                    <div className="track-name">{t.title || baseName(t.path)}</div>
                  </td>
                  <td>
                    <div className="track-sub">{t.artist || '—'}</div>
                  </td>
                  <td>
                    {t.format && (
                      <span className={`quality-tag ${isHighRes ? 'high-res' : ''}`}>
                        {t.format.toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="track-sub">{fmt(t.duration)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─── Lyrics ─────────────────────────────────────────── */
interface SearchResult { id: string; title: string; artist: string; source: string; content_id?: string; raw_lrc?: string; cover_url?: string; }
function LyricsPanel() {
  const { lyrics, playback, lyricOffset, lyricStatus, seek, adjustLyricOffset, saveLyrics, tracks, translateLyrics, getRomaji, isTranslating, showRomaji, setShowRomaji, applyOnlineCover } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolling, setUserScrolling] = useState(false);
  const userScrollTimer = useRef<number | null>(null);
  const [showFinder, setShowFinder] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [editContent, setEditContent] = useState('');

  const currentTrack = tracks.find(t => t.path === playback.current_track);

  const activeIdx = useMemo(() => {
    if (!lyrics.length) return -1;
    const now = playback.position_secs + lyricOffset / 1000;
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time_secs <= now) idx = i; else break;
    }
    return idx;
  }, [lyrics, playback.position_secs, lyricOffset]);

  useEffect(() => {
    if (userScrolling || !scrollRef.current || activeIdx === -1) return;
    const el = scrollRef.current.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIdx, userScrolling]);

  const onScroll = () => {
    setUserScrolling(true);
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current);
    userScrollTimer.current = window.setTimeout(() => setUserScrolling(false), 3500);
  };

  const doSearch = async () => {
    if (!currentTrack) return;
    setSearching(true); setShowFinder(true); setResults([]);
    try {
      const r: SearchResult[] = await invoke('search_lyrics_online', {
        artist: currentTrack.artist ?? '',
        title: currentTrack.title ?? baseName(currentTrack.path),
      });
      setResults(r);
    } catch (e) { console.error(e); } finally { setSearching(false); }
  };

  const pickResult = async (r: SearchResult, mode: 'lyrics' | 'art' | 'both') => {
    setSearching(true);
    try {
      if (!playback.current_track) return;

      if (mode === 'lyrics' || mode === 'both') {
        let lrc = r.raw_lrc ?? '';
        if (!lrc && r.source === 'NetEase' && r.content_id)
          lrc = await invoke<string>('get_netease_lrc', { id: r.content_id }).catch(() => '');
        if (!lrc && r.source === 'QQMusic' && r.content_id)
          lrc = await invoke<string>('get_qqmusic_lrc', { mid: r.content_id }).catch(() => '');

        if (lrc) {
          await saveLyrics(playback.current_track, lrc);
        }
      }

      if ((mode === 'art' || mode === 'both') && r.cover_url) {
        await applyOnlineCover(playback.current_track, r.cover_url);
      }

      setShowFinder(false);
    } catch (e) { console.error(e); } finally { setSearching(false); }
  };

  return (
    <div className="np-right">
      {/* Toolbar */}
      <div className="lyrics-toolbar">
        <div className="sync-controls">
          <button className="lyric-btn" title="Make lyrics appear earlier" onClick={() => adjustLyricOffset(-100)}>–</button>
          <div className="sync-value" onClick={() => adjustLyricOffset(-lyricOffset)} title="Click to reset">
            {lyricOffset > 0 ? `+${lyricOffset}` : lyricOffset}ms
          </div>
          <button className="lyric-btn" title="Make lyrics appear later" onClick={() => adjustLyricOffset(100)}>+</button>
        </div>

        <button className="lyric-btn" onClick={doSearch}>🔍 Finder</button>
        <button className="lyric-btn" onClick={() => {
          // Join existing lyrics back into LRC format for editing
          const raw = lyrics.map(l => `[${fmt(l.time_secs).padStart(5, '0')}.00]${l.text}`).join('\n');
          setEditContent(raw);
          setShowEditor(true);
        }}>✍️ Studio</button>

        {/* Status Indicator */}
        <div style={{
          marginLeft: 'auto', marginRight: 12, fontSize: 10, fontWeight: 700,
          letterSpacing: 1, textTransform: 'uppercase',
          color: lyricStatus === 'loading' ? 'var(--accent)' : lyricStatus === 'not_found' ? '#ef4444' : 'var(--text-dim)',
          display: 'flex', alignItems: 'center', gap: 6
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: lyricStatus === 'loading' ? 'var(--accent)' : lyricStatus === 'not_found' ? '#ef4444' : lyricStatus === 'found' ? '#10b981' : 'transparent',
            boxShadow: lyricStatus === 'found' ? '0 0 8px #10b981' : 'none',
            animation: lyricStatus === 'loading' ? 'pulse 1.5s infinite' : 'none'
          }} />
          {lyricStatus === 'loading' ? 'Searching...' : lyricStatus === 'found' ? 'Synced' : lyricStatus === 'not_found' ? 'No Lyrics' : ''}
        </div>
        <button className={`lyric-btn ${isTranslating ? 'active' : ''}`} onClick={translateLyrics} disabled={isTranslating}>
          {isTranslating ? 'Working…' : '🌐 Translate'}
        </button>
        <button
          className={`lyric-btn ${showRomaji ? 'active' : ''}`}
          disabled={isTranslating}
          onClick={async () => {
            // Fetch romaji if lyrics exist but don't have it yet
            const hasRomaji = lyrics.some(l => l.romaji);
            if (!hasRomaji && lyrics.length > 0) await getRomaji();
            setShowRomaji(!showRomaji);
          }}
        >
          {isTranslating ? 'Working…' : 'Romaji'}
        </button>
      </div>

      {/* Lyrics scroll */}
      <div className="lyrics-fade-wrap">
        <div className="lyrics-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="lyric-spacer-top" />
          {lyrics.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 16, padding: '48px 24px' }}>
              {lyricStatus === 'loading' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <RefreshCw size={32} className="spin" style={{ color: 'var(--accent)' }} />
                  <div style={{ fontSize: 14 }}>Fetching lyrics...</div>
                </div>
              ) : lyricStatus === 'not_found' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <X size={32} style={{ color: '#ef4444' }} />
                  <div style={{ fontSize: 14 }}>No lyrics found in file.</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={doSearch}>Try Online Finder</button>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => { setEditContent(''); setShowEditor(true); }}>Open Studio</button>
                  </div>
                </div>
              ) : (
                <>No lyrics. Click <strong>Finder</strong> to search online.</>
              )}
            </div>
          ) : (
            lyrics.map((l, i) => (
              <div key={i} data-idx={i} className={`lyric-line${i === activeIdx ? ' active' : ''}`}
                onClick={() => seek(l.time_secs - lyricOffset / 1000)}>
                <div>{l.text || '♪'}</div>
                {showRomaji && l.romaji && l.romaji !== l.text && <div className="lyric-romaji">{l.romaji}</div>}
                {l.translation && <div className="lyric-translation">{l.translation}</div>}
              </div>
            ))
          )}
          <div className="lyric-spacer-bottom" />
        </div>
      </div>

      {/* Lyric Finder Modal */}
      <AnimatePresence>
        {showFinder && (
          <div className="modal-overlay" onClick={() => setShowFinder(false)}>
            <motion.div className="modal-box" onClick={e => e.stopPropagation()}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}>
              <div className="modal-header">
                <h3>Lyric Finder</h3>
                <button className="modal-close" onClick={() => setShowFinder(false)}>✕</button>
              </div>
              <div className="modal-body">
                {searching && results.length === 0 && <div className="modal-empty">Searching…</div>}
                {!searching && results.length === 0 && <div className="modal-empty">No results found.</div>}
                {results.map((r, i) => (
                  <div key={i} className="modal-item" style={{ display: 'flex', alignItems: 'center', cursor: 'default' }}>
                    {r.cover_url && <img src={r.cover_url} alt="cover" style={{ width: 36, height: 36, borderRadius: 4, marginRight: 12, objectFit: 'cover' }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="modal-item-title">{r.title}</div>
                      <div className="modal-item-sub">{r.artist} · {r.source}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn btn-secondary" style={{ fontSize: 10, padding: '4px 8px' }}
                        onClick={() => pickResult(r, 'lyrics')}>
                        🎵 Lyrics
                      </button>
                      {r.cover_url && (
                        <button className="btn btn-secondary" style={{ fontSize: 10, padding: '4px 8px' }}
                          onClick={() => pickResult(r, 'art')}>
                          ✨ Art
                        </button>
                      )}
                      {r.cover_url && (
                        <button className="btn btn-primary" style={{ fontSize: 10, padding: '4px 8px' }}
                          onClick={() => pickResult(r, 'both')}>
                          Both
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lyric Editor Modal (Studio) */}
      <AnimatePresence>
        {showEditor && (
          <div className="modal-overlay" onClick={() => setShowEditor(false)}>
            <motion.div className="modal-box" onClick={e => e.stopPropagation()}
              style={{ width: 600, height: 700 }}
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}>
              <div className="modal-header">
                <div>
                  <h3 style={{ margin: 0 }}>Lyric Studio</h3>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Paste your LRC text or AI-generated lyrics below.</div>
                </div>
                <button className="modal-close" onClick={() => setShowEditor(false)}>✕</button>
              </div>
              <div className="modal-body" style={{ padding: 0 }}>
                <textarea
                  className="studio-editor"
                  placeholder="Paste lyrics here... 
Example:
[00:12.50]Hello world
[00:15.00]This is Aideo"
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                />
              </div>
              <div className="modal-footer" style={{ padding: '0 24px 24px', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button className="btn btn-secondary" style={{ width: 'auto', padding: '10px 24px' }} onClick={() => setShowEditor(false)}>Cancel</button>
                <button className="btn btn-primary" style={{ width: 'auto', padding: '10px 32px' }} onClick={async () => {
                  if (playback.current_track) {
                    await saveLyrics(playback.current_track, editContent);
                    setShowEditor(false);
                  }
                }}>Save to File</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Audio Control Center ─────────────────────────────── */
function AudioControlCenter() {
  const { dsp, setDSP, resetProMode, playback, toggleExclusive, devices, currentDevice, setAudioDevice, showControlCenter, toggleControlCenter, fetchDevices } = useStore();
  const [devOpen, setDevOpen] = useState(false);

  useEffect(() => {
    if (showControlCenter) fetchDevices();
  }, [showControlCenter]);

  if (!showControlCenter) return null;

  return (
    <div className="modal-overlay" onClick={toggleControlCenter} style={{ backdropFilter: 'blur(16px)', background: 'rgba(0,0,0,0.6)' }}>
      <motion.div className="modal-box" onClick={e => e.stopPropagation()}
        style={{ width: 800, maxWidth: '90vw', height: 600, maxHeight: '90vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Activity size={24} color="var(--accent)" />
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Audio Engine</h2>
          </div>
          <button className="modal-close" onClick={toggleControlCenter}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Column: DSP / Soundstage */}
          <div style={{ flex: 2, padding: 32, borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 48 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={18} /> Soundstage Engine
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={resetProMode}>Reset</button>
                <button className={`btn ${dsp.enabled ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDSP({ enabled: !dsp.enabled })}>
                  {dsp.enabled ? 'Engine: ON' : 'Engine: OFF'}
                </button>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 32 }}>
              <div style={{ width: '100%', maxWidth: 500 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: dsp.width < 1.0 ? 'var(--accent)' : 'var(--text-dim)', transition: 'color 0.2s' }}>
                    HEADPHONE CROSSFEED
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: dsp.width > 1.0 ? 'var(--accent)' : 'var(--text-dim)', transition: 'color 0.2s' }}>
                    SPATIAL WIDENER
                  </span>
                </div>

                <input type="range" min={0} max={3} step={0.01} value={dsp.width}
                  style={{ width: '100%', height: 6, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  onChange={e => setDSP({ width: +e.target.value })} />

                <div style={{ marginTop: 24, textAlign: 'center' }}>
                  <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--accent)', fontFamily: 'monospace' }}>
                    {Math.round(dsp.width * 100)}%
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8, textTransform: 'uppercase', letterSpacing: 2 }}>
                    {dsp.width === 1.0 ? 'Natural Stereo' : dsp.width < 1.0 ? 'Focused Center' : 'Immersive Width'}
                  </div>
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: 24, borderRadius: 16, maxWidth: 400, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                <p style={{ margin: 0 }}>
                  {dsp.width < 1.0
                    ? "Crossfeed blends stereo channels to reduce ear fatigue when using headphones, simulating the natural sound of speakers."
                    : dsp.width > 1.0
                      ? "Spatial widening uses mid/side processing to expand the soundstage, making instruments feel more distinct and immersive."
                      : "Music is playing in its original stereo master format with zero processing."}
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Hardware & Output */}
          <div style={{ flex: 1, padding: 32, background: 'rgba(255,255,255,0.02)' }}>
            <h3 style={{ margin: 0, marginBottom: 24, fontSize: 16, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Settings2 size={18} /> Output Hardware
            </h3>

            {/* Device Selector */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Playback Device</div>
              <div className="device-selector" style={{ position: 'relative' }}>
                <div className="current-device" onClick={() => setDevOpen(o => !o)} style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{currentDevice || 'System Default'}</span>
                  <span style={{ color: 'var(--text-dim)' }}>▾</span>
                </div>
                <AnimatePresence>
                  {devOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1200, background: '#1a1a24', border: '1px solid var(--glass-border)', borderRadius: 8, marginTop: 4, overflow: 'hidden', maxHeight: 200, overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                      {devices.length === 0 && <div style={{ padding: 12, fontSize: 11, color: 'var(--text-dim)' }}>No devices found</div>}
                      {devices.map(d => (
                        <div key={d} onClick={() => { setAudioDevice(d); setDevOpen(false); }}
                          style={{
                            padding: '12px 16px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--glass-border)',
                            color: currentDevice === d ? 'var(--accent)' : 'var(--text)', background: currentDevice === d ? 'rgba(var(--accent-rgb),0.1)' : ''
                          }}>
                          {d}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Exclusive Mode */}
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Audio API</div>
              <div className={`exclusive-toggle ${playback.exclusive ? 'active' : ''}`} onClick={toggleExclusive} style={{ padding: '16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: playback.exclusive ? 'rgba(var(--accent-rgb), 0.1)' : 'rgba(0,0,0,0.2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Exclusive Mode</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 12, background: playback.exclusive ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: playback.exclusive ? '#fff' : 'var(--text-dim)' }}>
                    {playback.exclusive ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.4 }}>
                  Bypass the OS mixer for bit-perfect output. Takes exclusive control of the DAC.
                </div>
              </div>
            </div>

          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Now Playing ────────────────────────────────────── */
function NowPlayingView() {
  const { tracks, playback, coverArt, accentColor } = useStore();
  const current = tracks.find(t => t.path === playback.current_track);

  // Apply dynamic accent colour as CSS variable on root
  useEffect(() => {
    document.documentElement.style.setProperty('--dynamic-accent', accentColor);
    // Derive an rgb version so rgba() works
    const m = accentColor.match(/\d+/g);
    if (m && m.length >= 3) {
      document.documentElement.style.setProperty('--accent-rgb', `${m[0]},${m[1]},${m[2]}`);
    }
  }, [accentColor]);

  if (!playback.current_track) {
    return (
      <div className="nowplaying">
        <div className="np-empty" style={{ gridColumn: '1/3' }}>
          <span>💿</span>
          <h2>Nothing playing</h2>
          <p>Select a track from the Library to begin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="nowplaying">
      {/* Blurred background */}
      {coverArt && (
        <div className="np-bg" style={{ backgroundImage: `url(${coverArt})` }} />
      )}

      {/* Art + Meta — fixed left column */}
      <div className="np-left">
        <div className={`np-art-wrap${coverArt ? ' has-art' : ''}`}>
          <img src={coverArt || defaultCover} alt="cover" className="np-art" />
        </div>
        <div className="np-meta">
          <div className="np-title">{current?.title || baseName(playback.current_track)}</div>
          <div className="np-artist">{current?.artist || 'Unknown Artist'}</div>
        </div>
      </div>

      {/* Lyrics — right column */}
      <LyricsPanel />
    </div>
  );
}

/* ─── Player Bar ─────────────────────────────────────── */
function PlayerBar() {
  const {
    view, tracks, playback, coverArt, lyrics, lyricOffset,
    pauseTrack, resumeTrack, stopTrack, setVolume, seek, setView,
    playNext, playPrev, shuffle, toggleShuffle,
  } = useStore();

  const activeLyric = useMemo(() => {
    if (!lyrics.length) return null;
    const now = playback.position_secs + lyricOffset / 1000;
    let current = null;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time_secs <= now) current = lyrics[i]; else break;
    }
    return current;
  }, [lyrics, playback.position_secs, lyricOffset]);

  const current = tracks.find(t => t.path === playback.current_track);
  const duration = current?.duration ?? 0;
  const pct = duration > 0 ? (playback.position_secs / duration) * 100 : 0;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div className="player-bar">
      {/* LEFT */}
      <div className="pb-left">
        <div className="pb-thumb" onClick={() => setView('nowplaying')}>
          <img src={coverArt || defaultCover} alt="" />
        </div>
        <div className="pb-info" onClick={() => setView('nowplaying')}>
          <div className="pb-title">{current?.title || baseName(playback.current_track)}</div>
          <div className="pb-artist">{current?.artist || '—'}</div>
        </div>
      </div>

      {/* CENTER */}
      <div className="pb-center">
        {activeLyric && view !== 'nowplaying' && (
          <div className="pb-lyric" onClick={() => setView('nowplaying')}>
            {activeLyric.text}
          </div>
        )}
        <div className="pb-buttons">
          <button className={`pb-btn ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle">
            <Shuffle size={16} />
          </button>
          <button className="pb-btn" onClick={playPrev} title="Previous">
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button className="pb-btn play" onClick={playback.status === 'Playing' ? pauseTrack : resumeTrack}>
            {playback.status === 'Playing' ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" style={{ marginLeft: 3 }} />}
          </button>
          <button className="pb-btn" onClick={playNext} title="Next">
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button className="pb-btn" onClick={stopTrack} title="Stop">
            <Square size={14} fill="currentColor" />
          </button>
        </div>
        <div className="progress-row">
          <span className="prog-time">{fmt(playback.position_secs)}</span>
          <div className="prog-track" onClick={handleSeek}>
            <div className="prog-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="prog-time">{fmt(duration)}</span>
        </div>
      </div>

      {/* RIGHT */}
      <div className="pb-right" style={{ gap: 16 }}>
        {playback.exclusive && <span className="bit-badge" style={{ transform: 'none' }}>BIT-PERFECT</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Volume2 size={16} color="var(--text-dim)" />
          <input className="vol-slider" type="range" min={0} max={1} step={0.01} style={{ width: 80 }}
            value={playback.volume} onChange={e => setVolume(+e.target.value)} />
        </div>
        <button className="pb-btn" onClick={() => useStore.getState().toggleControlCenter()} title="Audio Engine Settings">
          <SlidersHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}

/* ─── Settings Modal ────────────────────────────────────── */
function SettingsModal() {
  const { 
    showSettings, toggleSettings, scanDirs, addScanDir, removeScanDir, scanLibrary, scanStatus, 
    toggleScrobble, setLastFmSession, lastfmSessionKey, lastfmToken,
    scrobbleThreshold, setScrobbleThreshold
  } = useStore();
  const [activeTab, setActiveTab] = useState('library');
  const [lfmLoading, setLfmLoading] = useState(false);
  const [lfmError, setLfmError] = useState('');

  if (!showSettings) return null;

  const browse = async () => {
    const sel = await open({ directory: true, multiple: false }).catch(() => null);
    if (sel && typeof sel === 'string') addScanDir(sel);
  };

  return (
    <div className="modal-overlay" onClick={toggleSettings} style={{ backdropFilter: 'blur(16px)', background: 'rgba(0,0,0,0.6)' }}>
      <motion.div className="modal-box" onClick={e => e.stopPropagation()}
        style={{ width: 800, maxWidth: '90vw', height: 600, maxHeight: '90vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Settings size={24} color="var(--accent)" />
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Settings</h2>
          </div>
          <button className="modal-close" onClick={toggleSettings}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Tabs Sidebar */}
          <div style={{ width: 200, padding: 24, borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className={`nav-item ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>
              <Library size={18} /> Library
            </div>
            <div className={`nav-item ${activeTab === 'services' ? 'active' : ''}`} onClick={() => setActiveTab('services')}>
              <Radio size={18} /> Services
            </div>
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
            {activeTab === 'library' && (
              <div>
                <h3 style={{ margin: 0, marginBottom: 24, fontSize: 18, fontWeight: 500 }}>Library Folders</h3>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>
                  Add multiple folders to your library. Aideo will scan all of them and aggregate your music.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {scanDirs.map(dir => (
                    <div key={dir} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8 }}>
                      <span style={{ fontSize: 13, wordBreak: 'break-all' }}>{dir}</span>
                      <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => removeScanDir(dir)}>Remove</button>
                    </div>
                  ))}
                  {scanDirs.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-dim)', padding: 16, textAlign: 'center', background: 'rgba(0,0,0,0.1)', borderRadius: 8 }}>No folders tracked.</div>}
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <button className="btn btn-secondary" onClick={browse}>
                    <FolderSearch size={16} style={{ marginRight: 8 }} /> Add Folder
                  </button>
                  <button className="btn btn-primary" onClick={scanLibrary} disabled={scanDirs.length === 0}>
                    <RefreshCw size={16} style={{ marginRight: 8 }} /> Sync Library
                  </button>
                  <span style={{ fontSize: 13, color: 'var(--text-dim)', marginLeft: 8 }}>{scanStatus}</span>
                </div>
              </div>
            )}

            {activeTab === 'services' && (
              <div>
                <h3 style={{ margin: 0, marginBottom: 24, fontSize: 18, fontWeight: 500 }}>Connected Services</h3>
                <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>
                  Connect Aideo to external services like Last.fm to scrobble your listening history.
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, background: '#ba0000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 18 }}>
                      as
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Last.fm Scrobbling</div>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Automatically log songs you play to your Last.fm profile.</div>
                    </div>
                  </div>
                  {lastfmSessionKey ? (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>Active Connection</div>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '8px 20px' }}
                        onClick={toggleScrobble}
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {!lastfmToken ? (
                        <button 
                          className="btn btn-primary" 
                          style={{ padding: '8px 24px' }}
                          disabled={lfmLoading}
                          onClick={async () => {
                            setLfmLoading(true); setLfmError('');
                            try {
                              const token = await invoke<string>('lastfm_get_token');
                              useStore.setState({ lastfmToken: token });
                              // Open browser for authorization
                              // Replace YOUR_API_KEY below with your actual API key for this to work
                              const apiKey = "f4cbad896003f0f61f05b844ee3c5b0b"; 
                              await openUrl(`https://www.last.fm/api/auth/?api_key=${apiKey}&token=${token}`);
                            } catch (e: any) {
                              setLfmError(String(e));
                            } finally {
                              setLfmLoading(false);
                            }
                          }}
                        >
                          {lfmLoading ? 'Connecting...' : 'Connect to Last.fm'}
                        </button>
                      ) : (
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Waiting for Browser...</span>
                          <button 
                            className="btn btn-primary" 
                            style={{ padding: '8px 24px' }}
                            disabled={lfmLoading}
                            onClick={async () => {
                              setLfmLoading(true); setLfmError('');
                              try {
                                const session = await invoke<string>('lastfm_get_session', { token: lastfmToken });
                                setLastFmSession(session);
                                useStore.setState({ lastfmToken: null });
                              } catch (e: any) {
                                setLfmError("Could not find authorization. Did you click 'Allow' in your browser?");
                              } finally {
                                setLfmLoading(false);
                              }
                            }}
                          >
                            {lfmLoading ? 'Checking...' : 'I have Authorized'}
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={() => useStore.setState({ lastfmToken: null })}>Cancel</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {lastfmSessionKey && (
                  <div style={{ marginTop: 20, padding: '16px', background: 'var(--glass)', borderRadius: 12, border: '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>Scrobble Threshold</span>
                      <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>{scrobbleThreshold}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="10" max="100" step="5"
                      value={scrobbleThreshold}
                      onChange={(e) => setScrobbleThreshold(parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--accent)' }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
                      Song will be scrobbled after playing {scrobbleThreshold}% of its duration.
                    </div>
                  </div>
                )}
                {lfmError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 12, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 6 }}>{lfmError}</div>}
                <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                  Aideo uses official Web Auth. We never see or store your Last.fm password.
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Root ───────────────────────────────────────────── */
export default function App() {
  const { view, pollStatus, loadLibrary, lastScrobble } = useStore();

  useEffect(() => {
    loadLibrary();
    const id = setInterval(pollStatus, 200);

    let unlistenEnded: (() => void) | undefined;
    listen('track-ended', () => {
      useStore.getState().playNext();
    }).then(f => unlistenEnded = f);

    let unlistenChanged: (() => void) | undefined;
    listen<string>('track-changed', (event) => {
      useStore.getState().handleTrackTransition(event.payload);
    }).then(f => unlistenChanged = f);

    // OS Media Controls (souvlaki)
    let unlistenPlay: (() => void) | undefined;
    listen('media-play', () => useStore.getState().resumeTrack()).then(f => unlistenPlay = f);
    let unlistenPause: (() => void) | undefined;
    listen('media-pause', () => useStore.getState().pauseTrack()).then(f => unlistenPause = f);
    let unlistenToggle: (() => void) | undefined;
    listen('media-toggle', () => {
      const state = useStore.getState();
      if (state.playback.status === 'Playing') state.pauseTrack();
      else state.resumeTrack();
    }).then(f => unlistenToggle = f);
    let unlistenNext: (() => void) | undefined;
    listen('media-next', () => useStore.getState().playNext()).then(f => unlistenNext = f);
    let unlistenPrev: (() => void) | undefined;
    listen('media-prev', () => useStore.getState().playPrev()).then(f => unlistenPrev = f);

    // Global Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const key = e.keyCode || e.which;
      if (key === 32) { // Space
        e.preventDefault();
        const state = useStore.getState();
        if (state.playback.status === 'Playing') state.pauseTrack();
        else state.resumeTrack();
      } else if (key === 39) { // Right
        useStore.getState().playNext();
      } else if (key === 37) { // Left
        useStore.getState().playPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', handleKeyDown);
      if (unlistenEnded) unlistenEnded();
      if (unlistenChanged) unlistenChanged();
      if (unlistenPlay) unlistenPlay();
      if (unlistenPause) unlistenPause();
      if (unlistenToggle) unlistenToggle();
      if (unlistenNext) unlistenNext();
      if (unlistenPrev) unlistenPrev();
    };
  }, []);

  return (
    <div className="app">
      <Sidebar />
      <main className="app-main">
        <AnimatePresence mode="wait">
          {view === 'library' && (
            <motion.div key="lib" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LibraryView />
            </motion.div>
          )}
          {view === 'nowplaying' && (
            <motion.div key="np" style={{ height: '100%' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <NowPlayingView />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <PlayerBar />
      <AnimatePresence>
        <AudioControlCenter key="audio-cc" />
        <SettingsModal key="settings" />
        {lastScrobble && (
          <motion.div 
            key="scrobble-toast"
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="scrobble-toast"
          >
            <Radio size={14} className="pulse" />
            <span>Scrobbled: <strong>{lastScrobble.track}</strong></span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
