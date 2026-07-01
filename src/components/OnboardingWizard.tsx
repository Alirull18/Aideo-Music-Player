import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sparkles, Headphones, HardDrive, Check, ArrowRight, ArrowLeft, 
  ShieldCheck, Radio, 
  FolderOpen, Plus, Trash2, CheckSquare, Square,
  DownloadCloud, AlertCircle, Loader2, CheckCircle2
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function OnboardingWizard() {
  const { 
    appMode, setAppMode,
    setOnboardingCompleted, setShowOnboarding,
    dsp, setDSP,
    playback, toggleExclusive,
    toggleBitPerfect,
    discordEnabled, toggleDiscord,
    scrobbleEnabled, toggleScrobble,
    listenbrainzEnabled, toggleListenbrainzScrobble,
    scanDirs, addScanDir, removeScanDir, scanLibrary,
    accentColor
  } = useStore();

  const [step, setStep] = useState(1);
  const [selectedMode, setSelectedMode] = useState<'local' | 'hybrid'>(appMode);
  
  // Custom checklist state reflecting the active preferences chosen in onboarding
  const [options, setOptions] = useState({
    wasapiExclusive: playback.exclusive,
    bitPerfect: playback.bit_perfect,
    eqAutoEq: dsp.eq_enabled,
    crossfeed: dsp.crossfeed_enabled,
    subsonicFilter: dsp.subsonic_enabled,
    discordRpc: discordEnabled,
    lastfmScrobble: scrobbleEnabled,
    listenbrainzScrobble: listenbrainzEnabled,
    youtubeMusic: true
  });

  // Dependencies management state
  interface DependencyStatus {
    ytdlp_installed: boolean;
    ffmpeg_installed: boolean;
    ytdlp_size: number;
    ffmpeg_size: number;
  }
  const [depStatus, setDepStatus] = useState<DependencyStatus | null>(null);
  const [depDownloads, setDepDownloads] = useState<Record<string, { percent: number; downloaded: number; total: number; active: boolean }>>({});

  const fetchDepStatus = async () => {
    try {
      const res = await invoke<DependencyStatus>('get_dependencies_status');
      setDepStatus(res);
    } catch (e) {
      console.error("Failed to fetch dependency status:", e);
    }
  };

  const handleInstallDep = async (id: 'ytdlp' | 'ffmpeg') => {
    setDepDownloads(prev => ({
      ...prev,
      [id]: { percent: 0, downloaded: 0, total: 0, active: true }
    }));
    try {
      await invoke('install_dependency', { depId: id });
    } catch (e) {
      console.error(e);
      setDepDownloads(prev => ({
        ...prev,
        [id]: { percent: 0, downloaded: 0, total: 0, active: false }
      }));
    }
    fetchDepStatus();
  };

  useEffect(() => {
    fetchDepStatus();

    const unlisten = listen<any>('dependency-download-progress', (event) => {
      const { id, percent, downloaded, total } = event.payload;
      setDepDownloads((prev: any) => ({
        ...prev,
        [id]: { percent, downloaded, total, active: percent < 100 }
      }));
      if (percent >= 100) {
        setTimeout(fetchDepStatus, 1000);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Welcome Step Particle Backdrop
  const [dots, setDots] = useState<{ x: number; y: number; s: number; o: number }[]>([]);
  useEffect(() => {
    const list = Array.from({ length: 60 }).map(() => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      s: Math.random() * 2 + 0.5,
      o: Math.random() * 0.4 + 0.1
    }));
    setDots(list);
  }, []);

  const handleModeSelect = (mode: 'local' | 'hybrid') => {
    setSelectedMode(mode);
    setAppMode(mode);
    
    // Automatically pre-fill appropriate options depending on mode
    if (mode === 'local') {
      setOptions(prev => ({
        ...prev,
        discordRpc: true,
        lastfmScrobble: true,
        listenbrainzScrobble: true,
        youtubeMusic: false,
        wasapiExclusive: true,
        bitPerfect: true
      }));
    } else {
      setOptions(prev => ({
        ...prev,
        discordRpc: true,
        lastfmScrobble: true,
        listenbrainzScrobble: true,
        youtubeMusic: true
      }));
    }
  };

  const handleToggleOption = (key: keyof typeof options) => {
    setOptions(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleBrowseFolder = async () => {
    try {
      const sel = await open({ directory: true, multiple: false });
      if (sel && typeof sel === 'string') {
        addScanDir(sel);
      }
    } catch (err) {
      console.error("Folder selection failed:", err);
    }
  };

  const handleComplete = async () => {
    // 1. Persist the chosen mode
    setAppMode(selectedMode);

    // 2. Commit all configured checklist options to the store/state
    if (playback.exclusive !== options.wasapiExclusive) {
      await toggleExclusive();
    }
    if (playback.bit_perfect !== options.bitPerfect) {
      await toggleBitPerfect();
    }
    if (dsp.eq_enabled !== options.eqAutoEq) {
      await setDSP({ eq_enabled: options.eqAutoEq, enabled: options.eqAutoEq ? true : dsp.enabled });
    }
    if (dsp.crossfeed_enabled !== options.crossfeed) {
      await setDSP({ crossfeed_enabled: options.crossfeed, enabled: options.crossfeed ? true : dsp.enabled });
    }
    if (dsp.subsonic_enabled !== options.subsonicFilter) {
      await setDSP({ subsonic_enabled: options.subsonicFilter, enabled: options.subsonicFilter ? true : dsp.enabled });
    }
    if (discordEnabled !== options.discordRpc) {
      toggleDiscord();
    }
    if (scrobbleEnabled !== options.lastfmScrobble) {
      toggleScrobble();
    }
    if (listenbrainzEnabled !== options.listenbrainzScrobble) {
      toggleListenbrainzScrobble();
    }

    // 3. Trigger music scan if folder directories are set
    if (scanDirs.length > 0) {
      scanLibrary().catch(e => console.error("Library sync failed:", e));
    }

    // 4. Complete onboarding
    setOnboardingCompleted(true);
    setShowOnboarding(false);

    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Welcome to Aideo Console! Calibrated in ${selectedMode.toUpperCase()} mode.`, type: 'success' } 
    }));
  };

  const rgbAccent = accentColor.startsWith('rgb') 
    ? accentColor.replace('rgb(', '').replace(')', '') 
    : '139, 92, 246';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#09090d',
      zIndex: 99999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Outfit', sans-serif",
      color: '#ffffff',
      overflow: 'hidden'
    }}>
      {/* Animated particle background */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', opacity: 0.8 }}>
        {dots.map((dot, idx) => (
          <div 
            key={idx}
            style={{
              position: 'absolute',
              left: `${dot.x}%`,
              top: `${dot.y}%`,
              width: dot.s,
              height: dot.s,
              background: `rgba(${rgbAccent}, ${dot.o})`,
              borderRadius: '50%',
              boxShadow: dot.s > 1.8 ? `0 0 10px rgba(${rgbAccent}, 0.5)` : 'none'
            }}
          />
        ))}
        {/* Soft floating colored gradient spheres */}
        <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '50vw', height: '50vw', borderRadius: '50%', background: `radial-gradient(circle, rgba(${rgbAccent}, 0.08) 0%, transparent 70%)`, filter: 'blur(80px)' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '50vw', height: '50vw', borderRadius: '50%', background: `radial-gradient(circle, rgba(${rgbAccent}, 0.06) 0%, transparent 70%)`, filter: 'blur(80px)' }} />
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Mode Selection */}
        {step === 1 && (
          <motion.div 
            key="step1"
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -30, scale: 0.96 }}
            transition={{ type: 'spring', damping: 26, stiffness: 170 }}
            style={{
              width: '90%',
              maxWidth: 720,
              background: 'rgba(15, 15, 23, 0.72)',
              backdropFilter: 'blur(32px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 24,
              padding: 40,
              boxShadow: '0 24px 60px rgba(0,0,0,0.8), 0 0 2px rgba(255,255,255,0.1) inset',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              zIndex: 10
            }}
          >
            <div style={{
              background: `rgba(${rgbAccent}, 0.1)`,
              border: `1.5px solid rgba(${rgbAccent}, 0.25)`,
              borderRadius: '50%',
              width: 56,
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
              boxShadow: `0 0 20px rgba(${rgbAccent}, 0.2)`
            }}>
              <Sparkles size={24} style={{ color: `rgb(${rgbAccent})` }} />
            </div>

            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginBottom: 8 }}>
              Calibrate Your <span style={{ color: `rgb(${rgbAccent})` }}>Aideo Experience</span>
            </h1>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, maxWidth: 520, marginBottom: 36 }}>
              Welcome to the reference desktop audio workspace. Choose how you would like to interact with your music environment.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, width: '100%', marginBottom: 40 }}>
              {/* Option: Local Only */}
              <motion.div
                whileHover={{ scale: 1.02, translateY: -4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleModeSelect('local')}
                style={{
                  background: selectedMode === 'local' ? `rgba(${rgbAccent}, 0.08)` : 'rgba(255, 255, 255, 0.015)',
                  border: selectedMode === 'local' ? `2px solid rgb(${rgbAccent})` : '1.5px solid rgba(255, 255, 255, 0.04)',
                  borderRadius: 18,
                  padding: 24,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'border-color 0.25s ease, background-color 0.25s ease',
                  boxShadow: selectedMode === 'local' ? `0 10px 30px rgba(${rgbAccent}, 0.15)` : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  height: 240
                }}
              >
                <div>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: selectedMode === 'local' ? `rgb(${rgbAccent})` : 'rgba(255, 255, 255, 0.04)',
                    color: selectedMode === 'local' ? '#ffffff' : 'rgba(255,255,255,0.8)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 16, transition: 'all 0.2s'
                  }}>
                    <HardDrive size={18} />
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: '#ffffff' }}>Local File Only Mode</h3>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
                    Minimalist, offline local music catalog. Disables all background network queries, analytics, and third-party widgets for absolute low latency and CPU headroom.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: selectedMode === 'local' ? `rgb(${rgbAccent})` : 'rgba(255,255,255,0.4)' }}>
                  {selectedMode === 'local' ? <Check size={14} /> : null}
                  {selectedMode === 'local' ? 'Selected Path' : 'Select Local Path'}
                </div>
              </motion.div>

              {/* Option: Hybrid Explorer */}
              <motion.div
                whileHover={{ scale: 1.02, translateY: -4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleModeSelect('hybrid')}
                style={{
                  background: selectedMode === 'hybrid' ? `rgba(${rgbAccent}, 0.08)` : 'rgba(255, 255, 255, 0.015)',
                  border: selectedMode === 'hybrid' ? `2px solid rgb(${rgbAccent})` : '1.5px solid rgba(255, 255, 255, 0.04)',
                  borderRadius: 18,
                  padding: 24,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'border-color 0.25s ease, background-color 0.25s ease',
                  boxShadow: selectedMode === 'hybrid' ? `0 10px 30px rgba(${rgbAccent}, 0.15)` : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  height: 240
                }}
              >
                <div>
                  <div style={{
                    width: 38, height: 38, borderRadius: 10,
                    background: selectedMode === 'hybrid' ? `rgb(${rgbAccent})` : 'rgba(255, 255, 255, 0.04)',
                    color: selectedMode === 'hybrid' ? '#ffffff' : 'rgba(255,255,255,0.8)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 16, transition: 'all 0.2s'
                  }}>
                    <Headphones size={18} />
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: '#ffffff' }}>Hybrid Music Explorer Mode</h3>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>
                    Pristine offline engine coupled with high-fidelity Lossless Cloud streams, Web Stream search discovery, scrobblers, and remote Subsonic/Jellyfin cloud indexing.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: selectedMode === 'hybrid' ? `rgb(${rgbAccent})` : 'rgba(255,255,255,0.4)' }}>
                  {selectedMode === 'hybrid' ? <Check size={14} /> : null}
                  {selectedMode === 'hybrid' ? 'Selected Path' : 'Select Hybrid Path'}
                </div>
              </motion.div>
            </div>

            <button 
              className="btn btn-primary"
              onClick={() => setStep(selectedMode === 'hybrid' ? 2 : 3)}
              style={{
                width: '100%',
                padding: '12px 0',
                fontSize: 13,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                borderRadius: 12,
                boxShadow: `0 8px 24px rgba(${rgbAccent}, 0.25)`
              }}
            >
              Continue to Calibration <ArrowRight size={16} />
            </button>
          </motion.div>
        )}

        {/* Step 2: Dependency Installer */}
        {step === 2 && (
          <motion.div 
            key="step2"
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -30, scale: 0.96 }}
            transition={{ type: 'spring', damping: 26, stiffness: 170 }}
            style={{
              width: '90%',
              maxWidth: 720,
              background: 'rgba(15, 15, 23, 0.72)',
              backdropFilter: 'blur(32px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 24,
              padding: 40,
              boxShadow: '0 24px 60px rgba(0,0,0,0.8), 0 0 2px rgba(255,255,255,0.1) inset',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 10
            }}
          >
            <div style={{
              background: `rgba(${rgbAccent}, 0.1)`,
              border: `1.5px solid rgba(${rgbAccent}, 0.25)`,
              borderRadius: '50%',
              width: 52,
              height: 52,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
              alignSelf: 'center'
            }}>
              <DownloadCloud size={20} style={{ color: `rgb(${rgbAccent})` }} />
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4, textAlign: 'center' }}>
              Required Engines Calibration
            </h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 1.5, maxWidth: 540, marginBottom: 28, alignSelf: 'center' }}>
              Hybrid Mode blends local files with scrobblers and web searches. To stream high-fidelity audio from the cloud, Aideo uses local decoders. Let's download and set them up now.
            </p>

            {/* Dependency Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32, width: '100%' }}>
              {/* Card 1: yt-dlp */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.015)',
                border: '1px solid rgba(255, 255, 255, 0.04)',
                borderRadius: 16,
                padding: '20px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.2s'
              }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: depStatus?.ytdlp_installed ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.08)',
                    color: depStatus?.ytdlp_installed ? '#10b981' : '#ef4444',
                    display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center'
                  }}>
                    {depStatus?.ytdlp_installed ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                  </div>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>Web Stream Resolver</h3>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                      Handles direct lossless stream extraction. Size: {depStatus?.ytdlp_size ? `${(depStatus.ytdlp_size / 1024 / 1024).toFixed(1)} MB` : 'Pending Download'}
                    </p>
                  </div>
                </div>

                <div>
                  {depStatus?.ytdlp_installed ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Check size={14} /> Ready
                    </span>
                  ) : depDownloads['ytdlp']?.active ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{ fontSize: 11, color: `rgb(${rgbAccent})`, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Loader2 size={12} className="animate-spin" /> Downloading {depDownloads['ytdlp'].percent.toFixed(0)}%
                      </span>
                      <div style={{ width: 100, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${depDownloads['ytdlp'].percent}%`, height: '100%', background: `rgb(${rgbAccent})` }} />
                      </div>
                    </div>
                  ) : (
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => handleInstallDep('ytdlp')}
                      style={{ padding: '6px 12px', fontSize: 11, borderRadius: 8 }}
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>

              {/* Card 2: ffmpeg */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.015)',
                border: '1px solid rgba(255, 255, 255, 0.04)',
                borderRadius: 16,
                padding: '20px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.2s'
              }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: depStatus?.ffmpeg_installed ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.08)',
                    color: depStatus?.ffmpeg_installed ? '#10b981' : '#ef4444',
                    display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center'
                  }}>
                    {depStatus?.ffmpeg_installed ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                  </div>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>FFmpeg Transcoder</h3>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                      Decodes and converts audio streams to premium lossless M4A format. Size: {depStatus?.ffmpeg_size ? `${(depStatus.ffmpeg_size / 1024 / 1024).toFixed(1)} MB` : 'Pending Download'}
                    </p>
                  </div>
                </div>

                <div>
                  {depStatus?.ffmpeg_installed ? (
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Check size={14} /> Ready
                    </span>
                  ) : depDownloads['ffmpeg']?.active ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{ fontSize: 11, color: `rgb(${rgbAccent})`, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Loader2 size={12} className="animate-spin" /> Downloading {depDownloads['ffmpeg'].percent.toFixed(0)}%
                      </span>
                      <div style={{ width: 100, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${depDownloads['ffmpeg'].percent}%`, height: '100%', background: `rgb(${rgbAccent})` }} />
                      </div>
                    </div>
                  ) : (
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => handleInstallDep('ffmpeg')}
                      style={{ padding: '6px 12px', fontSize: 11, borderRadius: 8 }}
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Install All Button if both missing */}
            {depStatus && (!depStatus.ytdlp_installed || !depStatus.ffmpeg_installed) && (
              <button
                className="btn btn-primary"
                disabled={depDownloads['ytdlp']?.active || depDownloads['ffmpeg']?.active}
                onClick={async () => {
                  if (!depStatus.ytdlp_installed) handleInstallDep('ytdlp');
                  if (!depStatus.ffmpeg_installed) handleInstallDep('ffmpeg');
                }}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 12,
                  marginBottom: 24,
                  boxShadow: `0 8px 24px rgba(${rgbAccent}, 0.2)`
                }}
              >
                <DownloadCloud size={16} /> 
                {depDownloads['ytdlp']?.active || depDownloads['ffmpeg']?.active
                  ? 'Downloading Core Engines...'
                  : 'Install All Required Engines (Recommended)'}
              </button>
            )}

            {/* Controls */}
            <div style={{ display: 'flex', gap: 14, width: '100%', marginTop: 'auto' }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setStep(1)}
                style={{
                  flex: 0.3,
                  padding: '12px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  borderRadius: 12
                }}
              >
                <ArrowLeft size={16} /> Back
              </button>
              
              <button 
                className="btn btn-primary"
                disabled={!depStatus?.ytdlp_installed || !depStatus?.ffmpeg_installed}
                onClick={() => setStep(3)}
                style={{
                  flex: 0.7,
                  padding: '12px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 12,
                  boxShadow: depStatus?.ytdlp_installed && depStatus?.ffmpeg_installed
                    ? `0 8px 24px rgba(${rgbAccent}, 0.35)`
                    : 'none',
                  background: depStatus?.ytdlp_installed && depStatus?.ffmpeg_installed
                    ? `linear-gradient(135deg, rgb(${rgbAccent}), rgba(${rgbAccent}, 0.75))`
                    : 'rgba(255, 255, 255, 0.05)',
                  cursor: depStatus?.ytdlp_installed && depStatus?.ffmpeg_installed ? 'pointer' : 'not-allowed',
                  color: depStatus?.ytdlp_installed && depStatus?.ffmpeg_installed ? 'white' : 'rgba(255, 255, 255, 0.3)'
                }}
              >
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Setup & Connection Parameters */}
        {step === 3 && (
          <motion.div 
            key="step3"
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -30, scale: 0.96 }}
            transition={{ type: 'spring', damping: 26, stiffness: 170 }}
            style={{
              width: '90%',
              maxWidth: 780,
              background: 'rgba(15, 15, 23, 0.72)',
              backdropFilter: 'blur(32px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 24,
              padding: '36px 40px',
              boxShadow: '0 24px 60px rgba(0,0,0,0.8), 0 0 2px rgba(255,255,255,0.1) inset',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 10
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', marginBottom: 4 }}>
              Setup & Connection Parameters
            </h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginBottom: 28 }}>
              Configure your optional connected stream and stats API integrations.
            </p>

            <div style={{ 
              display: 'flex',
              flexDirection: 'column',
              gap: 16, 
              maxHeight: 380, 
              overflowY: 'auto', 
              paddingRight: 6,
              marginBottom: 32,
              width: '100%'
            }}>
              {/* Category: Connected Services */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: `rgb(${rgbAccent})`, letterSpacing: 1, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Radio size={12} /> Connected Services & APIs
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {selectedMode === 'hybrid' && (
                    <div 
                      className={`settings-ctrl-card ${options.youtubeMusic ? 'active' : ''}`}
                      onClick={() => handleToggleOption('youtubeMusic')}
                      style={{
                        padding: '12px 14px', borderRadius: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.015)',
                        border: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 10, alignItems: 'flex-start',
                        transition: 'all 0.2s', borderColor: options.youtubeMusic ? `rgba(${rgbAccent}, 0.4)` : 'rgba(255,255,255,0.04)'
                      }}
                    >
                      <div style={{ color: options.youtubeMusic ? `rgb(${rgbAccent})` : 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                        {options.youtubeMusic ? <CheckSquare size={16} /> : <Square size={16} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>Web Streams & Lossless Cloud Search</div>
                        <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.3, marginTop: 2 }}>Enables direct web stream extraction and lossless cloud FLAC downloads. Spawns yt-dlp.</div>
                      </div>
                    </div>
                  )}

                  <div 
                    className={`settings-ctrl-card ${options.discordRpc ? 'active' : ''}`}
                    onClick={() => handleToggleOption('discordRpc')}
                    style={{
                      padding: '12px 14px', borderRadius: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.015)',
                      border: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 10, alignItems: 'flex-start',
                      transition: 'all 0.2s', borderColor: options.discordRpc ? `rgba(${rgbAccent}, 0.4)` : 'rgba(255,255,255,0.04)'
                    }}
                  >
                    <div style={{ color: options.discordRpc ? `rgb(${rgbAccent})` : 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                      {options.discordRpc ? <CheckSquare size={16} /> : <Square size={16} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>Discord Rich Presence (RPC)</div>
                      <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.3, marginTop: 2 }}>Broadcasts cover artwork, active playback progress, and song titles onto profile badges.</div>
                    </div>
                  </div>

                  <div 
                    className={`settings-ctrl-card ${options.lastfmScrobble ? 'active' : ''}`}
                    onClick={() => handleToggleOption('lastfmScrobble')}
                    style={{
                      padding: '12px 14px', borderRadius: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.015)',
                      border: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 10, alignItems: 'flex-start',
                      transition: 'all 0.2s', borderColor: options.lastfmScrobble ? `rgba(${rgbAccent}, 0.4)` : 'rgba(255,255,255,0.04)'
                    }}
                  >
                    <div style={{ color: options.lastfmScrobble ? `rgb(${rgbAccent})` : 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                      {options.lastfmScrobble ? <CheckSquare size={16} /> : <Square size={16} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>Last.fm Stats Scrobbling</div>
                      <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.3, marginTop: 2 }}>Syncs tracks scrobble transitions and displays history dashboard.</div>
                    </div>
                  </div>

                  <div 
                    className={`settings-ctrl-card ${options.listenbrainzScrobble ? 'active' : ''}`}
                    onClick={() => handleToggleOption('listenbrainzScrobble')}
                    style={{
                      padding: '12px 14px', borderRadius: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.015)',
                      border: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 10, alignItems: 'flex-start',
                      transition: 'all 0.2s', borderColor: options.listenbrainzScrobble ? `rgba(${rgbAccent}, 0.4)` : 'rgba(255,255,255,0.04)'
                    }}
                  >
                    <div style={{ color: options.listenbrainzScrobble ? `rgb(${rgbAccent})` : 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                      {options.listenbrainzScrobble ? <CheckSquare size={16} /> : <Square size={16} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>ListenBrainz Scrobbling & Recs</div>
                      <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.3, marginTop: 2 }}>Connects opensource listening feeds to MusicBrainz dataset.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, width: '100%', marginTop: 'auto' }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setStep(selectedMode === 'hybrid' ? 2 : 1)}
                style={{
                  flex: 0.35,
                  padding: '12px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  borderRadius: 12
                }}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button 
                className="btn btn-primary"
                onClick={() => setStep(4)}
                style={{
                  flex: 0.65,
                  padding: '12px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 12,
                  boxShadow: `0 8px 24px rgba(${rgbAccent}, 0.35)`,
                  background: `linear-gradient(135deg, rgb(${rgbAccent}), rgba(${rgbAccent}, 0.75))`
                }}
              >
                Continue to Folders <ArrowRight size={16} />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 4: Folder Selection */}
        {step === 4 && (
          <motion.div 
            key="step4"
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -30, scale: 0.96 }}
            transition={{ type: 'spring', damping: 26, stiffness: 170 }}
            style={{
              width: '90%',
              maxWidth: 720,
              background: 'rgba(15, 15, 23, 0.72)',
              backdropFilter: 'blur(32px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 24,
              padding: 40,
              boxShadow: '0 24px 60px rgba(0,0,0,0.8), 0 0 2px rgba(255,255,255,0.1) inset',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              zIndex: 10
            }}
          >
            <div style={{
              background: `rgba(${rgbAccent}, 0.1)`,
              border: `1.5px solid rgba(${rgbAccent}, 0.25)`,
              borderRadius: '50%',
              width: 52,
              height: 52,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20
            }}>
              <FolderOpen size={20} style={{ color: `rgb(${rgbAccent})` }} />
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              Define Offline Audio Directories
            </h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 1.5, maxWidth: 500, marginBottom: 28 }}>
              Select folders on your local disk containing MP3, FLAC, M4A, or WAV files. Aideo indices metadata recursively.
            </p>

            {/* Folder list box */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto', marginBottom: 20, paddingRight: 6 }}>
              {scanDirs.map(dir => (
                <div 
                  key={dir} 
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 16px', background: 'rgba(255, 255, 255, 0.015)', 
                    border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 10
                  }}
                >
                  <span style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%', color: 'rgba(255,255,255,0.8)' }}>
                    {dir}
                  </span>
                  <button 
                    onClick={() => removeScanDir(dir)}
                    style={{
                      background: 'none', border: 'none', color: '#ef4444', 
                      fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700
                    }}
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                </div>
              ))}

              {scanDirs.length === 0 && (
                <div style={{
                  fontSize: 12, color: 'rgba(255,255,255,0.4)', padding: '24px', textAlign: 'center',
                  background: 'rgba(0,0,0,0.15)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.06)'
                }}>
                  No local paths linked yet. Link folders to index your music!
                </div>
              )}
            </div>

            {/* Button to browse folder */}
            <button 
              className="btn btn-secondary"
              onClick={handleBrowseFolder}
              style={{
                width: '100%',
                padding: '10px 0',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                borderRadius: 10,
                border: '1.5px dashed rgba(255,255,255,0.15)',
                background: 'transparent',
                marginBottom: 36
              }}
            >
              <Plus size={14} /> Add Local Music Folder
            </button>

            <div style={{ display: 'flex', gap: 14, width: '100%' }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setStep(3)}
                style={{
                  flex: 0.3,
                  padding: '12px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  borderRadius: 12
                }}
              >
                <ArrowLeft size={16} /> Back
              </button>
              
              <button 
                className="btn btn-primary"
                onClick={handleComplete}
                style={{
                  flex: 0.7,
                  padding: '12px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 12,
                  boxShadow: `0 8px 24px rgba(${rgbAccent}, 0.35)`,
                  background: `linear-gradient(135deg, rgb(${rgbAccent}), rgba(${rgbAccent}, 0.75))`
                }}
              >
                <ShieldCheck size={16} /> Launch Aideo Console
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
