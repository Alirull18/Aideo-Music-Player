import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, GripVertical } from 'lucide-react';
import { useState } from 'react';
import { fmt } from '../utils';
import { useVirtualList } from '../utils/useVirtualList';


export function QueueView() {
  const { queue, showQueue, toggleQueue, playFromQueue, removeFromQueue, clearQueue, reorderQueue } = useStore();
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const {
    containerRef,
    visibleItems: virtualQueue,
    topSpacerHeight: topQueueSpacer,
    bottomSpacerHeight: bottomQueueSpacer,
    startIndex: queueStartIndex,
  } = useVirtualList(queue, {
    itemHeight: 58,
  });

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (draggedIdx !== null && draggedIdx !== dropIdx) {
      reorderQueue(draggedIdx, dropIdx);
    }
    setDraggedIdx(null);
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
            initial={{ y: '100%', opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.5 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{
              position: 'fixed',
              bottom: 90, // Just above PlayerBar
              right: 24,
              width: 400,
              maxHeight: '60vh',
              background: 'rgba(26, 26, 36, 0.95)',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--glass-border)',
              borderRadius: 12,
              boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
              zIndex: 4001,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Up Next</h2>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {queue.length > 0 && (
                  <button 
                    onClick={() => clearQueue()}
                    style={{ 
                      background: 'none', border: 'none', color: 'var(--text-dim)', 
                      fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 
                    }}
                  >
                    <Trash2 size={14} /> Clear
                  </button>
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
                    return (
                      <div
                        key={`${t.path}-${i}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, i)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, i)}
                        onMouseEnter={() => setHoveredIdx(i)}
                        onMouseLeave={() => setHoveredIdx(null)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 16,
                          padding: '8px 12px',
                          background: draggedIdx === i ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)',
                          borderRadius: 8,
                          cursor: 'grab',
                          transition: 'background 0.2s',
                          border: draggedIdx === i ? '1px dashed var(--text-dim)' : '1px solid transparent'
                        }}
                        onDoubleClick={() => playFromQueue(i)}
                      >
                        <div style={{ color: 'var(--text-dim)', cursor: 'grab', display: 'flex', alignItems: 'center' }}>
                          <GripVertical size={14} style={{ opacity: hoveredIdx === i ? 1 : 0.3, transition: 'opacity 0.2s' }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.title || t.path.split(/[\\/]/).pop()}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.artist || 'Unknown Artist'}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 12 }}>
                          {hoveredIdx === i ? (
                            <button 
                              onClick={(e) => { e.stopPropagation(); removeFromQueue(i); }}
                              style={{ background: 'rgba(255,50,50,0.2)', border: 'none', borderRadius: 4, padding: 4, cursor: 'pointer', color: '#ff6b6b', display: 'flex' }}
                            >
                              <X size={14} />
                            </button>
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
