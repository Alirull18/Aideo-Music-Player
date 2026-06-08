import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Cast, Loader2, Wifi, WifiOff, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function CastSelector() {
  const {
    chromecast_devices,
    chromecast_active_device,
    chromecast_scanning,
    chromecast_connected,
    discoverCastDevices,
    connectCastDevice,
    disconnectCastDevice,
  } = useStore();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Trigger scan when opening
  const handleToggle = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      discoverCastDevices();
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={handleToggle}
        className={`pb-btn ${chromecast_connected ? 'active' : ''}`}
        title="Cast to Device (Chromecast)"
        style={{
          color: chromecast_connected ? 'var(--accent)' : 'var(--text-dim)',
          position: 'relative',
        }}
      >
        <Cast size={18} />
        {chromecast_connected && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: '#10b981',
              boxShadow: '0 0 6px #10b981',
            }}
          />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 12px)',
              right: 0,
              width: 300,
              background: 'rgba(20, 20, 30, 0.85)',
              backdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 16,
              padding: 16,
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5)',
              zIndex: 1000,
              color: 'white',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Cast size={16} className="accent-color" />
                <span style={{ fontSize: 14, fontWeight: 700 }}>Google Cast</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Scanning Indicator / Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {chromecast_scanning ? 'Searching for devices...' : 'Available Devices'}
              </span>
              <button
                className="btn btn-secondary"
                style={{
                  fontSize: 10,
                  padding: '4px 8px',
                  borderRadius: 6,
                  height: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                onClick={discoverCastDevices}
                disabled={chromecast_scanning}
              >
                {chromecast_scanning && <Loader2 size={10} className="spin" />}
                Scan
              </button>
            </div>

            {/* Devices List */}
            <div
              style={{
                maxHeight: 180,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingRight: 4,
              }}
            >
              {chromecast_devices.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)', fontSize: 12 }}>
                  {chromecast_scanning ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <Loader2 size={20} className="spin accent-color" />
                      Searching local network...
                    </div>
                  ) : (
                    'No Cast devices discovered'
                  )}
                </div>
              ) : (
                chromecast_devices.map((device) => {
                  const isActive = chromecast_active_device === device.ip;
                  return (
                    <div
                      key={device.ip}
                      onClick={() => !isActive && connectCastDevice(device)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        background: isActive ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                        border: isActive ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: 10,
                        cursor: isActive ? 'default' : 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {device.name}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                          {device.ip}:{device.port}
                        </span>
                      </div>
                      <div>
                        {isActive ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#10b981', fontSize: 11, fontWeight: 700 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
                            Active
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>Connect</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Active Casting State Info / Disconnect */}
            {chromecast_connected && (
              <div
                style={{
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ color: '#10b981', display: 'flex' }}>
                    <Wifi size={14} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    Casting to <strong>{chromecast_devices.find(d => d.ip === chromecast_active_device)?.name || 'device'}</strong>
                  </span>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    padding: '8px 0',
                    borderRadius: 10,
                    color: '#ef4444',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                  onClick={disconnectCastDevice}
                >
                  <WifiOff size={14} />
                  Disconnect
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
