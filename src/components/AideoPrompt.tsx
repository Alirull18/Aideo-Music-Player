import { useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, X } from 'lucide-react';

export function AideoPrompt({ title, placeholder, initialValue = '', actionLabel, onClose, onSubmit }: {
  title: string,
  placeholder: string,
  initialValue?: string,
  actionLabel: string,
  onClose: () => void,
  onSubmit: (v: string) => void
}) {
  const [val, setVal] = useState(initialValue);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="modal-overlay"
      style={{ zIndex: 3000 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="modal-content"
        style={{ maxWidth: 450, padding: 32 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Activity size={20} color="var(--accent)" />
            {title}
          </h2>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div style={{ marginBottom: 24 }}>
          <input
            autoFocus
            type="text"
            placeholder={placeholder}
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onSubmit(val); onClose(); } }}
            style={{
              width: '100%',
              padding: '14px 18px',
              fontSize: 14,
              borderRadius: 12,
              border: '1px solid var(--glass-border)',
              background: 'rgba(0,0,0,0.3)',
              color: 'white',
              outline: 'none',
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { onSubmit(val); onClose(); }}>
            {actionLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
