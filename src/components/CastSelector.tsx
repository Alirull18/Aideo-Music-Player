import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Cast, Loader2, Wifi, WifiOff, X, Radio, Tv } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { LocalQRCode } from './LocalQRCode';

export function CastSelector() {
  const {
    chromecast_devices,
    chromecast_active_device,
    chromecast_scanning,
    chromecast_connected,
    discoverCastDevices,
    connectCastDevice,
    disconnectCastDevice,
    upnp_devices,
    upnp_active_device,
    upnp_scanning,
    upnp_connected,
    discoverUpnpDevices,
    connectUpnpDevice,
    disconnectUpnpDevice,
  } = useStore();

  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeCastTab, setActiveCastTab] = useState<'all' | 'dlna' | 'google'>('all');
  const containerRef = useRef<HTMLDivElement>(null);

  const isConnectedAny = chromecast_connected || upnp_connected;
  const isScanningAny = chromecast_scanning || upnp_scanning;

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

  useEffect(() => {
    if (isOpen) {
      invoke<string>('get_remote_connection_url')
        .then(setRemoteUrl)
        .catch(console.error);
    }
  }, [isOpen]);

  const handleScanAll = () => {
    discoverCastDevices();
    discoverUpnpDevices();
  };

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      handleScanAll();
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={handleToggle}
        className={`pb-btn ${isConnectedAny ? 'active' : ''}`}
        title="Network Audio Streamer (DLNA & Cast)"
        style={{
          color: isConnectedAny ? 'var(--accent)' : 'var(--text-dim)',
          position: 'relative',
        }}
      >
        <Cast size={18} />
        {isConnectedAny && (
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
              width: 360,
              background: 'rgba(20, 20, 30, 0.92)',
              backdropFilter: 'blur(28px)',
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
                <span style={{ fontSize: 14, fontWeight: 700 }}>Network Streamer</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Protocol Filter Tabs & Scan Action */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.3)', padding: 2, borderRadius: 8 }}>
                <button
                  onClick={() => setActiveCastTab('all')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: 'none',
                    background: activeCastTab === 'all' ? 'var(--accent)' : 'transparent',
                    color: activeCastTab === 'all' ? 'white' : 'var(--text-dim)',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  All
                </button>
                <button
                  onClick={() => setActiveCastTab('dlna')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: 'none',
                    background: activeCastTab === 'dlna' ? 'var(--accent)' : 'transparent',
                    color: activeCastTab === 'dlna' ? 'white' : 'var(--text-dim)',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  DLNA Hi-Res
                </button>
                <button
                  onClick={() => setActiveCastTab('google')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: 'none',
                    background: activeCastTab === 'google' ? 'var(--accent)' : 'transparent',
                    color: activeCastTab === 'google' ? 'white' : 'var(--text-dim)',
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Google Cast
                </button>
              </div>

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
                onClick={handleScanAll}
                disabled={isScanningAny}
              >
                {isScanningAny && <Loader2 size={10} className="spin" />}
                Scan
              </button>
            </div>

            {/* Devices List */}
            <div
              style={{
                maxHeight: 200,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingRight: 4,
              }}
            >
              {/* DLNA / UPnP Devices */}
              {(activeCastTab === 'all' || activeCastTab === 'dlna') && upnp_devices.map((device) => {
                const isActive = upnp_connected && upnp_active_device === device.id;
                return (
                  <div
                    key={device.id}
                    onClick={() => !isActive && connectUpnpDevice(device)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: isActive ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: 10,
                      cursor: isActive ? 'default' : 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                      <Radio size={14} className="accent-color" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {device.name}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                          {device.manufacturer} • {device.ip} <strong style={{ color: '#10b981' }}>[Lossless FLAC/WAV]</strong>
                        </span>
                      </div>
                    </div>
                    <div>
                      {isActive ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#10b981', fontSize: 10, fontWeight: 700 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
                          Streaming
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>Stream</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Google Cast Devices */}
              {(activeCastTab === 'all' || activeCastTab === 'google') && chromecast_devices.map((device) => {
                const isActive = chromecast_connected && chromecast_active_device === device.ip;
                return (
                  <div
                    key={device.ip}
                    onClick={() => !isActive && connectCastDevice(device)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: isActive ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      border: isActive ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: 10,
                      cursor: isActive ? 'default' : 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                      <Tv size={14} style={{ color: '#8b5cf6' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {device.name}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                          Google Cast • {device.ip}:{device.port}
                        </span>
                      </div>
                    </div>
                    <div>
                      {isActive ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#10b981', fontSize: 10, fontWeight: 700 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
                          Active
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>Cast</span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Empty State */}
              {upnp_devices.length === 0 && chromecast_devices.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-dim)', fontSize: 12 }}>
                  {isScanningAny ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <Loader2 size={18} className="spin accent-color" />
                      Scanning Wi-Fi network for DLNA & Cast...
                    </div>
                  ) : (
                    'No network audio renderers discovered'
                  )}
                </div>
              )}
            </div>

            {/* Active Streaming State / Disconnect Controls */}
            {isConnectedAny && (
              <div
                style={{
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  paddingTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ color: '#10b981', display: 'flex' }}>
                    <Wifi size={13} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    Streaming {upnp_connected ? 'Lossless Audio (DLNA)' : 'Media (Cast)'} to <strong>{upnp_connected ? (upnp_devices.find(d => d.id === upnp_active_device)?.name || 'DLNA Renderer') : (chromecast_devices.find(d => d.ip === chromecast_active_device)?.name || 'Cast Device')}</strong>
                  </span>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    padding: '6px 0',
                    borderRadius: 8,
                    color: '#ef4444',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                  onClick={() => {
                    if (upnp_connected) disconnectUpnpDevice();
                    if (chromecast_connected) disconnectCastDevice();
                  }}
                >
                  <WifiOff size={13} />
                  Disconnect Network Stream
                </button>
              </div>
            )}

            {/* Divider */}
            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '2px 0' }} />

            {/* Aideo Connect Hub */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--accent)' }}>
                  Aideo Connect Remote
                </span>
              </div>

              {remoteUrl ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Control playback from your phone:</span>
                    <a
                      href={remoteUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: 11,
                        color: 'var(--accent)',
                        fontWeight: 600,
                        textDecoration: 'underline',
                        wordBreak: 'break-all'
                      }}
                    >
                      {remoteUrl}
                    </a>
                  </div>
                  <div style={{
                    background: 'white',
                    padding: 4,
                    borderRadius: 6,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <LocalQRCode value={remoteUrl} size={60} />
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  Connecting to local network...
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
