import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import { getAudioPathPresentation } from '../../utils/audioPath';
import { useAudioLevels } from '../../utils/useAudioLevels';
import { AudioLevelReadout } from '../AudioLevelReadout';
import {
  X,
  Activity,
  Disc3,
  Cpu,
  Volume2,
  Sliders,
  Headphones,
  RefreshCw,
  Speaker,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Info
} from 'lucide-react';

export interface TheaterSignalPathModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TheaterSignalPathModal({ isOpen, onClose }: TheaterSignalPathModalProps) {
  const audioLevels = useAudioLevels(isOpen);
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

  const effectivePath = playback.effective_audio_path?.active ? playback.effective_audio_path : null;
  const { isBitPerfect, hudLabel } = getAudioPathPresentation(playback);
  const sourceFormat = currentTrack?.format || 'Unknown';
  const sourceRate = effectivePath?.source.sample_rate || playback.file_rate || 0;
  const sourceChannels = effectivePath?.source.channels || playback.file_ch || 0;
  const sourceBits = effectivePath?.source.bits_per_sample || effectivePath?.source.valid_bits_per_sample || 0;
  const outputRate = effectivePath?.output.sample_rate || 0;
  const outputBits = effectivePath?.output.bits_per_sample || 0;
  const outputChannels = effectivePath?.output.channels || 0;
  const underruns = effectivePath?.underruns;
  const activeTransforms = effectivePath?.active_transforms;

  // Determine overall fidelity & color tone
  const isDownsampled = sourceRate > 0 && outputRate > 0 && outputRate < sourceRate;
  const isResampled = sourceRate > 0 && outputRate > 0 && outputRate !== sourceRate;
  const hasDsp = dsp.enabled || dsp.eq_enabled || dsp.convolution_enabled || dsp.crossfeed_enabled || dsp.spatial_enabled || dsp.r128_enabled || (dsp.upsample_rate > 0 && isResampled);

  let overallFidelity = 'Lossless';
  let colorTone = '#10b981'; // green
  if (isBitPerfect) {
    overallFidelity = 'Bit-Perfect';
    colorTone = '#06b6d4'; // cyan
  } else if (isDownsampled) {
    overallFidelity = 'Resampled';
    colorTone = '#f59e0b'; // amber
  } else if (hasDsp || (effectivePath?.active_transforms && effectivePath.active_transforms.length > 0)) {
    overallFidelity = 'Enhanced';
    colorTone = '#a855f7'; // purple
  }

