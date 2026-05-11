import { useEffect, useRef, useState, useMemo } from 'react';
import { useStore } from './store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import './App.css';

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
  const {
    view, setView, scanDir, setScanDir, scanStatus, scanLibrary,
    devices, currentDevice, fetchDevices, setAudioDevice,
    playback, toggleExclusive, showProMode, toggleProMode,
  } = useStore();
  const [devOpen, setDevOpen] = useState(false);

  useEffect(() => { fetchDevices(); }, []);

  const browse = async () => {
    const sel = await open({ directory: true, multiple: false }).catch(() => null);
    if (sel && typeof sel === 'string') setScanDir(sel);
  };

  return (
    <aside className="app-sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-name">Aideo</span>
      </div>

      {/* Navigation */}
      <div className={`nav-item ${view === 'library' ? 'active' : ''}`} onClick={() => setView('library')}>
        <span>📚</span> Library
      </div>
      <div className={`nav-item ${view === 'nowplaying' ? 'active' : ''}`} onClick={() => setView('nowplaying')}>
        <span>🎧</span> Now Playing
      </div>
      <div className={`nav-item ${showProMode ? 'active' : ''}`} onClick={toggleProMode}>
        <span>🎚️</span> Studio EQ
      </div>

      {/* Hardware section */}
      <div className="sidebar-section-label">Hardware</div>

      <div className={`exclusive-toggle ${playback.exclusive ? 'active' : ''}`} onClick={toggleExclusive}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Exclusive Mode</span>
          <span style={{ fontSize: 9, color: playback.exclusive ? 'var(--accent)' : 'var(--text-dim)' }}>
            {playback.exclusive ? 'ON' : 'OFF'}
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>Bit-perfect output</div>
      </div>

      <div className="device-selector">
        <div className="current-device" onClick={() => setDevOpen(o => !o)}>
          {currentDevice || 'System Default'} ▾
        </div>
        <AnimatePresence>
          {devOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1200,
                background: '#13131d', border: '1px solid var(--glass-border)', borderRadius: 12, marginTop: 4, overflow: 'hidden' }}>
              {devices.length === 0 && <div style={{ padding: 12, fontSize: 11, color: 'var(--text-dim)' }}>No devices found</div>}
              {devices.map(d => (
                <div key={d} onClick={() => { setAudioDevice(d); setDevOpen(false); }}
                  style={{ padding: '10px 14px', fontSize: 11, cursor: 'pointer', borderBottom: '1px solid var(--glass-border)',
                    color: currentDevice === d ? 'var(--accent)' : 'var(--text)', background: currentDevice === d ? 'rgba(var(--accent-rgb),0.06)' : '' }}>
                  {d}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Scan section */}
      <div className="scan-box">
        <button className="btn btn-secondary" onClick={browse}>📁 Select Folder</button>
        {scanDir && <div style={{ fontSize: 10, color: 'var(--text-dim)', margin: '6px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{scanDir}</div>}
        <button className="btn btn-primary" onClick={scanLibrary}>Scan Library</button>
        <div className="scan-status">{scanStatus}</div>
      </div>
    </aside>
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
              <th style={{ width: 52 }}>#</th>
              <th>Title</th>
              <th>Artist</th>
              <th style={{ width: 72 }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t, i) => {
              const active = playback.current_track === t.path;
              return (
                <tr key={t.id} className={`track-row${active ? ' playing' : ''}`}
                  onClick={() => { playTrack(t); setView('nowplaying'); }}>
                  <td style={{ color: active ? 'var(--accent)' : 'var(--text-dim)' }}>{active ? '▶' : i + 1}</td>
                  <td><div className="track-name">{t.title || baseName(t.path)}</div></td>
                  <td><div className="track-sub">{t.artist || 'Unknown'}</div></td>
                  <td><div className="track-sub">{fmt(t.duration)}</div></td>
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
  const { lyrics, playback, lyricOffset, seek, adjustLyricOffset, saveLyrics, tracks, translateLyrics, getRomaji, isTranslating, showRomaji, setShowRomaji, applyOnlineCover } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolling, setUserScrolling] = useState(false);
  const userScrollTimer = useRef<number | null>(null);
  const [showFinder, setShowFinder] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

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
        <button className="lyric-btn" onClick={() => adjustLyricOffset(-100)}>−100ms</button>
        <button className="lyric-btn" onClick={() => adjustLyricOffset(100)}>+100ms</button>
        <button className="lyric-btn" onClick={doSearch}>🔍 Finder</button>
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
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 16, padding: '24px 0' }}>
              No lyrics. Click <strong>Finder</strong> to search online.
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
    </div>
  );
}

/* ─── EQ ─────────────────────────────────────────────── */
function EQPanel() {
  const { eq, setEQ, resetProMode } = useStore();
  const BANDS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  return (
    <motion.div className="eq-panel"
      initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Studio Equalizer</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="lyric-btn" onClick={resetProMode}>Reset</button>
          <button className={`lyric-btn ${eq.enabled ? 'active' : ''}`} onClick={() => setEQ({ enabled: !eq.enabled })}>
            {eq.enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
      <div className="eq-bands">
        {eq.bands.map((v, i) => (
          <div key={i} className="eq-band">
            <input type="range" min={-12} max={12} step={0.5} value={v}
              style={{ writingMode: 'vertical-lr', direction: 'rtl', height: 120, width: 4, accentColor: 'var(--accent)' } as any}
              onChange={e => { const b = [...eq.bands] as typeof eq.bands; b[i] = +e.target.value; setEQ({ bands: b }); }} />
            <span>{BANDS[i]}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ─── Now Playing ────────────────────────────────────── */
function NowPlayingView() {
  const { tracks, playback, coverArt, accentColor, showProMode } = useStore();
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
          {coverArt
            ? <img src={coverArt} alt="cover" className="np-art" />
            : <div className="np-art-placeholder">🎵</div>
          }
        </div>
        <div className="np-meta">
          <div className="np-title">{current?.title || baseName(playback.current_track)}</div>
          <div className="np-artist">{current?.artist || 'Unknown Artist'}</div>
        </div>
      </div>

      {/* Lyrics — right column */}
      <LyricsPanel />

      {/* EQ overlay */}
      <AnimatePresence>{showProMode && <EQPanel />}</AnimatePresence>
    </div>
  );
}

/* ─── Player Bar ─────────────────────────────────────── */
function PlayerBar() {
  const {
    tracks, playback, coverArt,
    pauseTrack, resumeTrack, stopTrack, setVolume, seek, setView,
    playNext, playPrev, shuffle, toggleShuffle,
  } = useStore();

  const current  = tracks.find(t => t.path === playback.current_track);
  const duration = current?.duration ?? 0;
  const pct      = duration > 0 ? (playback.position_secs / duration) * 100 : 0;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div className="player-bar">
      {/* LEFT */}
      <div className="pb-left">
        <div className="pb-thumb" onClick={() => setView('nowplaying')}>
          {coverArt
            ? <img src={coverArt} alt="" />
            : <div className="no-art">🎵</div>
          }
        </div>
        <div className="pb-info" onClick={() => setView('nowplaying')}>
          <div className="pb-title">{current?.title || baseName(playback.current_track)}</div>
          <div className="pb-artist">{current?.artist || '—'}</div>
        </div>
      </div>

      {/* CENTER */}
      <div className="pb-center">
        <div className="pb-buttons">
          <button className={`pb-btn ${shuffle ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle">🔀</button>
          <button className="pb-btn" onClick={playPrev} title="Previous">⏮</button>
          <button className="pb-btn play" onClick={playback.status === 'Playing' ? pauseTrack : resumeTrack}>
            {playback.status === 'Playing' ? '⏸' : '▶'}
          </button>
          <button className="pb-btn" onClick={playNext} title="Next">⏭</button>
          <button className="pb-btn" onClick={stopTrack} style={{ fontSize: 14 }} title="Stop">⏹</button>
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
      <div className="pb-right">
        {playback.exclusive && <span className="bit-badge">BIT-PERFECT</span>}
        <input className="vol-slider" type="range" min={0} max={1} step={0.01}
          value={playback.volume} onChange={e => setVolume(+e.target.value)} />
      </div>
    </div>
  );
}

/* ─── Root ───────────────────────────────────────────── */
export default function App() {
  const { view, pollStatus, loadLibrary } = useStore();

  useEffect(() => {
    loadLibrary();
    const id = setInterval(pollStatus, 200);
    
    let unlisten: (() => void) | undefined;
    listen('track-ended', () => {
      useStore.getState().playNext();
    }).then(f => unlisten = f);

    return () => {
      clearInterval(id);
      if (unlisten) unlisten();
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
    </div>
  );
}
