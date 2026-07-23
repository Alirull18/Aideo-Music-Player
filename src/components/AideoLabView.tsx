import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { 
  Sliders, Activity, Loader2, Search, 
  Compass, Headphones, Power, Sparkles, FolderOpen, Disc
} from 'lucide-react';

const GRAPHIC_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];


// Math helpers for filter evaluation
function getPeakingResponse(f: number, fs: number, f0: number, gainDb: number, q: number): number {
  if (gainDb === 0) return 0;
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  
  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;

  return getBiquadMagnitudeDb(f, fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

function getLowshelfResponse(f: number, fs: number, f0: number, gainDb: number, q: number): number {
  if (gainDb === 0) return 0;
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  const sqrtA = Math.sqrt(A);
  const cosW0 = Math.cos(w0);

  const b0 = A * ((A + 1) - (A - 1) * cosW0 + 2 * sqrtA * alpha);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
  const b2 = A * ((A + 1) - (A - 1) * cosW0 - 2 * sqrtA * alpha);
  const a0 = (A + 1) + (A - 1) * cosW0 + 2 * sqrtA * alpha;
  const a1 = -2 * ((A - 1) + (A + 1) * cosW0);
  const a2 = (A + 1) + (A - 1) * cosW0 - 2 * sqrtA * alpha;

  return getBiquadMagnitudeDb(f, fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

function getHighshelfResponse(f: number, fs: number, f0: number, gainDb: number, q: number): number {
  if (gainDb === 0) return 0;
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  const sqrtA = Math.sqrt(A);
  const cosW0 = Math.cos(w0);

  const b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * sqrtA * alpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
  const b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * sqrtA * alpha);
  const a0 = (A + 1) - (A - 1) * cosW0 + 2 * sqrtA * alpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cosW0);
  const a2 = (A + 1) - (A - 1) * cosW0 - 2 * sqrtA * alpha;

  return getBiquadMagnitudeDb(f, fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

function getBiquadMagnitudeDb(f: number, fs: number, b0: number, b1: number, b2: number, a1: number, a2: number): number {
  const w = (2 * Math.PI * f) / fs;
  const cosW = Math.cos(w);
  const cos2W = Math.cos(2 * w);
  const sinW = Math.sin(w);
  const sin2W = Math.sin(2 * w);

  const nr = b0 + b1 * cosW + b2 * cos2W;
  const ni = -b1 * sinW - b2 * sin2W;
  const dr = 1 + a1 * cosW + a2 * cos2W;
  const di = -a1 * sinW - a2 * sin2W;

  const magSq = (nr * nr + ni * ni) / (dr * dr + di * di + 1e-15);
  return 10 * Math.log10(magSq);
}

const getSourceStyle = (source: string) => {
  const s = source.toLowerCase();
  if (s.includes('oratory')) return { bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.35)', color: '#60a5fa', label: 'oratory1990' };
  if (s.includes('crinacle')) return { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)', color: '#34d399', label: 'crinacle' };
  if (s.includes('rtings')) return { bg: 'rgba(249, 115, 22, 0.12)', border: 'rgba(249, 115, 22, 0.35)', color: '#fb923c', label: 'Rtings' };
  if (s.includes('innerfidelity')) return { bg: 'rgba(234, 179, 8, 0.12)', border: 'rgba(234, 179, 8, 0.35)', color: '#facc15', label: 'Innerfidelity' };
  if (s.includes('raa')) return { bg: 'rgba(236, 72, 153, 0.12)', border: 'rgba(236, 72, 153, 0.35)', color: '#f472b6', label: 'RAA' };
  return { bg: 'rgba(139, 92, 246, 0.12)', border: 'rgba(139, 92, 246, 0.3)', color: '#a78bfa', label: source };
};

export function AideoLabView() {
  const { 
    dsp, setDSP, accentColor, lowSpecMode, colorScheme
  } = useStore();
  const [activeTab, setActiveTab] = useState<'eq' | 'spatial' | 'dynamics' | 'aideo_filter'>('eq');
  const [systemIsLight, setSystemIsLight] = useState(() => 
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)').matches : false
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const listener = (e: MediaQueryListEvent) => setSystemIsLight(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  const isLightTheme = colorScheme === 'light' || (colorScheme === 'system' && systemIsLight);

  // Custom Preset States
  const [customPresets, setCustomPresets] = useState<{ name: string; dsp: any }[]>(() => {
    try {
      const saved = localStorage.getItem('aideo_dsp_presets');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newPresetName, setNewPresetName] = useState('');
  const [selectedPresetName, setSelectedPresetName] = useState('');

  const handleSavePreset = () => {
    if (!newPresetName.trim()) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Preset name cannot be empty', type: 'warning' } }));
      return;
    }
    const name = newPresetName.trim();
    const systemNames = ['Flat', 'Bass Boost', 'Vocal Booster', 'Treble Booster', 'Audiophile Hi-Res'];
    if (systemNames.includes(name)) {
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Cannot overwrite system presets', type: 'warning' } }));
      return;
    }

    const updated = [...customPresets.filter(p => p.name !== name), { name, dsp }];
    setCustomPresets(updated);
    localStorage.setItem('aideo_dsp_presets', JSON.stringify(updated));
    setSelectedPresetName(name);
    setNewPresetName('');
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Preset "${name}" saved successfully!`, type: 'success' } }));
  };

  const handleDeletePreset = (name: string) => {
    const updated = customPresets.filter(p => p.name !== name);
    setCustomPresets(updated);
    localStorage.setItem('aideo_dsp_presets', JSON.stringify(updated));
    setSelectedPresetName('');
    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Preset "${name}" deleted.`, type: 'info' } }));
  };

  const handleLoadPreset = (name: string) => {
    setSelectedPresetName(name);
    
    if (name === 'Flat') {
      const defaultBands = dsp.eq_parametric_bands.map((_: any, idx: number) => {
        let freq = 1000;
        if (idx === 0) freq = 31;
        else if (idx === 1) freq = 62;
        else if (idx === 2) freq = 125;
        else if (idx === 3) freq = 250;
        else if (idx === 4) freq = 500;
        else if (idx === 5) freq = 1000;
        else if (idx === 6) freq = 2000;
        else if (idx === 7) freq = 4000;
        else if (idx === 8) freq = 8000;
        else if (idx === 9) freq = 16000;
        return { freq, gain: 0, q: 0.7, band_type: idx === 0 ? 'lowshelf' : idx === 8 ? 'highshelf' : 'peaking' };
      });
      setDSP({
        eq_enabled: false,
        eq_parametric: true,
        eq_graphic_gains: new Array(10).fill(0),
        eq_parametric_bands: defaultBands,
        preamp_gain: 0,
        subsonic_enabled: false,
        night_mode_enabled: false,
        limiter_threshold: 0,
        saturation_enabled: false
      });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Loaded Flat bypass preset.', type: 'info' } }));
    } 
    else if (name === 'Bass Boost') {
      const bassBands = dsp.eq_parametric_bands.map((b: any, idx: number) => {
        if (idx === 0) return { ...b, freq: 31, gain: 5.5, band_type: 'lowshelf' };
        if (idx === 1) return { ...b, freq: 62, gain: 4.0, band_type: 'peaking' };
        if (idx === 2) return { ...b, freq: 125, gain: 2.0, band_type: 'peaking' };
        return { ...b, gain: 0 };
      });
      const bassGraphic = [6.0, 4.5, 3.0, 1.0, 0, 0, 0, 0, 0, 0];
      setDSP({
        eq_enabled: true,
        eq_graphic_gains: bassGraphic,
        eq_parametric_bands: bassBands,
        preamp_gain: -3.5
      });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Loaded Bass Boost preset.', type: 'info' } }));
    }
    else if (name === 'Vocal Booster') {
      const vocalBands = dsp.eq_parametric_bands.map((b: any, idx: number) => {
        if (idx === 4) return { ...b, freq: 500, gain: 2.0, band_type: 'peaking' };
        if (idx === 5) return { ...b, freq: 1000, gain: 3.5, band_type: 'peaking' };
        if (idx === 6) return { ...b, freq: 2000, gain: 2.0, band_type: 'peaking' };
        return { ...b, gain: 0 };
      });
      const vocalGraphic = [0, 0, 0, 0, 1.5, 3.0, 2.0, 0, 0, 0];
      setDSP({
        eq_enabled: true,
        eq_graphic_gains: vocalGraphic,
        eq_parametric_bands: vocalBands,
        preamp_gain: -2.0
      });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Loaded Vocal Booster preset.', type: 'info' } }));
    }
    else if (name === 'Treble Booster') {
      const trebleBands = dsp.eq_parametric_bands.map((b: any, idx: number) => {
        if (idx === 7) return { ...b, freq: 4000, gain: 2.0, band_type: 'peaking' };
        if (idx === 8) return { ...b, freq: 8000, gain: 4.5, band_type: 'highshelf' };
        if (idx === 9) return { ...b, freq: 16000, gain: 5.5, band_type: 'peaking' };
        return { ...b, gain: 0 };
      });
      const trebleGraphic = [0, 0, 0, 0, 0, 0, 1.5, 3.0, 4.5, 5.0];
      setDSP({
        eq_enabled: true,
        eq_graphic_gains: trebleGraphic,
        eq_parametric_bands: trebleBands,
        preamp_gain: -3.0
      });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Loaded Treble Booster preset.', type: 'info' } }));
    }
    else if (name === 'Audiophile Hi-Res') {
      setDSP({
        audio_profile: 'high',
        dither: true,
        low_spec_mode: false
      });
      window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Loaded Audiophile Hi-Res preset.', type: 'info' } }));
    }
    else {
      const custom = customPresets.find(p => p.name === name);
      if (custom) {
        setDSP(custom.dsp);
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Loaded preset "${name}".`, type: 'info' } }));
      }
    }
  };
  
  // AutoEQ States
  const [dbSearchQuery, setDbSearchQuery] = useState('');
  const [autoEqDb, setAutoEqDb] = useState<{ name: string; url: string; source: string; fullSource: string }[] | null>(null);
  const [isFetchingDb, setIsFetchingDb] = useState(false);
  const [showAutoEqSearch, setShowAutoEqSearch] = useState(false);
  const [autoEqError, setAutoEqError] = useState('');

  // Local Drag States
  const [activeDragNode, setActiveDragNode] = useState<number | null>(null);
  const graphRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);

  // XY Pad States
  const xyPadRef = useRef<HTMLDivElement>(null);
  const [isDraggingXY, setIsDraggingXY] = useState(false);
  const [xyPos, setXyPos] = useState({ x: 0.5, y: 0.5 }); // 0 to 1

  // Waterfall Spectrum state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<number[]>(new Array(64).fill(0));

  // Audio-reactive Soundstage refs
  const pulseBassRef = useRef<HTMLDivElement>(null);
  const pulseLRef = useRef<HTMLDivElement>(null);
  const pulseRRef = useRef<HTMLDivElement>(null);

  // FFT event listener for real-time waterfall overlay
  useEffect(() => {
    const unlisten = listen<number[]>('audio-spectrum', (event) => {
      spectrumRef.current = event.payload;
    });
    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Waterfall canvas loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || activeTab !== 'eq' || lowSpecMode) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create an offscreen canvas for double-buffered self-copying.
    // This avoids undefined behavior and frozen frames caused by drawing a canvas onto itself in modern WebViews (like WebView2 on Windows).
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const offscreenCtx = offscreen.getContext('2d');

    let animId: number;
    const render = () => {
      const w = canvas.width;
      const h = canvas.height;

      if (offscreenCtx) {
        // Copy current main canvas state to the offscreen canvas
        offscreenCtx.clearRect(0, 0, w, h);
        offscreenCtx.drawImage(canvas, 0, 0);

        // Clear main canvas
        ctx.clearRect(0, 0, w, h);

        // Draw the offscreen canvas shifted down by 1 pixel back to the main canvas
        ctx.drawImage(offscreen, 0, 1, w, h - 1);
      } else {
        // Fallback self-copy
        ctx.drawImage(canvas, 0, 1, w, h - 1);
      }
      
      // Clear top row
      ctx.fillStyle = isLightTheme ? 'rgba(243, 243, 249, 0.05)' : 'rgba(9, 9, 14, 0.05)';
      ctx.fillRect(0, 0, w, 1);

      const bands = spectrumRef.current;
      if (bands && bands.length > 0) {
        const step = w / bands.length;
        for (let i = 0; i < bands.length; i++) {
          const val = bands[i];
          if (val > 0.005) {
            const x = i * step;
            // Draw a tiny pixel with dynamic opacity reflecting frequency volume
            ctx.fillStyle = `hsla(${(i / bands.length) * 120 + 220}, 90%, 65%, ${Math.min(val * 1.5, 0.8)})`;
            ctx.fillRect(x, 0, step - 0.5, 1.2);
          }
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [activeTab, lowSpecMode, isLightTheme]);

  // Real-time audio-reactive Soundstage arena pulse engine
  useEffect(() => {
    if (activeTab !== 'spatial' || lowSpecMode) return;
    
    let animId: number;
    const render = () => {
      const bands = spectrumRef.current;
      if (bands && bands.length > 0) {
        // Calculate bass energy (first 8 bands)
        let bassSum = 0;
        const bassCount = Math.min(8, bands.length);
        for (let i = 0; i < bassCount; i++) {
          bassSum += bands[i];
        }
        const bassEnergy = bassSum / bassCount;

        // Calculate mid energy (bands 8 to 24)
        let midSum = 0;
        const midStart = Math.min(8, bands.length);
        const midEnd = Math.min(24, bands.length);
        const midCount = midEnd - midStart;
        for (let i = midStart; i < midEnd; i++) {
          midSum += bands[i];
        }
        const midEnergy = midCount > 0 ? midSum / midCount : 0;

        // Calculate high energy (bands 24 to 64)
        let highSum = 0;
        const highStart = Math.min(24, bands.length);
        const highEnd = Math.min(64, bands.length);
        const highCount = highEnd - highStart;
        for (let i = highStart; i < highEnd; i++) {
          highSum += bands[i];
        }
        const highsEnergy = highCount > 0 ? highSum / highCount : 0;

        // Smoothly adjust scale and opacity of the concentric soundwaves & speaker rings
        if (pulseBassRef.current) {
          const scale = 1.0 + bassEnergy * 0.75;
          const opacity = Math.min(0.7, 0.15 + bassEnergy * 0.55);
          pulseBassRef.current.style.transform = `scale(${scale})`;
          pulseBassRef.current.style.opacity = `${opacity}`;
        }

        if (pulseLRef.current) {
          const scale = 1.0 + midEnergy * 1.1;
          const opacity = Math.min(0.85, 0.15 + midEnergy * 0.65);
          pulseLRef.current.style.transform = `scale(${scale})`;
          pulseLRef.current.style.opacity = `${opacity}`;
        }

        if (pulseRRef.current) {
          const scale = 1.0 + highsEnergy * 1.3;
          const opacity = Math.min(0.85, 0.15 + highsEnergy * 0.65);
          pulseRRef.current.style.transform = `scale(${scale})`;
          pulseRRef.current.style.opacity = `${opacity}`;
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [activeTab, lowSpecMode]);

  // Fetch Jaakko Pasanen AutoEQ database
  const fetchAutoEqDb = async () => {
    setIsFetchingDb(true);
    setAutoEqError('');
    try {
      const response = await fetch('https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/INDEX.md');
      if (!response.ok) throw new Error('Failed to fetch AutoEQ headphone database.');
      const text = await response.text();
      
      const lines = text.split('\n');
      const parsedEntries: typeof autoEqDb = [];
      
      lines.forEach(line => {
        const trimmed = line.trim();
        const match = trimmed.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*by\s*(.+)$/i);
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
            fullSource: rawSource
          });
        }
      });
      setAutoEqDb(parsedEntries);
    } catch (err: any) {
      setAutoEqError(err.message || 'Failed to load headphone profiles.');
    } finally {
      setIsFetchingDb(false);
    }
  };

  const filteredDb = useMemo(() => {
    if (!autoEqDb) return [];
    if (!dbSearchQuery.trim()) return autoEqDb.slice(0, 15);
    const query = dbSearchQuery.toLowerCase().trim();
    const parts = query.split(/\s+/);
    
    return autoEqDb
      .filter(entry => {
        const nameLower = entry.name.toLowerCase();
        return parts.every(part => nameLower.includes(part));
      })
      .slice(0, 30);
  }, [autoEqDb, dbSearchQuery]);

  const handleSelectHeadphone = async (headphone: { name: string; url: string }) => {
    setAutoEqError('');
    try {
      const response = await fetch(headphone.url);
      if (!response.ok) throw new Error('Failed to download corrective EQ profile.');
      const text = await response.text();
      applyAutoEqText(text);
    } catch (err: any) {
      setAutoEqError(err.message || 'Failed to download EQ profile.');
    } finally {
      setShowAutoEqSearch(false);
    }
  };

  const applyAutoEqText = (profileText: string) => {
    try {
      const lines = profileText.split('\n');
      let preamp = 0;
      const parsedBands: typeof dsp.eq_parametric_bands = [];

      lines.forEach(line => {
        const trimmed = line.trim().toLowerCase();
        if (!trimmed) return;

        if (trimmed.includes('preamp:')) {
          const match = trimmed.match(/preamp:\s*(-?[\d.]+)\s*db/);
          if (match) preamp = parseFloat(match[1]);
          return;
        }

        if (trimmed.includes('filter')) {
          const fcMatch = trimmed.match(/fc\s+([\d.]+)\s*hz/);
          const gainMatch = trimmed.match(/gain\s+(-?[\d.]+)\s*db/);
          const qMatch = trimmed.match(/q\s+([\d.]+)/) || trimmed.match(/s\s+([\d.]+)/);
          
          let bandType = 'peaking';
          if (trimmed.includes('lsc') || trimmed.includes('lowshelf')) {
            bandType = 'lowshelf';
          } else if (trimmed.includes('hsc') || trimmed.includes('highshelf')) {
            bandType = 'highshelf';
          }

          if (fcMatch && gainMatch) {
            parsedBands.push({
              freq: parseFloat(fcMatch[1]),
              gain: parseFloat(gainMatch[1]),
              q: qMatch ? Math.max(0.1, Math.min(10.0, parseFloat(qMatch[1]))) : 1.0,
              band_type: bandType
            });
          }
        }
      });

      if (parsedBands.length === 0) throw new Error('Could not find any valid Parametric Filters.');

      const bandsToApply = [...dsp.eq_parametric_bands];
      for (let i = 0; i < 10; i++) {
        if (parsedBands[i]) {
          bandsToApply[i] = parsedBands[i];
        } else {
          bandsToApply[i] = { freq: bandsToApply[i]?.freq || 1000, gain: 0, q: 0.7, band_type: 'peaking' };
        }
      }

      setDSP({
        eq_enabled: true,
        eq_parametric: true,
        eq_parametric_bands: bandsToApply,
        preamp_gain: preamp
      });

      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Aideo Lab: Headphone calibration applied successfully!${preamp < 0 ? ` (Applied preamp: ${preamp}dB)` : ''}`, type: 'success' } 
      }));
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: err.message || 'Acoustic parser error.', type: 'error' } 
      }));
    }
  };

  // Aideo Lab - Section Reset functions
  const resetEQ = () => {
    const defaultBands = dsp.eq_parametric_bands.map((_, idx) => {
      let freq = 1000;
      if (idx === 0) freq = 31;
      else if (idx === 1) freq = 62;
      else if (idx === 2) freq = 125;
      else if (idx === 3) freq = 250;
      else if (idx === 4) freq = 500;
      else if (idx === 5) freq = 1000;
      else if (idx === 6) freq = 2000;
      else if (idx === 7) freq = 4000;
      else if (idx === 8) freq = 8000;
      else if (idx === 9) freq = 16000;
      return { freq, gain: 0, q: 0.7, band_type: idx === 0 ? 'lowshelf' : idx === 8 ? 'highshelf' : 'peaking' };
    });
    setDSP({
      eq_enabled: false,
      eq_parametric: true,
      eq_graphic_gains: new Array(10).fill(0),
      eq_parametric_bands: defaultBands
    });
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: 'Equalizer flattened and calibration parameters reset successfully!', type: 'success' } 
    }));
  };

  const resetSpatial = () => {
    setDSP({
      spatial_enabled: false,
      spatial_haas_delay: 15.0,
      spatial_wet: 0.5,
      crossfeed_enabled: false,
      crossfeed_level: -12.0
    });
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: '3D Spatial Arena parameters restored to defaults.', type: 'success' } 
    }));
  };

  const resetDynamics = () => {
    setXyPos({ x: 0.5, y: 0.5 });
    setDSP({
      subsonic_enabled: false,
      night_mode_enabled: false,
      r128_enabled: false,
      preamp_gain: 0.0,
      limiter_threshold: -0.1,
      resampler_phase_mode: 'linear'
    });
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: 'Dynamics controls, preamp/limiter, and XY Space Pad centered.', type: 'success' } 
    }));
  };

  // Logarithmic coordinates conversions
  const getX = (f: number, width: number) => {
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const logF = Math.log10(f);
    return ((logF - logMin) / (logMax - logMin)) * width;
  };

  const getFreqFromX = (x: number, width: number) => {
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const logF = logMin + (x / width) * (logMax - logMin);
    return Math.round(Math.max(20, Math.min(20000, Math.pow(10, logF))));
  };

  const getY = (db: number, height: number) => {
    const minDb = -12;
    const maxDb = 12;
    const clamped = Math.max(minDb, Math.min(maxDb, db));
    return height - ((clamped - minDb) / (maxDb - minDb)) * height;
  };

  const getGainFromY = (y: number, height: number) => {
    const minDb = -12;
    const maxDb = 12;
    const ratio = 1 - (y / height);
    const db = minDb + ratio * (maxDb - minDb);
    return Math.round(Math.max(minDb, Math.min(maxDb, db)) * 10) / 10;
  };

  // Spline calculations
  const curvePoints = useMemo(() => {
    const fs = 48000;
    const points: { f: number; db: number }[] = [];
    const minF = 20;
    const maxF = 20000;
    const logMin = Math.log10(minF);
    const logMax = Math.log10(maxF);

    for (let i = 0; i <= 150; i++) {
      const logF = logMin + (i / 150) * (logMax - logMin);
      const f = Math.pow(10, logF);
      let totalDb = 0;

      if (dsp.eq_enabled) {
        if (dsp.eq_parametric) {
          dsp.eq_parametric_bands.forEach((band) => {
            if (band.band_type === 'lowshelf') {
              totalDb += getLowshelfResponse(f, fs, band.freq, band.gain, band.q);
            } else if (band.band_type === 'highshelf') {
              totalDb += getHighshelfResponse(f, fs, band.freq, band.gain, band.q);
            } else {
              totalDb += getPeakingResponse(f, fs, band.freq, band.gain, band.q);
            }
          });
        } else {
          dsp.eq_graphic_gains.forEach((gain, index) => {
            totalDb += getPeakingResponse(f, fs, GRAPHIC_FREQS[index], gain, 1.0);
          });
        }
      }
      points.push({ f, db: totalDb });
    }
    return points;
  }, [dsp.eq_enabled, dsp.eq_parametric, dsp.eq_graphic_gains, dsp.eq_parametric_bands]);

  // drag-and-drop EQ node editor
  const handleGraphMouseMove = (e: React.MouseEvent) => {
    if (activeDragNode === null || !graphRef.current) return;
    const rect = graphRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const newFreq = getFreqFromX(mouseX, rect.width);
    const newGain = getGainFromY(mouseY, rect.height);

    if (dsp.eq_parametric) {
      const updatedBands = dsp.eq_parametric_bands.map((band, idx) => {
        if (idx === activeDragNode) {
          // Low/high-shelf freq clamps to preserve structural roles
          let freq = newFreq;
          if (idx === 0) freq = Math.min(150, newFreq); // low shelf
          if (idx === 8) freq = Math.max(4000, newFreq); // high shelf
          return { ...band, freq, gain: newGain };
        }
        return band;
      });
      setDSP({ eq_parametric_bands: updatedBands });
    } else {
      const updatedGains = [...dsp.eq_graphic_gains];
      updatedGains[activeDragNode] = newGain;
      setDSP({ eq_graphic_gains: updatedGains });
    }
  };

  const handleGraphMouseUp = () => {
    setActiveDragNode(null);
  };

  // Interpolate Bilinear weights inside XY Preset Morphing Space
  const handleXYMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingXY || !xyPadRef.current) return;
    const rect = xyPadRef.current.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const py = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setXyPos({ x: px, y: py });

    // Morphing algorithms:
    const w_tl = (1 - px) * (1 - py); // Spatial / Bright
    const w_tr = px * (1 - py);       // Warm / Compressed
    const w_bl = (1 - px) * py;       // Deep Bass Boost
    // w_br = px * py is Flat Reference, which maps to 0.0 offsets.

    // 1. Haas expander variables
    const spatial_haas_delay = Math.round((w_tl * 12.0) * 10) / 10;
    const spatial_wet = Math.round((w_tl * 0.75) * 100) / 100;
    const spatial_enabled = w_tl > 0.15;

    // 2. Headphone crossfeed variables
    const crossfeed_enabled = w_tr > 0.15;
    const crossfeed_level = Math.round((w_tr * -4.5 + (1 - w_tr) * -12.0) * 10) / 10;

    // 3. Dynamic Night-mode compressor
    const night_mode_enabled = w_tr > 0.35;

    // 4. EQ changes (Low/High-shelf parametric adjustments)
    const updatedBands = [...dsp.eq_parametric_bands];
    // Band 0: Low shelf bass boost
    updatedBands[0] = { ...updatedBands[0], gain: Math.round((w_bl * 5.5 + w_tr * 2.0) * 10) / 10 };
    // Band 8: High shelf brightness
    updatedBands[8] = { ...updatedBands[8], gain: Math.round((w_tl * 4.5 - w_tr * 2.5) * 10) / 10 };

    setDSP({
      spatial_enabled,
      spatial_haas_delay,
      spatial_wet,
      crossfeed_enabled,
      crossfeed_level,
      night_mode_enabled,
      eq_parametric_bands: updatedBands
    });
  };



  const getActiveXYLabel = () => {
    const { x, y } = xyPos;
    if (x < 0.4 && y < 0.4) return 'Spatial & Bright';
    if (x > 0.6 && y < 0.4) return 'Warm & Compressed';
    if (x < 0.4 && y > 0.6) return 'Deep Bass Boost';
    if (x > 0.6 && y > 0.6) return 'Reference Flat';
    return 'Hybrid Dynamic Morph';
  };

  return (
    <div className="aideo-lab-main" style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--bg)',
      color: 'var(--text)',
      padding: '30px 40px',
      overflowY: 'auto'
    }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', letterSpacing: -0.5 }}>Aideo Lab</h1>
          <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>
            Visual Acoustic Laboratory — Professional DSP Engineering & Psychoacoustics.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Master Acoustic Engine Switch */}
          <button
            onClick={() => setDSP({ enabled: !dsp.enabled })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: dsp.enabled ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.1)',
              border: dsp.enabled ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.25)',
              color: dsp.enabled ? '#34d399' : '#f87171',
              padding: '8px 16px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: dsp.enabled ? '0 0 12px rgba(16, 185, 129, 0.15)' : 'none',
              letterSpacing: '0.5px'
            }}
          >
            <Power size={14} style={{ transform: dsp.enabled ? 'scale(1.1)' : 'none', transition: 'all 0.2s' }} />
            ENGINE: {dsp.enabled ? 'ACTIVE' : 'BYPASSED'}
          </button>

          {/* Tab Selection */}
          <div style={{
            display: 'flex',
            background: 'var(--glass)',
            padding: 3,
            borderRadius: 10,
            border: '1px solid var(--glass-border)',
            gap: 4
          }}>
            {[
              { id: 'eq', label: 'EQ & Calibration', icon: Sliders },
              { id: 'spatial', label: 'Spatial Stage', icon: Compass },
              { id: 'dynamics', label: 'Dynamics & XY', icon: Activity },
              { id: 'aideo_filter', label: 'Aideo Filter', icon: Sparkles }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: activeTab === tab.id ? 'var(--glass-h)' : 'transparent',
                  border: 'none',
                  color: activeTab === tab.id ? 'var(--text)' : 'var(--text-dim)',
                  padding: '8px 16px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Workspace Panels */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <AnimatePresence mode="wait">
          {activeTab === 'eq' && (
            <motion.div
              key="eq-tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
            >
              {/* Spline EQ Laboratory Graph */}
              <div className="settings-ctrl-card" style={{ padding: 24, position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Logarithmic EQ Spline & Waterfall</h3>
                    <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                      Click and drag handles to adjust precise frequency responses. Translucent real-time waterfall active underneath.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={resetEQ}
                      className="settings-btn settings-btn-danger"
                      style={{ fontSize: 11, padding: '6px 12px' }}
                    >
                      Reset EQ
                    </button>
                    <button
                      onClick={() => setDSP({ eq_parametric: !dsp.eq_parametric })}
                      className="settings-btn"
                      style={{ fontSize: 11, padding: '6px 12px' }}
                    >
                      Use {dsp.eq_parametric ? '10-Band Graphic' : '5-Band Parametric'}
                    </button>
                    <button
                      onClick={() => setDSP({ eq_enabled: !dsp.eq_enabled, enabled: !dsp.eq_enabled ? true : dsp.enabled })}
                      className="settings-btn"
                      style={{
                        fontSize: 11,
                        padding: '6px 12px',
                        background: dsp.eq_enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: dsp.eq_enabled ? '#34d399' : '#f87171',
                        border: 'none'
                      }}
                    >
                      EQ: {dsp.eq_enabled ? 'ENABLED' : 'BYPASSED'}
                    </button>
                  </div>
                </div>

                {/* Graph Board */}
                <div style={{
                  position: 'relative',
                  width: '100%',
                  height: 200,
                  background: 'rgba(0, 0, 0, 0.3)',
                  borderRadius: 12,
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  overflow: 'hidden'
                }}>
                  {/* Waterfall Spectrogram Overlay */}
                  <canvas
                    ref={canvasRef}
                    width={720}
                    height={200}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                      opacity: 0.15
                    }}
                  />

                  {/* SVG Spline Grid */}
                  <svg
                    ref={graphRef}
                    width="100%"
                    height="100%"
                    onMouseMove={handleGraphMouseMove}
                    onMouseUp={handleGraphMouseUp}
                    onMouseLeave={handleGraphMouseUp}
                    style={{ position: 'relative', zIndex: 2, cursor: activeDragNode !== null ? 'grabbing' : 'default' }}
                  >
                    {/* Horizontal dB Gridlines (+12dB to -12dB) */}
                    {[12, 6, 0, -6, -12].map((db) => {
                      const y = getY(db, 200);
                      return (
                        <g key={db}>
                          <line x1="0" y1={y} x2="100%" y2={y} stroke="var(--glass-border)" strokeDasharray="3" />
                          <text x="6" y={y - 4} fill="var(--text-dim)" fontSize="9" fontWeight="600">{db > 0 ? `+${db}` : db}dB</text>
                        </g>
                      );
                    })}

                    {/* Vertical Log Frequency Gridlines */}
                    {[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => {
                      const x = `${(Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100}%`;
                      return (
                        <g key={f}>
                          <line x1={x} y1="0" x2={x} y2="100%" stroke="var(--glass-border)" />
                          <text x={x} y="194" dx="4" fill="var(--text-dim)" fontSize="8" fontWeight="600">
                            {f >= 1000 ? `${f / 1000}kHz` : `${f}Hz`}
                          </text>
                        </g>
                      );
                    })}

                    {/* EQ glowing Spline Path */}
                    {curvePoints.length > 0 && (
                      <path
                        d={`M 0 ${getY(curvePoints[0].db, 200)} ${curvePoints.slice(1).map(p => `L ${getX(p.f, 720)} ${getY(p.db, 200)}`).join(' ')}`}
                        fill="none"
                        stroke={accentColor || 'var(--dynamic-accent, #8b5cf6)'}
                        strokeWidth="2.5"
                        filter="drop-shadow(0px 0px 8px rgba(139, 92, 246, 0.35))"
                      />
                    )}

                    {/* Interactive drag nodes */}
                    {dsp.eq_enabled && (
                      dsp.eq_parametric ? (
                        // 10 Parametric nodes
                        dsp.eq_parametric_bands.map((band, idx) => {
                          const cx = getX(band.freq, 720);
                          const cy = getY(band.gain, 200);
                          const isHovered = hoveredNode === idx || activeDragNode === idx;
                          return (
                            <g key={idx}
                               onMouseEnter={() => setHoveredNode(idx)}
                               onMouseLeave={() => setHoveredNode(null)}
                               onMouseDown={() => setActiveDragNode(idx)}
                               style={{ cursor: 'grab' }}
                            >
                              <circle cx={cx} cy={cy} r={isHovered ? 8 : 5}
                                      fill={isHovered ? 'white' : (accentColor || 'var(--dynamic-accent)')}
                                      stroke="rgba(0, 0, 0, 0.5)" strokeWidth="1.5"
                                      filter="drop-shadow(0 0 4px rgba(0,0,0,0.5))"
                                      style={{ transition: 'r 0.1s ease' }}
                              />
                              {isHovered && (
                                <g transform={`translate(${cx + 12}, ${cy - 12})`}>
                                  <rect width="90" height="32" rx="6" fill="rgba(9, 9, 14, 0.95)" stroke="rgba(255,255,255,0.08)" />
                                  <text x="8" y="14" fill="white" fontSize="9" fontWeight="700">Band {idx + 1}: {band.band_type}</text>
                                  <text x="8" y="25" fill="var(--text-dim)" fontSize="8">{Math.round(band.freq)}Hz · {band.gain}dB</text>
                                </g>
                              )}
                            </g>
                          );
                        })
                      ) : (
                        // 10 Graphic nodes
                        dsp.eq_graphic_gains.map((gain, idx) => {
                          const cx = getX(GRAPHIC_FREQS[idx], 720);
                          const cy = getY(gain, 200);
                          const isHovered = hoveredNode === idx || activeDragNode === idx;
                          return (
                            <g key={idx}
                               onMouseEnter={() => setHoveredNode(idx)}
                               onMouseLeave={() => setHoveredNode(null)}
                               onMouseDown={() => setActiveDragNode(idx)}
                               style={{ cursor: 'grab' }}
                            >
                              <circle cx={cx} cy={cy} r={isHovered ? 7 : 4}
                                      fill={isHovered ? 'white' : '#a855f7'}
                                      stroke="rgba(0, 0, 0, 0.5)" strokeWidth="1"
                              />
                            </g>
                          );
                        })
                      )
                    )}
                  </svg>
                </div>
              </div>

              {/* DSP Preset Manager Card */}
              <div className="settings-ctrl-card" style={{ padding: 20 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                  <Sliders size={15} />
                  DSP & Equalizer Presets
                </h4>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    value={selectedPresetName}
                    onChange={(e) => handleLoadPreset(e.target.value)}
                    style={{
                      background: 'rgba(0, 0, 0, 0.3)',
                      color: 'var(--text)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 6,
                      padding: '6px 12px',
                      fontSize: 12,
                      outline: 'none',
                      cursor: 'pointer',
                      minWidth: 150
                    }}
                  >
                    <option value="" disabled>Select Preset...</option>
                    <optgroup label="System Presets">
                      <option value="Flat">Flat / Bypass</option>
                      <option value="Bass Boost">Bass Boost</option>
                      <option value="Vocal Booster">Vocal Booster</option>
                      <option value="Treble Booster">Treble Booster</option>
                      <option value="Audiophile Hi-Res">Audiophile Hi-Res</option>
                    </optgroup>
                    {customPresets.length > 0 && (
                      <optgroup label="Your Presets">
                        {customPresets.map(p => (
                          <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Preset name..."
                      value={newPresetName}
                      onChange={(e) => setNewPresetName(e.target.value)}
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        color: 'var(--text)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: 12,
                        outline: 'none',
                        width: 150
                      }}
                    />
                    <button
                      onClick={handleSavePreset}
                      className="settings-btn"
                      style={{ fontSize: 11, padding: '6px 12px' }}
                    >
                      Save Preset
                    </button>
                    {customPresets.some(p => p.name === selectedPresetName) && (
                      <button
                        onClick={() => handleDeletePreset(selectedPresetName)}
                        className="settings-btn settings-btn-danger"
                        style={{ fontSize: 11, padding: '6px 12px' }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Headphone autoEQ calibration block */}
              <div className="settings-ctrl-card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Headphones size={15} />
                      Import AutoEQ Headphone Profile
                    </h4>
                    <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                      Query Jaakko Pasanen's master database of 4,000+ reference target headphone profiles to calibrate reference outputs.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowAutoEqSearch(!showAutoEqSearch);
                      if (!autoEqDb && !showAutoEqSearch) fetchAutoEqDb();
                    }}
                    className="settings-btn"
                    style={{ fontSize: 11 }}
                  >
                    {showAutoEqSearch ? 'Hide Search Panel' : 'Search Profiles'}
                  </button>
                </div>

                {/* Autocomplete database list */}
                <AnimatePresence>
                  {showAutoEqSearch && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      style={{ overflow: 'hidden', marginTop: 14 }}
                    >
                      <div style={{ display: 'flex', gap: 10, background: 'rgba(0,0,0,0.18)', padding: 10, borderRadius: 8, border: '1px solid rgba(255,255,255,0.03)', marginBottom: 12 }}>
                        <Search size={16} style={{ color: 'var(--text-dim)', alignSelf: 'center', marginLeft: 4 }} />
                        <input
                          type="text"
                          placeholder="Search headphone models (e.g. Sony WH-1000XM4, HD600)..."
                          value={dbSearchQuery}
                          onChange={e => setDbSearchQuery(e.target.value)}
                          style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--text)', fontSize: 12, outline: 'none' }}
                        />
                        {isFetchingDb && <Loader2 size={14} className="spinning" style={{ alignSelf: 'center' }} />}
                      </div>

                      {autoEqError && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 10 }}>{autoEqError}</div>}

                      <div style={{
                        maxHeight: 180,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                        background: 'rgba(0,0,0,0.1)',
                        borderRadius: 8,
                        padding: 4
                      }}>
                        {filteredDb.map((item, idx) => {
                          const style = getSourceStyle(item.source);
                          return (
                            <div
                              key={idx}
                              onClick={() => handleSelectHeadphone(item)}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 12px',
                                borderRadius: 6,
                                cursor: 'pointer',
                                transition: 'all 0.15s'
                              }}
                              className="aideo-carousel-card-hover"
                            >
                              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{item.name}</span>
                              <span style={{
                                fontSize: 9,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 10,
                                background: style.bg,
                                color: style.color,
                                border: `1px solid ${style.border}`
                              }}>{style.label}</span>
                            </div>
                          );
                        })}
                        {filteredDb.length === 0 && !isFetchingDb && (
                          <div style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', padding: 20 }}>
                            No headphones found matching your query.
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {activeTab === 'spatial' && (
            <motion.div
              key="spatial-tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, alignItems: 'start' }}
            >
              {/* Left Column: 3D Soundstage Arena Vector */}
              <div className="settings-ctrl-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start' }}>
                <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>3D Visual Spatial Arena</h4>
                    <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>
                      Top-down view representing concentric loudspeaker shadow reflections and ear mixing.
                    </p>
                  </div>
                  <button
                    onClick={resetSpatial}
                    className="settings-btn settings-btn-danger"
                    style={{ fontSize: 10, padding: '6px 12px' }}
                  >
                    Reset Spatial
                  </button>
                </div>

                {/* Animated vector sound stage */}
                <div style={{
                  position: 'relative',
                  width: 200,
                  height: 200,
                  background: 'var(--glass)',
                  borderRadius: 100,
                  border: '1px solid var(--glass-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {/* concentric speaker soundwaves */}
                  {!dsp.low_spec_mode ? (
                    <div
                      ref={pulseBassRef}
                      style={{
                        position: 'absolute',
                        width: '80%',
                        height: '80%',
                        borderRadius: '50%',
                        border: `1.5px solid ${accentColor || '#8b5cf6'}`,
                        opacity: 0.15,
                        pointerEvents: 'none',
                        transformOrigin: 'center',
                        transition: 'transform 0.08s ease-out, opacity 0.08s ease-out'
                      }}
                    />
                  ) : (
                    dsp.spatial_enabled && (
                      <motion.div
                        animate={{ scale: [1, 1.45, 1], opacity: [0.35, 0, 0.35] }}
                        transition={{ repeat: Infinity, duration: 2.2, ease: 'easeOut' }}
                        style={{
                          position: 'absolute',
                          width: '80%',
                          height: '80%',
                          borderRadius: '50%',
                          border: `1.5px solid ${accentColor || '#8b5cf6'}`,
                          pointerEvents: 'none'
                        }}
                      />
                    )
                  )}

                  {/* Top-down Head profile */}
                  <div style={{
                    width: 70,
                    height: 70,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative'
                  }}>
                    {/* Ears */}
                    <div style={{ position: 'absolute', left: -5, width: 6, height: 18, borderRadius: 3, background: 'rgba(255,255,255,0.2)' }} />
                    <div style={{ position: 'absolute', right: -5, width: 6, height: 18, borderRadius: 3, background: 'rgba(255,255,255,0.2)' }} />
                    {/* Nose */}
                    <div style={{ position: 'absolute', top: -5, width: 10, height: 10, transform: 'rotate(45deg)', background: 'rgba(255,255,255,0.06)', borderLeft: '1px solid rgba(255,255,255,0.15)', borderTop: '1px solid rgba(255,255,255,0.15)' }} />
                    
                    <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.4 }}>LISTENER</span>
                  </div>

                  {/* Left speaker */}
                  <div style={{
                    position: 'absolute',
                    top: 25,
                    left: 20,
                    textAlign: 'center',
                    transform: 'rotate(25deg)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                  }}>
                    {!dsp.low_spec_mode && (
                      <div
                        ref={pulseLRef}
                        style={{
                          position: 'absolute',
                          width: 32,
                          height: 44,
                          borderRadius: 6,
                          border: '1.5px solid #06b6d4',
                          opacity: 0,
                          pointerEvents: 'none',
                          transformOrigin: 'center',
                          transition: 'transform 0.06s ease-out, opacity 0.06s ease-out',
                          boxShadow: '0 0 10px rgba(6, 182, 212, 0.25)'
                        }}
                      />
                    )}
                    <div style={{
                      width: 24,
                      height: 36,
                      background: dsp.spatial_enabled ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: dsp.spatial_enabled ? '1.5px solid #06b6d4' : '1px solid rgba(255,255,255,0.05)',
                      borderRadius: 4,
                      position: 'relative',
                      zIndex: 2
                    }} />
                    <span style={{ fontSize: 8, opacity: 0.5, display: 'block', marginTop: 2 }}>L</span>
                  </div>

                  {/* Right speaker */}
                  <div style={{
                    position: 'absolute',
                    top: 25,
                    right: 20,
                    textAlign: 'center',
                    transform: 'rotate(-25deg)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                  }}>
                    {!dsp.low_spec_mode && (
                      <div
                        ref={pulseRRef}
                        style={{
                          position: 'absolute',
                          width: 32,
                          height: 44,
                          borderRadius: 6,
                          border: '1.5px solid #06b6d4',
                          opacity: 0,
                          pointerEvents: 'none',
                          transformOrigin: 'center',
                          transition: 'transform 0.06s ease-out, opacity 0.06s ease-out',
                          boxShadow: '0 0 10px rgba(6, 182, 212, 0.25)'
                        }}
                      />
                    )}
                    <div style={{
                      width: 24,
                      height: 36,
                      background: dsp.spatial_enabled ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: dsp.spatial_enabled ? '1.5px solid #06b6d4' : '1px solid rgba(255,255,255,0.05)',
                      borderRadius: 4,
                      position: 'relative',
                      zIndex: 2
                    }} />
                    <span style={{ fontSize: 8, opacity: 0.5, display: 'block', marginTop: 2 }}>R</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Spatial sliders */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Crossfeed Panel */}
                <div className="settings-ctrl-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Linkwitz Headphone Crossfeed</h4>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Simulate dynamic speaker positioning in headphones.</p>
                    </div>
                    <button
                      onClick={() => setDSP({ crossfeed_enabled: !dsp.crossfeed_enabled, enabled: !dsp.crossfeed_enabled ? true : dsp.enabled })}
                      className="settings-btn"
                      style={{
                        fontSize: 10,
                        padding: '4px 10px',
                        background: dsp.crossfeed_enabled ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                        color: dsp.crossfeed_enabled ? '#06b6d4' : 'var(--text-dim)'
                      }}
                    >
                      {dsp.crossfeed_enabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {dsp.crossfeed_enabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                          <span style={{ color: 'var(--text-dim)' }}>Crossfeed Level</span>
                          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{dsp.crossfeed_level}dB</span>
                        </div>
                        <input
                          type="range" min="-12" max="-3" step="0.5"
                          value={dsp.crossfeed_level}
                          onChange={e => setDSP({ crossfeed_level: parseFloat(e.target.value) })}
                          style={{ width: '100%', accentColor: '#06b6d4' }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Haas Spatializer Panel */}
                <div className="settings-ctrl-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Haas Soundstage Expander</h4>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Width expansion using micro-second reflections.</p>
                    </div>
                    <button
                      onClick={() => setDSP({ spatial_enabled: !dsp.spatial_enabled, enabled: !dsp.spatial_enabled ? true : dsp.enabled })}
                      className="settings-btn"
                      style={{
                        fontSize: 10,
                        padding: '4px 10px',
                        background: dsp.spatial_enabled ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                        color: dsp.spatial_enabled ? '#a855f7' : 'var(--text-dim)'
                      }}
                    >
                      {dsp.spatial_enabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {dsp.spatial_enabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                          <span style={{ color: 'var(--text-dim)' }}>Precedence delay (Haas)</span>
                          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{dsp.spatial_haas_delay}ms</span>
                        </div>
                        <input
                          type="range" min="5" max="25" step="0.5"
                          value={dsp.spatial_haas_delay}
                          onChange={e => setDSP({ spatial_haas_delay: parseFloat(e.target.value) })}
                          style={{ width: '100%', accentColor: '#a855f7' }}
                        />
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                          <span style={{ color: 'var(--text-dim)' }}>Haas expansion intensity (Wet)</span>
                          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{Math.round(dsp.spatial_wet * 100)}%</span>
                        </div>
                        <input
                          type="range" min="0.0" max="1.0" step="0.05"
                          value={dsp.spatial_wet}
                          onChange={e => setDSP({ spatial_wet: parseFloat(e.target.value) })}
                          style={{ width: '100%', accentColor: '#a855f7' }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Impulse Response (IR) Convolution Panel */}
                <div className="settings-ctrl-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Disc size={15} style={{ color: '#10b981' }} />
                        Impulse Response (IR) Convolution Engine
                      </h4>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Load custom room acoustics & HRTF cabinet impulse profiles (.wav).</p>
                    </div>
                    <button
                      onClick={() => setDSP({ convolution_enabled: !dsp.convolution_enabled, enabled: !dsp.convolution_enabled ? true : dsp.enabled })}
                      className="settings-btn"
                      style={{
                        fontSize: 10,
                        padding: '4px 10px',
                        background: dsp.convolution_enabled ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                        color: dsp.convolution_enabled ? '#10b981' : 'var(--text-dim)'
                      }}
                    >
                      {dsp.convolution_enabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {dsp.convolution_enabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                          <span style={{ color: 'var(--text-dim)' }}>Active IR File</span>
                          <span style={{ color: dsp.convolution_ir_path ? '#10b981' : 'var(--text-dim)', fontWeight: 600, fontSize: 10 }}>
                            {dsp.convolution_ir_path ? dsp.convolution_ir_path.split(/[/\\]/).pop() : 'No File Selected'}
                          </span>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              const selected = await open({
                                multiple: false,
                                filters: [{ name: 'Audio Impulse Response', extensions: ['wav', 'flac'] }]
                              });
                              if (selected && typeof selected === 'string') {
                                setDSP({ convolution_ir_path: selected });
                              }
                            } catch (e) {
                              console.error('Failed to select IR file:', e);
                            }
                          }}
                          className="settings-btn"
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            padding: '8px 14px',
                            fontSize: 11,
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px dashed rgba(255,255,255,0.15)',
                            borderRadius: 6
                          }}
                        >
                          <FolderOpen size={14} />
                          {dsp.convolution_ir_path ? 'Change Impulse Response (.wav)' : 'Browse & Load IR File (.wav)'}
                        </button>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                          <span style={{ color: 'var(--text-dim)' }}>Convolution Blend (Wet Mix)</span>
                          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{Math.round(dsp.convolution_wet * 100)}%</span>
                        </div>
                        <input
                          type="range" min="0.0" max="1.0" step="0.05"
                          value={dsp.convolution_wet}
                          onChange={e => setDSP({ convolution_wet: parseFloat(e.target.value) })}
                          style={{ width: '100%', accentColor: '#10b981' }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'dynamics' && (
            <motion.div
              key="dynamics-tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, alignItems: 'start' }}
            >
              {/* Left Column: Draggable XY Morphing space */}
              <div className="settings-ctrl-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Acoustic XY Space Pad</h4>
                    <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>
                      Drag the glowing node to smoothly morph between spatial curves, compressed warm dynamics, or pure flats.
                    </p>
                  </div>
                  <button
                    onClick={resetDynamics}
                    className="settings-btn settings-btn-danger"
                    style={{ fontSize: 10, padding: '6px 12px' }}
                  >
                    Reset Dynamics & XY
                  </button>
                </div>

                {/* Pad grid */}
                <div
                  ref={xyPadRef}
                  onMouseDown={() => setIsDraggingXY(true)}
                  onMouseMove={handleXYMouseMove}
                  onMouseUp={() => setIsDraggingXY(false)}
                  onMouseLeave={() => setIsDraggingXY(false)}
                  style={{
                    position: 'relative',
                    width: 220,
                    height: 220,
                    background: 'var(--glass)',
                    borderRadius: 14,
                    border: '1px solid var(--glass-border)',
                    cursor: isDraggingXY ? 'grabbing' : 'grab',
                    overflow: 'hidden'
                  }}
                >
                  {/* Grid quadrants lines */}
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--glass-border)' }} />
                  <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--glass-border)' }} />

                  {/* Corner Labels */}
                  <div style={{ position: 'absolute', top: 10, left: 10, fontSize: 9, color: 'var(--text-dim)', fontWeight: 700 }}>SPATIAL & BRIGHT</div>
                  <div style={{ position: 'absolute', top: 10, right: 10, fontSize: 9, color: 'var(--text-dim)', fontWeight: 700 }}>WARM & COMPRESSED</div>
                  <div style={{ position: 'absolute', bottom: 10, left: 10, fontSize: 9, color: 'var(--text-dim)', fontWeight: 700 }}>DEEP BASS BOOST</div>
                  <div style={{ position: 'absolute', bottom: 10, right: 10, fontSize: 9, color: 'var(--text-dim)', fontWeight: 700 }}>PURE FLAT</div>

                  {/* Glowing Cursor Node */}
                  <div
                    style={{
                      position: 'absolute',
                      left: `${xyPos.x * 100}%`,
                      top: `${xyPos.y * 100}%`,
                      transform: 'translate(-50%, -50%)',
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'white',
                      boxShadow: `0 0 16px ${accentColor || '#8b5cf6'}, 0 0 4px white`,
                      border: '2px solid rgba(0,0,0,0.6)',
                      pointerEvents: 'none',
                      transition: isDraggingXY ? 'none' : 'all 0.15s ease'
                    }}
                  />
                </div>

                <div style={{
                  marginTop: 18,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--text)',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: '1px solid rgba(255,255,255,0.04)'
                }}>
                  Current: <span style={{ color: accentColor || 'var(--dynamic-accent)' }}>{getActiveXYLabel()}</span>
                </div>
              </div>

              {/* Right Column: Subsonic & Dynamic parameters */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Butterworth subsonic filter */}
                <div className="settings-ctrl-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Butterworth Subsonic Filter</h4>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Cuts inaudible sub-18Hz rumble to save amplifier headroom.</p>
                    </div>
                    <button
                      onClick={() => setDSP({ subsonic_enabled: !dsp.subsonic_enabled, enabled: !dsp.subsonic_enabled ? true : dsp.enabled })}
                      className="settings-btn"
                      style={{
                        fontSize: 10,
                        padding: '4px 10px',
                        background: dsp.subsonic_enabled ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                        color: dsp.subsonic_enabled ? '#34d399' : 'var(--text-dim)'
                      }}
                    >
                      {dsp.subsonic_enabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>
                </div>

                {/* Night-mode dynamic compressor */}
                <div className="settings-ctrl-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Night Mode Dynamic Compressor</h4>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>High ratio compression protecting ears from volume spikes.</p>
                    </div>
                    <button
                      onClick={() => setDSP({ night_mode_enabled: !dsp.night_mode_enabled, enabled: !dsp.night_mode_enabled ? true : dsp.enabled })}
                      className="settings-btn"
                      style={{
                        fontSize: 10,
                        padding: '4px 10px',
                        background: dsp.night_mode_enabled ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                        color: dsp.night_mode_enabled ? '#a855f7' : 'var(--text-dim)'
                      }}
                    >
                      {dsp.night_mode_enabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>
                </div>

                {/* EBU R128 Normalizer */}
                <div className="settings-ctrl-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>EBU R128 Loudness Normalizer</h4>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Slow Automatic Gain Control to match uniform track loudness.</p>
                    </div>
                    <button
                      onClick={() => setDSP({ r128_enabled: !dsp.r128_enabled, enabled: !dsp.r128_enabled ? true : dsp.enabled })}
                      className="settings-btn"
                      style={{
                        fontSize: 10,
                        padding: '4px 10px',
                        background: dsp.r128_enabled ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                        color: dsp.r128_enabled ? '#60a5fa' : 'var(--text-dim)'
                      }}
                    >
                      {dsp.r128_enabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>
                </div>

                {/* Digital Preamp & Peak Limiter Headroom */}
                <div className="settings-ctrl-card" style={{ padding: 20 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>Preamp & Safety Limiter</h4>
                  
                  {/* Preamp Gain */}
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Digital Preamp Gain</span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                          Attenuates signal to create digital headroom, avoiding clipping before EQ processing.
                        </span>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                        {dsp.preamp_gain.toFixed(1)} dB
                      </span>
                    </div>
                    <input
                      type="range" min="-12.0" max="0.0" step="0.1"
                      value={dsp.preamp_gain}
                      disabled={!dsp.enabled}
                      onChange={e => setDSP({ preamp_gain: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: dsp.enabled ? 'pointer' : 'default', opacity: dsp.enabled ? 1 : 0.5 }}
                    />
                  </div>

                  {/* Auto-Headroom Guard */}
                  <div style={{ marginBottom: 18, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Auto-Headroom Guard</span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                          Automatically attenuates preamp gain based on positive EQ boosts to prevent digital clipping.
                        </span>
                      </div>
                      <button
                        onClick={() => setDSP({ auto_headroom: !dsp.auto_headroom, enabled: !dsp.auto_headroom ? true : dsp.enabled })}
                        className="settings-btn"
                        style={{
                          fontSize: 10,
                          padding: '4px 10px',
                          background: dsp.auto_headroom ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                          color: dsp.auto_headroom ? '#34d399' : 'var(--text-dim)'
                        }}
                      >
                        {dsp.auto_headroom ? 'ENABLED' : 'DISABLED'}
                      </button>
                    </div>
                  </div>

                  {/* Limiter Threshold */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Limiter Threshold</span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                          Dynamic lookahead threshold to prevent clipping while maximizing analog output.
                        </span>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                        {dsp.limiter_threshold.toFixed(1)} dB
                      </span>
                    </div>
                    <input
                      type="range" min="-6.0" max="0.0" step="0.1"
                      value={dsp.limiter_threshold}
                      disabled={!dsp.enabled}
                      onChange={e => setDSP({ limiter_threshold: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: dsp.enabled ? 'pointer' : 'default', opacity: dsp.enabled ? 1 : 0.5 }}
                    />
                  </div>
                </div>

                {/* Resampler Phase Response Mode */}
                <div className="settings-ctrl-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Resampler Phase Response</h4>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        Controls pre/post-ringing filtering characteristics during high-resolution upsampling.
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.02)', padding: 3, borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.04)', gap: 4 }}>
                    {[
                      { id: 'linear', label: 'Linear Phase', desc: 'Symmetric pre-ringing, traditional' },
                      { id: 'minimum', label: 'Minimum Phase', desc: 'No pre-ringing, natural decay' },
                      { id: 'intermediate', label: 'Intermediate', desc: 'Optimized hybrid balance' }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setDSP({ resampler_phase_mode: opt.id as any })}
                        disabled={!dsp.enabled}
                        title={opt.desc}
                        style={{
                          flex: 1,
                          background: dsp.resampler_phase_mode === opt.id ? 'rgba(255, 255, 255, 0.07)' : 'transparent',
                          border: 'none',
                          color: dsp.resampler_phase_mode === opt.id ? 'white' : 'var(--text-dim)',
                          padding: '6px 8px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 600,
                          cursor: dsp.enabled ? 'pointer' : 'default',
                          opacity: dsp.enabled ? 1 : 0.5,
                          transition: 'all 0.15s'
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Crossfade Transitions */}
                <div className="settings-ctrl-card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div>
                      <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Seamless Crossfade Transitions</h4>
                      <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                        Fades out the current track while fading in the next track to eliminate gaps.
                      </p>
                    </div>
                    <button
                      onClick={() => setDSP({ crossfade_transition_enabled: !dsp.crossfade_transition_enabled, enabled: !dsp.crossfade_transition_enabled ? true : dsp.enabled })}
                      className="settings-btn"
                      style={{
                        fontSize: 10,
                        padding: '4px 10px',
                        background: dsp.crossfade_transition_enabled ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
                        color: dsp.crossfade_transition_enabled ? '#a78bfa' : 'var(--text-dim)'
                      }}
                    >
                      {dsp.crossfade_transition_enabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Crossfade Duration</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                        {dsp.crossfade_transition_duration.toFixed(1)} seconds
                      </span>
                    </div>
                    <input
                      type="range" min="2.0" max="10.0" step="0.5"
                      value={dsp.crossfade_transition_duration}
                      disabled={!dsp.crossfade_transition_enabled}
                      onChange={e => setDSP({ crossfade_transition_duration: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: dsp.crossfade_transition_enabled ? 'pointer' : 'default', opacity: dsp.crossfade_transition_enabled ? 1 : 0.5 }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}


          {activeTab === 'aideo_filter' && (
            <motion.div
              key="aideo-filter-tab"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
            >
              {/* Aideo Filter Panel */}
              <div className="settings-ctrl-card" style={{ padding: 28, position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Sparkles size={18} style={{ color: 'var(--accent)' }} />
                      Aideo Filter: Live Arena Sound Simulator
                    </h3>
                    <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                      Calibrate acoustic parameters to simulate physical room reflections, wide line-array speakers, and deep subwoofer vibrations.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => {
                        setDSP({
                          aideo_filter_enabled: false,
                          aideo_filter_room_size: 0.85,
                          aideo_filter_bass_thump: 6.0,
                          aideo_filter_dampening: 0.5
                        });
                        window.dispatchEvent(new CustomEvent('ui-toast', { 
                          detail: { message: 'Aideo Filter settings restored to defaults.', type: 'success' } 
                        }));
                      }}
                      className="settings-btn settings-btn-danger"
                      style={{ fontSize: 11, padding: '6px 12px' }}
                    >
                      Reset Filter
                    </button>
                    <button
                      onClick={() => setDSP({ aideo_filter_enabled: !dsp.aideo_filter_enabled, enabled: !dsp.aideo_filter_enabled ? true : dsp.enabled })}
                      className="settings-btn"
                      style={{
                        fontSize: 11,
                        padding: '6px 12px',
                        background: dsp.aideo_filter_enabled ? 'rgba(139, 92, 246, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: dsp.aideo_filter_enabled ? '#a78bfa' : '#f87171',
                        border: 'none',
                        fontWeight: 700
                      }}
                    >
                      Filter: {dsp.aideo_filter_enabled ? 'ACTIVE' : 'BYPASSED'}
                    </button>
                  </div>
                </div>

                {/* Settings sliders */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 12 }}>
                  {/* 1. Room Size / Arena Scale */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Arena Scale & Reflection Delay</span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                          Controls the physical size of the room and the delay times of early wall reflections.
                        </span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                        {Math.round((dsp.aideo_filter_room_size - 0.5) / 0.45 * 100)}% ({dsp.aideo_filter_room_size.toFixed(2)})
                      </span>
                    </div>
                    <input
                      type="range" min="0.5" max="0.95" step="0.01"
                      value={dsp.aideo_filter_room_size}
                      disabled={!dsp.aideo_filter_enabled}
                      onChange={e => setDSP({ aideo_filter_room_size: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: dsp.aideo_filter_enabled ? 'pointer' : 'default', opacity: dsp.aideo_filter_enabled ? 1 : 0.5 }}
                    />
                  </div>

                  {/* 2. Bass Thump / Subwoofer Intensity */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Subwoofer Intensity (Chest Thump)</span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                          Boosts sub-bass frequencies around 55Hz to simulate the chest-vibrating impact of stadium subwoofers.
                        </span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                        +{dsp.aideo_filter_bass_thump.toFixed(1)} dB
                      </span>
                    </div>
                    <input
                      type="range" min="0.0" max="12.0" step="0.5"
                      value={dsp.aideo_filter_bass_thump}
                      disabled={!dsp.aideo_filter_enabled}
                      onChange={e => setDSP({ aideo_filter_bass_thump: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: dsp.aideo_filter_enabled ? 'pointer' : 'default', opacity: dsp.aideo_filter_enabled ? 1 : 0.5 }}
                    />
                  </div>

                  {/* 3. Reverb Dampening / Crowd Density */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Acoustic Absorption & Crowd Dampening</span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                          Simulates how packed the stadium is. Higher values model more absorption (warmer sound, shorter decay).
                        </span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                        {Math.round((dsp.aideo_filter_dampening - 0.1) / 0.8 * 100)}% ({dsp.aideo_filter_dampening.toFixed(2)})
                      </span>
                    </div>
                    <input
                      type="range" min="0.1" max="0.9" step="0.01"
                      value={dsp.aideo_filter_dampening}
                      disabled={!dsp.aideo_filter_enabled}
                      onChange={e => setDSP({ aideo_filter_dampening: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: dsp.aideo_filter_enabled ? 'pointer' : 'default', opacity: dsp.aideo_filter_enabled ? 1 : 0.5 }}
                    />
                  </div>
                </div>

                {/* Real-time notice */}
                <div style={{
                  marginTop: 24,
                  background: 'rgba(255, 255, 255, 0.02)',
                  padding: '12px 18px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.04)',
                  fontSize: 11,
                  color: 'var(--text-dim)',
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700 }}>💡 Real-time Notice:</span>
                  <span>Adjustments will apply on the next track play, or automatically within a second on seek or track skip.</span>
                </div>
              </div>

              {/* Vacuum Tube Saturation Card */}
              <div className="settings-ctrl-card" style={{ padding: 28, marginTop: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Power size={18} style={{ color: 'var(--accent)' }} />
                      Vacuum Tube Analog Saturation
                    </h3>
                    <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                      Simulate the warm harmonic characteristics of high-end triode vacuum tube pre-amplifiers.
                    </p>
                  </div>
                  <button
                    onClick={() => setDSP({ saturation_enabled: !dsp.saturation_enabled, enabled: !dsp.saturation_enabled ? true : dsp.enabled })}
                    className="settings-btn"
                    style={{
                      fontSize: 11,
                      padding: '6px 12px',
                      background: dsp.saturation_enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: dsp.saturation_enabled ? '#34d399' : '#f87171',
                      border: 'none',
                      fontWeight: 700
                    }}
                  >
                    Tube Simulation: {dsp.saturation_enabled ? 'ACTIVE' : 'BYPASSED'}
                  </button>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Harmonic Drive & Warmth Intensity</span>
                      <span style={{ display: 'block', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                        Increasing drive generates pleasant 2nd-order harmonics and soft-compresses peaks.
                      </span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>
                      {Math.round(dsp.saturation_drive * 100)}%
                    </span>
                  </div>
                  <input
                    type="range" min="0.0" max="1.0" step="0.01"
                    value={dsp.saturation_drive}
                    disabled={!dsp.saturation_enabled}
                    onChange={e => setDSP({ saturation_drive: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: 'var(--accent)', cursor: dsp.saturation_enabled ? 'pointer' : 'default', opacity: dsp.saturation_enabled ? 1 : 0.5 }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
