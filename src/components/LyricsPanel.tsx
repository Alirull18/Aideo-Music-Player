import { useState, useRef, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, X } from 'lucide-react';
import { fmt, baseName } from '../utils';

interface SearchResult { id: string; title: string; artist: string; source: string; content_id?: string; raw_lrc?: string; duration?: number; }

export function LyricsPanel() {
  const { currentTrack, lyrics, playback, lyricOffset, lyricStatus, seek, adjustLyricOffset, saveLyrics, translateLyrics, getRomaji, isTranslating, showRomaji, setShowRomaji, setCustomPrompt } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lyricMode, setLyricMode] = useState<'lrc' | 'text'>(() => {
    return (localStorage.getItem('aideo-lyric-mode') as 'lrc' | 'text') || 'lrc';
  });

  useEffect(() => {
    localStorage.setItem('aideo-lyric-mode', lyricMode);
  }, [lyricMode]);
  const [userScrolling, setUserScrolling] = useState(false);
  const userScrollTimer = useRef<number | null>(null);
  const [showFinder, setShowFinder] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [editContent, setEditContent] = useState('');
  const [showFallbackSearch, setShowFallbackSearch] = useState(false);

  useEffect(() => {
    if (lyricStatus === 'loading') {
      const timer = setTimeout(() => {
        setShowFallbackSearch(true);
      }, 10000);
      return () => clearTimeout(timer);
    } else {
      setShowFallbackSearch(false);
    }
  }, [lyricStatus]);

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
    if (lyricMode === 'text' || userScrolling || !scrollRef.current || activeIdx === -1) return;
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

  const pickResult = async (r: SearchResult) => {
    setSearching(true);
    try {
      if (!playback.current_track) return;

      let lrc = r.raw_lrc ?? '';
      if (!lrc && r.source === 'NetEase' && r.content_id)
        lrc = await invoke<string>('get_netease_lrc', { id: r.content_id }).catch(() => '');
      if (!lrc && r.source === 'QQMusic' && r.content_id)
        lrc = await invoke<string>('get_qqmusic_lrc', { mid: r.content_id }).catch(() => '');

      if (lrc) {
        await saveLyrics(playback.current_track, lrc);

        if (currentTrack && currentTrack.duration && r.duration) {
          const diffSec = currentTrack.duration - r.duration;
          if (diffSec > 2 && diffSec < 120) {
            const calculatedMs = Math.round(diffSec * 10) * 100;
            adjustLyricOffset(calculatedMs);
            window.dispatchEvent(new CustomEvent('ui-toast', { 
              detail: { message: `✨ Sync: Adjusted lyric offset by +${(calculatedMs/1000).toFixed(1)}s to match video length`, type: 'info' } 
            }));
          }
        }
      }

      setShowFinder(false);
    } catch (e) { 
      console.error(e); 
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to download lyric: ${e}`, type: 'error' } }));
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
        <button
          className="lyric-btn"
          onClick={() => setLyricMode(prev => prev === 'lrc' ? 'text' : 'lrc')}
        >
          {lyricMode === 'lrc' ? '📄 Plain Text' : '⏱️ Synced LRC'}
        </button>
      </div>

      {/* Lyrics scroll */}
      <div className={`lyrics-fade-wrap ${lyricMode === 'text' ? 'plain-mode' : ''}`}>
        <div className="lyrics-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="lyric-spacer-top" />
          {lyrics.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 16, padding: '48px 24px' }}>
              {lyricStatus === 'loading' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <RefreshCw size={32} className="spin" style={{ color: 'var(--accent)' }} />
                  <div style={{ fontSize: 14 }}>Fetching lyrics...</div>
                  {showFallbackSearch && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                        Taking longer than expected. Search online or edit:
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => doSearch()}>
                          🔍 Auto
                        </button>
                        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => {
                          setCustomPrompt({
                            open: true,
                            title: 'Manual Lyric Search',
                            placeholder: 'Enter Artist and Track Name...',
                            initialValue: `${currentTrack?.artist ?? ''} ${currentTrack?.title ?? ''}`.trim(),
                            actionLabel: 'Search Online',
                            onSubmit: (val) => doSearch(val)
                          });
                        }}>
                          🔍 Manual
                        </button>
                        <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => {
                          setEditContent('');
                          setShowEditor(true);
                        }}>
                          ✍️ Studio
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : lyricStatus === 'not_found' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <X size={32} style={{ color: '#ef4444' }} />
                  <div style={{ fontSize: 14 }}>No lyrics found.</div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => doSearch()}>🔍 Auto</button>
                    <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => {
                      setCustomPrompt({
                        open: true,
                        title: 'Manual Lyric Search',
                        placeholder: 'Enter Artist and Track Name...',
                        initialValue: `${currentTrack?.artist ?? ''} ${currentTrack?.title ?? ''}`.trim(),
                        actionLabel: 'Search Online',
                        onSubmit: (val) => doSearch(val)
                      });
                    }}>🔍 Manual</button>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => { setEditContent(''); setShowEditor(true); }}>✍️ Studio</button>
                  </div>
                </div>
              ) : (
                <>No lyrics. Click <strong>Finder</strong> to search online.</>
              )}
            </div>
          ) : (
            lyrics.map((l, i) => (
              <div 
                key={i} 
                data-idx={i} 
                className={`lyric-line${(lyricMode === 'lrc' && i === activeIdx) ? ' active' : ''}`}
                style={{ cursor: lyricMode === 'lrc' ? 'pointer' : 'default' }}
                onClick={() => {
                  if (lyricMode === 'lrc') {
                    seek(l.time_secs - lyricOffset / 1000);
                  }
                }}
              >
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
                  <div key={i} className="modal-item" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '12px 16px', borderRadius: 8, transition: 'background 0.2s' }}
                    onClick={() => pickResult(r)}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="modal-item-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>{r.title}</span>
                        {r.duration && currentTrack?.duration && Math.abs(currentTrack.duration - r.duration) <= 2 && (
                          <span style={{ padding: '1px 5px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', borderRadius: 4, fontSize: 9, fontWeight: 700 }}>Matches Duration</span>
                        )}
                        {r.duration && currentTrack?.duration && currentTrack.duration > r.duration + 2 && currentTrack.duration < r.duration + 120 && (
                          <span style={{ padding: '1px 5px', background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4', borderRadius: 4, fontSize: 9, fontWeight: 700 }}>Suggests +{(currentTrack.duration - r.duration).toFixed(1)}s offset</span>
                        )}
                      </div>
                      <div className="modal-item-sub">
                        {r.artist} · {r.source}
                        {r.duration ? ` · ${fmt(r.duration)}` : ''}
                      </div>
                    </div>
                    <div>
                      <button className="btn btn-primary" style={{ fontSize: 10, padding: '6px 12px' }}
                        onClick={(e) => { e.stopPropagation(); pickResult(r); }}>
                        🎵 Select
                      </button>
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
