import { useEffect, useState, useMemo } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Sliders,
  Cpu,
  Gauge,
  Volume2,
  RefreshCw,
  X,
  Sparkles,
  Clock,
  Database,
  Globe,
  Wifi,
  Zap,
  RotateCcw,
  SlidersHorizontal,
  Disc,
} from 'lucide-react';
import {
  GRAPHIC_EQ_FREQUENCIES,
  calculateGraphicEqCurve,
  snapToDetent,
  freqToX,
  dbToY,
  generateSvgCurvePath,
  formatFrequency,
} from '../utils/audioMath';

type TabType = 'dsp_eq' | 'hardware_signal' | 'telemetry_utils';

const EQ_PRESETS: { name: string; gains: number[]; preamp?: number }[] = [
  { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  { name: 'Bass Boost', gains: [5.0, 4.0, 3.0, 1.5, 0.5, 0, 0, 0, 0, 0], preamp: -2.0 },
  { name: 'Vocal Clarity', gains: [-1.0, -0.5, 0, 1.5, 3.0, 3.5, 2.5, 1.0, 0, 0], preamp: -1.0 },
  { name: 'Treble Air', gains: [0, 0, 0, 0, 0, 0.5, 1.5, 3.0, 4.5, 5.0], preamp: -1.5 },
  { name: 'Audiophile Master', gains: [2.5, 1.8, 1.0, 0.0, -0.5, 0.5, 1.0, 1.5, 2.5, 3.0], preamp: -1.5 },
];

export function AudioControlCenter() {
  const {
    dsp,
    setDSP,
    toggleDspAB,
    resetProMode,
    toggleExclusive,
    devices,
    currentDevice,
    setAudioDevice,
    showControlCenter,
    toggleControlCenter,
    fetchDevices,
    networkTelemetry,
    sleepTimer,
    startSleepTimer,
    stopSleepTimer,
    playbackRate,
    setPlaybackRate,
    playbackFileRate,
    playbackFileCh,
    playbackFileFormat,
    playbackExclusive,
    playbackDevRate,
    playbackBitPerfect,
  } = useStore(
    useShallow(s => ({
      dsp: s.dsp,
      setDSP: s.setDSP,
      toggleDspAB: s.toggleDspAB,
      resetProMode: s.resetProMode,
      playbackFileRate: s.playback.file_rate,
      playbackFileCh: s.playback.file_ch,
      playbackFileFormat: s.playback.file_format,
      playbackExclusive: s.playback.exclusive,
      playbackDevRate: s.playback.dev_rate,
      playbackBitPerfect: s.playback.bit_perfect,
      toggleExclusive: s.toggleExclusive,
      devices: s.devices,
      currentDevice: s.currentDevice,
      setAudioDevice: s.setAudioDevice,
      showControlCenter: s.showControlCenter,
      toggleControlCenter: s.toggleControlCenter,
      fetchDevices: s.fetchDevices,
      networkTelemetry: s.networkTelemetry,
      sleepTimer: s.sleepTimer,
      startSleepTimer: s.startSleepTimer,
      stopSleepTimer: s.stopSleepTimer,
      playbackRate: s.playbackRate,
      setPlaybackRate: s.setPlaybackRate,
    }))
  );

  const [activeTab, setActiveTab] = useState<TabType>('dsp_eq');
  const [devOpen, setDevOpen] = useState(false);
  const [hoveredBand, setHoveredBand] = useState<number | null>(null);

  const fileRate = playbackFileRate || 44100;
  const fileCh = playbackFileCh || 2;
  const fileFormat = playbackFileFormat || 'PCM';

  const dspActive =
    dsp.enabled &&
    (dsp.eq_enabled ||
      dsp.crossfeed_enabled ||
      dsp.spatial_enabled ||
      dsp.night_mode_enabled ||
      dsp.subsonic_enabled ||
      dsp.saturation_enabled ||
      dsp.aideo_filter_enabled ||
      dsp.convolution_enabled ||
      dsp.width !== 1.0 ||
      (dsp.preamp_gain !== undefined && dsp.preamp_gain !== 0.0));

  const isAsio = currentDevice?.startsWith('[ASIO]');
  const isWasapiExclusive = playbackExclusive;
  const outputMode = isAsio ? 'ASIO Bit-Perfect' : isWasapiExclusive ? 'WASAPI Exclusive' : 'Shared Mixer';
  const outputRate = playbackDevRate || fileRate;

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
  }, [showControlCenter, devices.length, fetchDevices]);

  // Handle keyboard shortcut 'B' while control center is open
  useEffect(() => {
    if (!showControlCenter) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        toggleDspAB();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showControlCenter, toggleDspAB]);

  // Dynamic Frequency Transfer Curve Calculation
  const eqGains = useMemo(() => {
    const raw = dsp.eq_graphic_gains || [];
    if (raw.length >= 10) return raw.slice(0, 10);
    const padded = [...raw];
    while (padded.length < 10) padded.push(0);
    return padded;
  }, [dsp.eq_graphic_gains]);

  const curvePoints = useMemo(() => {
    if (!dsp.eq_enabled && (dsp.preamp_gain === undefined || dsp.preamp_gain === 0)) {
      return calculateGraphicEqCurve(new Array(10).fill(0), 0, fileRate, 90);
    }
    return calculateGraphicEqCurve(
      dsp.eq_enabled ? eqGains : new Array(10).fill(0),
      dsp.preamp_gain || 0,
      fileRate,
      90
    );
  }, [dsp.eq_enabled, eqGains, dsp.preamp_gain, fileRate]);

  const svgWidth = 800;
  const svgHeight = 120;
  const curvePath = useMemo(() => {
    return generateSvgCurvePath(curvePoints, svgWidth, svgHeight, -15, 15);
  }, [curvePoints, svgWidth, svgHeight]);

  const areaPath = useMemo(() => {
    if (!curvePath) return '';
    const zeroY = dbToY(0, svgHeight, -15, 15);
    return `${curvePath} L ${svgWidth} ${zeroY} L 0 ${zeroY} Z`;
  }, [curvePath, svgWidth, svgHeight]);

  const handleBandGainChange = (bandIndex: number, newGain: number) => {
    const snapped = snapToDetent(newGain, 0.35, 0);
    const updated = [...eqGains];
    updated[bandIndex] = Math.round(snapped * 10) / 10;
    setDSP({ eq_graphic_gains: updated, eq_enabled: true });
  };

  const handleBandReset = (bandIndex: number) => {
    const updated = [...eqGains];
    updated[bandIndex] = 0;
    setDSP({ eq_graphic_gains: updated });
  };

  const handleFlatAll = () => {
    setDSP({ eq_graphic_gains: new Array(10).fill(0), preamp_gain: 0 });
  };

  const applyPreset = (preset: (typeof EQ_PRESETS)[0]) => {
    setDSP({
      eq_enabled: true,
      eq_graphic_gains: [...preset.gains],
      preamp_gain: preset.preamp !== undefined ? preset.preamp : dsp.preamp_gain,
    });
  };

  if (!showControlCenter) return null;

  return (
    <div
      className="modal-overlay"
      onClick={toggleControlCenter}
      style={{
        backdropFilter: 'blur(20px)',
        background: 'rgba(0, 0, 0, 0.65)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <motion.div
        className="modal-box"
        onClick={e => e.stopPropagation()}
        style={{
          width: 1080,
          maxWidth: '96vw',
          height: 670,
          maxHeight: '94vh',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'linear-gradient(180deg, #161722 0%, #0f1017 100%)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          borderRadius: 16,
        }}
        initial={{ scale: 0.96, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 16 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {/* Master Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '18px 28px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          {/* Title & Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.25), rgba(6, 182, 212, 0.15))',
                border: '1px solid rgba(var(--accent-rgb), 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)',
              }}
            >
              <Activity size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: -0.2 }}>
                  Audio Control Center
                </h2>
                <span
                  style={{
                    fontSize: 9,
                    textTransform: 'uppercase',
                    letterSpacing: 1.2,
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: 4,
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: 'var(--text-dim)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  Pro Studio Deck
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                {outputMode} · {formatHz(outputRate)} · 32-bit Float Processing
              </div>
            </div>
          </div>

          {/* Master Controls: A/B Compare + Reset + Close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {playbackBitPerfect && (
              <div
                style={{
                  background: 'rgba(6, 182, 212, 0.12)',
                  border: '1px solid rgba(6, 182, 212, 0.35)',
                  color: '#22d3ee',
                  padding: '5px 10px',
                  borderRadius: 12,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0.8,
                }}
              >
                BIT-PERFECT DIRECT
              </div>
            )}

            {/* Master Instant A/B Compare Toggle */}
            <button
              className="btn"
              onClick={toggleDspAB}
              title="Instant A/B DSP Compare (Press 'B' globally)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 14px',
                borderRadius: 8,
                border: dsp.enabled
                  ? '1px solid rgba(16, 185, 129, 0.45)'
                  : '1px solid rgba(6, 182, 212, 0.45)',
                background: dsp.enabled ? 'rgba(16, 185, 129, 0.12)' : 'rgba(6, 182, 212, 0.1)',
                color: dsp.enabled ? '#34d399' : '#38bdf8',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Zap size={14} style={{ color: dsp.enabled ? '#34d399' : '#38bdf8' }} />
              <span>{dsp.enabled ? 'Mode B: DSP Active' : 'Mode A: Raw Direct'}</span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  opacity: 0.8,
                  background: 'rgba(0, 0, 0, 0.3)',
                  padding: '2px 5px',
                  borderRadius: 4,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                B
              </span>
            </button>

            {/* Reset Defaults */}
            <button
              className="btn btn-secondary"
              onClick={resetProMode}
              title="Reset all DSP stages to flat defaults"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 12,
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: 'var(--text-dim)',
              }}
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>

            {/* Modal Close */}
            <button
              className="modal-close"
              aria-label="Close audio control center"
              onClick={toggleControlCenter}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '0 28px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(0, 0, 0, 0.15)',
          }}
        >
          {[
            { id: 'dsp_eq' as TabType, label: 'DSP & 10-Band EQ', icon: Sliders },
            { id: 'hardware_signal' as TabType, label: 'Hardware & Pipeline', icon: Cpu },
            { id: 'telemetry_utils' as TabType, label: 'Telemetry & Utilities', icon: Gauge },
          ].map(tab => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 18px',
                  background: 'none',
                  border: 'none',
                  borderBottom: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                  color: isSelected ? 'var(--text)' : 'var(--text-dim)',
                  fontWeight: isSelected ? 600 : 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  marginBottom: -1,
                }}
              >
                <Icon size={15} color={isSelected ? 'var(--accent)' : 'currentColor'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Container */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column' }}>
          {/* TAB 1: DSP & 10-Band EQ Stage */}
          {activeTab === 'dsp_eq' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Dynamic Transfer Curve Visualizer */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: '16px 20px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Curve Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                      }}
                      onClick={() => setDSP({ eq_enabled: !dsp.eq_enabled })}
                    >
                      <button
                        style={{
                          width: 28,
                          height: 18,
                          borderRadius: 9,
                          border: 'none',
                          background: dsp.eq_enabled ? 'var(--accent)' : 'rgba(255, 255, 255, 0.15)',
                          position: 'relative',
                          cursor: 'pointer',
                          padding: 2,
                          transition: 'background 0.2s',
                        }}
                      >
                        <div
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: '50%',
                            background: '#fff',
                            transform: dsp.eq_enabled ? 'translateX(10px)' : 'translateX(0)',
                            transition: 'transform 0.2s',
                          }}
                        />
                      </button>
                      <span style={{ fontSize: 13, fontWeight: 700, color: dsp.eq_enabled ? 'var(--text)' : 'var(--text-dim)' }}>
                        Dynamic Frequency Transfer Curve
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      (10-Band Biquad Response · 20Hz - 20kHz)
                    </span>
                  </div>

                  {/* Quick Preset Selector & Flat Action */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {EQ_PRESETS.map(preset => {
                        const isCurrent =
                          preset.gains.every((g, i) => g === eqGains[i]) &&
                          (preset.preamp === undefined || preset.preamp === (dsp.preamp_gain || 0));
                        return (
                          <button
                            key={preset.name}
                            onClick={() => applyPreset(preset)}
                            style={{
                              fontSize: 10,
                              fontWeight: isCurrent ? 700 : 500,
                              padding: '4px 8px',
                              borderRadius: 5,
                              border: isCurrent
                                ? '1px solid rgba(var(--accent-rgb), 0.4)'
                                : '1px solid rgba(255, 255, 255, 0.08)',
                              background: isCurrent ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.03)',
                              color: isCurrent ? 'var(--accent)' : 'var(--text-dim)',
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                          >
                            {preset.name}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={handleFlatAll}
                      title="Reset all bands to 0 dB"
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '4px 8px',
                        borderRadius: 5,
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                      }}
                    >
                      Flat All
                    </button>
                  </div>
                </div>

                {/* SVG Curve Canvas */}
                <div style={{ width: '100%', height: svgHeight, position: 'relative' }}>
                  <svg
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    preserveAspectRatio="none"
                    style={{ width: '100%', height: '100%', display: 'block' }}
                  >
                    <defs>
                      <linearGradient id="curve-area-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={dsp.eq_enabled ? 0.22 : 0.05} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="curve-stroke-grad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="50%" stopColor="var(--accent)" />
                        <stop offset="100%" stopColor="#34d399" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal dB Grid Lines (+12dB, +6dB, 0dB, -6dB, -12dB) */}
                    {[-12, -6, 0, 6, 12].map(db => {
                      const y = dbToY(db, svgHeight, -15, 15);
                      const isZero = db === 0;
                      return (
                        <g key={db}>
                          <line
                            x1={0}
                            y1={y}
                            x2={svgWidth}
                            y2={y}
                            stroke={isZero ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)'}
                            strokeWidth={isZero ? 1.2 : 0.8}
                            strokeDasharray={isZero ? undefined : '3 3'}
                          />
                          <text
                            x={6}
                            y={y - 3}
                            fill={isZero ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.25)'}
                            fontSize={8}
                            fontFamily="monospace"
                          >
                            {db > 0 ? `+${db}dB` : `${db}dB`}
                          </text>
                        </g>
                      );
                    })}

                    {/* Vertical Frequency Grid Lines */}
                    {GRAPHIC_EQ_FREQUENCIES.map((freq, idx) => {
                      const x = freqToX(freq, svgWidth);
                      const isHovered = hoveredBand === idx;
                      return (
                        <g key={freq}>
                          <line
                            x1={x}
                            y1={0}
                            x2={x}
                            y2={svgHeight}
                            stroke={isHovered ? 'var(--accent)' : 'rgba(255, 255, 255, 0.06)'}
                            strokeWidth={isHovered ? 1.5 : 0.8}
                          />
                          <text
                            x={x}
                            y={svgHeight - 4}
                            textAnchor="middle"
                            fill={isHovered ? 'var(--accent)' : 'rgba(255, 255, 255, 0.3)'}
                            fontSize={8}
                            fontFamily="monospace"
                          >
                            {formatFrequency(freq)}
                          </text>
                        </g>
                      );
                    })}

                    {/* Area under curve */}
                    <path d={areaPath} fill="url(#curve-area-grad)" />

                    {/* Main Frequency Response Curve Stroke */}
                    <path
                      d={curvePath}
                      fill="none"
                      stroke={dsp.eq_enabled ? 'url(#curve-stroke-grad)' : 'rgba(255, 255, 255, 0.3)'}
                      strokeWidth={dsp.eq_enabled ? 2.5 : 1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Frequency Node Dots */}
                    {GRAPHIC_EQ_FREQUENCIES.map((freq, idx) => {
                      const gain = eqGains[idx] || 0;
                      const x = freqToX(freq, svgWidth);
                      const totalGainAtNode = (dsp.eq_enabled ? gain : 0) + (dsp.preamp_gain || 0);
                      const y = dbToY(totalGainAtNode, svgHeight, -15, 15);
                      const isHovered = hoveredBand === idx;
                      return (
                        <circle
                          key={freq}
                          cx={x}
                          cy={y}
                          r={isHovered ? 5 : gain !== 0 ? 3.5 : 2.5}
                          fill={dsp.eq_enabled && gain !== 0 ? 'var(--accent)' : '#fff'}
                          stroke="rgba(0, 0, 0, 0.8)"
                          strokeWidth={1.5}
                          style={{ transition: 'r 0.15s, fill 0.15s' }}
                        />
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* 10-Band Vertical Tactile Fader Bank */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.2)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
                    <SlidersHorizontal size={15} color="var(--accent)" />
                    <span>Tactile Graphic Channel Strips</span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    Double-click any fader to snap to 0 dB
                  </span>
                </div>

                {/* Vertical Faders Strip Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(10, 1fr)',
                    gap: 8,
                    alignItems: 'end',
                    padding: '8px 0',
                  }}
                >
                  {GRAPHIC_EQ_FREQUENCIES.map((freq, idx) => {
                    const gain = eqGains[idx] || 0;
                    const isHovered = hoveredBand === idx;
                    const isNonZero = gain !== 0;

                    return (
                      <div
                        key={freq}
                        onMouseEnter={() => setHoveredBand(idx)}
                        onMouseLeave={() => setHoveredBand(null)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 4px',
                          borderRadius: 8,
                          background: isHovered
                            ? 'rgba(255, 255, 255, 0.05)'
                            : isNonZero
                            ? 'rgba(var(--accent-rgb), 0.04)'
                            : 'rgba(255, 255, 255, 0.02)',
                          border: isHovered
                            ? '1px solid rgba(var(--accent-rgb), 0.3)'
                            : isNonZero
                            ? '1px solid rgba(var(--accent-rgb), 0.15)'
                            : '1px solid rgba(255, 255, 255, 0.04)',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {/* dB Gain Readout Badge */}
                        <div
                          onDoubleClick={() => handleBandReset(idx)}
                          title="Double-click to reset to 0dB"
                          style={{
                            fontSize: 10,
                            fontFamily: 'monospace',
                            fontWeight: isNonZero ? 700 : 500,
                            color: isNonZero ? 'var(--accent)' : 'var(--text-dim)',
                            padding: '2px 4px',
                            borderRadius: 4,
                            background: isNonZero ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                            cursor: 'pointer',
                            minHeight: 18,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          {gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)}
                        </div>

                        {/* Vertical Range Slider with zero detent */}
                        <div
                          style={{
                            height: 120,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                          }}
                          onDoubleClick={() => handleBandReset(idx)}
                        >
                          {/* 0dB Center Detent Notch Guide */}
                          <div
                            style={{
                              position: 'absolute',
                              top: '50%',
                              left: '15%',
                              right: '15%',
                              height: 1,
                              background: 'rgba(255, 255, 255, 0.15)',
                              pointerEvents: 'none',
                            }}
                          />

                          <input
                            type="range"
                            min={-12}
                            max={12}
                            step={0.1}
                            value={gain}
                            onChange={e => handleBandGainChange(idx, parseFloat(e.target.value))}
                            style={{
                              writingMode: 'vertical-lr',
                              WebkitAppearance: 'slider-vertical',
                              width: 24,
                              height: 110,
                              accentColor: 'var(--accent)',
                              cursor: 'pointer',
                              opacity: dsp.eq_enabled ? 1 : 0.45,
                            }}
                          />
                        </div>

                        {/* Frequency Label */}
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: isHovered || isNonZero ? 'var(--text)' : 'var(--text-dim)',
                            letterSpacing: -0.2,
                          }}
                        >
                          {formatFrequency(freq)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Soundstage Widener & Analog Processing Strip */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 16 }}>
                {/* Stereo Soundstage / Crossfeed */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Activity size={14} color="var(--accent)" /> Soundstage Width
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent)' }}>
                        {Math.round(dsp.width * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2.5}
                      step={0.02}
                      value={dsp.width}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        const snapped = snapToDetent(val, 0.06, 1.0);
                        setDSP({ width: Math.round(snapped * 100) / 100 });
                      }}
                      onDoubleClick={() => setDSP({ width: 1.0 })}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                    {[
                      { label: 'Crossfeed 70%', val: 0.7 },
                      { label: 'Natural 100%', val: 1.0 },
                      { label: 'Wide 140%', val: 1.4 },
                      { label: 'Stage 200%', val: 2.0 },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={() => setDSP({ width: item.val })}
                        style={{
                          flex: 1,
                          fontSize: 9,
                          fontWeight: dsp.width === item.val ? 700 : 500,
                          padding: '4px 2px',
                          borderRadius: 4,
                          border: dsp.width === item.val
                            ? '1px solid rgba(var(--accent-rgb), 0.4)'
                            : '1px solid rgba(255, 255, 255, 0.06)',
                          background: dsp.width === item.val
                            ? 'rgba(var(--accent-rgb), 0.15)'
                            : 'rgba(255, 255, 255, 0.02)',
                          color: dsp.width === item.val ? 'var(--accent)' : 'var(--text-dim)',
                          cursor: 'pointer',
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preamp Gain & Headroom */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Preamp Trim</span>
                      <span
                        onDoubleClick={() => setDSP({ preamp_gain: 0 })}
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          color: (dsp.preamp_gain || 0) !== 0 ? 'var(--accent)' : 'var(--text-dim)',
                          cursor: 'pointer',
                        }}
                      >
                        {(dsp.preamp_gain || 0) > 0 ? `+${dsp.preamp_gain}` : dsp.preamp_gain || 0} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={dsp.preamp_gain || 0}
                      onChange={e => {
                        const val = parseFloat(e.target.value);
                        setDSP({ preamp_gain: snapToDetent(val, 0.6, 0) });
                      }}
                      onDoubleClick={() => setDSP({ preamp_gain: 0 })}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Auto Headroom</span>
                    <button
                      onClick={() => setDSP({ auto_headroom: !dsp.auto_headroom })}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 10,
                        border: 'none',
                        background: dsp.auto_headroom ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)',
                        color: dsp.auto_headroom ? '#fff' : 'var(--text-dim)',
                        cursor: 'pointer',
                      }}
                    >
                      {dsp.auto_headroom ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                {/* Analog Tube Warmth */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={14} color="#f59e0b" /> Tube Warmth
                    </span>
                    <button
                      onClick={() => setDSP({ saturation_enabled: !dsp.saturation_enabled })}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 10,
                        border: 'none',
                        background: dsp.saturation_enabled ? '#f59e0b' : 'rgba(255, 255, 255, 0.1)',
                        color: dsp.saturation_enabled ? '#000' : 'var(--text-dim)',
                        cursor: 'pointer',
                      }}
                    >
                      {dsp.saturation_enabled ? 'ACTIVE' : 'OFF'}
                    </button>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
                      <span>Drive</span>
                      <span style={{ fontFamily: 'monospace' }}>
                        {dsp.saturation_enabled ? `${Math.round((dsp.saturation_drive || 0.2) * 100)}%` : 'Bypassed'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={dsp.saturation_drive || 0.2}
                      disabled={!dsp.saturation_enabled}
                      onChange={e => setDSP({ saturation_drive: parseFloat(e.target.value) })}
                      style={{
                        width: '100%',
                        accentColor: '#f59e0b',
                        cursor: dsp.saturation_enabled ? 'pointer' : 'default',
                        opacity: dsp.saturation_enabled ? 1 : 0.4,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Hardware & Signal Pipeline */}
          {activeTab === 'hardware_signal' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
              {/* Left Column: Device & Hardware Configuration */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Playback Device Selector */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '16px 20px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
                      Audio Output Device
                    </div>
                    <button
                      onClick={() => fetchDevices()}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent)',
                        fontSize: 11,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontWeight: 700,
                      }}
                    >
                      <RefreshCw size={11} /> Refresh
                    </button>
                  </div>

                  <div style={{ position: 'relative' }}>
                    <div
                      onClick={() => setDevOpen(o => !o)}
                      style={{
                        padding: '12px 16px',
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: 8,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    >
                      <span>{currentDevice || 'System Default Device'}</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>▾</span>
                    </div>

                    <AnimatePresence>
                      {devOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            zIndex: 1200,
                            background: '#181924',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: 8,
                            marginTop: 4,
                            maxHeight: 220,
                            overflowY: 'auto',
                            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
                          }}
                        >
                          {devices.length === 0 && (
                            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-dim)' }}>
                              No output audio devices found
                            </div>
                          )}
                          {devices.map(d => {
                            const isSelected = (!currentDevice && d === '[System Default Device]') || currentDevice === d;
                            return (
                              <div
                                key={d}
                                onClick={() => {
                                  setAudioDevice(d);
                                  setDevOpen(false);
                                }}
                                style={{
                                  padding: '10px 14px',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                                  color: isSelected ? 'var(--accent)' : 'var(--text)',
                                  background: isSelected ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                }}
                              >
                                {d === '[System Default Device]' && (
                                  <span style={{ fontSize: 8, background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', padding: '2px 5px', borderRadius: 3, fontWeight: 900 }}>
                                    DEFAULT
                                  </span>
                                )}
                                {d.startsWith('[ASIO]') && (
                                  <span style={{ fontSize: 8, background: '#ef4444', color: '#fff', padding: '2px 5px', borderRadius: 3, fontWeight: 900 }}>
                                    ASIO
                                  </span>
                                )}
                                {d.startsWith('[WASAPI]') && (
                                  <span style={{ fontSize: 8, background: '#3b82f6', color: '#fff', padding: '2px 5px', borderRadius: 3, fontWeight: 900 }}>
                                    WASAPI
                                  </span>
                                )}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {d === '[System Default Device]' ? 'System Default Device' : d.replace('[ASIO] ', '').replace('[WASAPI] ', '')}
                                </span>
                              </div>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Exclusive & Bit-Perfect Modes */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div
                    className={`exclusive-toggle ${playbackExclusive ? 'active' : ''}`}
                    onClick={toggleExclusive}
                    style={{
                      padding: '14px',
                      borderRadius: 10,
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      background: playbackExclusive ? 'rgba(var(--accent-rgb), 0.1)' : 'rgba(0, 0, 0, 0.2)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Exclusive Mode</span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 8,
                          background: playbackExclusive ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
                          color: playbackExclusive ? '#fff' : 'var(--text-dim)',
                        }}
                      >
                        {playbackExclusive ? 'ON' : 'OFF'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                      Direct exclusive hardware access.
                    </div>
                  </div>

                  <div
                    className={`exclusive-toggle ${playbackBitPerfect ? 'active' : ''}`}
                    onClick={() => useStore.getState().toggleBitPerfect()}
                    style={{
                      padding: '14px',
                      borderRadius: 10,
                      border: playbackBitPerfect
                        ? '1px solid rgba(6, 182, 212, 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                      background: playbackBitPerfect ? 'rgba(6, 182, 212, 0.1)' : 'rgba(0, 0, 0, 0.2)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Bit-Perfect</span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 8,
                          background: playbackBitPerfect ? '#06b6d4' : 'rgba(255, 255, 255, 0.08)',
                          color: playbackBitPerfect ? '#fff' : 'var(--text-dim)',
                        }}
                      >
                        {playbackBitPerfect ? 'ACTIVE' : 'OFF'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                      Bypasses volume, DSP, & resampler.
                    </div>
                  </div>
                </div>

                {/* Hi-Res Upsampling Chips */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '14px 18px',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>
                    Rubato Sinc Upsampling Target
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {[0, 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000].map(rate => (
                      <button
                        key={rate}
                        style={{
                          fontSize: 10,
                          padding: '4px 8px',
                          borderRadius: 5,
                          border: dsp.upsample_rate === rate
                            ? '1px solid rgba(var(--accent-rgb), 0.5)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                          background: dsp.upsample_rate === rate ? 'var(--accent)' : 'rgba(255, 255, 255, 0.04)',
                          color: dsp.upsample_rate === rate ? '#fff' : 'var(--text-dim)',
                          cursor: 'pointer',
                          fontWeight: dsp.upsample_rate === rate ? 700 : 500,
                          transition: 'all 0.15s',
                        }}
                        onClick={() => {
                          setDSP({ upsample_rate: rate });
                          if (rate > 0 && playbackBitPerfect) {
                            useStore.getState().toggleBitPerfect();
                          }
                        }}
                      >
                        {rate === 0 ? 'OFF (Direct)' : `${rate / 1000}k`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* TPDF Dithering */}
                <div
                  className={`exclusive-toggle ${dsp.dither ? 'active' : ''}`}
                  onClick={() => setDSP({ dither: !dsp.dither })}
                  style={{
                    padding: '14px 18px',
                    borderRadius: 12,
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    background: dsp.dither ? 'rgba(var(--accent-rgb), 0.1)' : 'rgba(0, 0, 0, 0.2)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>24-bit TPDF Dithering</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 8,
                        background: dsp.dither ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
                        color: dsp.dither ? '#fff' : 'var(--text-dim)',
                      }}
                    >
                      {dsp.dither ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                    Triangular Probability Density Function noise for smooth quantization.
                  </div>
                </div>
              </div>

              {/* Right Column: Detailed Signal Flow Pipeline */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.2)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
                  Live Signal Chain Architecture
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, position: 'relative' }}>
                  {/* Node 1: Source Stream */}
                  <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Disc size={16} />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 800 }}>1. Source Stream</div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{fileFormat} Stream</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        {formatHz(fileRate)} · {fileCh === 1 ? 'Mono' : fileCh === 2 ? 'Stereo' : `${fileCh} Ch`}
                      </div>
                    </div>
                  </div>

                  {/* Connector */}
                  <div style={{ width: 2, height: 12, background: 'var(--accent)', opacity: 0.3, marginLeft: 26, marginTop: -6, marginBottom: -6 }} />

                  {/* Node 2: DSP Engine */}
                  <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: dspActive ? '1px solid rgba(var(--accent-rgb), 0.3)' : '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: dspActive ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.05)', color: dspActive ? 'var(--accent)' : 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Sliders size={16} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 800 }}>2. DSP Processing</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: dspActive ? 'var(--text)' : 'var(--text-dim)' }}>
                        {dspActive ? 'DSP Active' : 'Lossless Direct Bypass'}
                      </div>
                      {dspActive && (
                        <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>
                          {[
                            dsp.eq_enabled ? 'EQ' : null,
                            dsp.width !== 1.0 ? `Width ${Math.round(dsp.width * 100)}%` : null,
                            dsp.saturation_enabled ? 'Tube' : null,
                            dsp.preamp_gain ? `${dsp.preamp_gain}dB` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Connector */}
                  <div style={{ width: 2, height: 12, background: 'var(--accent)', opacity: 0.3, marginLeft: 26, marginTop: -6, marginBottom: -6 }} />

                  {/* Node 3: Resampler */}
                  {(() => {
                    const devRate = playbackDevRate || 0;
                    const isUpsampling = dsp.upsample_rate > 0;
                    const isSharedResampling = !isUpsampling && fileRate > 0 && devRate > 0 && fileRate !== devRate;
                    const isResampling = isUpsampling || isSharedResampling;
                    const targetRate = isUpsampling ? dsp.upsample_rate : devRate;

                    return (
                      <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: isResampling ? '1px solid rgba(6, 182, 212, 0.3)' : '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: isResampling ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)', color: isResampling ? '#22d3ee' : 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Sparkles size={16} />
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 800 }}>3. Resampling Stage</div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>
                            {isUpsampling ? 'Rubato Sinc Upsampling' : isSharedResampling ? 'Mixer Sample Match' : 'Bit-Perfect Direct Rate'}
                          </div>
                          <div style={{ fontSize: 11, color: isResampling ? '#22d3ee' : 'var(--text-dim)', marginTop: 2 }}>
                            {isResampling ? `${formatHz(fileRate)} → ${formatHz(targetRate)}` : 'Direct bitstream'}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Connector */}
                  <div style={{ width: 2, height: 12, background: '#22c55e', opacity: 0.3, marginLeft: 26, marginTop: -6, marginBottom: -6 }} />

                  {/* Node 4: Output Driver */}
                  <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(34, 197, 94, 0.05)', border: '1px solid rgba(34, 197, 94, 0.2)', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Volume2 size={16} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 9, color: '#4ade80', textTransform: 'uppercase', fontWeight: 800 }}>4. Hardware DAC Output</div>
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {currentDevice || 'Default Audio Device'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        {outputMode} · {formatHz(outputRate)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Telemetry & Utilities */}
          {activeTab === 'telemetry_utils' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* DJ Crossfade & Playback Speed */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Gapless Crossfade */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '16px 20px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={15} color="var(--accent)" /> DJ Gapless Crossfade
                    </span>
                    <button
                      onClick={() => setDSP({ crossfade_transition_enabled: !dsp.crossfade_transition_enabled })}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 10,
                        border: 'none',
                        background: dsp.crossfade_transition_enabled ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)',
                        color: dsp.crossfade_transition_enabled ? '#fff' : 'var(--text-dim)',
                        cursor: 'pointer',
                      }}
                    >
                      {dsp.crossfade_transition_enabled ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                    <span>Transition Curve Duration</span>
                    <span style={{ color: dsp.crossfade_transition_enabled ? 'var(--accent)' : 'var(--text-dim)', fontWeight: 700 }}>
                      {dsp.crossfade_transition_enabled ? `${dsp.crossfade_transition_duration.toFixed(1)}s` : 'Disabled'}
                    </span>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={dsp.crossfade_transition_duration}
                    disabled={!dsp.crossfade_transition_enabled}
                    onChange={e => setDSP({ crossfade_transition_duration: parseFloat(e.target.value) })}
                    style={{
                      width: '100%',
                      accentColor: 'var(--accent)',
                      cursor: dsp.crossfade_transition_enabled ? 'pointer' : 'default',
                      opacity: dsp.crossfade_transition_enabled ? 1 : 0.4,
                    }}
                  />

                  <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
                    {[
                      { label: 'Off', val: 0, enable: false },
                      { label: '2.5s', val: 2.5, enable: true },
                      { label: '5.0s', val: 5.0, enable: true },
                      { label: '8.0s', val: 8.0, enable: true },
                    ].map(p => (
                      <button
                        key={p.label}
                        onClick={() => setDSP({ crossfade_transition_enabled: p.enable, crossfade_transition_duration: p.val })}
                        style={{
                          fontSize: 10,
                          padding: '4px 8px',
                          borderRadius: 4,
                          border: dsp.crossfade_transition_enabled && dsp.crossfade_transition_duration === p.val
                            ? '1px solid rgba(var(--accent-rgb), 0.4)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                          background: dsp.crossfade_transition_enabled && dsp.crossfade_transition_duration === p.val
                            ? 'var(--accent)'
                            : 'rgba(255, 255, 255, 0.03)',
                          color: dsp.crossfade_transition_enabled && dsp.crossfade_transition_duration === p.val
                            ? '#fff'
                            : 'var(--text-dim)',
                          cursor: 'pointer',
                          flex: 1,
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Playback Rate */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '16px 20px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Playback Pitch/Speed</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>
                      {playbackRate.toFixed(2)}x
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                    {[0.75, 1.0, 1.25, 1.5].map(rate => (
                      <button
                        key={rate}
                        onClick={() => setPlaybackRate(rate)}
                        style={{
                          flex: 1,
                          padding: '4px 0',
                          fontSize: 11,
                          fontWeight: 700,
                          borderRadius: 4,
                          border: playbackRate === rate ? '1px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
                          background: playbackRate === rate ? 'var(--accent)' : 'rgba(255, 255, 255, 0.03)',
                          color: playbackRate === rate ? '#fff' : 'var(--text-dim)',
                          cursor: 'pointer',
                        }}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>

                  <input
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={playbackRate}
                    onChange={e => setPlaybackRate(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                  />
                </div>

                {/* Sleep Timer */}
                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '16px 20px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Clock size={14} /> Sleep Timer
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 10,
                        background: sleepTimer.active ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
                        color: sleepTimer.active ? '#fff' : 'var(--text-dim)',
                      }}
                    >
                      {sleepTimer.active
                        ? `ACTIVE · ${Math.floor(sleepTimer.remaining / 60)}m ${sleepTimer.remaining % 60}s`
                        : 'OFF'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    {[15, 30, 45, 60].map(mins => (
                      <button
                        key={mins}
                        onClick={() => startSleepTimer(mins)}
                        style={{
                          fontSize: 10,
                          padding: '5px 8px',
                          borderRadius: 4,
                          border: sleepTimer.active && sleepTimer.duration === mins
                            ? '1px solid var(--accent)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                          background: sleepTimer.active && sleepTimer.duration === mins
                            ? 'var(--accent)'
                            : 'rgba(255, 255, 255, 0.03)',
                          color: sleepTimer.active && sleepTimer.duration === mins ? '#fff' : 'var(--text-dim)',
                          cursor: 'pointer',
                          flex: 1,
                        }}
                      >
                        {mins}m
                      </button>
                    ))}
                    {sleepTimer.active && (
                      <button
                        onClick={() => stopSleepTimer()}
                        style={{
                          fontSize: 10,
                          padding: '5px 8px',
                          borderRadius: 4,
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#f87171',
                          cursor: 'pointer',
                          flex: 1,
                        }}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Stream Telemetry Gauge */}
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.2)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Stream Telemetry & Network Health
                </div>

                {networkTelemetry ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {/* Latency */}
                      <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <Globe size={14} color={networkTelemetry.latency_ms < 60 ? '#34d399' : '#fbbf24'} />
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Latency</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: networkTelemetry.latency_ms < 60 ? '#34d399' : '#fbbf24' }}>
                          {networkTelemetry.latency_ms > 0 ? `${networkTelemetry.latency_ms} ms` : 'Testing...'}
                        </div>
                      </div>

                      {/* Speed */}
                      <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <Gauge size={14} color="var(--accent)" />
                          <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Throughput</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>
                          {(() => {
                            const bps = networkTelemetry.current_download_rate_bps * 8;
                            if (bps >= 1000000) return `${(bps / 1000000).toFixed(2)} Mbps`;
                            if (bps >= 1000) return `${(bps / 1000).toFixed(1)} Kbps`;
                            return `${bps} bps`;
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Buffer Bar */}
                    {networkTelemetry.active_stream_total_bytes > 0 && (
                      <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
                          <span>Stream Prebuffer</span>
                          <span>{((networkTelemetry.active_stream_buffered_bytes / networkTelemetry.active_stream_total_bytes) * 100).toFixed(0)}%</span>
                        </div>
                        <div style={{ width: '100%', height: 4, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 2, overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              background: 'var(--accent)',
                              width: `${(networkTelemetry.active_stream_buffered_bytes / networkTelemetry.active_stream_total_bytes) * 100}%`,
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Session Data */}
                    <div style={{ padding: '12px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Database size={14} color="var(--text-dim)" />
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Session Data Transferred</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>
                        {(() => {
                          const bytes = networkTelemetry.session_downloaded_bytes;
                          if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
                          if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
                          return `${(bytes / 1024).toFixed(0)} KB`;
                        })()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '16px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Wifi size={18} color="#34d399" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Offline Local Audio Mode</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        Playing from local storage with 0ms network transport latency.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
