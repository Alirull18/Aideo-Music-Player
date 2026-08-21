import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, GripVertical, ArrowUp, ArrowDown, CheckCircle2, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { fmt, isStreamTrack } from '../utils';
import { useVirtualList } from '../utils/useVirtualList';
import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';


export function QueueView() {
  const { queue, showQueue, toggleQueue, playFromQueue, removeFromQueue, clearQueue, reorderQueue, cachedCloudHashes } = useStore(useShallow(s => ({
    queue: s.queue,
    showQueue: s.showQueue,
    toggleQueue: s.toggleQueue,
    playFromQueue: s.playFromQueue,
    removeFromQueue: s.removeFromQueue,
    clearQueue: s.clearQueue,
    reorderQueue: s.reorderQueue,
    cachedCloudHashes: s.cachedCloudHashes,
  })));
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const {
    containerRef,
    visibleItems: virtualQueue,
    topSpacerHeight: topQueueSpacer,
    bottomSpacerHeight: bottomQueueSpacer,
    startIndex: queueStartIndex,
  } = useVirtualList(queue, {
    itemHeight: 72,
  });

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

  const handleCopyQueue = async () => {
    if (queue.length === 0) return;
    const text = queue.map(t => `${t.artist ? t.artist + ' - ' : ''}${t.title || t.path.split(/[\\/]/).pop()}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Copied ${queue.length} tracks to clipboard`, type: 'success' }
      }));
    } catch {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: 'Clipboard unavailable', type: 'error' }
      }));
    }
  };

  const handleExportQueue = async () => {
    if (queue.length === 0) return;
    try {
      const dest = await save({
        title: 'Export Queue as M3U8',
        defaultPath: 'aideo-queue.m3u8',
        filters: [{ name: 'M3U Playlist', extensions: ['m3u8', 'm3u'] }]
      });
      if (!dest) return;
      const m3u = '#EXTM3U\n' + queue.map(t => {
        const display = t.artist && t.title ? `${t.artist} - ${t.title}` : (t.title || t.path.split(/[\\/]/).pop() || t.path);
        const secs = t.duration ? Math.round(t.duration) : -1;
        return `#EXTINF:${secs},${display}\n${t.path}`;
      }).join('\n');
      await invoke('write_text_file', { path: dest, content: m3u + '\n' });
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Exported ${queue.length} tracks to ${dest.split(/[\\/]/).pop()}`, type: 'success' }
      }));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Export failed: ${e}`, type: 'error' }
      }));
    }
  };

  return (
    <AnimatePresence>
      {showQueue && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={toggleQueue}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 4000,
            }}
          />

          {/* Queue Panel */}
          <motion.div
            className="queue-panel"
            initial={{ y: '100%', opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.5 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{
              position: 'fixed',
              bottom: 'calc(var(--player-h, 96px) + 12px)',
              right: 24,
              width: 400,
              maxHeight: '60vh',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--glass-border)',
              borderRadius: 12,
              zIndex: 4001,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--glass-border)', background: 'var(--glass)' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Up Next</h2>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {queue.length > 0 && (
                  <>
                    <button
                      onClick={handleCopyQueue}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-dim)',
                        fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
                      }}
                      title="Copy queue as text list"
                    >
                      <Copy size={14} /> Copy
                    </button>
                    <button
                      onClick={handleExportQueue}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-dim)',
                        fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
                      }}
                      title="Export queue as M3U8"
                    >
                      <Download size={14} /> Export
                    </button>
                    <button
                      onClick={() => clearQueue()}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-dim)',
                        fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
                      }}
                    >
                      <Trash2 size={14} /> Clear
                    </button>
                  </>
                )}
                <button className="modal-close" onClick={toggleQueue}><X size={18} /></button>
              </div>
            </div>

            <div 
              ref={containerRef}
              className="queue-wrap" 
              style={{ padding: '16px', flex: 1, overflowY: 'auto', position: 'relative' }}
            >
              {queue.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '32px 0' }}>Queue is empty. Add songs to the queue or let auto-play take over.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {topQueueSpacer > 0 && <div style={{ height: topQueueSpacer }} />}
                  {virtualQueue.map((t, idx) => {
                    const i = queueStartIndex + idx;
                    const isDraggingThis = draggedIdx === i;
                    const isDragOverThis = dragOverIdx === i && draggedIdx !== null && draggedIdx !== i;

                    return (
                      <div
                        key={`${t.path}-${i}`}
                        data-queue-index={i}
                        onMouseEnter={() => setHoveredIdx(i)}
                        onMouseLeave={() => setHoveredIdx(null)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 16,
                          padding: '8px 12px',
                          background: isDraggingThis 
                            ? 'rgba(var(--accent-rgb, 139, 92, 246), 0.25)' 
                            : (isDragOverThis ? 'var(--glass-h)' : 'var(--glass)'),
                          borderRadius: 8,
                          userSelect: 'none',
                          transition: 'background 0.15s',
                          borderTop: isDragOverThis ? '2px solid var(--accent, #8b5cf6)' : '2px solid transparent',
                          borderBottom: '2px solid transparent',
                          borderLeft: '1px solid transparent',
                          borderRight: '1px solid transparent',
                          opacity: isDraggingThis ? 0.45 : 1,
                        }}
                        onDoubleClick={() => playFromQueue(i)}
                      >
                        <div 
                          onPointerDown={(e) => startPointerDrag(i, e)}
                          style={{ 
                            color: 'var(--text-dim)', 
                            cursor: 'grab', 
                            display: 'flex', 
                            alignItems: 'center', 
                            touchAction: 'none',
                            padding: '4px' 
                          }}
                          title="Drag to reorder"
                        >
                          <GripVertical size={15} style={{ opacity: hoveredIdx === i || isDraggingThis ? 1 : 0.4, color: (hoveredIdx === i || isDraggingThis) ? 'var(--accent)' : 'inherit', transition: 'opacity 0.2s' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {t.title || t.path.split(/[\\/]/).pop()}
                            </span>
                            {isStreamTrack(t.path, t.format) && t.path_hash && cachedCloudHashes.includes(t.path_hash) && (
                              <span title="Cached Offline (Available without internet)" style={{ color: '#10b981', display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                                <CheckCircle2 size={12} />
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.artist || 'Unknown Artist'}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {hoveredIdx === i ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {i > 0 && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); reorderQueue(i, i - 1); }}
                                  title="Move Up"
                                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 4, padding: 4, cursor: 'pointer', color: 'white', display: 'flex' }}
                                >
                                  <ArrowUp size={13} />
                                </button>
                              )}
                              {i < queue.length - 1 && (
                                <button 
                                  onClick={(e) => { e.stopPropagation(); reorderQueue(i, i + 1); }}
                                  title="Move Down"
                                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 4, padding: 4, cursor: 'pointer', color: 'white', display: 'flex' }}
                                >
                                  <ArrowDown size={13} />
                                </button>
                              )}
                              <button 
                                onClick={(e) => { e.stopPropagation(); removeFromQueue(i); }}
                                title="Remove from queue"
                                style={{ background: 'rgba(255,50,50,0.2)', border: 'none', borderRadius: 4, padding: 4, cursor: 'pointer', color: '#ff6b6b', display: 'flex' }}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <span>{fmt(t.duration)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {bottomQueueSpacer > 0 && <div style={{ height: bottomQueueSpacer }} />}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
