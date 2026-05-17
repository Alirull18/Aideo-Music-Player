import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

let toastIdCounter = 0;

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    // Listen for backend playback-errors
    const unlisten = listen<string>('playback-error', (event) => {
      addToast(event.payload, 'error');
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const addToast = (message: string, type: 'info' | 'error' | 'success') => {
    const id = String(++toastIdCounter);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      zIndex: 9999,
      pointerEvents: 'none'
    }}>
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            style={{
              background: t.type === 'error' ? 'rgba(239, 68, 68, 0.9)' : 
                          t.type === 'success' ? 'rgba(16, 185, 129, 0.9)' : 
                          'rgba(30, 30, 40, 0.9)',
              color: 'white',
              padding: '12px 20px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(8px)',
              pointerEvents: 'auto'
            }}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