  // Helper for status pill styling
  const getStatusBadgeStyle = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('bit-perfect')) {
      return {
        bg: 'rgba(6, 182, 212, 0.15)',
        text: '#06b6d4',
        border: '1px solid rgba(6, 182, 212, 0.35)',
        label: 'Bit-Perfect'
      };
    }
    if (s.includes('lossless')) {
      return {
        bg: 'rgba(16, 185, 129, 0.15)',
        text: '#10b981',
        border: '1px solid rgba(16, 185, 129, 0.35)',
        label: 'Lossless'
      };
    }
    if (s.includes('enhanced')) {
      return {
        bg: 'rgba(168, 85, 247, 0.15)',
        text: '#c084fc',
        border: '1px solid rgba(168, 85, 247, 0.35)',
        label: 'Enhanced'
      };
    }
    if (s.includes('resampled') || s.includes('downsampled')) {
      return {
        bg: 'rgba(245, 158, 11, 0.15)',
        text: '#fbbf24',
        border: '1px solid rgba(245, 158, 11, 0.35)',
        label: 'Resampled'
      };
    }
    if (s.includes('active')) {
      return {
        bg: 'rgba(59, 130, 246, 0.15)',
        text: '#60a5fa',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        label: 'Active'
      };
    }
    return {
      bg: 'rgba(255, 255, 255, 0.05)',
      text: 'rgba(255, 255, 255, 0.5)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      label: 'Bypassed'
    };
  };

  const volumeVal = typeof playback.volume === 'number' ? playback.volume : 1;
  const volumePct = Math.round(volumeVal * 100);
  const volumeActive = effectivePath?.volume_applied || Math.abs(volumeVal - 1.0) > 0.001;
  const levelingActive = dsp.r128_enabled;
  const acousticsActive = dsp.convolution_enabled || dsp.crossfeed_enabled || dsp.spatial_enabled || Math.abs((dsp.width ?? 1) - 1.0) > 0.01;

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
                maxWidth: 620,
                maxHeight: '88vh',
                backgroundColor: 'rgba(15, 18, 24, 0.97)',
                backdropFilter: 'blur(32px) saturate(190%)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 16,
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: `${colorTone}18`,
                      border: `1px solid ${colorTone}40`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: colorTone,
                      boxShadow: `0 0 16px ${colorTone}25`
                    }}
                  >
                    <Activity size={22} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <h2
                        style={{
                          margin: 0,
                          fontSize: 16,
                          fontWeight: 700,
                          letterSpacing: '-0.01em',
                          color: '#f8fafc'
                        }}
                      >
                        Audio signal path
                      </h2>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: 999,
                          backgroundColor: `${colorTone}20`,
                          color: colorTone,
                          border: `1px solid ${colorTone}40`,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase'
                        }}
                      >
                        {overallFidelity}
                      </span>
                    </div>
                    <p
                      style={{
                        margin: '2px 0 0 0',
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.5)'
                      }}
                    >
                      Interactive Roon-style signal chain & bit-accuracy inspector.
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
                    borderRadius: 8,
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

              {/* Body / Signal Path Nodes Chain */}
              <div
                style={{
                  padding: '20px 24px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14
                }}
              >
                {/* Live Peak & Headroom Meter Bar */}
                <div style={{ padding: '14px 18px', borderRadius: 10, backgroundColor: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Peak and headroom</span>
                  <AudioLevelReadout levels={audioLevels} />
                </div>

                {/* --- Stage 1: Source Format --- */}
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'rgba(255, 255, 255, 0.45)'
                        }}
                      >
                        Stage 1 · Source
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 4,
                          backgroundColor: getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : 'lossless').bg,
                          color: getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : 'lossless').text,
                          border: getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : 'lossless').border
                        }}
                      >
                        {getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : 'lossless').label}
                      </span>
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
                        color: 'rgba(255, 255, 255, 0.55)',
                        marginTop: 3
                      }}
                    >
                      {sourceRate > 0 ? `${sourceRate.toLocaleString()} Hz` : 'Unknown rate'}{sourceBits > 0 ? ` · ${sourceBits}-bit` : ''} · {sourceChannels > 0 ? (sourceChannels === 2 ? 'Stereo (2.0)' : `${sourceChannels} Channels`) : 'Unknown channels'}
                    </div>
                  </div>
                </div>

                {/* --- Stage 2: Decoder --- */}
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: isBitPerfect ? 'rgba(6, 182, 212, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                    border: isBitPerfect ? '1px solid rgba(6, 182, 212, 0.25)' : '1px solid rgba(255, 255, 255, 0.07)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: isBitPerfect ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isBitPerfect ? '#06b6d4' : '#94a3b8',
                      flexShrink: 0
                    }}
                  >
                    {isBitPerfect ? <ShieldCheck size={18} /> : <Cpu size={18} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: isBitPerfect ? '#06b6d4' : 'rgba(255, 255, 255, 0.45)'
                        }}
                      >
                        Stage 2 · Decoder
                      </span>
                      {isBitPerfect ? (
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
                      ) : (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: 4,
                            backgroundColor: getStatusBadgeStyle('lossless').bg,
                            color: getStatusBadgeStyle('lossless').text,
                            border: getStatusBadgeStyle('lossless').border
                          }}
                        >
                          Lossless
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        marginTop: 2
                      }}
                    >
                      Symphonia Audio Decoder
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.55)',
                        marginTop: 3
                      }}
                    >
                      f32 PCM Internal Bus · Lossless Stream Precision
                    </div>
                  </div>
                </div>

                {/* --- Stage 3: Volume & Leveling --- */}
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#94a3b8',
                      flexShrink: 0
                    }}
                  >
                    <Volume2 size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'rgba(255, 255, 255, 0.45)'
                        }}
                      >
                        Stage 3 · Volume & Leveling
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 4,
                          backgroundColor: getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (volumeActive || levelingActive ? 'enhanced' : 'bypassed')).bg,
                          color: getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (volumeActive || levelingActive ? 'enhanced' : 'bypassed')).text,
                          border: getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (volumeActive || levelingActive ? 'enhanced' : 'bypassed')).border
                        }}
                      >
                        {getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (volumeActive || levelingActive ? 'enhanced' : 'bypassed')).label}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        marginTop: 2
                      }}
                    >
                      ReplayGain / LUFS
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.55)',
                        marginTop: 3
                      }}
                    >
                      Volume & Peak Normalization · Master Volume: {volumePct}% · ReplayGain: {dsp.r128_enabled ? `${dsp.track_replaygain_gain || 0} dB` : 'Bypassed / Off'}
                    </div>
                  </div>
                </div>

                {/* --- Stage 4: Parametric EQ & Transforms --- */}
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: isBitPerfect ? 'rgba(6, 182, 212, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                    border: isBitPerfect ? '1px solid rgba(6, 182, 212, 0.2)' : '1px solid rgba(255, 255, 255, 0.07)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isBitPerfect ? '#06b6d4' : '#94a3b8',
                      flexShrink: 0
                    }}
                  >
                    <Sliders size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: isBitPerfect ? '#06b6d4' : 'rgba(255, 255, 255, 0.45)'
                        }}
                      >
                        Stage 4 · Parametric EQ
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 4,
                          backgroundColor: getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (dsp.eq_enabled ? 'enhanced' : 'bypassed')).bg,
                          color: getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (dsp.eq_enabled ? 'enhanced' : 'bypassed')).text,
                          border: getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (dsp.eq_enabled ? 'enhanced' : 'bypassed')).border
                        }}
                      >
                        {getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (dsp.eq_enabled ? 'enhanced' : 'bypassed')).label}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        marginTop: 2
                      }}
                    >
                      Biquad Parametric EQ
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
                        Backend reports a strict bit-perfect path with no active transforms.
                      </div>
                    ) : (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {activeTransforms == null ? (
                          <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>Transforms unknown</span>
                        ) : activeTransforms.length === 0 ? (
                          <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' }}>No active transforms</span>
                        ) : (
                          activeTransforms.map((t: string, i: number) => (
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
                              <Zap size={12} style={{ color: accentColor || '#a855f7', flexShrink: 0 }} />
                              <span>{t}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* --- Stage 5: Acoustics & Spatial --- */}
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#94a3b8',
                      flexShrink: 0
                    }}
                  >
                    <Headphones size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'rgba(255, 255, 255, 0.45)'
                        }}
                      >
                        Stage 5 · Acoustics & Spatial
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 4,
                          backgroundColor: getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (acousticsActive ? 'enhanced' : 'bypassed')).bg,
                          color: getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (acousticsActive ? 'enhanced' : 'bypassed')).text,
                          border: getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (acousticsActive ? 'enhanced' : 'bypassed')).border
                        }}
                      >
                        {getStatusBadgeStyle(isBitPerfect ? 'bypassed' : (acousticsActive ? 'enhanced' : 'bypassed')).label}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        marginTop: 2
                      }}
                    >
                      Acoustics & Spatial Processing
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.55)',
                        marginTop: 3
                      }}
                    >
                      Convolution & Crossfeed · Width: {Math.round((dsp.width ?? 1) * 100)}%
                    </div>
                  </div>
                </div>

                {/* --- Stage 6: Resampler --- */}
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#94a3b8',
                      flexShrink: 0
                    }}
                  >
                    <RefreshCw size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'rgba(255, 255, 255, 0.45)'
                        }}
                      >
                        Stage 6 · Resampler
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 4,
                          backgroundColor: getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : (isResampled ? (outputRate < sourceRate ? 'resampled' : 'enhanced') : 'bypassed')).bg,
                          color: getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : (isResampled ? (outputRate < sourceRate ? 'resampled' : 'enhanced') : 'bypassed')).text,
                          border: getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : (isResampled ? (outputRate < sourceRate ? 'resampled' : 'enhanced') : 'bypassed')).border
                        }}
                      >
                        {getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : (isResampled ? (outputRate < sourceRate ? 'resampled' : 'enhanced') : 'bypassed')).label}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        marginTop: 2
                      }}
                    >
                      Rubato Sinc Resampler
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(255, 255, 255, 0.55)',
                        marginTop: 3
                      }}
                    >
                      Sample Rate Conversion · {isResampled ? `Resampling: ${sourceRate} Hz -> ${outputRate} Hz` : '1:1 Direct Stream (Bypassed)'}
                    </div>
                  </div>
                </div>

                {/* --- Stage 7: Output Endpoint --- */}
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '14px 18px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: 'rgba(255, 255, 255, 0.06)',
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
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'rgba(255, 255, 255, 0.45)'
                        }}
                      >
                        Stage 7 · Output device
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 4,
                          backgroundColor: getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : (effectivePath ? 'lossless' : 'bypassed')).bg,
                          color: getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : (effectivePath ? 'lossless' : 'bypassed')).text,
                          border: getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : (effectivePath ? 'lossless' : 'bypassed')).border
                        }}
                      >
                        {getStatusBadgeStyle(isBitPerfect ? 'bit-perfect' : (effectivePath ? 'lossless' : 'bypassed')).label}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#f8fafc',
                        marginTop: 2
                      }}
                    >
                      {effectivePath ? hudLabel : 'Audio path pending'}
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
                      Requested endpoint: {currentDevice || 'System default'}
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
                      <span>
                        {outputRate > 0
                          ? `${outputRate.toLocaleString()} Hz · ${outputBits > 0 ? `${outputBits}-bit` : 'Unknown depth'} · ${outputChannels > 0 ? (outputChannels === 2 ? 'Stereo' : `${outputChannels}ch`) : 'Unknown channels'}`
                          : 'Unknown rate · Unknown depth · Unknown channels'}
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          color: underruns == null ? '#94a3b8' : underruns > 0 ? '#f59e0b' : '#10b981'
                        }}
                      >
                        {underruns == null ? <Info size={12} /> : <CheckCircle2 size={12} />}
                        <span>{underruns == null ? 'Underruns unknown' : `${underruns} Underruns`}</span>
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
