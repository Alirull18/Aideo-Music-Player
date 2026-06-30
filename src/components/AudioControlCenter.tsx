import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';

import { Activity, Settings2, RefreshCw, X, Volume2, Settings, AudioLines, Sparkles } from 'lucide-react';

export function AudioControlCenter() {
  const { dsp, setDSP, resetProMode, playback, toggleExclusive, devices, currentDevice, setAudioDevice, showControlCenter, toggleControlCenter, fetchDevices } = useStore();
  const [devOpen, setDevOpen] = useState(false);

  const fileRate = playback.file_rate || 44100;
  const fileCh = playback.file_ch || 2;
  const fileFormat = playback.file_format || 'PCM';

  const dspActive = dsp.enabled || dsp.eq_enabled || dsp.crossfeed_enabled || dsp.spatial_enabled || dsp.night_mode_enabled || dsp.subsonic_enabled;

  const isAsio = currentDevice?.startsWith('[ASIO]');
  const isWasapiExclusive = playback.exclusive;
  
  const outputMode = isAsio ? 'ASIO Bit-Perfect' : isWasapiExclusive ? 'WASAPI Exclusive' : 'Shared Mixer';
  const outputRate = playback.dev_rate || fileRate;

  const formatHz = (hz: number) => {
    if (hz >= 1000) {
      return `${(hz / 1000).toFixed(1)} kHz`;
    }
    return `${hz} Hz`;
  };

  useEffect(() => {
    if (showControlCenter && devices.length === 0) {
      fetchDevices();
    }
  }, [showControlCenter, devices.length]);

  if (!showControlCenter) return null;

  return (
    <div className="modal-overlay" onClick={toggleControlCenter} style={{ backdropFilter: 'blur(16px)', background: 'rgba(0,0,0,0.6)' }}>
      <motion.div className="modal-box" onClick={e => e.stopPropagation()}
        style={{ width: 1100, maxWidth: '95vw', height: 620, maxHeight: '95vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 32px', borderBottom: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Activity size={24} color="var(--accent)" />
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Audio Engine</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {playback.bit_perfect && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.3)', color: '#06b6d4', padding: '6px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>
                BYPASS ACTIVE
              </motion.div>
            )}
            <button className="modal-close" onClick={toggleControlCenter}><X size={20} /></button>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Column 1: DSP / Soundstage */}
          <div style={{ flex: 1.2, padding: 32, borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={18} /> Soundstage Engine
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={resetProMode}>Reset</button>
                <button className={`btn ${dsp.enabled ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDSP({ enabled: !dsp.enabled })}>
                  {dsp.enabled ? 'Engine: ON' : 'Engine: OFF'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', width: '100%', flex: 1, justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: 500 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: dsp.width < 1.0 ? 'var(--accent)' : 'var(--text-dim)', transition: 'color 0.2s' }}>
                    HEADPHONE CROSSFEED
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: dsp.width > 1.0 ? 'var(--accent)' : 'var(--text-dim)', transition: 'color 0.2s' }}>
                    SPATIAL WIDENER
                  </span>
                </div>

                <input type="range" min={0} max={3} step={0.01} value={dsp.width}
                  style={{ width: '100%', height: 6, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  onChange={e => setDSP({ width: +e.target.value })} />

                <div style={{ marginTop: 12, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--accent)', fontFamily: 'monospace' }}>
                    {Math.round(dsp.width * 100)}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, textTransform: 'uppercase', letterSpacing: 2 }}>
                    {dsp.width === 1.0 ? 'Natural Stereo' : dsp.width < 1.0 ? 'Focused Center' : 'Immersive Width'}
                  </div>
                </div>
              </div>

              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px 16px', borderRadius: 8, width: '100%', maxWidth: 500, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                <p style={{ margin: 0 }}>
                  {dsp.width < 1.0
                    ? "Crossfeed blends stereo channels to reduce ear fatigue when using headphones, simulating the natural sound of speakers."
                    : dsp.width > 1.0
                      ? "Spatial widening uses mid/side processing to expand the soundstage, making instruments feel more distinct and immersive."
                      : "Music is playing in its original stereo master format with zero processing."}
                </p>
              </div>
            </div>
          </div>

          {/* Column 2: Hardware & Output */}
          <div style={{ flex: 1.2, padding: 32, borderRight: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.01)', overflowY: 'auto' }}>
            <h3 style={{ margin: 0, marginBottom: 24, fontSize: 16, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Settings2 size={18} /> Output Hardware
            </h3>

            {/* Device Selector */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>Playback Device</div>
                <button onClick={() => fetchDevices()} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, textTransform: 'uppercase' }}>
                  <RefreshCw size={10} /> Refresh
                </button>
              </div>
              <div className="device-selector" style={{ position: 'relative' }}>
                <div className="current-device" onClick={() => setDevOpen(o => !o)} style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{currentDevice || 'System Default'}</span>
                  <span style={{ color: 'var(--text-dim)' }}>▾</span>
                </div>
                <AnimatePresence>
                  {devOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1200, background: '#1a1a24', border: '1px solid var(--glass-border)', borderRadius: 8, marginTop: 4, overflow: 'hidden', maxHeight: 200, overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                      {devices.length === 0 && <div style={{ padding: 12, fontSize: 11, color: 'var(--text-dim)' }}>No devices found</div>}
                      {devices.map(d => (
                        <div key={d} onClick={() => { setAudioDevice(d); setDevOpen(false); }}
                          style={{
                            padding: '12px 16px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--glass-border)',
                            color: currentDevice === d ? 'var(--accent)' : 'var(--text)', background: currentDevice === d ? 'rgba(var(--accent-rgb),0.1)' : '',
                            display: 'flex', alignItems: 'center', gap: 8
                          }}>
                          {d.startsWith('[ASIO]') && <span style={{ fontSize: 8, background: '#ef4444', color: 'white', padding: '2px 4px', borderRadius: 4, fontWeight: 900, flexShrink: 0 }}>ASIO</span>}
                          {d.startsWith('[WASAPI]') && <span style={{ fontSize: 8, background: '#3b82f6', color: 'white', padding: '2px 4px', borderRadius: 4, fontWeight: 900, flexShrink: 0 }}>WASAPI</span>}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.replace('[ASIO] ', '').replace('[WASAPI] ', '')}
                          </span>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Exclusive Mode & Bit Perfect */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Hardware Mode</div>
                <div className={`exclusive-toggle ${playback.exclusive ? 'active' : ''}`} onClick={toggleExclusive} style={{ padding: '16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: playback.exclusive ? 'rgba(var(--accent-rgb), 0.1)' : 'rgba(0,0,0,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Exclusive Mode</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 12, background: playback.exclusive ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: playback.exclusive ? '#fff' : 'var(--text-dim)' }}>
                      {playback.exclusive ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.4 }}>
                    Bypass the OS mixer for direct signal integrity.
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Signal Path</div>
                <div className={`exclusive-toggle ${playback.bit_perfect ? 'active' : ''}`}
                  onClick={() => useStore.getState().toggleBitPerfect()}
                  style={{ padding: '16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: playback.bit_perfect ? 'rgba(6, 182, 212, 0.1)' : 'rgba(0,0,0,0.2)', borderColor: playback.bit_perfect ? '#06b6d4' : '' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Bit-Perfect Bypass</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 12, background: playback.bit_perfect ? '#06b6d4' : 'rgba(255,255,255,0.1)', color: playback.bit_perfect ? '#fff' : 'var(--text-dim)' }}>
                      {playback.bit_perfect ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.4 }}>
                    Skips resampler, volume, and DSP. Only works if file rate matches hardware.
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Hi-Res Upsampling</div>
                <div style={{ padding: '16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {[0, 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000].map(rate => (
                      <button
                        key={rate}
                        className={`rate-chip ${dsp.upsample_rate === rate ? 'active' : ''}`}
                        style={{
                          fontSize: 9,
                          padding: '3px 6px',
                          borderRadius: 4,
                          border: '1px solid var(--glass-border)',
                          background: dsp.upsample_rate === rate ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                          color: dsp.upsample_rate === rate ? 'white' : 'var(--text-dim)',
                          cursor: 'pointer',
                          fontWeight: dsp.upsample_rate === rate ? 700 : 400,
                          transition: 'all 0.2s'
                        }}
                        onClick={() => {
                          setDSP({ upsample_rate: rate });
                          if (rate > 0 && playback.bit_perfect) {
                            useStore.getState().toggleBitPerfect();
                          }
                        }}
                      >
                        {rate === 0 ? 'OFF' : `${rate / 1000}k`}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 12, lineHeight: 1.4 }}>
                    Sinc-interpolation upsampling to hardware limits.
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Bit-Depth Optimization</div>
                <div className={`exclusive-toggle ${dsp.dither ? 'active' : ''}`}
                  onClick={() => setDSP({ dither: !dsp.dither })}
                  style={{ padding: '16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: dsp.dither ? 'rgba(var(--accent-rgb), 0.1)' : 'rgba(0,0,0,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>TPDF Dithering</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 12, background: dsp.dither ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: dsp.dither ? '#fff' : 'var(--text-dim)' }}>
                      {dsp.dither ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.4 }}>
                    Reduces quantization distortion by adding 24-bit TPDF noise. Recommended for high-end DACs.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Column 3: Detailed Vertical Signal Path */}
          <div style={{ flex: 1.5, padding: 32, background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <h3 style={{ margin: 0, marginBottom: 24, fontSize: 16, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AudioLines size={18} color="var(--accent)" /> Detailed Signal Path
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, position: 'relative', flex: 1 }}>
              {/* Node 1: Source */}
              <div style={{ display: 'flex', alignItems: 'start', gap: 12, padding: 12, borderRadius: 8, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--glass-border)' }}>
                <div style={{ padding: 8, borderRadius: 6, background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
                  <AudioLines size={16} />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 }}>Source</div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>{fileFormat} Stream</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span>{formatHz(fileRate)}</span>
                    <span style={{ opacity: 0.3 }}>•</span>
                    <span>{fileCh === 1 ? 'Mono' : fileCh === 2 ? 'Stereo' : `${fileCh} Channels`}</span>
                  </div>
                </div>
              </div>

              {/* Connecting Line 1 */}
              <div style={{ width: 2, height: 16, background: 'var(--accent)', opacity: 0.3, marginLeft: 25, marginTop: -18, marginBottom: -18 }} />

              {/* Node 2: DSP */}
              <div style={{ display: 'flex', alignItems: 'start', gap: 12, padding: 12, borderRadius: 8, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--glass-border)', borderColor: dspActive ? 'var(--accent)' : '' }}>
                <div style={{ padding: 8, borderRadius: 6, background: dspActive ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255,255,255,0.02)', color: dspActive ? '#6366f1' : '#6b7280' }}>
                  <Settings size={16} />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 }}>DSP Engine</div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>
                    {dspActive ? 'Processing Active' : 'Bypassed (Lossless)'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {dsp.eq_enabled && (
                      <span style={{ color: '#818cf8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Sparkles size={10} /> Graphic EQ enabled
                      </span>
                    )}
                    {dsp.crossfeed_enabled && <span>• Linkwitz Headphone Crossfeed active</span>}
                    {dsp.spatial_enabled && <span>• Haas Spatial Widener active</span>}
                    {dsp.subsonic_enabled && <span>• Subsonic filter active</span>}
                    {dsp.width !== 1.0 && <span>• Soundstage Width: {Math.round(dsp.width * 100)}%</span>}
                    {!dspActive && <span style={{ opacity: 0.5, fontStyle: 'italic' }}>No active DSP modifiers</span>}
                  </div>
                </div>
              </div>

              {/* Connecting Line 2 */}
              <div style={{ width: 2, height: 16, background: dsp.upsample_rate > 0 ? '#06b6d4' : 'var(--accent)', opacity: 0.3, marginLeft: 25, marginTop: -18, marginBottom: -18 }} />

              {/* Node 3: Resampler */}
              <div style={{ display: 'flex', alignItems: 'start', gap: 12, padding: 12, borderRadius: 8, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--glass-border)', borderColor: dsp.upsample_rate > 0 ? '#06b6d4' : '' }}>
                <div style={{ padding: 8, borderRadius: 6, background: dsp.upsample_rate > 0 ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255,255,255,0.02)', color: dsp.upsample_rate > 0 ? '#06b6d4' : '#6b7280' }}>
                  <Sparkles size={16} />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 }}>Resampler</div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>
                    {dsp.upsample_rate > 0 ? 'Rubato Sinc upsampling' : 'No Resampling'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                    {dsp.upsample_rate > 0 ? (
                      <span style={{ color: '#22d3ee', fontWeight: 'medium' }}>
                        {formatHz(fileRate)} → {formatHz(dsp.upsample_rate)} ({dsp.resampler_interpolation || 'Sinc'} interpolation)
                      </span>
                    ) : (
                      <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Direct bitstream matching sample rate</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Connecting Line 3 */}
              <div style={{ width: 2, height: 16, background: '#22c55e', opacity: 0.3, marginLeft: 25, marginTop: -18, marginBottom: -18 }} />

              {/* Node 4: Output Driver */}
              <div style={{ display: 'flex', alignItems: 'start', gap: 12, padding: 12, borderRadius: 8, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                <div style={{ padding: 8, borderRadius: 6, background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}>
                  <Volume2 size={16} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 9, color: '#22c55e', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 }}>Output Driver</div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {currentDevice || 'Default Audio Device'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: '#4ade80', fontWeight: 'bold' }}>{outputMode}</span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span>Output Rate: {formatHz(outputRate)}</span>
                      <span style={{ opacity: 0.3 }}>•</span>
                      <span>{fileCh === 1 ? 'Mono' : fileCh === 2 ? 'Stereo' : `${fileCh} Channels`}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)' }}>
              <span>Aideo Pipeline v2</span>
              <span style={{ color: playback.bit_perfect ? '#06b6d4' : '#a855f7', fontWeight: 'bold' }}>
                {playback.bit_perfect ? 'PURPLE: BIT-PERFECT' : 'GREEN: HIGH QUALITY'}
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
