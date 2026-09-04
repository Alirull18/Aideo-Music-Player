import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import {
  X,
  Trash2,
  ListMusic,
  ArrowUp,
  ArrowDown,
  GripVertical,
  CheckCircle2,
  Clock,
  Disc3
} from 'lucide-react';
import defaultCover from '../../assets/default_cover.png';
import { fmt, isStreamTrack } from '../../utils';

export interface TheaterQueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TheaterQueueDrawer({ isOpen, onClose }: TheaterQueueDrawerProps) {
  const {
    queue,
    currentTrack,
    coverArt,
    playbackStatus,
    playbackPositionSecs,
    accentColor,
    playFromQueue,
    removeFromQueue,
    clearQueue,
    reorderQueue,
    cachedCloudHashes
  } = useStore(
    useShallow((s) => ({
      queue: s.queue,
      currentTrack: s.currentTrack,
      coverArt: s.coverArt,
      playbackStatus: s.playback.status,
      playbackPositionSecs: s.playback.position_secs,
      accentColor: s.accentColor,
      playFromQueue: s.playFromQueue,
      removeFromQueue: s.removeFromQueue,
      clearQueue: s.clearQueue,
      reorderQueue: s.reorderQueue,
      cachedCloudHashes: s.cachedCloudHashes
    }))
  );

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Close on Escape when open
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  const totalQueueDuration = useMemo(() => {
    return queue.reduce((acc, t) => acc + (t.duration || 0), 0);
  }, [queue]);

  const effectiveCover = coverArt || currentTrack?.cover_url || defaultCover;

