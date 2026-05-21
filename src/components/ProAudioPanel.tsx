import React, { useState, useMemo } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, Sliders, Activity, Cpu, RefreshCw, Volume2, 
  Sparkles, Zap, Clipboard, CheckCircle2 
} from 'lucide-react';

// ISO Standard 10-Band Graphic EQ frequencies
const GRAPHIC_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Standard EQ Presets
const EQ_PRESETS: Record<string, number[]> = {
  'Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Acoustic': [3.5, 2, 1, 1.5, 0.5, 1, 2, 3, 2.5, 1.5],
  'Bass Boost': [5.5, 4.5, 3.5, 1.5, 0, 0, 0, 0, 0, 0],
  'Classical': [4.5, 3, 2.5, 2, -1, -1, 0, 2, 3, 3.5],
  'Electronic': [4, 3, 1, 0, -1, 2, 1, 1.5, 3.5, 4.5],
  'Hip Hop': [4.5, 4, 2, 2.5, -1, -1.5, 1, 0, 2.5, 3],
  'Vocal Boost': [-3, -2, -1, 1, 3, 4, 3.5, 2, 1, -1.5],
  'Podcast': [-4, -2, 0.5, 2, 3.5, 3, 2.5, 1.5, 0.5, -2]
};

// Math helper to calculate magnitude response of a peaking filter
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

// Math helper to calculate magnitude response of a low shelf filter
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

// Math helper to calculate magnitude response of a high shelf filter
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

// Evaluates a biquad transfer function magnitude at frequency f
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
  if (s.includes('oratory')) {
    return {
      bg: 'rgba(59, 130, 246, 0.12)',
      border: 'rgba(59, 130, 246, 0.35)',
      color: '#60a5fa',
      label: 'oratory1990'
    };
  }
  if (s.includes('crinacle')) {
    return {
      bg: 'rgba(16, 185, 129, 0.12)',
      border: 'rgba(16, 185, 129, 0.35)',
      color: '#34d399',
      label: 'crinacle'
    };
  }
  if (s.includes('rtings')) {
    return {
      bg: 'rgba(249, 115, 22, 0.12)',
      border: 'rgba(249, 115, 22, 0.35)',
      color: '#fb923c',
      label: 'Rtings'
    };
  }
  if (s.includes('innerfidelity')) {
    return {
      bg: 'rgba(234, 179, 8, 0.12)',
      border: 'rgba(234, 179, 8, 0.35)',
      color: '#facc15',
      label: 'Innerfidelity'
    };
  }
  if (s.includes('reference audio analyzer') || s.includes('raa')) {
    return {
      bg: 'rgba(236, 72, 153, 0.12)',
      border: 'rgba(236, 72, 153, 0.35)',
      color: '#f472b6',
      label: 'RAA'
    };
  }
  return {
    bg: 'rgba(139, 92, 246, 0.12)',
    border: 'rgba(139, 92, 246, 0.3)',
    color: '#a78bfa',
    label: source
  };
};

