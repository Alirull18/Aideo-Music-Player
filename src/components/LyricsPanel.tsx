import { useState, useRef, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, X } from 'lucide-react';

function fmt(s: number | null) {
  if (!s || isNaN(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function baseName(p: string | null) {
  return p ? (p.split(/[\\/]/).pop() ?? p) : '—';
}

interface SearchResult { id: string; title: string; artist: string; source: string; content_id?: string; raw_lrc?: string; cover_url?: string; }

export function LyricsPanel() {
  const { lyrics, playback, lyricOffset, lyricStatus, seek, adjustLyricOffset, saveLyrics, tracks, translateLyrics, getRomaji, isTranslating, showRomaji, setShowRomaji, applyOnlineCover, setCustomPrompt } = useStore();
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
    if (el) {
      const container = scrollRef.current;
      const targetTop = el.offsetTop - (container.clientHeight / 2) + (el.clientHeight / 2);
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }, [activeIdx, userScrolling]);

  const onScroll = () => {
    setUserScrolling(true);
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current);
    userScrollTimer.current = window.setTimeout(() => setUserScrolling(false), 3500);
  };

  const doSearch = async (manualQuery?: string) => {
    if (!currentTrack && !manualQuery) return;
    setSearching(true); setShowFinder(true); setResults([]);
    try {
      const query = manualQuery || `${currentTrack?.artist ?? ''} ${currentTrack?.title ?? baseName(currentTrack?.path ?? '')}`;
      const r: SearchResult[] = await invoke('search_lyrics_online', { query });
      setResults(r);
    } catch (e) { 
      console.error(e); 
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Lyric search failed: ${e}`, type: 'error' } }));
    } finally { setSearching(false); }
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
    } catch (e) { 
      console.error(e); 
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to download lyric/art: ${e}`, type: 'error' } }));
    } finally { setSearching(false); }
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

        <button className="lyric-btn" onClick={() => doSearch()}>🔍 Auto</button>
        <button className="lyric-btn" onClick={() => {
          setCustomPrompt({
            open: true,
            title: 'Manual Lyric Search',
            placeholder: 'Enter Artist and Track Name...',
            initialValue: `${currentTrack?.artist ?? ''} ${currentTrack?.title ?? ''}`.trim(),
            actionLabel: 'Search Online',
            onSubmit: (val) => doSearch(val)
          });
        }}>🔍 Manual</button>

        <button className="lyric-btn" onClick={() => {
          const raw = lyrics.map(l => `[${fmt(l.time_secs).padStart(5, '0')}.00]${l.text}`).join('\n');
          setEditContent(raw);
          setShowEditor(true);
        }}>✍️ Studio</button>

        {/* Status Indicator */}
        <div style={{
          fontSize: 10, fontWeight: 700,
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
                    <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => doSearch()}>Try Online Finder</button>
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
                  placeholder="Paste lyrics here..."
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
