import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import {
  X,
  Activity,
  Disc3,
  Sliders,
  Speaker,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Info
} from 'lucide-react';

export interface TheaterSignalPathModalProps {
  isOpen: boolean;
  onClose: () => void;
  spectrumBands?: number[];
}

export function TheaterSignalPathModal({ isOpen, onClose, spectrumBands = [] }: TheaterSignalPathModalProps) {
  const {
    currentTrack,
    currentDevice,
    playback,
    dsp,
    accentColor
  } = useStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      currentDevice: s.currentDevice,
      playback: s.playback,
      dsp: s.dsp,
      accentColor: s.accentColor
    }))
  );

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

  const effectivePath = playback.effective_audio_path;
  const isBitPerfect = effectivePath ? effectivePath.strict_bit_perfect : playback.bit_perfect;
  const isExclusive = effectivePath
    ? effectivePath.share_mode === 'exclusive' || effectivePath.share_mode === 'direct'
    : playback.exclusive;

  const engineLabel = effectivePath
    ? effectivePath.engine === 'asio'
      ? 'ASIO'
      : effectivePath.engine === 'wasapi'
      ? 'WASAPI'
      : 'CPAL'
    : playback.driver_type || 'WASAPI';

  const sourceFormat = currentTrack?.format || (effectivePath ? `${effectivePath.source.sample_rate / 1000}kHz` : 'PCM Audio');
  const sourceRate = effectivePath?.source.sample_rate || playback.file_rate || 44100;
  const sourceChannels = effectivePath?.source.channels || playback.file_ch || 2;

  const outputRate = effectivePath?.output.sample_rate || playback.dev_rate || sourceRate;
  const outputBits = effectivePath?.output.bits_per_sample || 24;
  const outputChannels = effectivePath?.output.channels || sourceChannels;
  const underruns = effectivePath?.underruns || 0;

  // Active transforms list
  const activeTransforms = useMemo(() => {
    if (effectivePath?.active_transforms && effectivePath.active_transforms.length > 0) {
      return effectivePath.active_transforms;
    }
    const list: string[] = [];
    if (dsp.auto_headroom) list.push('Auto Headroom Protection (-3dB)');
    if (dsp.eq_enabled) list.push('10-Band Graphic EQ');
    if (dsp.r128_enabled) list.push('EBU R128 Volume Normalization');
    if (dsp.upsample_rate > 0) list.push(`Upsampler (${dsp.upsample_rate / 1000}kHz sinc)`);
    if (dsp.saturation_enabled) list.push(`Analog Saturation (${dsp.saturation_drive}x)`);
    if (playback.volume < 1) list.push(`Software Volume Attenuation (${Math.round(playback.volume * 100)}%)`);
    return list;
  }, [effectivePath, dsp, playback.volume]);

  // Real-time peak & headroom telemetry calculation
  const { peakDbStr, headroomDbStr, isClipping, isNearLimit, peakRatio } = useMemo(() => {
    if (!spectrumBands || spectrumBands.length === 0) {
      return {
        peakDbStr: '-12.0',
        headroomDbStr: '+12.0',
        isClipping: false,
        isNearLimit: false,
        peakRatio: 0.25
      };
    }
    const maxAmp = Math.max(0.001, Math.min(1.0, Math.max(...spectrumBands)));
    const db = 20 * Math.log10(maxAmp);
    const headroom = Math.max(0, -db);
    return {
      peakDbStr: db >= -0.05 ? '0.0' : db.toFixed(1),
      headroomDbStr: `+${headroom.toFixed(1)}`,
      isClipping: maxAmp >= 0.98,
      isNearLimit: maxAmp >= 0.89 && maxAmp < 0.98,
      peakRatio: maxAmp
    };
  }, [spectrumBands]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop Scrim */}
          <motion.div
            key="signal-path-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 5100,
              backgroundColor: 'rgba(0, 0, 0, 0.65)',
              backdropFilter: 'blur(6px)'
            }}
          />

          {/* Centered Signal Path Modal */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 5101,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
              pointerEvents: 'none'
            }}
          >
            <motion.div
              key="signal-path-modal"
              initial={{ scale: 0.94, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 16 }}
              transition={{ type: 'spring', damping: 26, stiffness: 300 }}
              style={{
                width: '100%',
                maxWidth: 580,
                maxHeight: '88vh',
                backgroundColor: 'rgba(15, 18, 24, 0.96)',
                backdropFilter: 'blur(32px) saturate(190%)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 14,
                boxShadow: '0 24px 48px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                pointerEvents: 'auto',
                color: '#f8fafc'
              }}
              role="dialog"
              aria-modal="true"
              aria-label="Audio Signal Path & Telemetry"
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '18px 24px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(255, 255, 255, 0.02)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      backgroundColor: isBitPerfect ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                      border: isBitPerfect ? '1px solid rgba(6, 182, 212, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isBitPerfect ? '#06b6d4' : accentColor
                    }}
                  >
                    <Activity size={20} />
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
                      Signal Path & Audio Telemetry
                    </h2>
                    <p
                      style={{
                        margin: '2px 0 0 0',
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.5)'
                      }}
                    >
                      Real-time DSP pipeline and hardware driver telemetry
                    </p>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  aria-label="Close signal path"
                  title="Close Inspector"
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

              {/* Body / Signal Path Nodes */}
              <div
                style={{
                  padding: '20px 24px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16
                }}
              >
                {/* Real-time Headroom & Clipping Telemetry Card */}
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: 'rgba(255, 255, 255, 0.5)'
                    }}
                  >
                    <span>SIGNAL HEADROOM & PEAK DYNAMICS</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor: isClipping ? '#ef4444' : isNearLimit ? '#f59e0b' : '#10b981',
                          boxShadow: isClipping ? '0 0 8px #ef4444' : isNearLimit ? '0 0 8px #f59e0b' : '0 0 8px #10b981'
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: isClipping ? '#ef4444' : isNearLimit ? '#f59e0b' : '#10b981'
                        }}
                      >
                        {isClipping ? 'CLIPPING' : isNearLimit ? 'PEAK WARN' : 'SAFE / CLEAN'}
                      </span>
                    </div>
                  </div>

                  {/* Level Meter Bar */}
                  <div
                    style={{
                      height: 10,
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                      borderRadius: 4,
                      overflow: 'hidden',
                      position: 'relative'
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.round(peakRatio * 100)}%`,
                        backgroundColor: isClipping ? '#ef4444' : isNearLimit ? '#f59e0b' : accentColor,
                        borderRadius: 4,
                        transition: 'width 0.1s ease-out'
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      color: 'rgba(255, 255, 255, 0.7)'
                    }}
                  >
                    <span>Peak: <strong style={{ color: '#f8fafc' }}>{peakDbStr} dBFS</strong></span>
                    <span>Dynamic Headroom: <strong style={{ color: '#10b981' }}>{headroomDbStr} dB</strong></span>
                  </div>
                </div>

                {/* Node 1: Source */}
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#94a3b8',
                      flexShrink: 0
                    }}
                  >
                    <Disc3 size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'rgba(255, 255, 255, 0.45)'
                      }}
                    >
                      Stage 1 · Source Stream
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        marginTop: 2
                      }}
                    >
                      {sourceFormat}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.5)',
                        marginTop: 2
                      }}
                    >
                      {sourceRate.toLocaleString()} Hz · {sourceChannels === 2 ? 'Stereo (2.0)' : `${sourceChannels} Channels`}
                    </div>
                  </div>
                </div>

                {/* Node 2: DSP & Pipeline */}
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: isBitPerfect ? 'rgba(6, 182, 212, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                    border: isBitPerfect ? '1px solid rgba(6, 182, 212, 0.2)' : '1px solid rgba(255, 255, 255, 0.06)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      backgroundColor: isBitPerfect ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isBitPerfect ? '#06b6d4' : '#94a3b8',
                      flexShrink: 0
                    }}
                  >
                    {isBitPerfect ? <ShieldCheck size={18} /> : <Sliders size={18} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: isBitPerfect ? '#06b6d4' : 'rgba(255, 255, 255, 0.45)'
                        }}
                      >
                        Stage 2 · DSP & Processing
                      </span>
                      {isBitPerfect && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: 4,
                            backgroundColor: 'rgba(6, 182, 212, 0.15)',
                            color: '#06b6d4',
                            border: '1px solid rgba(6, 182, 212, 0.3)'
                          }}
                        >
                          BIT-PERFECT PASSTHROUGH
                        </span>
                      )}
                    </div>

                    {isBitPerfect ? (
                      <div
                        style={{
                          fontSize: 13,
                          color: '#e2e8f0',
                          marginTop: 4,
                          lineHeight: 1.4
                        }}
                      >
                        Exact bitstream delivered to the audio driver with 0 bit alterations or software volume re-quantization.
                      </div>
                    ) : (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {activeTransforms.map((t, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: 12,
                              color: '#cbd5e1',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6
                            }}
                          >
                            <Zap size={12} style={{ color: accentColor, flexShrink: 0 }} />
                            <span>{t}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Node 3: Output Device & Driver */}
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#94a3b8',
                      flexShrink: 0
                    }}
                  >
                    <Speaker size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'rgba(255, 255, 255, 0.45)'
                      }}
                    >
                      Stage 3 · Hardware Output Stage
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        marginTop: 2
                      }}
                    >
                      {engineLabel} {isExclusive ? 'Exclusive' : 'Shared'}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.6)',
                        marginTop: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      Endpoint: {currentDevice || 'Default System Audio Device'}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: 6,
                        fontSize: 11,
                        color: 'rgba(255, 255, 255, 0.45)'
                      }}
                    >
                      <span>{outputRate.toLocaleString()} Hz · {outputBits}-bit · {outputChannels === 2 ? 'Stereo' : `${outputChannels}ch`}</span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          color: underruns > 0 ? '#f59e0b' : '#10b981'
                        }}
                      >
                        <CheckCircle2 size={12} />
                        <span>{underruns} Underruns</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div
                style={{
                  padding: '12px 24px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  background: 'rgba(255, 255, 255, 0.02)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: 'rgba(255, 255, 255, 0.4)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Info size={13} />
                  <span>Press <kbd style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(255, 255, 255, 0.1)', color: '#ffffff' }}>I</kbd> or <kbd style={{ padding: '1px 5px', borderRadius: 3, background: 'rgba(255, 255, 255, 0.1)', color: '#ffffff' }}>Esc</kbd> to close</span>
                </div>
                <button
                  onClick={onClose}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