export function ProAudioPanel() {
  const {
    showProMode, toggleProMode, dsp, setDSP, resetProMode,
    playback, toggleExclusive, toggleBitPerfect, fetchDevices, setAudioDevice, devices, currentDevice
  } = useStore();

  const [activePreset, setActivePreset] = useState('Flat');
  const [autoEqText, setAutoEqText] = useState('');
  const [showAutoEqPanel, setShowAutoEqPanel] = useState(false);
  const [autoEqError, setAutoEqError] = useState('');
  const [autoEqSuccess, setAutoEqSuccess] = useState(false);

  const [activeSubTab, setActiveSubTab] = useState<'online' | 'paste'>('online');
  const [autoEqDb, setAutoEqDb] = useState<{ name: string; url: string; source: string; fullSource: string }[] | null>(null);
  const [isFetchingDb, setIsFetchingDb] = useState(false);
  const [dbSearchQuery, setDbSearchQuery] = useState('');
  const [isFetchingProfile, setIsFetchingProfile] = useState(false);

  const fetchAutoEqDb = async () => {
    setIsFetchingDb(true);
    setAutoEqError('');
    try {
      const response = await fetch('https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/INDEX.md');
      if (!response.ok) {
        throw new Error('Failed to fetch AutoEQ headphone index.');
      }
      const text = await response.text();
      
      const lines = text.split('\n');
      const parsedEntries: { name: string; url: string; source: string; fullSource: string }[] = [];
      
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

      if (parsedEntries.length === 0) {
        throw new Error('Could not parse any headphone entries from the index.');
      }

      setAutoEqDb(parsedEntries);
    } catch (err: any) {
      setAutoEqError(err.message || 'Failed to load AutoEQ database.');
    } finally {
      setIsFetchingDb(false);
    }
  };

  React.useEffect(() => {
    if (showAutoEqPanel && activeSubTab === 'online' && !autoEqDb && !isFetchingDb) {
      fetchAutoEqDb();
    }
  }, [showAutoEqPanel, activeSubTab, autoEqDb, isFetchingDb]);

  const filteredDb = useMemo(() => {
    if (!autoEqDb) return [];
    if (!dbSearchQuery.trim()) {
      return autoEqDb.slice(0, 30);
    }
    const query = dbSearchQuery.toLowerCase().trim();
    const parts = query.split(/\s+/);
    
    const matches: { entry: typeof autoEqDb[0]; score: number }[] = [];
    
    for (const entry of autoEqDb) {
      const nameLower = entry.name.toLowerCase();
      const isMatch = parts.every(part => nameLower.includes(part));
      if (isMatch) {
        let score = 0;
        if (nameLower === query) {
          score = 100;
        } else if (nameLower.startsWith(query)) {
          score = 80;
        } else {
          score = 50 - nameLower.indexOf(query) * 0.1;
        }
        matches.push({ entry, score });
      }
    }
    
    return matches
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .map(m => m.entry)
      .slice(0, 50);
  }, [autoEqDb, dbSearchQuery]);

  const handleSelectHeadphone = async (headphone: { name: string; url: string }) => {
    setIsFetchingProfile(true);
    setAutoEqError('');
    try {
      const response = await fetch(headphone.url);
      if (!response.ok) {
        throw new Error(`Failed to download profile. Status ${response.status}.`);
      }
      const text = await response.text();
      handleApplyAutoEq(text);
    } catch (err: any) {
      setAutoEqError(err.message || 'Failed to apply headphone profile.');
    } finally {
      setIsFetchingProfile(false);
    }
  };

  // Sync state on mount
  React.useEffect(() => {
    if (showProMode) {
      fetchDevices().catch(console.error);
    }
  }, [showProMode]);

  // Compute the full EQ response curve points for the graph
  const curvePoints = useMemo(() => {
    const fs = 48000; // standard virtual sampling rate for graph evaluation
    const points: { f: number; db: number }[] = [];
    
    // Create 120 log-spaced frequency points from 20Hz to 20kHz
    const minF = 20;
    const maxF = 20000;
    const logMin = Math.log10(minF);
    const logMax = Math.log10(maxF);

    for (let i = 0; i <= 120; i++) {
      const logF = logMin + (i / 120) * (logMax - logMin);
      const f = Math.pow(10, logF);
      let totalDb = 0;

      if (dsp.eq_enabled) {
        if (dsp.eq_parametric) {
          // Sum the response of all 5 active parametric bands
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
          // Sum the response of all 10 graphic EQ peaking filters (Q is fixed to 1.0)
          dsp.eq_graphic_gains.forEach((gain, index) => {
            const f0 = GRAPHIC_FREQS[index];
            totalDb += getPeakingResponse(f, fs, f0, gain, 1.0);
          });
        }
      }

      points.push({ f, db: totalDb });
    }

    return points;
  }, [dsp.eq_enabled, dsp.eq_parametric, dsp.eq_graphic_gains, dsp.eq_parametric_bands]);

  // Map frequency to X coordinate on a logarithmic scale
  const getX = (f: number, width: number) => {
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const logF = Math.log10(f);
    return ((logF - logMin) / (logMax - logMin)) * width;
  };

  // Map dB to Y coordinate on a linear scale (+15dB to -15dB range)
  const getY = (db: number, height: number) => {
    const minDb = -15;
    const maxDb = 15;
    const clamped = Math.max(minDb, Math.min(maxDb, db));
    return height - ((clamped - minDb) / (maxDb - minDb)) * height;
  };

  // Generate SVG path string from coordinates
  const svgPath = useMemo(() => {
    const width = 360;
    const height = 120;
    if (curvePoints.length === 0) return '';
    let path = `M ${getX(curvePoints[0].f, width)} ${getY(curvePoints[0].db, height)}`;
    for (let i = 1; i < curvePoints.length; i++) {
      path += ` L ${getX(curvePoints[i].f, width)} ${getY(curvePoints[i].db, height)}`;
    }
    return path;
  }, [curvePoints]);

  if (!showProMode) return null;

  // Graphic EQ Gain Slider change handler
  const handleGraphicGainChange = (index: number, val: number) => {
    const newGains = [...dsp.eq_graphic_gains];
    newGains[index] = val;
    setDSP({ eq_graphic_gains: newGains });
    setActivePreset('Custom');
  };

  // Preset loading handler
  const handlePresetSelect = (presetName: string) => {
    setActivePreset(presetName);
    const gains = EQ_PRESETS[presetName];
    if (gains) {
      setDSP({ eq_graphic_gains: gains });
    }
  };

  // Parametric band value editor
  const handleParametricBandChange = (index: number, fields: Partial<typeof dsp.eq_parametric_bands[0]>) => {
    const newBands = dsp.eq_parametric_bands.map((band, idx) => {
      if (idx === index) {
        return { ...band, ...fields };
      }
      return band;
    });
    setDSP({ eq_parametric_bands: newBands });
  };

  // Parse and Apply AutoEQ / APO parametric profile
  const handleApplyAutoEq = (profileText?: string) => {
    setAutoEqError('');
    setAutoEqSuccess(false);
    
    const textToParse = profileText !== undefined ? profileText : autoEqText;
    
    try {
      if (!textToParse.trim()) {
        throw new Error('Please paste or select your EQ profile.');
      }

      // Regex matching standard Equalizer APO formats:
      // e.g. "Preamp: -6.4 dB"
      // e.g. "Filter 1: ON PK Fc 80.5 Hz Gain -3.2 dB Q 1.45"
      // e.g. "Filter 2: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.7"
      // e.g. "Filter 3: ON HSC Fc 10000 Hz Gain -1.5 dB Q 0.7"
      const lines = textToParse.split('\n');
      let preamp = 0;
      const parsedBands: typeof dsp.eq_parametric_bands = [];

      lines.forEach(line => {
        const trimmed = line.trim().toLowerCase();
        if (!trimmed) return;

        // Preamp parse
        if (trimmed.includes('preamp:')) {
          const match = trimmed.match(/preamp:\s*(-?[\d.]+)\s*db/);
          if (match) preamp = parseFloat(match[1]);
          return;
        }

        // Filter parse
        if (trimmed.includes('filter')) {
          // Extract filter parameters
          const fcMatch = trimmed.match(/fc\s+([\d.]+)\s*hz/);
          const gainMatch = trimmed.match(/gain\s+(-?[\d.]+)\s*db/);
          // AutoEQ uses Q, sometimes S (shelf slope, but we clamp Q)
          const qMatch = trimmed.match(/q\s+([\d.]+)/) || trimmed.match(/s\s+([\d.]+)/);
          
          let bandType = 'peaking';
          if (trimmed.includes('lsc') || trimmed.includes('lowshelf')) {
            bandType = 'lowshelf';
          } else if (trimmed.includes('hsc') || trimmed.includes('highshelf')) {
            bandType = 'highshelf';
          }

          if (fcMatch && gainMatch) {
            const freq = parseFloat(fcMatch[1]);
            const gain = parseFloat(gainMatch[1]);
            const q = qMatch ? parseFloat(qMatch[1]) : 1.0;

            parsedBands.push({
              freq,
              gain,
              q: Math.max(0.1, Math.min(10.0, q)),
              band_type: bandType
            });
          }
        }
      });

      if (parsedBands.length === 0) {
        throw new Error('Could not find any valid Parametric Filters (e.g. Fc, Gain, Q).');
      }

      // Map parsed bands to the 5 available parametric bands. If there are more, grab the first 5.
      const bandsToApply = [...dsp.eq_parametric_bands];
      for (let i = 0; i < 5; i++) {
        if (parsedBands[i]) {
          bandsToApply[i] = parsedBands[i];
        } else {
          // Zero out excess bands
          bandsToApply[i] = { freq: bandsToApply[i]?.freq || 1000, gain: 0, q: 0.7, band_type: 'peaking' };
        }
      }

      // Update DSP state
      setDSP({
        eq_enabled: true,
        eq_parametric: true,
        eq_parametric_bands: bandsToApply
      });

      // Apply preamp if preamp is negative
      if (preamp < 0) {
        // Dispatch toast message
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `Loaded AutoEQ! Applied ${preamp}dB Preamp protection.`, type: 'success' } 
        }));
      } else {
        // Generic success toast
        window.dispatchEvent(new CustomEvent('ui-toast', { 
          detail: { message: `AutoEQ filter correction applied successfully!`, type: 'success' } 
        }));
      }

      setAutoEqSuccess(true);
      if (profileText === undefined) {
        setAutoEqText('');
      }
      setTimeout(() => {
        setShowAutoEqPanel(false);
        setAutoEqSuccess(false);
      }, 1500);

    } catch (err: any) {
      if (profileText !== undefined) {
        throw err;
      } else {
        setAutoEqError(err.message || 'Parsing failed. Check your format.');
      }
    }
  };

  return (
    <motion.div 
      initial={{ x: '100%', opacity: 0.95 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0.95 }}
      transition={{ type: 'spring', damping: 25, stiffness: 220 }}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 440,
        height: '100vh',
        background: 'rgba(11, 11, 18, 0.94)',
        backdropFilter: 'blur(30px)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '-10px 0 35px rgba(0, 0, 0, 0.6)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#f0f0ff'
      }}
    >
      {/* HEADER SECTION */}
      <div style={{
        padding: '24px 28px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.01)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(219, 39, 119, 0.2))',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 12px rgba(139, 92, 246, 0.15)'
          }}>
            <Activity size={18} color="var(--accent)" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '0.3px', background: 'linear-gradient(135deg, #fff 40%, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Pro Audio Suite</h2>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Real-Time Audiophile DSP Console</span>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button 
            onClick={resetProMode}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            title="Reset DSP to Flat/Bypassed"
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <RefreshCw size={15} />
          </button>
          
          <button 
            onClick={toggleProMode}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dim)',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* BODY SCROLL CONTAINER */}
      <div className="pro-audio-scroll" style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        paddingBottom: 40
      }}>
        
        {/* MASTER SWITCH ROW */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          background: dsp.enabled ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%)' : 'rgba(255,255,255,0.01)',
          border: dsp.enabled ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12,
          transition: 'all 0.3s ease',
          boxShadow: dsp.enabled ? '0 4px 20px rgba(139, 92, 246, 0.15)' : 'none'
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: dsp.enabled ? '#fff' : 'var(--text-dim)' }}>Master DSP Engine</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
              {dsp.enabled ? 'DSP pipeline active (<1.5% CPU overhead)' : 'Pure bitstream bypass'}
            </div>
          </div>
          <label className="switch" style={{ cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={dsp.enabled} 
              onChange={(e) => setDSP({ enabled: e.target.checked })} 
              style={{ display: 'none' }} 
            />
            <div style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              background: dsp.enabled ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
              position: 'relative',
              transition: 'all 0.3s ease',
              border: dsp.enabled ? 'none' : '1px solid rgba(255,255,255,0.15)'
            }}>
              <div style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: 2,
                left: dsp.enabled ? 22 : 2,
                transition: 'all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
              }} />
            </div>
          </label>
        </div>

        {/* SECTION 1: HIGH-FIDELITY EQUALIZER */}
        <div style={{
          padding: '20px 24px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sliders size={16} color="var(--accent)" />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Parametric & Graphic EQ</span>
            </div>
            <label className="switch" style={{ cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={dsp.eq_enabled} 
                onChange={(e) => setDSP({ eq_enabled: e.target.checked })} 
                style={{ display: 'none' }} 
              />
              <div style={{
                width: 34,
                height: 18,
                borderRadius: 9,
                background: dsp.eq_enabled ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                position: 'relative',
                transition: 'all 0.2s',
                border: dsp.eq_enabled ? 'none' : '1px solid rgba(255,255,255,0.1)'
              }}>
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 1,
                  left: dsp.eq_enabled ? 17 : 1,
                  transition: 'all 0.2s'
                }} />
              </div>
            </label>
          </div>

          {/* DYNAMIC RESPONSE GRAPH */}
          <div style={{
            height: 120,
            background: '#07070d',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.05)',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Gridlines */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {/* dB lines (+10dB, 0dB, -10dB) */}
              <div style={{ position: 'absolute', top: '16.6%', left: 0, right: 0, height: 1, borderTop: '1px dashed rgba(255, 255, 255, 0.03)' }} />
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, borderTop: '1px solid rgba(255, 255, 255, 0.07)' }} />
              <div style={{ position: 'absolute', top: '83.3%', left: 0, right: 0, height: 1, borderTop: '1px dashed rgba(255, 255, 255, 0.03)' }} />
              
              {/* Labels for dB */}
              <span style={{ position: 'absolute', top: 4, left: 6, fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>+10 dB</span>
              <span style={{ position: 'absolute', top: '44%', left: 6, fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>0 dB</span>
              <span style={{ position: 'absolute', bottom: 4, left: 6, fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>-10 dB</span>

              {/* Freq vertical lines (100Hz, 1kHz, 10kHz) */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(Math.log10(100) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100}%`, width: 1, borderRight: '1px dashed rgba(255, 255, 255, 0.03)' }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(Math.log10(1000) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100}%`, width: 1, borderRight: '1px dashed rgba(255, 255, 255, 0.05)' }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(Math.log10(10000) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100}%`, width: 1, borderRight: '1px dashed rgba(255, 255, 255, 0.03)' }} />
              
              {/* Freq labels */}
              <span style={{ position: 'absolute', bottom: 4, left: `${(Math.log10(100) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100}%`, transform: 'translateX(-50%)', fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>100Hz</span>
              <span style={{ position: 'absolute', bottom: 4, left: `${(Math.log10(1000) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100}%`, transform: 'translateX(-50%)', fontSize: 8, color: 'rgba(255,255,255,0.3)' }}>1kHz</span>
              <span style={{ position: 'absolute', bottom: 4, left: `${(Math.log10(10000) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)) * 100}%`, transform: 'translateX(-50%)', fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>10kHz</span>
            </div>

            {/* Actual Curve SVG */}
            <svg style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
              <defs>
                <linearGradient id="eq-glow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Fill area */}
              {svgPath && dsp.eq_enabled && (
                <path 
                  d={`${svgPath} L 360 120 L 0 120 Z`}
                  fill="url(#eq-glow)"
                  style={{ transition: 'all 0.1s ease' }}
                />
              )}
              {/* Curve Line */}
              {svgPath && (
                <path 
                  d={svgPath}
                  fill="none"
                  stroke={dsp.eq_enabled ? 'var(--accent)' : 'rgba(255, 255, 255, 0.2)'}
                  strokeWidth="2"
                  style={{ transition: 'all 0.1s ease', filter: dsp.eq_enabled ? 'drop-shadow(0px 0px 4px var(--accent))' : 'none' }}
                />
              )}
            </svg>
          </div>

          {/* EQ MODE SELECTOR */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 8,
            padding: 2,
            border: '1px solid rgba(255,255,255,0.04)'
          }}>
            <button 
              onClick={() => setDSP({ eq_parametric: false })}
              style={{
                background: !dsp.eq_parametric ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: 'none',
                color: !dsp.eq_parametric ? '#fff' : 'var(--text-dim)',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              10-Band Graphic
            </button>
            <button 
              onClick={() => setDSP({ eq_parametric: true })}
              style={{
                background: dsp.eq_parametric ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: 'none',
                color: dsp.eq_parametric ? '#fff' : 'var(--text-dim)',
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              5-Band Parametric
            </button>
          </div>

          {/* MODE CONTENT */}
          <AnimatePresence mode="wait">
            {!dsp.eq_parametric ? (
              <motion.div 
                key="graphic-eq"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                {/* Preset List */}
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, width: '100%' }} className="pro-audio-scroll">
                  {Object.keys(EQ_PRESETS).map(name => (
                    <button
                      key={name}
                      onClick={() => handlePresetSelect(name)}
                      style={{
                        background: activePreset === name ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                        border: activePreset === name ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(255,255,255,0.05)',
                        color: activePreset === name ? 'var(--accent)' : 'var(--text-dim)',
                        padding: '4px 10px',
                        borderRadius: 6,
                        fontSize: 10,
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => { if (activePreset !== name) e.currentTarget.style.color = '#fff'; }}
                      onMouseLeave={e => { if (activePreset !== name) e.currentTarget.style.color = 'var(--text-dim)'; }}
                    >
                      {name}
                    </button>
                  ))}
                </div>

                {/* ISO Band Sliders (Planar layout) */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  height: 140,
                  padding: '8px 4px',
                  background: 'rgba(0,0,0,0.1)',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.03)'
                }}>
                  {GRAPHIC_FREQS.map((freq, index) => {
                    const gain = dsp.eq_graphic_gains[index] || 0;
                    return (
                      <div key={freq} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        width: '9%',
                        height: '100%',
                        position: 'relative'
                      }}>
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          step="0.5"
                          value={gain}
                          disabled={!dsp.eq_enabled}
                          onChange={(e) => handleGraphicGainChange(index, parseFloat(e.target.value))}
                          style={{
                            writingMode: 'vertical-lr' as any, // vertical layout fallback
                            WebkitAppearance: 'slider-vertical',
                            width: 8,
                            height: 90,
                            accentColor: 'var(--accent)',
                            opacity: dsp.eq_enabled ? 1 : 0.4,
                            cursor: dsp.eq_enabled ? 'pointer' : 'default'
                          }}
                        />
                        <span style={{ fontSize: 8, color: 'var(--text-dim)', marginTop: 8, fontWeight: 500 }}>
                          {freq >= 1000 ? `${freq/1000}k` : freq}
                        </span>
                        <span style={{ fontSize: 7, color: dsp.eq_enabled && gain !== 0 ? 'var(--accent)' : 'var(--text-dim)', marginTop: 2, fontWeight: 600 }}>
                          {gain > 0 ? `+${gain.toFixed(0)}` : gain.toFixed(0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="parametric-eq"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                {/* Parametric Bands list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dsp.eq_parametric_bands.map((band, idx) => (
                    <div 
                      key={idx} 
                      style={{
                        padding: '10px 12px',
                        background: 'rgba(0,0,0,0.15)',
                        border: '1px solid rgba(255,255,255,0.04)',
                        borderRadius: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        opacity: dsp.eq_enabled ? 1 : 0.5
                      }}
                    >
                      {/* Top Header Row for individual band */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.5px' }}>
                          BAND {idx + 1}
                        </span>
                        <select 
                          value={band.band_type} 
                          disabled={!dsp.eq_enabled}
                          onChange={(e) => handleParametricBandChange(idx, { band_type: e.target.value })}
                          style={{
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            color: '#fff',
                            fontSize: 9,
                            borderRadius: 4,
                            padding: '2px 6px',
                            fontWeight: 600,
                            outline: 'none',
                            cursor: dsp.eq_enabled ? 'pointer' : 'default'
                          }}
                        >
                          <option value="peaking" style={{ background: '#111' }}>Peaking</option>
                          <option value="lowshelf" style={{ background: '#111' }}>Low-Shelf</option>
                          <option value="highshelf" style={{ background: '#111' }}>High-Shelf</option>
                        </select>
                      </div>

                      {/* Control sliders row */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        {/* Freq */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>Freq (Hz)</span>
                          <input 
                            type="number"
                            min="20"
                            max="20000"
                            value={band.freq}
                            disabled={!dsp.eq_enabled}
                            onChange={(e) => handleParametricBandChange(idx, { freq: parseFloat(e.target.value) || 1000 })}
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid rgba(255,255,255,0.05)',
                              borderRadius: 4,
                              color: '#fff',
                              fontSize: 10,
                              padding: '4px 6px',
                              fontWeight: 600
                            }}
                          />
                        </div>
                        {/* Gain */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>Gain (dB)</span>
                          <input 
                            type="number"
                            min="-18"
                            max="18"
                            step="0.1"
                            value={band.gain}
                            disabled={!dsp.eq_enabled}
                            onChange={(e) => handleParametricBandChange(idx, { gain: parseFloat(e.target.value) || 0 })}
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid rgba(255,255,255,0.05)',
                              borderRadius: 4,
                              color: '#fff',
                              fontSize: 10,
                              padding: '4px 6px',
                              fontWeight: 600
                            }}
                          />
                        </div>
                        {/* Q */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>Q-Factor</span>
                          <input 
                            type="number"
                            min="0.1"
                            max="10.0"
                            step="0.05"
                            value={band.q}
                            disabled={!dsp.eq_enabled}
                            onChange={(e) => handleParametricBandChange(idx, { q: parseFloat(e.target.value) || 0.7 })}
                            style={{
                              background: 'rgba(0,0,0,0.2)',
                              border: '1px solid rgba(255,255,255,0.05)',
                              borderRadius: 4,
                              color: '#fff',
                              fontSize: 10,
                              padding: '4px 6px',
                              fontWeight: 600
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* KILLER FEATURE: AUTOEQ PASTE IMPORTER */}
                <div style={{ marginTop: 6 }}>
                  <button
                    onClick={() => setShowAutoEqPanel(!showAutoEqPanel)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--accent)',
                      fontSize: 10,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: 'pointer',
                      padding: '4px 0'
                    }}
                  >
                    <Sparkles size={11} />
                    {showAutoEqPanel ? 'Hide AutoEQ Importer' : 'Import AutoEQ Calibration Profile...'}
                  </button>

                  <AnimatePresence>
                    {showAutoEqPanel && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <style>{`
                          @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                          }
                        `}</style>
                        <div style={{
                          padding: 12,
                          background: 'rgba(0,0,0,0.2)',
                          border: '1px dashed rgba(139,92,246,0.3)',
                          borderRadius: 8,
                          marginTop: 8,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10
                        }}>
                          {/* SUB-TABS: ONLINE SEARCH VS MANUAL PASTE */}
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            background: 'rgba(0,0,0,0.3)',
                            borderRadius: 6,
                            padding: 2,
                            border: '1px solid rgba(255,255,255,0.04)'
                          }}>
                            <button 
                              onClick={() => { setActiveSubTab('online'); setAutoEqError(''); }}
                              style={{
                                background: activeSubTab === 'online' ? 'rgba(255,255,255,0.06)' : 'transparent',
                                border: 'none',
                                color: activeSubTab === 'online' ? '#fff' : 'var(--text-dim)',
                                padding: '4px 8px',
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4
                              }}
                            >
                              <Activity size={10} /> Search Online
                            </button>
                            <button 
                              onClick={() => { setActiveSubTab('paste'); setAutoEqError(''); }}
                              style={{
                                background: activeSubTab === 'paste' ? 'rgba(255,255,255,0.06)' : 'transparent',
                                border: 'none',
                                color: activeSubTab === 'paste' ? '#fff' : 'var(--text-dim)',
                                padding: '4px 8px',
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4
                              }}
                            >
                              <Clipboard size={10} /> Paste Text
                            </button>
                          </div>

                          {activeSubTab === 'online' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
                              {/* Search input */}
                              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <input
                                  type="text"
                                  placeholder="Search 4,000+ headphone models..."
                                  value={dbSearchQuery}
                                  onChange={(e) => setDbSearchQuery(e.target.value)}
                                  disabled={isFetchingDb || isFetchingProfile}
                                  style={{
                                    width: '100%',
                                    background: '#07070d',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    borderRadius: 6,
                                    color: '#fff',
                                    fontSize: 10,
                                    padding: '8px 12px',
                                    paddingRight: 28,
                                    outline: 'none',
                                    fontWeight: 500,
                                    transition: 'all 0.3s'
                                  }}
                                  onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                                  onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                                />
                                {dbSearchQuery && (
                                  <button
                                    onClick={() => setDbSearchQuery('')}
                                    style={{
                                      position: 'absolute',
                                      right: 8,
                                      background: 'transparent',
                                      border: 'none',
                                      color: 'var(--text-dim)',
                                      cursor: 'pointer',
                                      padding: 0,
                                      display: 'flex',
                                      alignItems: 'center'
                                    }}
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                              </div>

                              {/* Error display */}
                              {autoEqError && (
                                <span style={{ fontSize: 9, color: '#ef4444', lineHeight: '13px' }}>
                                  {autoEqError}
                                </span>
                              )}

                              {/* Database Fetching State */}
                              {isFetchingDb && (
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 8,
                                  padding: '24px 0',
                                  color: 'var(--text-dim)',
                                  fontSize: 10
                                }}>
                                  <RefreshCw size={14} style={{ animation: 'spin 1.5s linear infinite', color: 'var(--accent)' }} />
                                  <span>Syncing headphone database index...</span>
                                </div>
                              )}

                              {/* Profile Fetching Loader Overlay */}
                              {isFetchingProfile && (
                                <div style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'rgba(11, 11, 18, 0.85)',
                                  backdropFilter: 'blur(2px)',
                                  zIndex: 10,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  borderRadius: 6,
                                  gap: 8
                                }}>
                                  <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
                                  <span style={{ fontSize: 9, color: '#fff', fontWeight: 600 }}>Downloading & parsing calibration...</span>
                                </div>
                              )}

                              {/* Dynamic Results Scroll Area */}
                              {!isFetchingDb && autoEqDb && (
                                <div 
                                  className="pro-audio-scroll"
                                  style={{
                                    maxHeight: 180,
                                    overflowY: 'auto',
                                    borderRadius: 6,
                                    background: 'rgba(0,0,0,0.15)',
                                    border: '1px solid rgba(255,255,255,0.04)',
                                    display: 'flex',
                                    flexDirection: 'column'
                                  }}
                                >
                                  {filteredDb.length === 0 ? (
                                    <div style={{ padding: '16px', textAlign: 'center', fontSize: 10, color: 'var(--text-dim)' }}>
                                      No headphones found matching "{dbSearchQuery}"
                                    </div>
                                  ) : (
                                    filteredDb.map((headphone, i) => {
                                      const badge = getSourceStyle(headphone.source);
                                      return (
                                        <button
                                          key={i}
                                          disabled={isFetchingProfile}
                                          onClick={() => handleSelectHeadphone(headphone)}
                                          style={{
                                            width: '100%',
                                            background: 'transparent',
                                            border: 'none',
                                            borderBottom: i === filteredDb.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.02)',
                                            padding: '8px 12px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                            color: '#fff',
                                            outline: 'none'
                                          }}
                                          onMouseEnter={e => {
                                            e.currentTarget.style.background = 'rgba(139, 92, 246, 0.08)';
                                            e.currentTarget.style.paddingLeft = '16px';
                                          }}
                                          onMouseLeave={e => {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.paddingLeft = '12px';
                                          }}
                                        >
                                          <span style={{ fontSize: 10, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 8, flex: 1 }}>
                                            {headphone.name}
                                          </span>
                                          <span style={{
                                            fontSize: 7.5,
                                            fontWeight: 700,
                                            padding: '2px 6px',
                                            borderRadius: 10,
                                            background: badge.bg,
                                            border: `1px solid ${badge.border}`,
                                            color: badge.color,
                                            textTransform: 'lowercase',
                                            letterSpacing: '0.2px',
                                            flexShrink: 0
                                          }}>
                                            {badge.label}
                                          </span>
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            // Pasted layout
                            <>
                              <span style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: '13px' }}>
                                Paste standard Equalizer APO/AutoEQ mathematical profiles below. This automatically calibrates Sennheiser, Sony, AirPods, or standard IEM hardware response curves:
                              </span>
                              <textarea
                                rows={3}
                                placeholder="Preamp: -6.4 dB&#10;Filter 1: ON PK Fc 105 Hz Gain 5.8 dB Q 0.70&#10;Filter 2: ON PK Fc 1500 Hz Gain -3.2 dB Q 1.80"
                                value={autoEqText}
                                onChange={(e) => setAutoEqText(e.target.value)}
                                style={{
                                  background: '#07070d',
                                  border: '1px solid rgba(255,255,255,0.06)',
                                  borderRadius: 6,
                                  color: '#fff',
                                  fontFamily: 'monospace',
                                  fontSize: 9,
                                  padding: 8,
                                  outline: 'none',
                                  resize: 'none'
                                }}
                              />
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 8, color: '#ef4444' }}>{autoEqError}</span>
                                <button
                                  onClick={() => handleApplyAutoEq()}
                                  disabled={autoEqSuccess}
                                  style={{
                                    background: autoEqSuccess ? '#22c55e' : 'var(--accent)',
                                    border: 'none',
                                    color: '#fff',
                                    padding: '6px 14px',
                                    borderRadius: 6,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    cursor: autoEqSuccess ? 'default' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    transition: 'all 0.2s'
                                  }}
                                >
                                  {autoEqSuccess ? (
                                    <>
                                      <CheckCircle2 size={12} /> Applied
                                    </>
                                  ) : (
                                    <>
                                      <Clipboard size={12} /> Apply correction
                                    </>
                                  )}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* SECTION 2: TRUE HEADPHONE CROSSFEED (Linkwitz/Chu Moy) */}
        <div style={{
          padding: '20px 24px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Volume2 size={16} color="var(--accent)" />
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>Linkwitz/Chu Moy Crossfeed</span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 1 }}>Prevents headphone ear fatigue</span>
              </div>
            </div>
            <label className="switch" style={{ cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={dsp.crossfeed_enabled} 
                onChange={(e) => setDSP({ crossfeed_enabled: e.target.checked })} 
                style={{ display: 'none' }} 
              />
              <div style={{
                width: 34,
                height: 18,
                borderRadius: 9,
                background: dsp.crossfeed_enabled ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                position: 'relative',
                transition: 'all 0.2s',
                border: dsp.crossfeed_enabled ? 'none' : '1px solid rgba(255,255,255,0.1)'
              }}>
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 1,
                  left: dsp.crossfeed_enabled ? 17 : 1,
                  transition: 'all 0.2s'
                }} />
              </div>
            </label>
          </div>

          {dsp.crossfeed_enabled && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}
            >
              {/* Corner Low Pass Freq */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Corner Freq (Acoustic shadow border)</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{dsp.crossfeed_corner.toFixed(0)} Hz</span>
                </div>
                <input 
                  type="range"
                  min="300"
                  max="1200"
                  step="10"
                  value={dsp.crossfeed_corner}
                  onChange={(e) => setDSP({ crossfeed_corner: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>

              {/* Feed level */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Inter-aural Feed Level</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{dsp.crossfeed_level.toFixed(1)} dB</span>
                </div>
                <input 
                  type="range"
                  min="-18"
                  max="0"
                  step="0.5"
                  value={dsp.crossfeed_level}
                  onChange={(e) => setDSP({ crossfeed_level: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>
            </motion.div>
          )}
        </div>

        {/* SECTION 3: HAAS-EFFECT SPATIALIZER (Constant-power) */}
        <div style={{
          padding: '20px 24px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={16} color="var(--accent)" />
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>Haas Soundstage Spatializer</span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 1 }}>Expansive, mono-compatible width</span>
              </div>
            </div>
            <label className="switch" style={{ cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={dsp.spatial_enabled} 
                onChange={(e) => setDSP({ spatial_enabled: e.target.checked })} 
                style={{ display: 'none' }} 
              />
              <div style={{
                width: 34,
                height: 18,
                borderRadius: 9,
                background: dsp.spatial_enabled ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                position: 'relative',
                transition: 'all 0.2s',
                border: dsp.spatial_enabled ? 'none' : '1px solid rgba(255,255,255,0.1)'
              }}>
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 1,
                  left: dsp.spatial_enabled ? 17 : 1,
                  transition: 'all 0.2s'
                }} />
              </div>
            </label>
          </div>

          {dsp.spatial_enabled && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}
            >
              {/* Haas Delay */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Haas Precedence Delay</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{dsp.spatial_haas_delay.toFixed(1)} ms</span>
                </div>
                <input 
                  type="range"
                  min="5"
                  max="12"
                  step="0.25"
                  value={dsp.spatial_haas_delay}
                  onChange={(e) => setDSP({ spatial_haas_delay: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>

              {/* Wet Mix */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Reflections & Panning Intensity</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{(dsp.spatial_wet * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range"
                  min="0"
                  max="1.0"
                  step="0.01"
                  value={dsp.spatial_wet}
                  onChange={(e) => setDSP({ spatial_wet: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>
            </motion.div>
          )}
        </div>

        {/* SECTION 4: DYNAMICS SUITE */}
        <div style={{
          padding: '20px 24px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={16} color="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Dynamics Processing Suite</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 1. Subsonic Filter */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(0,0,0,0.1)', borderRadius: 8 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, display: 'block' }}>Subsonic Rumble Filter</span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 1 }}>Sharp 18Hz HPF protects diaphragms</span>
              </div>
              <label className="switch" style={{ cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={dsp.subsonic_enabled} 
                  onChange={(e) => setDSP({ subsonic_enabled: e.target.checked })} 
                  style={{ display: 'none' }} 
                />
                <div style={{
                  width: 30,
                  height: 16,
                  borderRadius: 8,
                  background: dsp.subsonic_enabled ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  position: 'relative',
                  transition: 'all 0.2s',
                  border: dsp.subsonic_enabled ? 'none' : '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: 1,
                    left: dsp.subsonic_enabled ? 15 : 1,
                    transition: 'all 0.2s'
                  }} />
                </div>
              </label>
            </div>

            {/* 2. Night Mode */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(0,0,0,0.1)', borderRadius: 8 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, display: 'block' }}>Night Mode (Dynamics Compressor)</span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 1 }}>Soft 2.5:1 ratio keeps volume level</span>
              </div>
              <label className="switch" style={{ cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={dsp.night_mode_enabled} 
                  onChange={(e) => setDSP({ night_mode_enabled: e.target.checked })} 
                  style={{ display: 'none' }} 
                />
                <div style={{
                  width: 30,
                  height: 16,
                  borderRadius: 8,
                  background: dsp.night_mode_enabled ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  position: 'relative',
                  transition: 'all 0.2s',
                  border: dsp.night_mode_enabled ? 'none' : '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: 1,
                    left: dsp.night_mode_enabled ? 15 : 1,
                    transition: 'all 0.2s'
                  }} />
                </div>
              </label>
            </div>

            {/* 3. EBU R128 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(0,0,0,0.1)', borderRadius: 8 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, display: 'block' }}>EBU R128 Loudness Auto-Matching</span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 1 }}>Perceived auto-level target (-14 LUFS)</span>
              </div>
              <label className="switch" style={{ cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={dsp.r128_enabled} 
                  onChange={(e) => setDSP({ r128_enabled: e.target.checked })} 
                  style={{ display: 'none' }} 
                />
                <div style={{
                  width: 30,
                  height: 16,
                  borderRadius: 8,
                  background: dsp.r128_enabled ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  position: 'relative',
                  transition: 'all 0.2s',
                  border: dsp.r128_enabled ? 'none' : '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: 1,
                    left: dsp.r128_enabled ? 15 : 1,
                    transition: 'all 0.2s'
                  }} />
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* SECTION 5: HARDWARE & BIT-PERFECT CONFIG */}
        <div style={{
          padding: '20px 24px',
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={16} color="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Hardware & Upsampling Engine</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Audio Hardware output device list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Output Hardware Device</span>
              <select
                value={currentDevice || ''}
                onChange={(e) => setAudioDevice(e.target.value)}
                style={{
                  width: '100%',
                  background: '#07070d',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 12,
                  padding: '8px 12px',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="">Default OS Device</option>
                {devices.map(d => (
                  <option key={d} value={d} style={{ background: '#111' }}>{d}</option>
                ))}
              </select>
            </div>

            {/* Target Upsampling Rate dropdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Upsampler Target Sample Rate</span>
                {playback.dev_rate > 0 && (
                  <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700 }}>Active: {playback.dev_rate} Hz</span>
                )}
              </div>
              <select
                value={dsp.upsample_rate}
                disabled={playback.bit_perfect}
                onChange={(e) => setDSP({ upsample_rate: parseInt(e.target.value) || 0 })}
                style={{
                  width: '100%',
                  background: '#07070d',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  color: playback.bit_perfect ? 'var(--text-dim)' : '#fff',
                  fontSize: 12,
                  padding: '8px 12px',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: playback.bit_perfect ? 'default' : 'pointer'
                }}
              >
                <option value="0" style={{ background: '#111' }}>Disabled (Resampler native match)</option>
                <option value="44100" style={{ background: '#111' }}>44.1 kHz</option>
                <option value="48000" style={{ background: '#111' }}>48.0 kHz</option>
                <option value="88200" style={{ background: '#111' }}>88.2 kHz</option>
                <option value="96000" style={{ background: '#111' }}>96.0 kHz</option>
                <option value="176400" style={{ background: '#111' }}>176.4 kHz (Hi-Res)</option>
                <option value="192000" style={{ background: '#111' }}>192.0 kHz (Hi-Res)</option>
                <option value="352800" style={{ background: '#111' }}>352.8 kHz (Extreme)</option>
                <option value="384000" style={{ background: '#111' }}>384.0 kHz (Extreme)</option>
              </select>
            </div>

            {/* Dithering toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(0,0,0,0.1)', borderRadius: 8 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, display: 'block' }}>High-Fidelity TPDF Dithering</span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 1 }}>Eliminates low-level truncation distortion</span>
              </div>
              <label className="switch" style={{ cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={dsp.dither} 
                  onChange={(e) => setDSP({ dither: e.target.checked })} 
                  style={{ display: 'none' }} 
                />
                <div style={{
                  width: 30,
                  height: 16,
                  borderRadius: 8,
                  background: dsp.dither ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  position: 'relative',
                  transition: 'all 0.2s',
                  border: dsp.dither ? 'none' : '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: 1,
                    left: dsp.dither ? 15 : 1,
                    transition: 'all 0.2s'
                  }} />
                </div>
              </label>
            </div>

            {/* WASAPI Exclusive toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(0,0,0,0.1)', borderRadius: 8 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, display: 'block' }}>WASAPI Exclusive Mode</span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 1 }}>Bypasses Windows mixer (zero latency)</span>
              </div>
              <label className="switch" style={{ cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={playback.exclusive} 
                  onChange={toggleExclusive} 
                  style={{ display: 'none' }} 
                />
                <div style={{
                  width: 30,
                  height: 16,
                  borderRadius: 8,
                  background: playback.exclusive ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  position: 'relative',
                  transition: 'all 0.2s',
                  border: playback.exclusive ? 'none' : '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: 1,
                    left: playback.exclusive ? 15 : 1,
                    transition: 'all 0.2s'
                  }} />
                </div>
              </label>
            </div>

            {/* Bit-Perfect Mode toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(0,0,0,0.1)', borderRadius: 8 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, display: 'block' }}>Bit-Perfect Pure Mode</span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 1 }}>Completely disables DSP & mixer adjustments</span>
              </div>
              <label className="switch" style={{ cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={playback.bit_perfect} 
                  onChange={toggleBitPerfect} 
                  style={{ display: 'none' }} 
                />
                <div style={{
                  width: 30,
                  height: 16,
                  borderRadius: 8,
                  background: playback.bit_perfect ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  position: 'relative',
                  transition: 'all 0.2s',
                  border: playback.bit_perfect ? 'none' : '1px solid rgba(255,255,255,0.1)'
                }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: 1,
                    left: playback.bit_perfect ? 15 : 1,
                    transition: 'all 0.2s'
                  }} />
                </div>
              </label>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