  // Pointer drag-to-reorder handler
  const startPointerDrag = (startIdx: number, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    let currentOverIdx = startIdx;
    setDraggedIdx(startIdx);
    setDragOverIdx(startIdx);

    const onPointerMove = (moveEvt: PointerEvent) => {
      const el = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
      const target = el?.closest('[data-queue-index]');
      if (target) {
        const idxStr = target.getAttribute('data-queue-index');
        if (idxStr !== null) {
          const idx = parseInt(idxStr, 10);
          if (!isNaN(idx)) {
            currentOverIdx = idx;
            setDragOverIdx(idx);
          }
        }
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (startIdx !== currentOverIdx) {
        reorderQueue(startIdx, currentOverIdx);
      }
      setDraggedIdx(null);
      setDragOverIdx(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Subtle Scrim Backdrop */}
          <motion.div
            key="theater-queue-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 5000,
              backgroundColor: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(4px)'
            }}
          />

          {/* Slide-over Right Drawer Panel */}
          <motion.aside
            key="theater-queue-panel"
            initial={{ x: '100%', opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.8 }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            style={{
              position: 'fixed',
              top: 0,
              bottom: 0,
              right: 0,
              width: 'min(420px, 92vw)',
              zIndex: 5001,
              backgroundColor: 'rgba(13, 15, 20, 0.92)',
              backdropFilter: 'blur(30px) saturate(180%)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              color: '#f1f5f9'
            }}
            aria-label="Theater Mode Up Next Queue"
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '20px 24px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(255, 255, 255, 0.02)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: accentColor
                  }}
                >
                  <ListMusic size={18} />
                </div>
                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: 16,
                      fontWeight: 700,
                      letterSpacing: '-0.01em',
                      color: '#f8fafc'
                    }}
                  >
                    Up Next ({queue.length})
                  </h2>
                  {queue.length > 0 && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        marginTop: 2
                      }}
                    >
                      <Clock size={11} />
                      <span>{fmt(totalQueueDuration)} remaining</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {queue.length > 0 && (
                  <button
                    onClick={() => clearQueue()}
                    title="Clear all upcoming tracks"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      color: '#f87171',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                    }}
                  >
                    <Trash2 size={13} />
                    <span>Clear</span>
                  </button>
                )}

                <button
                  onClick={onClose}
                  aria-label="Close queue drawer"
                  title="Close queue"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    color: 'rgba(255, 255, 255, 0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ffffff';
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Pinned "Now Playing" Card */}
            {currentTrack && (
              <div
                style={{
                  padding: '16px 20px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: accentColor,
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: playbackStatus === 'Playing' ? '#10b981' : 'rgba(255, 255, 255, 0.4)',
                      boxShadow: playbackStatus === 'Playing' ? '0 0 6px #10b981' : 'none'
                    }}
                  />
                  <span>NOW PLAYING</span>
                </div>

                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <img
                    src={effectiveCover}
                    alt={currentTrack.title || 'Cover'}
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 8,
                      objectFit: 'cover',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      flexShrink: 0
                    }}
                  />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: '#f8fafc',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {currentTrack.title || currentTrack.path.split(/[\\/]/).pop()}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.6)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginTop: 2
                      }}
                    >
                      {currentTrack.artist || 'Unknown Artist'}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: 6,
                        fontSize: 11,
                        color: 'rgba(255, 255, 255, 0.4)'
                      }}
                    >
                      <span>
                        {fmt(playbackPositionSecs)} / {fmt(currentTrack.duration)}
                      </span>
                      {currentTrack.format && (
                        <span
                          style={{
                            padding: '1px 6px',
                            borderRadius: 4,
                            backgroundColor: 'rgba(255, 255, 255, 0.06)',
                            fontSize: 10,
                            fontWeight: 600,
                            color: 'rgba(255, 255, 255, 0.7)'
                          }}
                        >
                          {currentTrack.format}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Upcoming Queue List */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }}
            >
              {queue.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: '60px 24px',
                    color: 'rgba(255, 255, 255, 0.4)'
                  }}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 16,
                      color: 'rgba(255, 255, 255, 0.3)'
                    }}
                  >
                    <Disc3 size={28} />
                  </div>
                  <h3
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#cbd5e1',
                      margin: '0 0 6px 0'
                    }}
                  >
                    Queue is empty
                  </h3>
                  <p
                    style={{
                      fontSize: 12,
                      margin: 0,
                      lineHeight: 1.5,
                      maxWidth: 240
                    }}
                  >
                    Add tracks from your library or let Autoplay keep the music flowing seamlessly.
                  </p>
                </div>
              ) : (
                queue.map((t, idx) => {
                  const isHovered = hoveredIdx === idx;
                  const isDraggingThis = draggedIdx === idx;
                  const isDragOverThis = dragOverIdx === idx && draggedIdx !== null && draggedIdx !== idx;

                  return (
                    <div
                      key={`${t.path}-${idx}`}
                      data-queue-index={idx}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      onClick={() => playFromQueue(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '8px 12px',
                        borderRadius: 8,
                        backgroundColor: isDraggingThis
                          ? 'rgba(var(--accent-rgb, 139, 92, 246), 0.25)'
                          : isHovered || isDragOverThis
                          ? 'rgba(255, 255, 255, 0.08)'
                          : 'rgba(255, 255, 255, 0.02)',
                        border: isDragOverThis
                          ? `1px solid ${accentColor}`
                          : '1px solid rgba(255, 255, 255, 0.04)',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease, border 0.15s ease',
                        opacity: isDraggingThis ? 0.45 : 1,
                        userSelect: 'none'
                      }}
                    >
                      {/* Track number / drag handle */}
                      <div
                        onPointerDown={(e) => startPointerDrag(idx, e)}
                        style={{
                          width: 24,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'grab',
                          touchAction: 'none',
                          color: isHovered ? accentColor : 'rgba(255, 255, 255, 0.35)',
                          fontSize: 12,
                          fontWeight: 600,
                          flexShrink: 0
                        }}
                        title="Drag to reorder"
                      >
                        {isHovered ? <GripVertical size={15} /> : <span>{idx + 1}</span>}
                      </div>

                      {/* Track info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: '#f8fafc',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.title || t.path.split(/[\\/]/).pop()}
                          </span>
                          {isStreamTrack(t.path, t.format) && t.path_hash && cachedCloudHashes.includes(t.path_hash) && (
                            <span
                              title="Cached Offline"
                              style={{ color: '#10b981', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}
                            >
                              <CheckCircle2 size={12} />
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'rgba(255, 255, 255, 0.5)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            marginTop: 2
                          }}
                        >
                          {t.artist || 'Unknown Artist'}
                        </div>
                      </div>

                      {/* Duration and Hover Controls */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          flexShrink: 0,
                          fontSize: 11,
                          color: 'rgba(255, 255, 255, 0.45)'
                        }}
                      >
                        {isHovered ? (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {idx > 0 && (
                              <button
                                onClick={() => reorderQueue(idx, idx - 1)}
                                title="Move up"
                                style={{
                                  padding: 4,
                                  borderRadius: 4,
                                  border: 'none',
                                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                  color: '#f8fafc',
                                  cursor: 'pointer',
                                  display: 'flex'
                                }}
                              >
                                <ArrowUp size={12} />
                              </button>
                            )}
                            {idx < queue.length - 1 && (
                              <button
                                onClick={() => reorderQueue(idx, idx + 1)}
                                title="Move down"
                                style={{
                                  padding: 4,
                                  borderRadius: 4,
                                  border: 'none',
                                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                  color: '#f8fafc',
                                  cursor: 'pointer',
                                  display: 'flex'
                                }}
                              >
                                <ArrowDown size={12} />
                              </button>
                            )}
                            <button
                              onClick={() => removeFromQueue(idx)}
                              title="Remove from queue"
                              style={{
                                padding: 4,
                                borderRadius: 4,
                                border: 'none',
                                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                                color: '#f87171',
                                cursor: 'pointer',
                                display: 'flex'
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <span>{fmt(t.duration)}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
