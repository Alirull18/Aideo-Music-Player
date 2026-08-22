import { useState, useRef, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, X, Tv2, ChevronUp, ChevronDown } from 'lucide-react';
import { fmt, baseName, cleanSearchQuery } from '../utils';
import { LyricsDisplayMode } from '../store/types';

interface SearchResult { id: string; title: string; artist: string; source: string; content_id?: string; raw_lrc?: string; duration?: number; }

export function LyricsPanel() {
  const { currentTrack, lyrics, playback, lyricOffset, lyricStatus, lyricsDisplayMode, setLyricsDisplayMode, seek, adjustLyricOffset, setLyricOffset, saveLyrics, translateLyrics, getRomaji, isTranslating, showRomaji, setShowRomaji, showTranslation, setShowTranslation, showLyricsHeader, toggleLyricsHeader, setCustomPrompt, desktopLyricsOpen, toggleDesktopLyrics, desktopLyricsLocked, toggleDesktopLyricsLocked } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleTranslateClick = async () => {
    const hasTranslation = lyrics.some(l => l.translation);
    if (!hasTranslation && lyrics.length > 0) {
      try {
        await translateLyrics();
        setShowTranslation(true);
      } catch (err) {
        console.error('Translation error:', err);
      }
    } else {
      setShowTranslation(!showTranslation);
    }
  };
  
  // Auto Translation & Romaji on track change / startup when user has toggle enabled
  useEffect(() => {
    if (!currentTrack || lyrics.length === 0 || isTranslating) return;

    const checkAndFetch = async () => {
      if (showTranslation) {
        const hasTranslation = lyrics.some(l => l.translation);
        if (!hasTranslation) {
          try {
            await translateLyrics();
          } catch (err) {
            console.error('Auto-translation failed:', err);
          }
          return;
        }
      }

      if (showRomaji) {
        const hasRomaji = lyrics.some(l => l.romaji);
        if (!hasRomaji) {
          try {
            await getRomaji();
          } catch (err) {
            console.error('Auto-romaji failed:', err);
          }
        }
      }
    };

    checkAndFetch();
  }, [currentTrack?.path, lyrics.length, showRomaji, showTranslation, isTranslating]);

  // Syllable word-by-word sync detection: only run 60fps rAF timer if track has word-level karaoke data and karaoke mode is active
  const hasWordSync = useMemo(() => lyrics.some(l => l.words && l.words.length > 0), [lyrics]);
  const isKaraokeActive = hasWordSync && lyricsDisplayMode === 'karaoke';
  const [smoothedTime, setSmoothedTime] = useState(playback.position_secs);
  const lastPositionRef = useRef(playback.position_secs);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    lastPositionRef.current = playback.position_secs;
    lastTimeRef.current = performance.now();
    if (isKaraokeActive) {
      setSmoothedTime(playback.position_secs);
    }
  }, [playback.position_secs, isKaraokeActive]);

  useEffect(() => {
    if (!isKaraokeActive || playback.status !== 'Playing') return;

    let frameId: number;
    const update = () => {
      const now = performance.now();
      const delta = (now - lastTimeRef.current) / 1000;
      const interpolated = lastPositionRef.current + Math.max(0, delta);
      setSmoothedTime(interpolated);
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [playback.status, isKaraokeActive]);

  const currentTime = (isKaraokeActive ? smoothedTime : playback.position_secs) + lyricOffset / 1000;

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
    if (lyricsDisplayMode === 'static' || userScrolling || !scrollRef.current || activeIdx === -1) return;
    const el = scrollRef.current.querySelector(`[data-idx="${activeIdx}"]`) as HTMLElement | null;
    if (el) {
      const container = scrollRef.current;
      const targetTop = el.offsetTop - (container.clientHeight / 2) + (el.clientHeight / 2);
      container.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }, [activeIdx, userScrolling, lyricsDisplayMode]);

  const onScroll = () => {
    setUserScrolling(true);
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current);
    userScrollTimer.current = window.setTimeout(() => setUserScrolling(false), 3500);
  };

  const doSearch = async (manualQuery?: string) => {
    if (!currentTrack && !manualQuery) return;
    setSearching(true); setShowFinder(true); setResults([]);
    try {
      let query = '';
      let cleanTitle = '';
      let cleanArtist = '';
      if (manualQuery) {
        query = manualQuery;
        const { artist, title } = cleanSearchQuery('', manualQuery);
        cleanArtist = artist;
        cleanTitle = title;
      } else {
        const { artist, title } = cleanSearchQuery(currentTrack?.artist, currentTrack?.title ?? baseName(currentTrack?.path ?? ''));
        cleanArtist = artist;
        cleanTitle = title;
        query = `${cleanArtist} ${cleanTitle}`.trim();
      }
      const r: SearchResult[] = await invoke('search_lyrics_online', { query });

      // Score and rank the results so the exact match floats to the top
      const targetTitle = cleanTitle || currentTrack?.title || '';
      const targetArtist = cleanArtist || currentTrack?.artist || '';
      const targetDuration = currentTrack?.duration;

      const scored = r.map((item, index) => {
        const cleanStr = (s: string) => s.toLowerCase()
          .replace(/[()\[\]\-\s_]+/g, '')
          .replace(/[^\p{L}\p{N}]/gu, '');

        const pTitle = cleanStr(targetTitle);
        const rTitle = cleanStr(item.title);

        let titleScore = 0;
        if (pTitle === rTitle) {
          titleScore = 1.0;
        } else if (pTitle.includes(rTitle) || rTitle.includes(pTitle)) {
          titleScore = 0.6;
        }

        const pArtist = cleanStr(targetArtist);
        const rArtist = cleanStr(item.artist);
        let artistScore = 0;
        if (pArtist && rArtist) {
          if (pArtist === rArtist || rArtist.includes(pArtist) || pArtist.includes(rArtist)) {
            artistScore = 1.0;
          }
        } else if (!targetArtist || targetArtist.trim() === '') {
          artistScore = 0.5;
        }

        let durationBonus = 0;
        if (targetDuration && item.duration) {
          const diff = Math.abs(targetDuration - item.duration);
          if (diff <= 3) {
            durationBonus = 0.5;
          } else if (diff <= 15) {
            durationBonus = 0.2;
          } else if (diff > 60) {
            durationBonus = -0.3;
          }
        }

        let syncBonus = 0.0;
        if (item.source === 'Unison' || (item.raw_lrc && (item.raw_lrc.includes('<span') || item.raw_lrc.includes('<tt') || item.raw_lrc.includes('(')))) {
          syncBonus = 0.25;
        } else if (item.raw_lrc || item.source !== 'iTunes') {
          syncBonus = 0.10;
        }

        let sourceBonus = 0.0;
        if (item.source === 'Unison') sourceBonus = 0.15;
        else if (item.source === 'NetEase') sourceBonus = 0.10;
        else if (item.source === 'QQMusic') sourceBonus = 0.05;

        const rankBonus = Math.max(0, 0.15 - (index * 0.03));
        const score = (titleScore * 0.5) + (artistScore * 0.3) + durationBonus + syncBonus + sourceBonus + rankBonus;

        return { item, score };
      });

      scored.sort((a, b) => b.score - a.score);
      setResults(scored.map(s => s.item));
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
      if (!lrc && r.source === 'Unison') {
        lrc = await invoke<string>('get_unison_ttml', {
          song: r.title,
          artist: r.artist || undefined,
          duration: r.duration || undefined,
        }).catch(() => '');
      }
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
            setLyricOffset(calculatedMs);
            window.dispatchEvent(new CustomEvent('ui-toast', { 
              detail: { message: `✨ Sync: Set lyric offset to +${(calculatedMs/1000).toFixed(1)}s to match video length`, type: 'info' } 
            }));
          } else {
            setLyricOffset(0);
          }
        } else {
          setLyricOffset(0);
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
      {/* Header / Toolbar */}
      <AnimatePresence initial={false}>
        {showLyricsHeader ? (
          <motion.div
            key="lyrics-toolbar"
            className="lyrics-toolbar"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
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
            <button className={`lyric-btn ${showTranslation && lyrics.some(l => l.translation) ? 'active' : ''}`} onClick={handleTranslateClick} disabled={isTranslating}>
              {isTranslating ? 'Working…' : showTranslation && lyrics.some(l => l.translation) ? '🌐 Hide Translation' : '🌐 Translate'}
            </button>
            <button
              className={`lyric-btn ${showRomaji ? 'active' : ''}`}
              disabled={isTranslating}
              onClick={async () => {
                const hasRomaji = lyrics.some(l => l.romaji);
                if (!hasRomaji && lyrics.length > 0) {
                  await getRomaji();
                  setShowRomaji(true);
                } else {
                  setShowRomaji(!showRomaji);
                }
              }}
            >
              {isTranslating ? 'Working…' : 'Romaji'}
            </button>
            <button
              className={`lyric-btn ${lyricsDisplayMode === 'karaoke' ? 'active' : ''}`}
              onClick={() => {
                const nextMode: LyricsDisplayMode =
                  lyricsDisplayMode === 'karaoke' ? 'line_sync' :
                  lyricsDisplayMode === 'line_sync' ? 'static' : 'karaoke';
                setLyricsDisplayMode(nextMode);
              }}
              title={`Display Mode: ${lyricsDisplayMode === 'karaoke' ? 'Karaoke (Word-by-word)' : lyricsDisplayMode === 'line_sync' ? 'Line Sync (Line-by-line)' : 'Static (Plain text)'} — Click to switch`}
            >
              {lyricsDisplayMode === 'karaoke' && '🎤 Karaoke'}
              {lyricsDisplayMode === 'line_sync' && '⏱️ Line Sync'}
              {lyricsDisplayMode === 'static' && '📄 Plain Text'}
            </button>
            <button
              className={`lyric-btn ${desktopLyricsOpen ? 'active' : ''}`}
              onClick={toggleDesktopLyrics}
              onContextMenu={(e) => {
                e.preventDefault();
                toggleDesktopLyricsLocked();
              }}
              title={desktopLyricsOpen ? (desktopLyricsLocked ? "Desktop Lyrics: Locked (Right-click to Unlock)" : "Desktop Lyrics: Open (Right-click to Lock)") : "Open Floating Desktop Lyric Bar"}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <Tv2 size={13} />
              <span>Floating Bar</span>
            </button>

            {/* Hide Header Button */}
            <button
              className="lyric-btn lyric-header-hide-btn"
              onClick={toggleLyricsHeader}
              title="Hide lyric section header and controls"
            >
              <ChevronUp size={13} />
              <span>Hide Header</span>
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="lyrics-reveal-btn"
            className="lyric-header-reveal-btn"
            onClick={toggleLyricsHeader}
            title="Show lyric section header and controls"
            initial={{ opacity: 0, scale: 0.9, y: -5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -5 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown size={13} />
            <span>Show Header</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Lyrics scroll */}
      <div className={`lyrics-fade-wrap ${lyricsDisplayMode === 'static' ? 'plain-mode' : ''}`}>
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
                className={`lyric-line${(lyricsDisplayMode !== 'static' && i === activeIdx) ? ' active' : ''}`}
                style={{ cursor: lyricsDisplayMode !== 'static' ? 'pointer' : 'default' }}
                onClick={() => {
                  if (lyricsDisplayMode !== 'static') {
                    seek(l.time_secs - lyricOffset / 1000);
                  }
                }}
              >
                <div>
                  {lyricsDisplayMode === 'karaoke' && i === activeIdx && l.words && l.words.length > 0 ? (
                    l.words.map((word, wordIdx) => {
                      const nextWord = l.words![wordIdx + 1];
                      const duration = word.duration_secs && word.duration_secs > 0
                        ? word.duration_secs
                        : (nextWord && nextWord.time_secs > word.time_secs ? (nextWord.time_secs - word.time_secs) : 0.8);
                      const isStarted = currentTime >= word.time_secs;
                      const isFinished = (word.duration_secs && word.duration_secs > 0)
                        ? currentTime >= (word.time_secs + word.duration_secs)
                        : (nextWord ? currentTime >= nextWord.time_secs : currentTime >= (word.time_secs + duration));
                      
                      let progress = 0;
                      if (isFinished) {
                        progress = 100;
                      } else if (isStarted) {
                        progress = Math.min(100, Math.max(0, ((currentTime - word.time_secs) / duration) * 100));
                      }

                      return (
                        <span 
                          key={wordIdx} 
                          className="lyric-word"
                          style={{ '--word-progress': `${progress}%` } as React.CSSProperties}
                        >
                          {word.text}
                        </span>
                      );
                    })
                  ) : (
                    l.text || '♪'
                  )}
                </div>
                {showRomaji && l.romaji && l.romaji !== l.text && <div className="lyric-romaji">{l.romaji}</div>}
                {showTranslation && l.translation && <div className="lyric-translation">{l.translation}</div>}
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
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Paste your LRC text or synchronized lyrics below.</div>
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
