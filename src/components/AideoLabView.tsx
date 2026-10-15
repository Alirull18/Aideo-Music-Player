import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/types';
import {
  Sliders,
  Activity,
  Headphones,
  Sparkles,
  FolderOpen,
  Search,
  RotateCcw,
  Zap,
  Waves,
  Shield,
  Check,
  X,
  FileAudio,
  Trash2,
  Save,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Compass,
  Play,
  ListPlus,
} from 'lucide-react';
import {
  GRAPHIC_EQ_FREQUENCIES,
  getPeakingResponse,
  getLowshelfResponse,
  getHighshelfResponse,
  snapToDetent,
  freqToX,
  dbToY,
  formatFrequency,
  parseAutoEqProfileText,
} from '../utils/audioMath';

type MainLabTab = 'studio_eq' | 'spatial_acoustics' | 'sonic_flow';
type EqViewMode = 'graph' | 'faders';

const BRAND_FILTERS = [
  'All',
  'Sennheiser',
  'Sony',
  'Beyerdynamic',
  'Moondrop',
  'Audio-Technica',
  'Apple',
  'Hifiman',
  'Focal',
  'AKG',
  'Shure',
  'Philips',
];

const EQ_QUICK_PRESETS = [
  { name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  { name: 'Bass Boost', gains: [4.5, 3.5, 2.0, 1.0, 0, 0, 0, 0.5, 1.0, 1.5], preamp: -2.0 },
  { name: 'Vocal Clarity', gains: [-1.0, -0.5, 0, 1.0, 2.5, 3.0, 2.0, 1.0, 0.5, 0], preamp: -1.0 },
  { name: 'Treble Air', gains: [0, 0, 0, 0, 0, 0.5, 1.5, 3.0, 4.0, 4.5], preamp: -1.5 },
  { name: 'Mild Boost', gains: [1.0, 0.5, 0, -0.5, 0, 0.5, 1.0, 1.5, 2.0, 1.5], preamp: -0.5 },
];

const getSourceStyle = (source: string) => {
  const s = source.toLowerCase();
  if (s.includes('oratory')) return { bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.35)', color: '#60a5fa' };
  if (s.includes('crinacle')) return { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)', color: '#34d399' };
  if (s.includes('rtings')) return { bg: 'rgba(249, 115, 22, 0.12)', border: 'rgba(249, 115, 22, 0.35)', color: '#fb923c' };
  if (s.includes('innerfidelity')) return { bg: 'rgba(234, 179, 8, 0.12)', border: 'rgba(234, 179, 8, 0.35)', color: '#facc15' };
  if (s.includes('raa')) return { bg: 'rgba(236, 72, 153, 0.12)', border: 'rgba(236, 72, 153, 0.35)', color: '#f472b6' };
  return { bg: 'rgba(139, 92, 246, 0.12)', border: 'rgba(139, 92, 246, 0.3)', color: '#a78bfa' };
};

export function AideoLabView() {
  const {
    dsp,
    setDSP,
    toggleDspAB,
    resetProMode,
    lowSpecMode,
    playbackStatus,
    playbackDevRate,
    playbackFileRate,
    activeAutoEq,
    setActiveAutoEq,
    tracks,
    currentTrack,
    playTrack,
    addToQueue,
  } = useStore(
    useShallow(s => ({
      dsp: s.dsp,
      setDSP: s.setDSP,
      toggleDspAB: s.toggleDspAB,
      resetProMode: s.resetProMode,
      lowSpecMode: s.lowSpecMode,
      playbackStatus: s.playback.status,
      playbackDevRate: s.playback.dev_rate,
      playbackFileRate: s.playback.file_rate,
      activeAutoEq: s.activeAutoEq,
      setActiveAutoEq: s.setActiveAutoEq,
      tracks: s.tracks,
      currentTrack: s.currentTrack,
      playTrack: s.playTrack,
      addToQueue: s.addToQueue,
    }))
  );

  const [activeTab, setActiveTab] = useState<MainLabTab>('studio_eq');
  const [eqViewMode, setEqViewMode] = useState<EqViewMode>('graph');
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [dbSearchQuery, setDbSearchQuery] = useState('');
  const [autoEqDb, setAutoEqDb] = useState<{ name: string; url: string; source: string; fullSource: string }[] | null>(null);
  const [isFetchingDb, setIsFetchingDb] = useState(false);
  const [autoEqError, setAutoEqError] = useState('');
  const activeAutoEqUrl = activeAutoEq?.url || '';
  const activeAutoEqProfile = activeAutoEq || autoEqDb?.find(profile => profile.url === activeAutoEqUrl);

  // Selected Node & Dragging state for Parametric EQ
  const [selectedBand, setSelectedBand] = useState<number>(0);
  const [activeDragNode, setActiveDragNode] = useState<number | null>(null);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const graphRef = useRef<SVGSVGElement>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(840);
  const svgWidth = Math.max(480, containerWidth);
  const svgHeight = eqViewMode === 'graph' ? 260 : 130;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<number[]>(new Array(64).fill(0));

  // AutoEQ Dock Collapsed State with LocalStorage Persistence
  const [autoEqCollapsed, setAutoEqCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('aideo_autoeq_collapsed') === 'true';
  });

  const toggleAutoEqCollapsed = () => {
    setAutoEqCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('aideo_autoeq_collapsed', String(next));
      return next;
    });
  };

  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0 && Math.abs(el.clientWidth - containerWidth) >= 2) {
        setContainerWidth(el.clientWidth);
      }
    };
    if (el.clientWidth > 0) setContainerWidth(el.clientWidth);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateWidth);
      ro.observe(el);
    }
    window.addEventListener('resize', updateWidth);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, [containerWidth]);

  // Custom Presets
  const [customPresets, setCustomPresets] = useState<{ name: string; dsp: typeof dsp }[]>(() => {
    try {
      const saved = localStorage.getItem('aideo_dsp_presets');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newPresetName, setNewPresetName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);

  const sampleRate = playbackDevRate || playbackFileRate || 48000;
  const eqGains = dsp.eq_graphic_gains || new Array(10).fill(0);

  // Listen for audio spectrum FFT IPC events
  useEffect(() => {
    const unlisten = listen<number[]>('audio-spectrum', event => {
      spectrumRef.current = event.payload;
    });
    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Waterfall canvas loop for interactive graph mode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || activeTab !== 'studio_eq' || eqViewMode !== 'graph' || lowSpecMode) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const offscreenCtx = offscreen.getContext('2d');

    let animId: number;
    const render = () => {
      const w = canvas.width;
      const h = canvas.height;

      if (offscreenCtx) {
        offscreenCtx.clearRect(0, 0, w, h);
        offscreenCtx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(offscreen, 0, 1, w, h - 1);
      } else {
        ctx.drawImage(canvas, 0, 1, w, h - 1);
      }

      ctx.fillStyle = 'rgba(9, 9, 14, 0.05)';
      ctx.fillRect(0, 0, w, 1);

      const bands = spectrumRef.current;
      if (bands && bands.length > 0) {
        const step = w / bands.length;
        for (let i = 0; i < bands.length; i++) {
          const val = bands[i];
          if (val > 0.005) {
            const x = i * step;
            ctx.fillStyle = `hsla(${(i / bands.length) * 120 + 210}, 85%, 60%, ${Math.min(val * 1.5, 0.8)})`;
            ctx.fillRect(x, 0, step - 0.5, 1.2);
          }
        }
      }
      animId = requestAnimationFrame(render);
    };

    if (playbackStatus === 'Playing') {
      render();
    }
    return () => cancelAnimationFrame(animId);
  }, [activeTab, eqViewMode, lowSpecMode, playbackStatus, svgWidth, svgHeight]);

  // AutoEQ Database Fetcher
  const fetchAutoEqDb = useCallback(async () => {
    if (autoEqDb && autoEqDb.length > 0) return;
    setIsFetchingDb(true);
    setAutoEqError('');
    try {
      const response = await fetch('https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/INDEX.md');
      if (!response.ok) throw new Error('Failed to download AutoEQ master index.');
      const text = await response.text();
      const lines = text.split('\n');
      const parsedEntries: { name: string; url: string; source: string; fullSource: string }[] = [];

      lines.forEach(line => {
        const match = line.trim().match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*by\s*(.+)$/i);
        if (match) {
          const name = match[1];
          const relativePath = match[2].replace(/^\.\//, '');
          const rawSource = match[3];
          const contributor = rawSource.split(' on ')[0].trim();
          const segments = relativePath.split('/');
          const lastSegment = segments[segments.length - 1];
          const decodedFolderName = decodeURIComponent(lastSegment);
          const fileUrl = `https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/${relativePath}/${encodeURIComponent(decodedFolderName)}%20ParametricEQ.txt`;

          parsedEntries.push({
            name,
            url: fileUrl,
            source: contributor,
            fullSource: rawSource,
          });
        }
      });
      setAutoEqDb(parsedEntries);
    } catch (err: any) {
      setAutoEqError(err.message || 'Failed to load headphone database.');
    } finally {
      setIsFetchingDb(false);
    }
  }, [autoEqDb]);

  useEffect(() => {
    if (activeTab === 'studio_eq') {
      fetchAutoEqDb();
    }
  }, [activeTab, fetchAutoEqDb]);

  // Filtered AutoEQ entries
  const filteredHeadphones = useMemo(() => {
    if (!autoEqDb) return [];
    let list = autoEqDb;
    if (selectedBrand !== 'All') {
      const bLower = selectedBrand.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(bLower));
    }
    if (dbSearchQuery.trim()) {
      const q = dbSearchQuery.toLowerCase().trim();
      const parts = q.split(/\s+/);
      list = list.filter(e => {
        const n = e.name.toLowerCase();
        return parts.every(p => n.includes(p));
      });
    }
    return list.slice(0, 30);
  }, [autoEqDb, selectedBrand, dbSearchQuery]);

  // Load and apply selected headphone profile
  const handleApplyHeadphoneProfile = async (headphone: { name: string; url: string; fullSource: string }) => {
    setAutoEqError('');
    try {
      const response = await fetch(headphone.url);
      if (!response.ok) throw new Error('Could not retrieve corrective EQ profile.');
      const text = await response.text();
      const { preamp, bands } = parseAutoEqProfileText(text);

      if (bands.length === 0) throw new Error('No parametric biquad bands detected in profile.');

      const currentBands = [...(dsp.eq_parametric_bands || [])];
      const strength = useStore.getState().autoEqStrength ?? 100;
      const factor = strength / 100;
      const scaledPreamp = Number((preamp * factor).toFixed(2));
      const newBands = [];
      for (let i = 0; i < 10; i++) {
        if (bands[i]) {
          newBands.push({
            freq: bands[i].freq,
            gain: Number((bands[i].gain * factor).toFixed(2)),
            q: bands[i].q,
            band_type: bands[i].band_type,
          });
        } else if (currentBands[i]) {
          newBands.push({ ...currentBands[i], gain: 0 });
        } else {
          newBands.push({ freq: 1000, gain: 0, q: 1.0, band_type: 'peaking' as const });
        }
      }

      await setDSP({
        enabled: true,
        eq_enabled: true,
        eq_parametric: true,
        eq_parametric_bands: newBands,
        preamp_gain: scaledPreamp,
      });

      setActiveAutoEq(headphone);
      localStorage.setItem('aideo_active_autoeq_model', headphone.url);
      window.dispatchEvent(
        new CustomEvent('ui-toast', {
          detail: {
            message: `Applied AutoEQ for ${headphone.name} (${headphone.fullSource})`,
            type: 'success',
          },
        })
      );
    } catch (err: any) {
      setAutoEqError(err.message || 'Failed to apply AutoEQ profile.');
    }
  };

  // Evaluate parametric response curve points
  const points = useMemo(() => {
    const pts: { f: number; db: number }[] = [];
    const minF = 20;
    const maxF = 20000;
    const numPoints = 120;
    const logMin = Math.log10(minF);
    const logMax = Math.log10(maxF);

    for (let i = 0; i <= numPoints; i++) {
      const logF = logMin + (i / numPoints) * (logMax - logMin);
      const f = Math.pow(10, logF);
      let totalDb = dsp.preamp_gain || 0;

      if (dsp.eq_enabled) {
        if (dsp.eq_parametric) {
          (dsp.eq_parametric_bands || []).forEach(band => {
            if (band.band_type === 'lowshelf') {
              totalDb += getLowshelfResponse(f, sampleRate, band.freq, band.gain, band.q);
            } else if (band.band_type === 'highshelf') {
              totalDb += getHighshelfResponse(f, sampleRate, band.freq, band.gain, band.q);
            } else {
              totalDb += getPeakingResponse(f, sampleRate, band.freq, band.gain, band.q);
            }
          });
        } else {
          (dsp.eq_graphic_gains || []).forEach((gain, idx) => {
            if (idx < GRAPHIC_EQ_FREQUENCIES.length) {
              totalDb += getPeakingResponse(f, sampleRate, GRAPHIC_EQ_FREQUENCIES[idx], gain, 1.4);
            }
          });
        }
      }
      pts.push({ f, db: totalDb });
    }
    return pts;
  }, [dsp.eq_enabled, dsp.eq_parametric, dsp.eq_parametric_bands, dsp.eq_graphic_gains, dsp.preamp_gain, sampleRate]);

  // Coordinate Helpers
  const getFreqFromX = (x: number, width: number) => {
    const minF = 20;
    const maxF = 20000;
    const logMin = Math.log10(minF);
    const logMax = Math.log10(maxF);
    const ratio = Math.max(0, Math.min(1, x / width));
    return Math.round(Math.pow(10, logMin + ratio * (logMax - logMin)));
  };

  const getGainFromY = (y: number, height: number) => {
    const ratio = Math.max(0, Math.min(1, y / height));
    const gain = 15 - ratio * 30; // +15dB to -15dB
    return snapToDetent(Math.round(gain * 10) / 10, 0.35, 0);
  };

  // Node Drag Handlers for Spline Graph
  const handleGraphMouseMove = (e: React.MouseEvent) => {
    if (activeDragNode === null || !graphRef.current) return;
    const rect = graphRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const newFreq = getFreqFromX(mouseX, rect.width);
    const newGain = getGainFromY(mouseY, rect.height);

    if (dsp.eq_parametric) {
      const updated = (dsp.eq_parametric_bands || []).map((band, idx) => {
        if (idx === activeDragNode) {
          return { ...band, freq: newFreq, gain: newGain };
        }
        return band;
      });
      setDSP({ eq_parametric_bands: updated, eq_enabled: true });
    } else {
      const updatedGains = [...(dsp.eq_graphic_gains || [])];
      updatedGains[activeDragNode] = newGain;
      setDSP({ eq_graphic_gains: updatedGains, eq_enabled: true });
    }
  };

  const handleGraphMouseUp = () => {
    setActiveDragNode(null);
  };

  const handleNodeWheel = (bandIdx: number, e: React.WheelEvent) => {
    e.preventDefault();
    if (!dsp.eq_parametric) return;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const updated = (dsp.eq_parametric_bands || []).map((b, idx) => {
      if (idx === bandIdx) {
        const nextQ = Math.max(0.2, Math.min(10.0, Math.round((b.q + delta) * 10) / 10));
        return { ...b, q: nextQ };
      }
      return b;
    });
    setDSP({ eq_parametric_bands: updated });
  };

  // Fader Gain Handlers
  const handleFaderGainChange = (bandIndex: number, newGain: number) => {
    const snapped = snapToDetent(newGain, 0.35, 0);
    const updated = [...eqGains];
    updated[bandIndex] = Math.round(snapped * 10) / 10;
    setDSP({ eq_graphic_gains: updated, eq_enabled: true });
  };

  const handleFaderReset = (bandIndex: number) => {
    const updated = [...eqGains];
    updated[bandIndex] = 0;
    setDSP({ eq_graphic_gains: updated });
  };

  const applyQuickPreset = (preset: (typeof EQ_QUICK_PRESETS)[0]) => {
    if (dsp.eq_parametric) {
      const updatedBands = (dsp.eq_parametric_bands || []).map((b, i) => ({
        ...b,
        gain: preset.gains[i] !== undefined ? preset.gains[i] : b.gain,
      }));
      setDSP({
        eq_enabled: true,
        eq_parametric_bands: updatedBands,
        preamp_gain: preset.preamp,
      });
    } else {
      setDSP({
        eq_enabled: true,
        eq_graphic_gains: [...preset.gains],
        preamp_gain: preset.preamp,
      });
    }
  };

  // Impulse Response (IR) Loader
  const handlePickIrFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Impulse Response (*.wav, *.flac)', extensions: ['wav', 'flac'] }],
      });
      if (selected && typeof selected === 'string') {
        setDSP({ convolution_ir_path: selected, convolution_enabled: true });
        window.dispatchEvent(
          new CustomEvent('ui-toast', {
            detail: { message: `Loaded IR file: ${selected.split(/[/\\]/).pop()}`, type: 'success' },
          })
        );
      }
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to open IR: ${err.message}`, type: 'error' } }));
    }
  };

  // Preset Handlers
  const handleSavePreset = () => {
    if (!newPresetName.trim()) return;
    const name = newPresetName.trim();
    const updated = [...customPresets.filter(p => p.name !== name), { name, dsp }];
    setCustomPresets(updated);
    localStorage.setItem('aideo_dsp_presets', JSON.stringify(updated));
    setNewPresetName('');
    setShowSaveModal(false);
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Saved preset "${name}"`, type: 'success' } }));
  };

  const handleDeletePreset = (name: string) => {
    const updated = customPresets.filter(p => p.name !== name);
    setCustomPresets(updated);
    localStorage.setItem('aideo_dsp_presets', JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Deleted preset "${name}"`, type: 'info' } }));
  };

  const handleLoadCustomPreset = (preset: (typeof customPresets)[0]) => {
    setDSP(preset.dsp);
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Loaded preset "${preset.name}"`, type: 'info' } }));
  };

  // ── Sonic Flow 2D Acoustic Map State ──────────────────────────────
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [trajectory, setTrajectory] = useState<{ bpm: number; energy: number }[]>([]);
  const [isDrawingFlow, setIsDrawingFlow] = useState(false);
  const [hoveredTrack, setHoveredTrack] = useState<{ track: Track; x: number; y: number } | null>(null);
  const [isGeneratingFlow, setIsGeneratingFlow] = useState(false);
  const flowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const [flowCanvasWidth, setFlowCanvasWidth] = useState(1000);

  useEffect(() => {
    if (tracks && tracks.length > 0) {
      setLocalTracks(tracks);
    } else {
      invoke<Track[]>('get_all_tracks')
        .then(t => {
          if (t && t.length > 0) setLocalTracks(t);
        })
        .catch(() => {});
    }
  }, [tracks]);

  useEffect(() => {
    if (!flowContainerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width > 50) {
          setFlowCanvasWidth(Math.floor(entry.contentRect.width));
        }
      }
    });
    observer.observe(flowContainerRef.current);
    return () => observer.disconnect();
  }, []);

  const plotPadding = useMemo(() => ({ top: 35, right: 35, bottom: 45, left: 60 }), []);
  const plotW = Math.max(100, flowCanvasWidth - plotPadding.left - plotPadding.right);
  const plotH = 420 - plotPadding.top - plotPadding.bottom;

  const bpmToX = useCallback((bpm: number) => {
    const clamped = Math.max(60, Math.min(180, bpm));
    return plotPadding.left + ((clamped - 60) / 120) * plotW;
  }, [plotPadding, plotW]);

  const xToBpm = useCallback((x: number) => {
    const clampedX = Math.max(plotPadding.left, Math.min(plotPadding.left + plotW, x));
    return 60 + ((clampedX - plotPadding.left) / plotW) * 120;
  }, [plotPadding, plotW]);

  const energyToY = useCallback((energy: number) => {
    const clamped = Math.max(0, Math.min(1, energy));
    return plotPadding.top + (1 - clamped) * plotH;
  }, [plotPadding, plotH]);

  const yToEnergy = useCallback((y: number) => {
    const clampedY = Math.max(plotPadding.top, Math.min(plotPadding.top + plotH, y));
    return 1 - ((clampedY - plotPadding.top) / plotH);
  }, [plotPadding, plotH]);

  const allPlottedTracks = useMemo(() => {
    return localTracks.length > 0 ? localTracks : (tracks || []);
  }, [localTracks, tracks]);

  useEffect(() => {
    if (activeTab !== 'sonic_flow') return;
    const canvas = flowCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = flowCanvasWidth * dpr;
    canvas.height = 420 * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#0b0c14';
    ctx.fillRect(0, 0, flowCanvasWidth, 420);

    // Plot area background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
    ctx.fillRect(plotPadding.left, plotPadding.top, plotW, plotH);

    // Grid lines for BPM
    const bpmGrid = [80, 100, 120, 140, 160];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '11px Inter, system-ui, sans-serif';

    bpmGrid.forEach(bpm => {
      const x = bpmToX(bpm);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(x, plotPadding.top);
      ctx.lineTo(x, plotPadding.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(`${bpm} BPM`, x, plotPadding.top + plotH + 8);
    });

    // Grid lines for Energy
    const energyGrid = [
      { val: 0.25, label: 'Low Energy' },
      { val: 0.50, label: 'Mid Energy' },
      { val: 0.75, label: 'High Energy' },
    ];
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    energyGrid.forEach(e => {
      const y = energyToY(e.val);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(plotPadding.left, y);
      ctx.lineTo(plotPadding.left + plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText(e.label, plotPadding.left - 8, y);
    });

    // Border around plot area
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plotPadding.left, plotPadding.top, plotW, plotH);

    // Axis Labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TEMPO (BPM) →', plotPadding.left + plotW / 2, 420 - 14);

    ctx.save();
    ctx.translate(14, plotPadding.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('ACOUSTIC ENERGY →', 0, 0);
    ctx.restore();

    // Plot library tracks as glowing dots
    const candidateTracks = allPlottedTracks.slice(0, 500);
    for (const t of candidateTracks) {
      const tBpm = t.bpm || 120.0;
      const tEnergy = t.energy !== null && t.energy !== undefined ? t.energy : 0.5;
      const x = bpmToX(tBpm);
      const y = energyToY(tEnergy);

      const r = Math.round(56 + tEnergy * (236 - 56));
      const g = Math.round(189 - tEnergy * (189 - 72));
      const b = Math.round(248 - tEnergy * (248 - 153));
      const dotColor = `rgb(${r}, ${g}, ${b})`;

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.shadowColor = dotColor;
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.restore();
    }

    // Plot user trajectory curve
    if (trajectory.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(34, 197, 94, 0.7)';
      ctx.shadowBlur = 10;

      trajectory.forEach((pt, idx) => {
        const x = bpmToX(pt.bpm);
        const y = energyToY(pt.energy);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      const startPt = trajectory[0];
      const endPt = trajectory[trajectory.length - 1];

      const sx = bpmToX(startPt.bpm);
      const sy = energyToY(startPt.energy);
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#22c55e';
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#22c55e';
      ctx.fill();

      const ex = bpmToX(endPt.bpm);
      const ey = energyToY(endPt.energy);
      ctx.beginPath();
      ctx.arc(ex, ey, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ec4899';
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#ec4899';
      ctx.fill();

      ctx.restore();
    }
  }, [activeTab, flowCanvasWidth, allPlottedTracks, trajectory, bpmToX, energyToY, plotPadding, plotW, plotH]);

  const handleFlowMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = flowCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (x < plotPadding.left || x > plotPadding.left + plotW || y < plotPadding.top || y > plotPadding.top + plotH) {
      return;
    }

    setIsDrawingFlow(true);
    const bpm = Math.round(xToBpm(x) * 10) / 10;
    const energy = Math.round(yToEnergy(y) * 100) / 100;
    setTrajectory([{ bpm, energy }]);
  };

  const handleFlowMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = flowCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (isDrawingFlow) {
      const bpm = Math.round(xToBpm(x) * 10) / 10;
      const energy = Math.round(yToEnergy(y) * 100) / 100;
      setTrajectory(prev => {
        const last = prev[prev.length - 1];
        if (last && Math.hypot(bpm - last.bpm, (energy - last.energy) * 60) < 1.0) {
          return prev;
        }
        return [...prev, { bpm, energy }];
      });
    } else {
      const candidateTracks = allPlottedTracks.slice(0, 500);
      let found: { track: Track; x: number; y: number } | null = null;
      let minDistance = 14;

      for (const t of candidateTracks) {
        const tx = bpmToX(t.bpm || 120);
        const ty = energyToY(t.energy !== null && t.energy !== undefined ? t.energy : 0.5);
        const d = Math.hypot(x - tx, y - ty);
        if (d < minDistance) {
          minDistance = d;
          found = { track: t, x: tx, y: ty };
        }
      }
      setHoveredTrack(found);
    }
  };

  const handleFlowMouseUp = () => {
    setIsDrawingFlow(false);
  };

  const handleGenerateFlowQueue = async (startPlayback = false) => {
    setIsGeneratingFlow(true);
    try {
      const flowPoints = trajectory.length > 0 ? trajectory : null;
      const seed = currentTrack?.path || null;
      const result = await invoke<Track[]>('generate_sonic_flow', {
        seedPath: seed,
        trajectory: flowPoints,
        limit: 20,
      });

      if (!result || result.length === 0) {
        window.dispatchEvent(
          new CustomEvent('ui-toast', {
            detail: { message: 'No candidate tracks found for Sonic Flow.', type: 'info' },
          })
        );
        return;
      }

      if (startPlayback) {
        await playTrack(result[0]);
        for (let i = 1; i < result.length; i++) {
          await addToQueue(result[i]);
        }
        window.dispatchEvent(
          new CustomEvent('ui-toast', {
            detail: {
              message: `Playing Sonic Flow with ${result.length} tracks`,
              type: 'success',
            },
          })
        );
      } else {
        for (const t of result) {
          await addToQueue(t);
        }
        window.dispatchEvent(
          new CustomEvent('ui-toast', {
            detail: {
              message: `Generated Sonic Flow queue with ${result.length} tracks`,
              type: 'success',
            },
          })
        );
      }
    } catch (err: any) {
      window.dispatchEvent(
        new CustomEvent('ui-toast', {
          detail: {
            message: `Sonic Flow error: ${err.message || String(err)}`,
            type: 'error',
          },
        })
      );
    } finally {
      setIsGeneratingFlow(false);
    }
  };

  return (
    <div
      className="aideo-lab-wrap"
      data-scroll-container="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '24px 32px',
        overflowY: 'auto',
        background: 'var(--bg-primary, #0c0d14)',
        color: 'var(--text)',
      }}
      onMouseMove={handleGraphMouseMove}
      onMouseUp={handleGraphMouseUp}
    >
      <div
        className="aideo-lab-workspace-container"
        style={{
          width: '100%',
          maxWidth: 1600,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          flex: 1,
        }}
      >
        {/* Master Studio Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 18,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.25), rgba(168, 85, 247, 0.2))',
              border: '1px solid rgba(var(--accent-rgb), 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
            }}
          >
            <Activity size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.3 }}>
                Audio Settings
              </h1>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: 1.2,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: 'var(--text-dim)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                DSP
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
              Headphone AutoEQ, 10-band equalizer, and spatial audio
            </div>
          </div>
        </div>

        {/* Header Actions: Instant A/B + Reset */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {activeAutoEqProfile && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 20,
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#34d399',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <Headphones size={13} />
              <span>AutoEQ: {activeAutoEqProfile.name} ({activeAutoEqProfile.fullSource})</span>
            </div>
          )}

          {/* Master Instant A/B Compare Toggle */}
          <button
            className="btn"
            onClick={toggleDspAB}
            title="Compare DSP on/off (Press 'B')"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 14px',
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
            <Zap size={14} color={dsp.enabled ? '#34d399' : '#38bdf8'} />
            <span>{dsp.enabled ? 'Mode B: DSP On' : 'Mode A: DSP Off'}</span>
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

          <button
            className="btn btn-secondary"
            onClick={resetProMode}
            title="Reset DSP settings"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
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
        </div>
      </div>

      {/* Main Tab Navigation Bar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 18,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        {[
          { id: 'studio_eq' as MainLabTab, label: 'EQ & AutoEQ', icon: Sliders, badge: '10 Bands' },
          { id: 'spatial_acoustics' as MainLabTab, label: 'Spatial Audio & Effects', icon: Waves, badge: 'IR & Crossfeed' },
          { id: 'sonic_flow' as MainLabTab, label: 'Sonic Flow & Automix', icon: Compass, badge: '2D Map' },
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
                gap: 10,
                padding: '12px 20px',
                background: 'none',
                border: 'none',
                borderBottom: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                color: isSelected ? 'var(--text)' : 'var(--text-dim)',
                fontWeight: isSelected ? 700 : 500,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                marginBottom: -1,
              }}
            >
              <Icon size={16} color={isSelected ? 'var(--accent)' : 'currentColor'} />
              <span>{tab.label}</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 10,
                  background: isSelected ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  color: isSelected ? 'var(--accent)' : 'var(--text-dim)',
                }}
              >
                {tab.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* UNIFIED WORKSPACE: Studio EQ & AutoEQ Calibration */}
      {activeTab === 'studio_eq' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, flex: 1 }}>
          {/* Top Equalizer Toolbar */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '12px 18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            {/* EQ Power & View Switcher (Graph vs Faders) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {/* Power Toggle */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={() => setDSP({ eq_enabled: !dsp.eq_enabled })}
              >
                <button
                  style={{
                    width: 32,
                    height: 20,
                    borderRadius: 10,
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
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#fff',
                      transform: dsp.eq_enabled ? 'translateX(12px)' : 'translateX(0)',
                      transition: 'transform 0.2s',
                    }}
                  />
                </button>
                <span style={{ fontSize: 13, fontWeight: 700, color: dsp.eq_enabled ? 'var(--text)' : 'var(--text-dim)' }}>
                  Equalizer
                </span>
              </div>

              {/* View Switcher: Interactive Spline Graph vs Tactile Channel Faders */}
              <div style={{ display: 'flex', gap: 3, background: 'rgba(0, 0, 0, 0.35)', padding: 3, borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <button
                  onClick={() => setEqViewMode('graph')}
                  style={{
                    fontSize: 11,
                    fontWeight: eqViewMode === 'graph' ? 700 : 500,
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: eqViewMode === 'graph' ? 'var(--accent)' : 'transparent',
                    color: eqViewMode === 'graph' ? '#fff' : 'var(--text-dim)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.15s',
                  }}
                >
                  <Activity size={13} />
                  <span>Graph</span>
                </button>
                <button
                  onClick={() => setEqViewMode('faders')}
                  style={{
                    fontSize: 11,
                    fontWeight: eqViewMode === 'faders' ? 700 : 500,
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: eqViewMode === 'faders' ? 'var(--accent)' : 'transparent',
                    color: eqViewMode === 'faders' ? '#fff' : 'var(--text-dim)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.15s',
                  }}
                >
                  <SlidersHorizontal size={13} />
                  <span>Faders</span>
                </button>
              </div>

              {/* Parametric vs Graphic mode (when in Graph view) */}
              {eqViewMode === 'graph' && (
                <div style={{ display: 'flex', gap: 3, background: 'rgba(0, 0, 0, 0.25)', padding: 3, borderRadius: 6 }}>
                  <button
                    onClick={() => setDSP({ eq_parametric: true })}
                    style={{
                      fontSize: 10,
                      fontWeight: dsp.eq_parametric ? 700 : 500,
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: 'none',
                      background: dsp.eq_parametric ? 'rgba(var(--accent-rgb), 0.3)' : 'transparent',
                      color: dsp.eq_parametric ? 'var(--accent)' : 'var(--text-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    10-Band Parametric
                  </button>
                  <button
                    onClick={() => setDSP({ eq_parametric: false })}
                    style={{
                      fontSize: 10,
                      fontWeight: !dsp.eq_parametric ? 700 : 500,
                      padding: '3px 8px',
                      borderRadius: 4,
                      border: 'none',
                      background: !dsp.eq_parametric ? 'rgba(var(--accent-rgb), 0.3)' : 'transparent',
                      color: !dsp.eq_parametric ? 'var(--accent)' : 'var(--text-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    10-Band Graphic
                  </button>
                </div>
              )}

              {/* Resampler Phase Mode */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Phase:</span>
                {(['minimum', 'linear', 'intermediate'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setDSP({ resampler_phase_mode: mode })}
                    style={{
                      fontSize: 10,
                      fontWeight: dsp.resampler_phase_mode === mode ? 700 : 500,
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: dsp.resampler_phase_mode === mode
                        ? '1px solid rgba(var(--accent-rgb), 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                      background: dsp.resampler_phase_mode === mode
                        ? 'rgba(var(--accent-rgb), 0.15)'
                        : 'rgba(255, 255, 255, 0.02)',
                      color: dsp.resampler_phase_mode === mode ? 'var(--accent)' : 'var(--text-dim)',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Presets & Preset Manager */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {EQ_QUICK_PRESETS.map(preset => (
                  <button
                    key={preset.name}
                    onClick={() => applyQuickPreset(preset)}
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '4px 8px',
                      borderRadius: 5,
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      background: 'rgba(255, 255, 255, 0.03)',
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>

              {customPresets.length > 0 && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {customPresets.map(p => (
                    <div
                      key={p.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 6px',
                        borderRadius: 4,
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        background: 'rgba(255, 255, 255, 0.04)',
                      }}
                    >
                      <button
                        onClick={() => handleLoadCustomPreset(p)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text)',
                          fontSize: 10,
                          cursor: 'pointer',
                        }}
                      >
                        {p.name}
                      </button>
                      <button
                        onClick={() => handleDeletePreset(p.name)}
                        title={`Delete preset "${p.name}"`}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-dim)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: 1,
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowSaveModal(true)}
                style={{
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  borderRadius: 5,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                <Save size={11} />
                <span>Save</span>
              </button>

              <button
                onClick={() => {
                  const defaultBands = (dsp.eq_parametric_bands || []).map(b => ({ ...b, gain: 0 }));
                  setDSP({
                    eq_graphic_gains: new Array(10).fill(0),
                    eq_parametric_bands: defaultBands,
                    preamp_gain: 0,
                  });
                }}
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

          {/* VIEW MODE 1: Interactive Spline Graph */}
          {eqViewMode === 'graph' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Equalizer Spline Graph & Real-Time Waterfall Canvas */}
              <div
                ref={graphContainerRef}
                style={{
                  background: '#090a10',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  position: 'relative',
                  overflow: 'hidden',
                  height: svgHeight,
                }}
              >
                {/* Real-time spectrum waterfall overlay canvas */}
                <canvas
                  ref={canvasRef}
                  width={svgWidth}
                  height={svgHeight}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0.7,
                    pointerEvents: 'none',
                  }}
                />

                {/* SVG Biquad Response Spline Graph */}
                <svg
                  ref={graphRef}
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  preserveAspectRatio="xMidYMid meet"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    cursor: activeDragNode !== null ? 'grabbing' : 'default',
                  }}
                >
                  <defs>
                    <linearGradient id="lab-curve-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={dsp.eq_enabled ? 0.25 : 0.04} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="lab-curve-stroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="50%" stopColor="var(--accent)" />
                      <stop offset="100%" stopColor="#34d399" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal dB Grid Lines */}
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
                          stroke={isZero ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.05)'}
                          strokeWidth={isZero ? 1.2 : 0.8}
                          strokeDasharray={isZero ? undefined : '4 4'}
                        />
                        <text
                          x={8}
                          y={y - 3}
                          fill={isZero ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.25)'}
                          fontSize={9}
                          fontFamily="monospace"
                        >
                          {db > 0 ? `+${db} dB` : `${db} dB`}
                        </text>
                      </g>
                    );
                  })}

                  {/* Vertical Frequency Grid Lines */}
                  {GRAPHIC_EQ_FREQUENCIES.map(freq => {
                    const x = freqToX(freq, svgWidth);
                    return (
                      <g key={freq}>
                        <line x1={x} y1={0} x2={x} y2={svgHeight} stroke="rgba(255, 255, 255, 0.06)" strokeWidth={0.8} />
                        <text x={x} y={svgHeight - 6} textAnchor="middle" fill="rgba(255, 255, 255, 0.3)" fontSize={9} fontFamily="monospace">
                          {formatFrequency(freq)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Area Fill */}
                  {(() => {
                    if (points.length === 0) return null;
                    const pathStr = points.reduce((acc, pt, idx) => {
                      const x = freqToX(pt.f, svgWidth);
                      const y = dbToY(pt.db, svgHeight, -15, 15);
                      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
                    }, '');
                    const zeroY = dbToY(0, svgHeight, -15, 15);
                    const fullArea = `${pathStr} L ${svgWidth} ${zeroY} L 0 ${zeroY} Z`;
                    return <path d={fullArea} fill="url(#lab-curve-fill)" />;
                  })()}

                  {/* Curve Stroke */}
                  {(() => {
                    if (points.length === 0) return null;
                    const pathStr = points.reduce((acc, pt, idx) => {
                      const x = freqToX(pt.f, svgWidth);
                      const y = dbToY(pt.db, svgHeight, -15, 15);
                      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
                    }, '');
                    return (
                      <path
                        d={pathStr}
                        fill="none"
                        stroke={dsp.eq_enabled ? 'url(#lab-curve-stroke)' : 'rgba(255, 255, 255, 0.3)'}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })()}

                  {/* Draggable Node Markers */}
                  {dsp.eq_parametric
                    ? (dsp.eq_parametric_bands || []).map((band, idx) => {
                        const x = freqToX(band.freq, svgWidth);
                        const y = dbToY(band.gain + (dsp.preamp_gain || 0), svgHeight, -15, 15);
                        const isSelected = selectedBand === idx;
                        const isHovered = hoveredNode === idx;

                        return (
                          <g
                            key={idx}
                            onMouseDown={e => {
                              e.stopPropagation();
                              setSelectedBand(idx);
                              setActiveDragNode(idx);
                            }}
                            onMouseEnter={() => setHoveredNode(idx)}
                            onMouseLeave={() => setHoveredNode(null)}
                            onWheel={e => handleNodeWheel(idx, e)}
                            style={{ cursor: 'grab' }}
                          >
                            <circle
                              cx={x}
                              cy={y}
                              r={isSelected ? 14 : isHovered ? 11 : 8}
                              fill={isSelected ? 'rgba(var(--accent-rgb), 0.25)' : 'rgba(255, 255, 255, 0.06)'}
                              stroke={isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.4)'}
                              strokeWidth={1.5}
                            />
                            <circle cx={x} cy={y} r={4} fill={isSelected ? 'var(--accent)' : '#fff'} />
                            <text
                              x={x}
                              y={y - 12}
                              textAnchor="middle"
                              fill={isSelected ? 'var(--accent)' : '#fff'}
                              fontSize={9}
                              fontWeight="bold"
                              fontFamily="monospace"
                            >
                              {idx + 1}
                            </text>
                          </g>
                        );
                      })
                    : (dsp.eq_graphic_gains || []).map((gain, idx) => {
                        if (idx >= GRAPHIC_EQ_FREQUENCIES.length) return null;
                        const freq = GRAPHIC_EQ_FREQUENCIES[idx];
                        const x = freqToX(freq, svgWidth);
                        const y = dbToY(gain + (dsp.preamp_gain || 0), svgHeight, -15, 15);
                        const isHovered = hoveredNode === idx;

                        return (
                          <g
                            key={freq}
                            onMouseDown={e => {
                              e.stopPropagation();
                              setSelectedBand(idx);
                              setActiveDragNode(idx);
                            }}
                            onMouseEnter={() => setHoveredNode(idx)}
                            onMouseLeave={() => setHoveredNode(null)}
                            style={{ cursor: 'grab' }}
                          >
                            <circle
                              cx={x}
                              cy={y}
                              r={isHovered ? 10 : 7}
                              fill={gain !== 0 ? 'var(--accent)' : '#fff'}
                              stroke="rgba(0, 0, 0, 0.8)"
                              strokeWidth={1.5}
                            />
                          </g>
                        );
                      })}
                </svg>
              </div>

              {/* Floating Band Inspector Strip */}
              {dsp.eq_parametric && dsp.eq_parametric_bands && dsp.eq_parametric_bands[selectedBand] && (
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '14px 18px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* Band Quick Switcher */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                        Band:
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {dsp.eq_parametric_bands.map((_, idx) => {
                          const isCur = selectedBand === idx;
                          return (
                            <button
                              key={idx}
                              onClick={() => setSelectedBand(idx)}
                              style={{
                                width: 26,
                                height: 22,
                                borderRadius: 4,
                                border: isCur
                                  ? '1px solid var(--accent)'
                                  : '1px solid rgba(255, 255, 255, 0.08)',
                                background: isCur ? 'rgba(var(--accent-rgb), 0.2)' : 'rgba(255, 255, 255, 0.03)',
                                color: isCur ? 'var(--accent)' : 'var(--text-dim)',
                                fontSize: 10,
                                fontWeight: isCur ? 800 : 500,
                                cursor: 'pointer',
                              }}
                            >
                              {idx + 1}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      Tip: Scroll mousewheel over any node on the graph to adjust Q factor
                    </div>
                  </div>

                  {/* Band Parameters Inspector Strip */}
                  {(() => {
                    const band = dsp.eq_parametric_bands[selectedBand];
                    const updateBand = (partial: Partial<typeof band>) => {
                      const updated = dsp.eq_parametric_bands.map((b, idx) => {
                        if (idx === selectedBand) return { ...b, ...partial };
                        return b;
                      });
                      setDSP({ eq_parametric_bands: updated });
                    };

                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr', gap: 14, alignItems: 'center' }}>
                        {/* Filter Type */}
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>
                            Topology
                          </div>
                          <select
                            value={band.band_type || 'peaking'}
                            onChange={e => updateBand({ band_type: e.target.value as any })}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              borderRadius: 6,
                              background: 'rgba(0, 0, 0, 0.4)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              color: 'var(--text)',
                              fontSize: 11,
                            }}
                          >
                            <option value="peaking">Peaking (Bell)</option>
                            <option value="lowshelf">Low Shelf</option>
                            <option value="highshelf">High Shelf</option>
                            <option value="highpass">High Pass (12dB/oct)</option>
                            <option value="lowpass">Low Pass (12dB/oct)</option>
                            <option value="notch">Notch</option>
                          </select>
                        </div>

                        {/* Frequency (Hz) */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>
                            <span>Frequency</span>
                            <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{band.freq} Hz</span>
                          </div>
                          <input
                            type="range"
                            min={20}
                            max={20000}
                            step={1}
                            value={band.freq}
                            onChange={e => updateBand({ freq: parseFloat(e.target.value) })}
                            style={{ width: '100%', accentColor: 'var(--accent)' }}
                          />
                        </div>

                        {/* Gain (dB) */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>
                            <span>Gain</span>
                            <span
                              onDoubleClick={() => updateBand({ gain: 0 })}
                              style={{ fontFamily: 'monospace', color: band.gain !== 0 ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer' }}
                            >
                              {band.gain > 0 ? `+${band.gain.toFixed(1)}` : band.gain.toFixed(1)} dB
                            </span>
                          </div>
                          <input
                            type="range"
                            min={-15}
                            max={15}
                            step={0.1}
                            value={band.gain}
                            onChange={e => updateBand({ gain: snapToDetent(parseFloat(e.target.value), 0.35, 0) })}
                            onDoubleClick={() => updateBand({ gain: 0 })}
                            style={{ width: '100%', accentColor: 'var(--accent)' }}
                          />
                        </div>

                        {/* Q Factor */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>
                            <span>Q (Bandwidth)</span>
                            <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{band.q.toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min={0.2}
                            max={10.0}
                            step={0.05}
                            value={band.q}
                            onChange={e => updateBand({ q: parseFloat(e.target.value) })}
                            style={{ width: '100%', accentColor: 'var(--accent)' }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* VIEW MODE 2: Tactile Vertical Channel Faders */}
          {eqViewMode === 'faders' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Dynamic Transfer Curve Mini Visualizer */}
              <div
                style={{
                  background: '#090a10',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  height: svgHeight,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                  <defs>
                    <linearGradient id="fader-curve-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={dsp.eq_enabled ? 0.25 : 0.04} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="fader-curve-stroke" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#38bdf8" />
                      <stop offset="50%" stopColor="var(--accent)" />
                      <stop offset="100%" stopColor="#34d399" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal 0dB Grid Line */}
                  <line
                    x1={0}
                    y1={dbToY(0, svgHeight, -15, 15)}
                    x2={svgWidth}
                    y2={dbToY(0, svgHeight, -15, 15)}
                    stroke="rgba(255, 255, 255, 0.2)"
                    strokeWidth={1}
                  />

                  {/* Frequency Vertical Lines */}
                  {GRAPHIC_EQ_FREQUENCIES.map(freq => {
                    const x = freqToX(freq, svgWidth);
                    return <line key={freq} x1={x} y1={0} x2={x} y2={svgHeight} stroke="rgba(255, 255, 255, 0.06)" strokeWidth={0.8} />;
                  })}

                  {/* Area Fill */}
                  {(() => {
                    if (points.length === 0) return null;
                    const pathStr = points.reduce((acc, pt, idx) => {
                      const x = freqToX(pt.f, svgWidth);
                      const y = dbToY(pt.db, svgHeight, -15, 15);
                      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
                    }, '');
                    const zeroY = dbToY(0, svgHeight, -15, 15);
                    const fullArea = `${pathStr} L ${svgWidth} ${zeroY} L 0 ${zeroY} Z`;
                    return <path d={fullArea} fill="url(#fader-curve-fill)" />;
                  })()}

                  {/* Curve Stroke */}
                  {(() => {
                    if (points.length === 0) return null;
                    const pathStr = points.reduce((acc, pt, idx) => {
                      const x = freqToX(pt.f, svgWidth);
                      const y = dbToY(pt.db, svgHeight, -15, 15);
                      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
                    }, '');
                    return (
                      <path
                        d={pathStr}
                        fill="none"
                        stroke={dsp.eq_enabled ? 'url(#fader-curve-stroke)' : 'rgba(255, 255, 255, 0.3)'}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })()}
                </svg>
              </div>

              {/* 10-Band Vertical Tactile Channel Strips */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                    EQ faders
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    Double-click any fader to snap to 0 dB
                  </span>
                </div>

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
                    const isHovered = hoveredNode === idx;
                    const isNonZero = gain !== 0;

                    return (
                      <div
                        key={freq}
                        onMouseEnter={() => setHoveredNode(idx)}
                        onMouseLeave={() => setHoveredNode(null)}
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
                        {/* dB Gain Readout */}
                        <div
                          onDoubleClick={() => handleFaderReset(idx)}
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

                        {/* Vertical Range Slider */}
                        <div
                          style={{
                            height: 110,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                          }}
                          onDoubleClick={() => handleFaderReset(idx)}
                        >
                          {/* 0dB Notch Guide */}
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
                            onChange={e => handleFaderGainChange(idx, parseFloat(e.target.value))}
                            style={{
                              writingMode: 'vertical-lr',
                              WebkitAppearance: 'slider-vertical',
                              width: 24,
                              height: 100,
                              accentColor: 'var(--accent)',
                              cursor: 'pointer',
                              opacity: dsp.eq_enabled ? 1 : 0.45,
                            }}
                          />
                        </div>

                        {/* Frequency Label */}
                        <div
                          style={{
                            fontSize: 10,
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            color: isHovered ? 'var(--accent)' : 'var(--text-dim)',
                            transition: 'color 0.15s ease',
                          }}
                        >
                          {formatFrequency(freq)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ULTRA-COMPACT AUTOEQ HEADPHONE CALIBRATION DOCK (Integrated at Bottom) */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: autoEqCollapsed ? '12px 18px' : '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: autoEqCollapsed ? 0 : 14,
              transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Dock Header & Toggle */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={toggleAutoEqCollapsed}
              title={autoEqCollapsed ? 'Click to expand AutoEQ' : 'Click to collapse AutoEQ'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Headphones size={16} color="var(--accent)" />
                <span style={{ fontSize: 13, fontWeight: 700 }}>AutoEQ headphone profiles</span>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  ({isFetchingDb ? 'Loading index...' : `${filteredHeadphones.length} profiles shown`})
                </span>
                {activeAutoEqProfile && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: '#34d399',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Check size={10} /> Active: {activeAutoEqProfile.name} ({activeAutoEqProfile.fullSource})
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Compact Search Input (when expanded) */}
                {!autoEqCollapsed && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 12px',
                      borderRadius: 6,
                      background: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      minWidth: 260,
                      maxWidth: 380,
                      flex: 1,
                    }}
                  >
                    <Search size={14} color="var(--text-dim)" />
                    <input
                      type="text"
                      placeholder="Search model (HD 600, WH-1000XM4, DT 990)..."
                      value={dbSearchQuery}
                      onChange={e => setDbSearchQuery(e.target.value)}
                      style={{
                        background: 'none',
                        border: 'none',
                        outline: 'none',
                        color: 'var(--text)',
                        fontSize: 12,
                        width: '100%',
                      }}
                    />
                    {dbSearchQuery && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setDbSearchQuery('');
                        }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0 }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )}

                {/* Collapse / Expand Button */}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    toggleAutoEqCollapsed();
                  }}
                  className="autoeq-collapse-btn"
                  title={autoEqCollapsed ? 'Expand AutoEQ profiles' : 'Collapse AutoEQ profiles'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 10px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: 'var(--text-dim)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{autoEqCollapsed ? 'Expand' : 'Collapse'}</span>
                  {autoEqCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                </button>
              </div>
            </div>

            {!autoEqCollapsed && (
              <>
                {/* Brand Filter Chips Strip */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {BRAND_FILTERS.map(brand => {
                const isSelected = selectedBrand === brand;
                return (
                  <button
                    key={brand}
                    onClick={() => setSelectedBrand(brand)}
                    style={{
                      fontSize: 10,
                      fontWeight: isSelected ? 700 : 500,
                      padding: '4px 9px',
                      borderRadius: 5,
                      border: isSelected
                        ? '1px solid rgba(var(--accent-rgb), 0.5)'
                        : '1px solid rgba(255, 255, 255, 0.06)',
                      background: isSelected ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      color: isSelected ? 'var(--accent)' : 'var(--text-dim)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {brand}
                  </button>
                );
              })}
            </div>

            {/* Error Banner */}
            {autoEqError && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: 11,
                }}
              >
                {autoEqError}
              </div>
            )}

            {/* High-Density 3-Column Calibration Shelf */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 10,
                maxHeight: 260,
                overflowY: 'auto',
                paddingRight: 4,
              }}
            >
              {filteredHeadphones.map(hp => {
                const srcStyle = getSourceStyle(hp.source);
                const isActive = activeAutoEqUrl === hp.url;

                return (
                  <div
                    key={hp.url}
                    style={{
                      background: isActive ? 'rgba(var(--accent-rgb), 0.08)' : 'rgba(255, 255, 255, 0.02)',
                      border: isActive
                        ? '1px solid rgba(var(--accent-rgb), 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {hp.name}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        <span
                          style={{
                            fontSize: 8,
                            fontWeight: 800,
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: srcStyle.bg,
                            border: `1px solid ${srcStyle.border}`,
                            color: srcStyle.color,
                          }}
                        >
                          {hp.fullSource}
                        </span>
                      </div>
                    </div>

                    <button
                      aria-label={`Apply ${hp.name} (${hp.fullSource})`}
                      aria-pressed={isActive}
                      onClick={() => handleApplyHeadphoneProfile(hp)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '5px 9px',
                        borderRadius: 5,
                        border: 'none',
                        background: isActive ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
                        color: isActive ? '#fff' : 'var(--text)',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background 0.15s',
                      }}
                    >
                      {isActive ? <Check size={12} /> : <Zap size={12} />}
                      <span>{isActive ? 'Applied' : 'Apply'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )}

      {/* TAB 2: Spatial Acoustics & DSP Rack */}
      {activeTab === 'spatial_acoustics' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 20,
            flex: 1,
          }}
        >
          {/* Module 1: IR Convolution Engine */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 14,
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileAudio size={16} color="var(--accent)" /> Impulse Response Convolution
                </span>
                <button
                  onClick={() => setDSP({ convolution_enabled: !dsp.convolution_enabled })}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: 10,
                    border: 'none',
                    background: dsp.convolution_enabled ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)',
                    color: dsp.convolution_enabled ? '#fff' : 'var(--text-dim)',
                    cursor: 'pointer',
                  }}
                >
                  {dsp.convolution_enabled ? 'ACTIVE' : 'BYPASS'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                Load an impulse response for room, cabinet, or HRTF filtering.
              </div>
            </div>

            {/* IR File Path & Picker */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 8,
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700 }}>Loaded IR File</div>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                  {dsp.convolution_ir_path ? dsp.convolution_ir_path.split(/[/\\]/).pop() : 'No Impulse File Selected'}
                </div>
              </div>
              <button
                onClick={handlePickIrFile}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <FolderOpen size={13} />
                <span>Browse...</span>
              </button>
            </div>

            {/* Wet / Dry Blend */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                <span>Wet / Dry Blend</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{Math.round((dsp.convolution_wet || 0.5) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={dsp.convolution_wet || 0.5}
                onChange={e => setDSP({ convolution_wet: parseFloat(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
            </div>
          </div>

          {/* Module 2: Binaural Crossfeed & Haas Expander */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 14,
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Headphones size={16} color="var(--accent)" /> Crossfeed & Stereo Width
                </span>
                <button
                  onClick={() => setDSP({ crossfeed_enabled: !dsp.crossfeed_enabled })}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: 10,
                    border: 'none',
                    background: dsp.crossfeed_enabled ? 'var(--accent)' : 'rgba(255, 255, 255, 0.1)',
                    color: dsp.crossfeed_enabled ? '#fff' : 'var(--text-dim)',
                    cursor: 'pointer',
                  }}
                >
                  {dsp.crossfeed_enabled ? 'CROSSFEED ON' : 'OFF'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                Adjust headphone crossfeed, stereo width, and Haas delay.
              </div>
            </div>

            {/* Crossfeed Level & Haas Delay */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
                  <span>Linkwitz Crossfeed Level</span>
                  <span style={{ fontFamily: 'monospace' }}>{(dsp.crossfeed_level || -6).toFixed(1)} dB</span>
                </div>
                <input
                  type="range"
                  min={-12}
                  max={-3}
                  step={0.5}
                  value={dsp.crossfeed_level || -6}
                  disabled={!dsp.crossfeed_enabled}
                  onChange={e => setDSP({ crossfeed_level: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--accent)', opacity: dsp.crossfeed_enabled ? 1 : 0.4 }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
                  <span>Haas Precedence Delay</span>
                  <span style={{ fontFamily: 'monospace' }}>{(dsp.spatial_haas_delay || 15).toFixed(1)} ms</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={25}
                  step={0.5}
                  value={dsp.spatial_haas_delay || 15}
                  onChange={e => setDSP({ spatial_haas_delay: parseFloat(e.target.value), spatial_enabled: true })}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>
            </div>

            {/* Soundstage Width Slider */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                <span>Stereo Width</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{Math.round(dsp.width * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={2.5}
                step={0.02}
                value={dsp.width}
                onChange={e => setDSP({ width: Math.round(snapToDetent(parseFloat(e.target.value), 0.06, 1.0) * 100) / 100 })}
                onDoubleClick={() => setDSP({ width: 1.0 })}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
            </div>
          </div>

          {/* Module 3: Analog Triode Tube Saturation */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 14,
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={16} color="#f59e0b" /> Saturation
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
                  {dsp.saturation_enabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                Adds harmonic distortion and soft clipping.
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                <span>Harmonic Drive</span>
                <span style={{ fontFamily: 'monospace', color: '#f59e0b' }}>
                  {Math.round((dsp.saturation_drive || 0.2) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={dsp.saturation_drive || 0.2}
                disabled={!dsp.saturation_enabled}
                onChange={e => setDSP({ saturation_drive: parseFloat(e.target.value) })}
                style={{
                  width: '100%',
                  accentColor: '#f59e0b',
                  opacity: dsp.saturation_enabled ? 1 : 0.4,
                }}
              />
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-dim)', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: 6 }}>
              Drive controls the amount of saturation.
            </div>
          </div>

          {/* Module 4: Safety Gain Staging & Dynamic Limiter */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 12,
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 14,
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={16} color="#34d399" /> Gain & Limiter
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                Adjust preamp gain, limiter ceiling, automatic headroom, and the 18 Hz subsonic filter.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {/* Preamp Trim */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
                  <span>Preamp Trim</span>
                  <span style={{ fontFamily: 'monospace' }}>{(dsp.preamp_gain || 0) > 0 ? `+${dsp.preamp_gain}` : dsp.preamp_gain || 0} dB</span>
                </div>
                <input
                  type="range"
                  min={-12}
                  max={6}
                  step={0.5}
                  value={dsp.preamp_gain || 0}
                  onChange={e => setDSP({ preamp_gain: snapToDetent(parseFloat(e.target.value), 0.6, 0) })}
                  onDoubleClick={() => setDSP({ preamp_gain: 0 })}
                  style={{ width: '100%', accentColor: '#34d399' }}
                />
              </div>

              {/* Limiter Threshold */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
                  <span>Limiter Ceiling</span>
                  <span style={{ fontFamily: 'monospace' }}>{(dsp.limiter_threshold || 0).toFixed(1)} dB</span>
                </div>
                <input
                  type="range"
                  min={-6}
                  max={0}
                  step={0.5}
                  value={dsp.limiter_threshold || 0}
                  onChange={e => setDSP({ limiter_threshold: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: '#34d399' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setDSP({ auto_headroom: !dsp.auto_headroom })}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: 6,
                  border: dsp.auto_headroom
                    ? '1px solid rgba(52, 211, 153, 0.4)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  background: dsp.auto_headroom ? 'rgba(52, 211, 153, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  color: dsp.auto_headroom ? '#34d399' : 'var(--text-dim)',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Auto-Headroom {dsp.auto_headroom ? 'ON' : 'OFF'}
              </button>

              <button
                onClick={() => setDSP({ subsonic_enabled: !dsp.subsonic_enabled })}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: 6,
                  border: dsp.subsonic_enabled
                    ? '1px solid rgba(52, 211, 153, 0.4)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  background: dsp.subsonic_enabled ? 'rgba(52, 211, 153, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  color: dsp.subsonic_enabled ? '#34d399' : 'var(--text-dim)',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                18Hz Subsonic {dsp.subsonic_enabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sonic_flow' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Header Panel */}
          <div
            style={{
              padding: '16px 20px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(20, 22, 35, 0.7), rgba(12, 13, 20, 0.9))',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <Compass size={20} color="var(--accent)" />
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>2D Acoustic Map &amp; Automix Flow</h2>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'rgba(var(--accent-rgb), 0.15)',
                    color: 'var(--accent)',
                    border: '1px solid rgba(var(--accent-rgb), 0.3)',
                  }}
                >
                  BPM × Energy Space
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', maxWidth: 680 }}>
                Click &amp; drag across the acoustic map to sketch a trajectory from start to finish. Sonic Flow samples your curve to synthesize a smooth DJ transition queue.
              </p>
            </div>

            {/* Actions Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="btn btn-secondary"
                onClick={() => setTrajectory([])}
                disabled={trajectory.length === 0}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  fontSize: 12,
                  borderRadius: 8,
                  opacity: trajectory.length === 0 ? 0.5 : 1,
                  cursor: trajectory.length === 0 ? 'not-allowed' : 'pointer',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: 'var(--text)',
                }}
              >
                <Trash2 size={14} />
                <span>Clear Curve</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={() => handleGenerateFlowQueue(false)}
                disabled={isGeneratingFlow}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: 'var(--text)',
                  cursor: isGeneratingFlow ? 'wait' : 'pointer',
                }}
              >
                <ListPlus size={14} />
                <span>{isGeneratingFlow ? 'Generating...' : 'Generate Flow Queue'}</span>
              </button>

              <button
                className="btn"
                onClick={() => handleGenerateFlowQueue(true)}
                disabled={isGeneratingFlow}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 18px',
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 8,
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  cursor: isGeneratingFlow ? 'wait' : 'pointer',
                  boxShadow: '0 4px 14px rgba(var(--accent-rgb), 0.35)',
                }}
              >
                <Play size={14} fill="currentColor" />
                <span>Play Sonic Flow</span>
              </button>
            </div>
          </div>

          {/* 2D Canvas Acoustic Map Container */}
          <div
            ref={flowContainerRef}
            style={{
              position: 'relative',
              width: '100%',
              height: 420,
              borderRadius: 14,
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: '#090a10',
              boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.6), 0 8px 30px rgba(0, 0, 0, 0.4)',
              userSelect: 'none',
            }}
          >
            <canvas
              ref={flowCanvasRef}
              onMouseDown={handleFlowMouseDown}
              onMouseMove={handleFlowMouseMove}
              onMouseUp={handleFlowMouseUp}
              onMouseLeave={() => {
                setIsDrawingFlow(false);
                setHoveredTrack(null);
              }}
              style={{
                width: '100%',
                height: 420,
                display: 'block',
                cursor: isDrawingFlow ? 'crosshair' : 'default',
              }}
            />

            {/* Empty state hint overlay */}
            {trajectory.length === 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  color: 'rgba(255, 255, 255, 0.35)',
                  textAlign: 'center',
                }}
              >
                <Compass size={32} strokeWidth={1.5} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  Click &amp; drag anywhere to sketch a flow trajectory
                </span>
                <span style={{ fontSize: 11, opacity: 0.7 }}>
                  From slow &amp; chill (60 BPM) to peak energy (180 BPM)
                </span>
              </div>
            )}

            {/* Hover Tooltip Overlay */}
            {hoveredTrack && (
              <div
                style={{
                  position: 'absolute',
                  left: Math.min(Math.max(10, hoveredTrack.x - 90), flowCanvasWidth - 210),
                  top: Math.max(10, hoveredTrack.y - 75),
                  pointerEvents: 'none',
                  background: 'rgba(15, 17, 28, 0.94)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255, 255, 255, 0.18)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                  minWidth: 170,
                  maxWidth: 240,
                  zIndex: 30,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {hoveredTrack.track.title || hoveredTrack.track.path.split(/[/\\]/).pop()}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {hoveredTrack.track.artist || 'Unknown Artist'}
                </div>
                <div style={{ display: 'flex', gap: 10, fontSize: 11, borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 4 }}>
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                    {(hoveredTrack.track.bpm || 120).toFixed(1)} BPM
                  </span>
                  <span style={{ color: '#ec4899', fontWeight: 600 }}>
                    Energy: {((hoveredTrack.track.energy !== null && hoveredTrack.track.energy !== undefined ? hoveredTrack.track.energy : 0.5) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            )}

            {/* Corner Legend & Stats */}
            <div
              style={{
                position: 'absolute',
                top: 12,
                right: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(0, 0, 0, 0.55)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: 11,
                color: 'var(--text-dim)',
                pointerEvents: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8' }} />
                <span>Low</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a855f7' }} />
                <span>Mid</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ec4899' }} />
                <span>High</span>
              </div>
              <span style={{ width: 1, height: 12, background: 'rgba(255, 255, 255, 0.15)' }} />
              <span>{allPlottedTracks.length} Library Tracks</span>
              {trajectory.length > 0 && (
                <>
                  <span style={{ width: 1, height: 12, background: 'rgba(255, 255, 255, 0.15)' }} />
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>
                    Path: {trajectory.length} pts
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save Preset Dialog Modal */}
      {showSaveModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowSaveModal(false)}
          style={{
            backdropFilter: 'blur(16px)',
            background: 'rgba(0,0,0,0.7)',
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <motion.div
            className="modal-box"
            onClick={e => e.stopPropagation()}
            style={{
              width: 400,
              padding: 24,
              background: '#161722',
              borderRadius: 12,
              border: '1px solid rgba(255, 255, 255, 0.12)',
            }}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Save DSP Preset</h3>
              <button onClick={() => setShowSaveModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            <input
              type="text"
              placeholder="Preset name..."
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: 'var(--text)',
                fontSize: 13,
                marginBottom: 16,
              }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowSaveModal(false)}
                style={{ padding: '8px 16px', fontSize: 12 }}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={handleSavePreset}
                style={{
                  padding: '8px 16px',
                  fontSize: 12,
                  fontWeight: 700,
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Save Preset
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </div>
    </div>
  );
}
