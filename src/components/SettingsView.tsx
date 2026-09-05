import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { PlayerBarDesign, AideoPageDesign, TheaterModeDesign, TheaterHudStyle } from '../store/types';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open } from '@tauri-apps/plugin-dialog';
import { 
  Settings, Library, Radio, FolderSearch, RefreshCw, DownloadCloud, 
  Search, Palette, Volume2, Info, ShieldAlert, Laptop, HelpCircle, 
  Trash2, Plus, Sparkles, LogOut, Zap, Puzzle, User, Keyboard,
  Disc, Layers, Activity, Minus, LayoutGrid, Copy, BarChart3, TrendingUp,
  Headphones, Heart, ArrowUp, ArrowDown, RotateCcw, Terminal, FolderOpen,
  Tv2, Sliders, FileText, Type, Sun, Moon
} from 'lucide-react';
import TidalConnectCard from './TidalConnectCard';
import QobuzConnectCard from './QobuzConnectCard';
import { DebugLogsModal } from './DebugLogsModal';
import { logger } from '../utils/logger';

interface PresetTheme {
  name: string;
  color: string;
  rgb: string;
  description: string;
}

const PRESET_THEMES: PresetTheme[] = [
  { name: 'Purple', color: '#8b5cf6', rgb: '139, 92, 246', description: 'Royal Violet default' },
  { name: 'Forest', color: '#10b981', rgb: '16, 185, 129', description: 'Emerald Deep Green' },
  { name: 'Ocean', color: '#0ea5e9', rgb: '14, 165, 233', description: 'Bright Maritime Blue' },
  { name: 'Mocha', color: '#d97706', rgb: '217, 119, 6', description: 'Amber Warm Cocoa' },
  { name: 'Black', color: '#ffffff', rgb: '255, 255, 255', description: 'Pure Monochromatic White' },
  { name: 'Dark', color: '#64748b', rgb: '100, 116, 139', description: 'Slate Metal Gray' },
  { name: 'White', color: '#0f172a', rgb: '15, 23, 42', description: 'Deep Onyx contrast' },
  { name: 'Frappé', color: '#f2cdcd', rgb: '242, 205, 205', description: 'Soft Pastel Rose' },
  { name: 'Latte', color: '#dc8a78', rgb: '220, 138, 120', description: 'Warm Sunbaked Peach' }
];

const GOOGLE_FONTS = [
  'Outfit',
  'Inter',
  'Roboto',
  'Montserrat',
  'JetBrains Mono',
  'Playfair Display'
];

interface SlidingSwitchProps {
  checked: boolean;
  onChange: () => void;
}

function SlidingSwitch({ checked, onChange }: SlidingSwitchProps) {
  return (
    <motion.div 
      onClick={onChange}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? 'var(--dynamic-accent, #8b5cf6)' : 'var(--glass-h)',
        border: '1px solid var(--glass-border)',
        padding: 2,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        transition: 'background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease',
        boxShadow: checked ? '0 0 10px rgba(var(--accent-rgb), 0.25)' : 'none',
      }}
    >
      <motion.div
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.25)',
        }}
      />
    </motion.div>
  );
}

export function SettingsView() {
  const {
    scanDirs, addScanDir, removeScanDir, scanLibrary, scanStatus,
    toggleScrobble, setLastFmSession, lastfmSessionKey, lastfmToken,
    scrobbleThreshold, setScrobbleThreshold,
    keepAwake, toggleKeepAwake,
    discordEnabled, toggleDiscord,
    lowSpecMode, toggleLowSpecMode,
    dsp, setDSP, playbackExclusive, playbackBitPerfect, toggleExclusive, devices, currentDevice, setAudioDevice, fetchDevices,
    listenbrainzToken, listenbrainzUsername, listenbrainzEnabled,
    validateAndSetListenbrainzToken, setListenbrainzToken, toggleListenbrainzScrobble,
    sidebarLastfmVisible, sidebarListenbrainzVisible,
    toggleSidebarLastfmVisible, toggleSidebarListenbrainzVisible,
    sidebarNavItems, toggleSidebarNavItemVisibility, moveSidebarNavItem, resetSidebarNavItems,
    liquidBackgroundEnabled, toggleLiquidBackground,
    showSmartMixWidget, toggleSmartMixWidget,
    qobuzExperimentalEnabled, toggleQobuzExperimental,
    notificationsEnabled, developerNotifications,
    toggleNotificationsEnabled, toggleDeveloperNotifications,
    subsonicUrl, subsonicUser, subsonicPass, subsonicConnected, subsonicLoading,
    jellyfinUrl, jellyfinConnected, jellyfinLoading,
    connectSubsonic, disconnectSubsonic, connectJellyfin, disconnectJellyfin,
    autoplayDiscoveryLevel, setAutoplayDiscoveryLevel,
    setShowOnboarding, setOnboardingCompleted,
    cacheSizeLimit, setCacheSizeLimit,
    discoverCastDevices,
    resetDislikedTracks,
    colorScheme, setColorScheme, shortcuts, setShortcut,
    albumArtFit, setAlbumArtFit,
    globalHotkeys, setGlobalHotkey,
    playerBarDesign, setPlayerBarDesign,
    aideoPageDesign, setAideoPageDesign,
    theaterModeDesign, setTheaterModeDesign,
    theaterHudStyle, setTheaterHudStyle,
    playerBarTransparent, togglePlayerBarTransparent, setPlayerBarTransparent,
    discoveryLayout, setDiscoveryLayout,
    visualizerMode, setVisualizerMode,
    visualizerDecayRate, setVisualizerDecayRate,
    visualizerExpanded, setVisualizerExpanded
  } = useStore(useShallow(s => ({
    scanDirs: s.scanDirs,
    addScanDir: s.addScanDir,
    removeScanDir: s.removeScanDir,
    scanLibrary: s.scanLibrary,
    scanStatus: s.scanStatus,
    toggleScrobble: s.toggleScrobble,
    setLastFmSession: s.setLastFmSession,
    lastfmSessionKey: s.lastfmSessionKey,
    lastfmToken: s.lastfmToken,
    scrobbleThreshold: s.scrobbleThreshold,
    setScrobbleThreshold: s.setScrobbleThreshold,
    keepAwake: s.keepAwake,
    toggleKeepAwake: s.toggleKeepAwake,
    discordEnabled: s.discordEnabled,
    toggleDiscord: s.toggleDiscord,
    lowSpecMode: s.lowSpecMode,
    toggleLowSpecMode: s.toggleLowSpecMode,
    dsp: s.dsp,
    setDSP: s.setDSP,
    playbackExclusive: s.playback.exclusive,
    playbackBitPerfect: s.playback.bit_perfect,
    toggleExclusive: s.toggleExclusive,
    devices: s.devices,
    currentDevice: s.currentDevice,
    setAudioDevice: s.setAudioDevice,
    fetchDevices: s.fetchDevices,
    listenbrainzToken: s.listenbrainzToken,
    listenbrainzUsername: s.listenbrainzUsername,
    listenbrainzEnabled: s.listenbrainzEnabled,
    validateAndSetListenbrainzToken: s.validateAndSetListenbrainzToken,
    setListenbrainzToken: s.setListenbrainzToken,
    toggleListenbrainzScrobble: s.toggleListenbrainzScrobble,
    sidebarLastfmVisible: s.sidebarLastfmVisible,
    sidebarListenbrainzVisible: s.sidebarListenbrainzVisible,
    toggleSidebarLastfmVisible: s.toggleSidebarLastfmVisible,
    toggleSidebarListenbrainzVisible: s.toggleSidebarListenbrainzVisible,
    sidebarNavItems: s.sidebarNavItems || [],
    toggleSidebarNavItemVisibility: s.toggleSidebarNavItemVisibility,
    moveSidebarNavItem: s.moveSidebarNavItem,
    resetSidebarNavItems: s.resetSidebarNavItems,
    liquidBackgroundEnabled: s.liquidBackgroundEnabled,
    toggleLiquidBackground: s.toggleLiquidBackground,
    showSmartMixWidget: s.showSmartMixWidget,
    toggleSmartMixWidget: s.toggleSmartMixWidget,
    qobuzExperimentalEnabled: s.qobuzExperimentalEnabled,
    toggleQobuzExperimental: s.toggleQobuzExperimental,
    notificationsEnabled: s.notificationsEnabled,
    developerNotifications: s.developerNotifications,
    toggleNotificationsEnabled: s.toggleNotificationsEnabled,
    toggleDeveloperNotifications: s.toggleDeveloperNotifications,
    subsonicUrl: s.subsonicUrl,
    subsonicUser: s.subsonicUser,
    subsonicPass: s.subsonicPass,
    subsonicConnected: s.subsonicConnected,
    subsonicLoading: s.subsonicLoading,
    jellyfinUrl: s.jellyfinUrl,
    jellyfinConnected: s.jellyfinConnected,
    jellyfinLoading: s.jellyfinLoading,
    connectSubsonic: s.connectSubsonic,
    disconnectSubsonic: s.disconnectSubsonic,
    connectJellyfin: s.connectJellyfin,
    disconnectJellyfin: s.disconnectJellyfin,
    autoplayDiscoveryLevel: s.autoplayDiscoveryLevel,
    setAutoplayDiscoveryLevel: s.setAutoplayDiscoveryLevel,
    setShowOnboarding: s.setShowOnboarding,
    setOnboardingCompleted: s.setOnboardingCompleted,
    cacheSizeLimit: s.cacheSizeLimit,
    setCacheSizeLimit: s.setCacheSizeLimit,
    discoverCastDevices: s.discoverCastDevices,
    resetDislikedTracks: s.resetDislikedTracks,
    colorScheme: s.colorScheme,
    setColorScheme: s.setColorScheme,
    shortcuts: s.shortcuts,
    setShortcut: s.setShortcut,
    albumArtFit: s.albumArtFit,
    setAlbumArtFit: s.setAlbumArtFit,
    globalHotkeys: s.globalHotkeys,
    setGlobalHotkey: s.setGlobalHotkey,
    playerBarDesign: s.playerBarDesign,
    setPlayerBarDesign: s.setPlayerBarDesign,
    aideoPageDesign: s.aideoPageDesign,
    setAideoPageDesign: s.setAideoPageDesign,
    theaterModeDesign: s.theaterModeDesign,
    setTheaterModeDesign: s.setTheaterModeDesign,
    theaterHudStyle: s.theaterHudStyle,
    setTheaterHudStyle: s.setTheaterHudStyle,
    playerBarTransparent: s.playerBarTransparent,
    togglePlayerBarTransparent: s.togglePlayerBarTransparent,
    discoveryLayout: s.discoveryLayout,
    setDiscoveryLayout: s.setDiscoveryLayout,
    setPlayerBarTransparent: s.setPlayerBarTransparent,
    visualizerMode: s.visualizerMode,
    setVisualizerMode: s.setVisualizerMode,
    visualizerDecayRate: s.visualizerDecayRate,
    setVisualizerDecayRate: s.setVisualizerDecayRate,
    visualizerExpanded: s.visualizerExpanded,
    setVisualizerExpanded: s.setVisualizerExpanded,
  })));

  // Tab navigation State
  const [activeTab, setActiveTab] = useState<'appearance' | 'library' | 'plugins' | 'scrobbling' | 'audio' | 'system' | 'updates' | 'account' | 'shortcuts'>('appearance');
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const [recordingGlobalAction, setRecordingGlobalAction] = useState<string | null>(null);
  const [showDebugModal, setShowDebugModal] = useState(false);

  useEffect(() => {
    if (!recordingGlobalAction) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecordingGlobalAction(null);
        return;
      }
      if (e.key === 'Backspace') {
        setGlobalHotkey(recordingGlobalAction, null);
        setRecordingGlobalAction(null);
        window.dispatchEvent(new CustomEvent('ui-toast', {
          detail: { message: 'Global hotkey cleared', type: 'info' }
        }));
        return;
      }
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      let keyName = e.key === ' ' ? 'Space' : e.key;
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // wait for the actual key
      if (keyName.length === 1) keyName = keyName.toUpperCase();
      const binding = [...parts, keyName].join('+');
      if (parts.length === 0) {
        window.dispatchEvent(new CustomEvent('ui-toast', {
          detail: { message: 'Global hotkeys need a modifier (Ctrl/Alt/Shift)', type: 'warning' }
        }));
        return;
      }
      setGlobalHotkey(recordingGlobalAction, binding);
      setRecordingGlobalAction(null);
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Global hotkey bound to ${binding}`, type: 'success' }
      }));
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordingGlobalAction, setGlobalHotkey]);

  // Cache Size & Usage State
  const [cacheInfo, setCacheInfo] = useState<{ bytes: number; formatted: string; count: number }>({ bytes: 0, formatted: 'Calculating...', count: 0 });

  const fetchCacheInfo = useCallback(async () => {
    try {
      const info: any = await invoke('get_cache_size_info');
      if (info) setCacheInfo(info);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchCacheInfo();
  }, [fetchCacheInfo, cacheSizeLimit]);

  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const keyName = e.key === ' ' ? 'Space' : e.key;
      setShortcut(recordingAction, keyName);
      setRecordingAction(null);

      window.dispatchEvent(new CustomEvent('ui-toast', { 
        detail: { message: `Shortcut bound to ${keyName}`, type: 'success' } 
      }));
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recordingAction, setShortcut]);

  const resetShortcuts = () => {
    localStorage.removeItem('aideo-keyboard-shortcuts');
    setShortcut('playPause', 'Space');
    setShortcut('next', 'ArrowRight');
    setShortcut('prev', 'ArrowLeft');
    setShortcut('volumeUp', 'ArrowUp');
    setShortcut('volumeDown', 'ArrowDown');
    setShortcut('dspBypass', 'b');
    setShortcut('mute', 'm');
    setShortcut('fullscreenToggle', 'F11');
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: 'Keyboard shortcuts restored to defaults', type: 'info' } 
    }));
  };
  const [searchQuery, setSearchQuery] = useState('');

  // Subsonic / Navidrome local input states
  const [subsonicUrlInput, setSubsonicUrlInput] = useState(subsonicUrl || '');
  const [subsonicUserInput, setSubsonicUserInput] = useState(subsonicUser || '');
  const [subsonicPassInput, setSubsonicPassInput] = useState(subsonicPass || '');
  const [subsonicError, setSubsonicError] = useState('');

  // Jellyfin local input states
  const [jellyfinUrlInput, setJellyfinUrlInput] = useState(jellyfinUrl || '');
  const [jellyfinApiKeyInput, setJellyfinApiKeyInput] = useState(localStorage.getItem('aideo_jellyfin_api_key') || '');
  const [jellyfinError, setJellyfinError] = useState('');

  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>('get_remote_connection_url')
      .then(setRemoteUrl)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (activeTab === 'system') {
      discoverCastDevices();
    }
  }, [activeTab]);

  // Sync inputs with store values on change or reset
  useEffect(() => {
    setSubsonicUrlInput(subsonicUrl);
    setSubsonicUserInput(subsonicUser);
    setSubsonicPassInput(subsonicPass || '');
  }, [subsonicUrl, subsonicUser, subsonicPass]);

  useEffect(() => {
    setJellyfinUrlInput(jellyfinUrl);
    setJellyfinApiKeyInput(localStorage.getItem('aideo_jellyfin_api_key') || '');
  }, [jellyfinUrl]);

  // Connected services loading
  const [lfmLoading, setLfmLoading] = useState(false);
  const [lfmError, setLfmError] = useState('');
  const [lbToken, setLbToken] = useState('');
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState('');
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const [devOpen, setDevOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Theme & Appearance states
  const [themeMode, setThemeMode] = useState<'dynamic' | 'preset' | 'windows'>(() => {
    return (localStorage.getItem('aideo-theme-mode') as 'dynamic' | 'preset' | 'windows') || 'dynamic';
  });
  const [presetColor, setPresetColor] = useState(() => {
    return localStorage.getItem('aideo-preset-color') || '#8b5cf6';
  });
  const [presetRgb, setPresetRgb] = useState(() => {
    return localStorage.getItem('aideo-preset-rgb') || '139, 92, 246';
  });
  const [selectedFont, setSelectedFont] = useState(() => {
    return localStorage.getItem('aideo-font') || 'Outfit';
  });
  const [fontScale, setFontScale] = useState<number>(() => {
    return Number(localStorage.getItem('aideo-font-scale')) || 100;
  });
  const [customColor, setCustomColor] = useState('#8b5cf6');
  const [autoplayLocal, setAutoplayLocal] = useState(() => {
    return localStorage.getItem('aideo_autoplay_local_for_cloud') === 'true';
  });
  const [closeToTray, setCloseToTray] = useState(() => {
    return localStorage.getItem('aideo_close_to_tray') === 'true';
  });

  // Tab-specific reset handlers
  const resetAppearance = () => {
    setThemeMode('dynamic');
    setSelectedFont('Outfit');
    setFontScale(100);
    setPlayerBarDesign('classic');
    setTheaterModeDesign('stage');
    setPlayerBarTransparent(false);
    if (!liquidBackgroundEnabled) toggleLiquidBackground();
    if (!sidebarLastfmVisible) toggleSidebarLastfmVisible();
    if (!sidebarListenbrainzVisible) toggleSidebarListenbrainzVisible();
    if (!showSmartMixWidget) toggleSmartMixWidget();
    
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: 'Appearance settings restored to defaults!', type: 'success' } 
    }));
  };

  const resetLibrary = () => {
    scanDirs.forEach(dir => removeScanDir(dir));
    disconnectSubsonic();
    disconnectJellyfin();
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: 'Library storage paths & cloud servers restored to defaults.', type: 'success' } 
    }));
  };

  const resetScrobbling = () => {
    setLastFmSession(null);
    localStorage.removeItem('lastfm_scrobble_enabled');
    setListenbrainzToken(null);
    localStorage.removeItem('listenbrainz_enabled');
    setScrobbleThreshold(50);
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: 'Scrobbling statistics & user tokens cleared.', type: 'success' } 
    }));
  };

  const resetAudio = async () => {
    await setDSP({
      enabled: true,
      width: 1.0,
      upsample_rate: 0,
      dither: false,
      crossfeed_enabled: false,
      crossfeed_level: -12.0,
      spatial_enabled: false,
      spatial_haas_delay: 15.0,
      spatial_wet: 0.5
    });
    const hasSavedDirectOutputMode =
      localStorage.getItem('aideo_exclusive_mode') === 'true' ||
      localStorage.getItem('aideo_bit_perfect_mode') === 'true';
    if (useStore.getState().playback.exclusive || useStore.getState().playback.bit_perfect || hasSavedDirectOutputMode) {
      await toggleExclusive(false);
    }
    
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: 'Audio hardware engine restored to bit-perfect flat!', type: 'success' } 
    }));
  };

  const resetSystem = async () => {
    if (keepAwake) await toggleKeepAwake();
    if (!discordEnabled) toggleDiscord();
    if (lowSpecMode) toggleLowSpecMode();
    disconnectSubsonic();
    disconnectJellyfin();
    setAutoplayDiscoveryLevel('balanced');
    setCacheSizeLimit(5.0);
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: 'System extensions, cloud credentials & calibrations reset.', type: 'success' } 
    }));
  };

  // Load and apply Google Fonts dynamically
  useEffect(() => {
    localStorage.setItem('aideo-font', selectedFont);
    const existingLink = document.getElementById('aideo-custom-font');
    if (existingLink) existingLink.remove();

    if (selectedFont !== 'Outfit') {
      const link = document.createElement('link');
      link.id = 'aideo-custom-font';
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${selectedFont.replace(' ', '+')}:wght@300;400;500;600;700;800&display=swap`;
      document.head.appendChild(link);
    }
    document.documentElement.style.setProperty('--font-family', selectedFont === 'Outfit' ? "'Outfit', sans-serif" : `'${selectedFont}', sans-serif`);
  }, [selectedFont]);

  // Apply Font Scale
  useEffect(() => {
    localStorage.setItem('aideo-font-scale', fontScale.toString());
    document.documentElement.style.fontSize = `${fontScale}%`;
  }, [fontScale]);

  // Apply Theme Mode
  useEffect(() => {
    localStorage.setItem('aideo-theme-mode', themeMode);
    if (themeMode === 'preset') {
      localStorage.setItem('aideo-preset-color', presetColor);
      localStorage.setItem('aideo-preset-rgb', presetRgb);
      document.documentElement.style.setProperty('--dynamic-accent', presetColor);
      document.documentElement.style.setProperty('--accent-rgb', presetRgb);
    } else if (themeMode === 'windows') {
      invoke('get_windows_accent_color')
        .then((color: any) => {
          document.documentElement.style.setProperty('--dynamic-accent', color);
          applyRgbFromHex(color);
        })
        .catch(err => console.error("Failed to get windows accent color:", err));
    } else {
      const storeAccent = useStore.getState().accentColor;
      document.documentElement.style.setProperty('--dynamic-accent', storeAccent);
      applyRgbFromHex(storeAccent);
    }
  }, [themeMode, presetColor, presetRgb]);

  const applyRgbFromHex = (hexColor: string) => {
    let r = 139, g = 92, b = 246;
    if (hexColor.startsWith('rgb')) {
      const m = hexColor.match(/\d+/g);
      if (m && m.length >= 3) {
        r = parseInt(m[0]); g = parseInt(m[1]); b = parseInt(m[2]);
      }
    } else if (hexColor.startsWith('#')) {
      const hex = hexColor.replace('#', '');
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }
    document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);
  };

  const handleSelectPreset = (preset: PresetTheme) => {
    setThemeMode('preset');
    setPresetColor(preset.color);
    setPresetRgb(preset.rgb);
    window.dispatchEvent(new CustomEvent('ui-toast', { 
      detail: { message: `Accent theme set to static preset: ${preset.name}`, type: 'success' } 
    }));
  };

  const handleCustomColorSubmit = (hex: string) => {
    setCustomColor(hex);
    // Convert hex to rgb
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    const rgbStr = `${r}, ${g}, ${b}`;
    
    setThemeMode('preset');
    setPresetColor(hex);
    setPresetRgb(rgbStr);
  };

  const browse = async () => {
    const sel = await open({ directory: true, multiple: false }).catch(() => null);
    if (sel && typeof sel === 'string') addScanDir(sel);
  };



  useEffect(() => {
    fetchDevices();
  }, []);

  // Filter-indexing engine for settings search
  const settingsItems = [
    {
      id: 'theme',
      title: 'Appearance Theme & Accent',
      description: 'Select dynamic colors extracted from album art, OS system accent, or custom presets.',
      keywords: 'theme appearance style layout accent color green blue black white forest ocean mocha pink frappé custom palette colorpicker',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-ctrl-header-row">
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: 0.5 }}>
              Mode
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                className={`btn ${themeMode === 'dynamic' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '6px 12px' }}
                onClick={() => setThemeMode('dynamic')}
              >
                Dynamic Art
              </button>
              <button 
                className={`btn ${themeMode === 'preset' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '6px 12px' }}
                onClick={() => setThemeMode('preset')}
              >
                Static Preset
              </button>
              <button 
                className={`btn ${themeMode === 'windows' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '6px 12px' }}
                onClick={() => setThemeMode('windows')}
              >
                Windows Accent
              </button>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: 0.5, marginBottom: 12 }}>
              Presets
            </div>
            <div className="settings-theme-grid">
              {/* Dynamic / System chip */}
              <div 
                className={`settings-theme-chip ${themeMode === 'dynamic' ? 'active' : ''}`}
                onClick={() => setThemeMode('dynamic')}
              >
                <div className="settings-chip-color" style={{ background: 'linear-gradient(135deg, #a855f7, #ec4899, #3b82f6)' }}>
                  <Sparkles size={12} color="white" />
                </div>
                <div className="settings-chip-info">
                  <div className="settings-chip-name">Album Dynamic</div>
                  <div className="settings-chip-desc">Extracted from cover art</div>
                </div>
              </div>

              {/* Windows Accent chip */}
              <div 
                className={`settings-theme-chip ${themeMode === 'windows' ? 'active' : ''}`}
                onClick={() => setThemeMode('windows')}
              >
                <div className="settings-chip-color" style={{ background: 'linear-gradient(135deg, #2563eb, #3b82f6, #60a5fa)' }}>
                  <Laptop size={12} color="white" />
                </div>
                <div className="settings-chip-info">
                  <div className="settings-chip-name">Windows Accent</div>
                  <div className="settings-chip-desc">Sync with OS color</div>
                </div>
              </div>

              {/* Standard chips */}
              {PRESET_THEMES.map((theme) => {
                const isActive = themeMode === 'preset' && presetColor.toLowerCase() === theme.color.toLowerCase();
                return (
                  <div 
                    key={theme.name}
                    className={`settings-theme-chip ${isActive ? 'active' : ''}`}
                    onClick={() => handleSelectPreset(theme)}
                  >
                    <div className="settings-chip-color" style={{ backgroundColor: theme.color }} />
                    <div className="settings-chip-info">
                      <div className="settings-chip-name">{theme.name}</div>
                      <div className="settings-chip-desc">{theme.description}</div>
                    </div>
                  </div>
                );
              })}

              {/* Custom color chip */}
              <div 
                className={`settings-theme-chip custom-color-chip ${themeMode === 'preset' && !PRESET_THEMES.some(t => t.color.toLowerCase() === presetColor.toLowerCase()) ? 'active' : ''}`}
                style={{ position: 'relative' }}
              >
                <label style={{ display: 'flex', width: '100%', height: '100%', cursor: 'pointer', alignItems: 'center', gap: 10 }}>
                  <div className="settings-chip-color" style={{ backgroundColor: customColor, border: '1px solid var(--glass-border)' }}>
                    <Plus size={10} color="white" />
                  </div>
                  <div className="settings-chip-info">
                    <div className="settings-chip-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Custom Color
                    </div>
                    <div className="settings-chip-desc">Hex color picker</div>
                  </div>
                  <input 
                    type="color" 
                    value={customColor} 
                    onChange={(e) => handleCustomColorSubmit(e.target.value)}
                    style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer' }}
                  />
                </label>
              </div>

            </div>
          </div>
        </div>
      )
    },
    {
      id: 'dark-light-mode',
      title: 'Color Scheme Mode',
      description: 'Switch between Dark mode, Light mode, or follow your OS system preference.',
      keywords: 'dark light system theme toggle mode appearance white black transparent glass',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-ctrl-header-row">
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Theme Mode</span>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Switch between high-contrast Dark mode, crisp Light mode, or follow OS system preference.
              </div>
            </div>
            <div className="theme-mode-segmented">
              <button 
                type="button"
                className={`theme-mode-option ${colorScheme === 'dark' ? 'active' : ''}`}
                onClick={() => setColorScheme('dark')}
              >
                <Moon size={13} />
                <span>Dark</span>
              </button>
              <button 
                type="button"
                className={`theme-mode-option ${colorScheme === 'light' ? 'active' : ''}`}
                onClick={() => setColorScheme('light')}
              >
                <Sun size={13} />
                <span>Light</span>
              </button>
              <button 
                type="button"
                className={`theme-mode-option ${colorScheme === 'system' ? 'active' : ''}`}
                onClick={() => setColorScheme('system')}
              >
                <Laptop size={13} />
                <span>System</span>
              </button>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'global-hotkeys-config',
      title: 'Global Hotkeys (System-Wide)',
      description: 'Control playback from anywhere in Windows, even when Aideo is minimized in the system tray.',
      keywords: 'global hotkey shortcut system wide minimized tray background play pause next prev control',
      tab: 'shortcuts',
      element: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
            Press Record, then enter key combination with a modifier (Ctrl / Alt / Shift). Press Backspace while recording to clear.
          </div>
          {[
            { id: 'playPause', label: 'Play / Pause' },
            { id: 'next', label: 'Next Track' },
            { id: 'prev', label: 'Previous Track' }
          ].map(action => {
            const isRecording = recordingGlobalAction === action.id;
            const binding = globalHotkeys[action.id];
            return (
              <div
                key={action.id}
                className="settings-ctrl-card"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: isRecording ? 'rgba(var(--accent-rgb), 0.05)' : '',
                  borderColor: isRecording ? 'var(--accent)' : '',
                  transition: 'all 0.2s'
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{action.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    Global shortcut
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: isRecording ? 'var(--accent)' : binding ? 'var(--text)' : 'var(--text-dim)'
                    }}
                  >
                    {isRecording ? 'Press Ctrl/Alt/Shift + key...' : binding || 'Not set'}
                  </div>
                  <button
                    className={`btn ${isRecording ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: 11, padding: '6px 12px' }}
                    onClick={() => setRecordingGlobalAction(isRecording ? null : action.id)}
                  >
                    {isRecording ? 'Cancel' : binding ? 'Rebind' : 'Record'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )
    },
    {
      id: 'keyboard-shortcuts-config',
      title: 'In-App Keyboard Shortcuts',
      description: 'Customize keyboard shortcuts for player operations when the application window is focused.',
      keywords: 'keyboard shortcuts hotkeys customization bind keys control play pause next prev volume',
      tab: 'shortcuts',
      element: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { id: 'playPause', label: 'Play / Pause' },
            { id: 'next', label: 'Next Track' },
            { id: 'prev', label: 'Previous Track' },
            { id: 'volumeUp', label: 'Volume Up' },
            { id: 'volumeDown', label: 'Volume Down' },
            { id: 'mute', label: 'Mute / Unmute' },
            { id: 'dspBypass', label: 'DSP A/B Bypass Toggle' },
            { id: 'fullscreenToggle', label: 'Toggle Fullscreen Window' }
          ].map(action => {
            const isRecording = recordingAction === action.id;
            return (
              <div 
                key={action.id} 
                className="settings-ctrl-card" 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  background: isRecording ? 'rgba(var(--accent-rgb), 0.05)' : '',
                  borderColor: isRecording ? 'var(--accent)' : '',
                  transition: 'all 0.2s'
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{action.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    Trigger action when pressed
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div 
                    style={{ 
                      padding: '6px 12px', 
                      background: 'rgba(0,0,0,0.3)', 
                      border: '1px solid var(--glass-border)', 
                      borderRadius: 6, 
                      fontSize: 12, 
                      fontWeight: 700, 
                      fontFamily: 'monospace',
                      color: isRecording ? 'var(--accent)' : 'var(--text)'
                    }}
                  >
                    {isRecording ? 'Press any key...' : shortcuts[action.id] || 'None'}
                  </div>
                  <button 
                    className={`btn ${isRecording ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: 11, padding: '6px 12px' }}
                    onClick={() => setRecordingAction(isRecording ? null : action.id)}
                  >
                    {isRecording ? 'Cancel' : 'Record'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )
    },
    {
      id: 'sidebar-visibility',
      title: 'Sidebar Navigation Items',
      description: 'Customize visibility and reorder navigation items in the left sidebar.',
      keywords: 'sidebar menu visible toggle hide show reorder order navigation customize lastfm stats listenbrainz clean layout configuration optimize layout settings',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--glass)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--glass-border)', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', flex: 1, minWidth: 200 }}>
                Customize which items appear in the sidebar and reorder them with the arrow buttons. At least one navigation item must remain active.
              </span>
              <button
                className="btn-glass"
                onClick={resetSidebarNavItems}
                style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer' }}
                title="Reset sidebar navigation items to default order and visibility"
              >
                <RotateCcw size={12} />
                <span>Reset to Default</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {sidebarNavItems.map((item, index) => {
                let icon = <Sparkles size={16} />;
                let subtitle = '';
                if (item.id === 'aideo') {
                  icon = <Sparkles size={16} />;
                  subtitle = 'AI Music Companion & Discovery';
                } else if (item.id === 'charts') {
                  icon = <TrendingUp size={16} />;
                  subtitle = 'Global Top Streaming Charts (Hybrid mode)';
                } else if (item.id === 'library') {
                  icon = <Library size={16} />;
                  subtitle = 'All Tracks & Local Library';
                } else if (item.id === 'nowplaying') {
                  icon = <Headphones size={16} />;
                  subtitle = 'Now Playing Fullscreen / Player View';
                } else if (item.id === 'loved_streams') {
                  icon = <Heart size={16} />;
                  subtitle = 'Loved Online Streams & Radios (Hybrid mode)';
                } else if (item.id === 'downloaded') {
                  icon = <DownloadCloud size={16} />;
                  subtitle = 'Offline Cached & Downloaded Songs';
                } else if (item.id === 'aideo_lab') {
                  icon = <Activity size={16} />;
                  subtitle = 'Studio DSP, Equalizer & Audio Lab';
                } else if (item.id === 'insights') {
                  icon = <BarChart3 size={16} />;
                  subtitle = 'Personal Listening Analytics & Insights';
                } else if (item.id === 'lastfm') {
                  icon = <Radio size={16} />;
                  subtitle = 'Last.fm Scrobble Stats & Profile';
                } else if (item.id === 'listenbrainz') {
                  icon = <Radio size={16} style={{ color: 'rgba(235, 116, 59, 0.95)' }} />;
                  subtitle = 'ListenBrainz Open Feed & Scrobbling';
                }

                const isFirst = index === 0;
                const isLast = index === sidebarNavItems.length - 1;
                const visibleCount = sidebarNavItems.filter(i => i.visible).length;
                const disableToggle = item.visible && visibleCount <= 1;

                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'var(--glass)',
                      borderRadius: 8,
                      border: '1px solid var(--glass-border)',
                      opacity: item.visible ? 1 : 0.6,
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                      <div style={{ color: item.visible ? 'var(--text)' : 'var(--text-dim)', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                        {icon}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{item.label}</span>
                          {item.requiresHybrid && (
                            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', fontWeight: 600, textTransform: 'uppercase' }}>Hybrid</span>
                          )}
                          {item.requiresAuth && (
                            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6', fontWeight: 600, textTransform: 'uppercase' }}>Service</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {subtitle}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <div style={{ display: 'flex', gap: 2 }}>
                        <button
                          className="icon-btn"
                          disabled={isFirst}
                          onClick={() => moveSidebarNavItem(index, 'up')}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--glass-border)',
                            borderRadius: 4,
                            padding: 4,
                            color: isFirst ? 'var(--text-dim)' : 'var(--text)',
                            cursor: isFirst ? 'not-allowed' : 'pointer',
                            opacity: isFirst ? 0.3 : 1
                          }}
                          title="Move up"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          className="icon-btn"
                          disabled={isLast}
                          onClick={() => moveSidebarNavItem(index, 'down')}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--glass-border)',
                            borderRadius: 4,
                            padding: 4,
                            color: isLast ? 'var(--text-dim)' : 'var(--text)',
                            cursor: isLast ? 'not-allowed' : 'pointer',
                            opacity: isLast ? 0.3 : 1
                          }}
                          title="Move down"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                      <SlidingSwitch
                        checked={item.visible}
                        onChange={() => {
                          if (!disableToggle) {
                            toggleSidebarNavItemVisibility(item.id);
                          }
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Smart Mix Builder Visibility Switch */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px', borderTop: '1px solid var(--glass-border)', marginTop: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Smart Mix Builder Card</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Display smart mix generator card on home portal</div>
              </div>
              <SlidingSwitch 
                checked={showSmartMixWidget} 
                onChange={toggleSmartMixWidget} 
              />
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'system-notifications',
      title: 'Toast Notifications',
      description: 'Configure overlay toast alerts and developer diagnostic messaging.',
      keywords: 'notifications toast popups alert messages appearance UI settings mute enable disable developer diagnostics debug error logs system level',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Notifications Enabled Toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 2px' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>System Overlay Toasts</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  Show real-time notifications for actions, playback events, and errors
                </div>
              </div>
              <SlidingSwitch 
                checked={notificationsEnabled} 
                onChange={toggleNotificationsEnabled} 
              />
            </div>

            {/* Developer Diagnostics Mode Toggle */}
            <div 
              style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '6px 2px', 
                borderTop: '1px solid var(--glass-border)',
                opacity: notificationsEnabled ? 1 : 0.5,
                transition: 'opacity 0.2s',
                pointerEvents: notificationsEnabled ? 'auto' : 'none'
              }}
            >
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Developer Diagnostics Mode</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  Include internal error context and telemetry in error alerts
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <SlidingSwitch 
                  checked={developerNotifications} 
                  onChange={toggleDeveloperNotifications} 
                />
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'liquid-backdrop',
      title: 'Audio-Reactive Liquid Backdrop',
      description: 'Render animated fluid gradient waves behind Now Playing synced to cover art colors and audio tempo (disabled in Low-Spec Mode).',
      keywords: 'liquid backdrop background dynamic webgl dynamic waves audio reactive animated visualizer settings option layout appearance',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Dynamic Fluid Waves</span>
          <SlidingSwitch 
            checked={liquidBackgroundEnabled} 
            onChange={toggleLiquidBackground} 
          />
        </div>
      )
    },
    {
      id: 'album-art-fit',
      title: 'Album Artwork Fit',
      description: 'Choose how non-square covers are presented (contain with ambient background blur vs. crop to fill).',
      keywords: 'album art artwork aspect ratio fit cover contain blur ambient padding obi singles rectangular appearance',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Fitting Mode</span>
          <div style={{ display: 'flex', gap: 6, background: 'var(--glass-h)', padding: 4, borderRadius: 10 }}>
            <button
              onClick={() => setAlbumArtFit('contain')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: albumArtFit === 'contain' ? 'var(--accent, #8b5cf6)' : 'transparent',
                color: albumArtFit === 'contain' ? 'white' : 'var(--text-dim)',
                transition: 'all 0.2s ease'
              }}
            >
              Aspect Fit (Blur)
            </button>
            <button
              onClick={() => setAlbumArtFit('cover')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: albumArtFit === 'cover' ? 'var(--accent, #8b5cf6)' : 'transparent',
                color: albumArtFit === 'cover' ? 'white' : 'var(--text-dim)',
                transition: 'all 0.2s ease'
              }}
            >
              Aspect Fill (Crop)
            </button>
          </div>
        </div>
      )
    },
    {
      id: 'discovery-layout',
      title: 'Discovery Hub Layout',
      description: 'Choose how recommendations and smart mixes are organized in the Discovery Hub view.',
      keywords: 'discovery hub layout shelves unified multi-shelf feed mix playlists recommendations appearance UI',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Feed Style</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button 
              className={`btn ${discoveryLayout === 'shelves' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setDiscoveryLayout('shelves')}
            >
              <Layers size={13} />
              Multi-Shelf
            </button>
            <button 
              className={`btn ${discoveryLayout === 'unified' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: 11, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => setDiscoveryLayout('unified')}
            >
              <LayoutGrid size={13} />
              Unified Feed
            </button>
          </div>
        </div>
      )
    },
    {
      id: 'theater-mode-design',
      title: 'Theater & Fullscreen Style',
      description: 'Choose your default visual archetype for Theater Fullscreen mode.',
      keywords: 'theater fullscreen layout style design stage zen studio vinyl turntable poster scope visualizer appearance UI',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {[
              {
                id: 'stage' as TheaterModeDesign,
                name: 'Stage View',
                badge: 'MODERN',
                badgeColor: '#8b5cf6',
                icon: <Tv2 size={18} color="#a78bfa" />,
                desc: 'Balanced 2-column layout with high-contrast album artwork and smooth karaoke word-by-word synced lyrics.',
              },
              {
                id: 'zen' as TheaterModeDesign,
                name: 'Zen Mode',
                badge: 'MINIMAL',
                badgeColor: '#10b981',
                icon: <Type size={18} color="#34d399" />,
                desc: 'Typographic focus with generous whitespace, centered lyric typography, and minimal ambient art pill.',
              },
              {
                id: 'studio' as TheaterModeDesign,
                name: 'Hi-Fi Studio Deck',
                badge: 'AUDIOPHILE',
                badgeColor: '#f59e0b',
                icon: <Sliders size={18} color="#fbbf24" />,
                desc: 'Vintage analog studio console with dual ballistic needle VU meters, signal path telemetry, and realtime oscilloscope.',
              },
              {
                id: 'vinyl' as TheaterModeDesign,
                name: 'Vinyl Turntable',
                badge: 'ANALOG WARMTH',
                badgeColor: '#ec4899',
                icon: <Disc size={18} color="#f472b6" />,
                desc: 'Realistic 33⅓ RPM rotating vinyl with micro-groove sheen, physical tonearm tracking progress, and propped jacket.',
              },
              {
                id: 'poster' as TheaterModeDesign,
                name: 'Editorial Poster',
                badge: 'SWISS GRID',
                badgeColor: '#06b6d4',
                icon: <FileText size={18} color="#22d3ee" />,
                desc: 'Swiss broadsheet layout with bold solid-ink typography, asymmetric grid, and album liner notes archive.',
              },
              {
                id: 'scope' as TheaterModeDesign,
                name: 'Pure Scope',
                badge: 'IMMERSIVE',
                badgeColor: '#a855f7',
                icon: <Activity size={18} color="#c084fc" />,
                desc: 'Full-bleed 60fps audio reactive vector scope modulated by 64 FFT bands with an ethereal auto-dimming lyric overlay.',
              },
            ].map((d) => {
              const isSelected = theaterModeDesign === d.id;
              return (
                <div
                  key={d.id}
                  onClick={() => setTheaterModeDesign(d.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: 16,
                    borderRadius: 12,
                    border: isSelected ? '1px solid var(--accent, #8b5cf6)' : '1px solid var(--glass-border)',
                    background: isSelected ? 'rgba(var(--accent-rgb, 139, 92, 246), 0.08)' : 'var(--glass)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {d.icon}
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{d.name}</span>
                      </div>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: `${d.badgeColor}22`,
                          color: d.badgeColor,
                          border: `1px solid ${d.badgeColor}44`,
                          letterSpacing: '0.5px',
                        }}
                      >
                        {d.badge}
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45, margin: 0 }}>
                      {d.desc}
                    </p>
                  </div>
                  {isSelected && (
                    <div
                      style={{
                        marginTop: 10,
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--accent, #8b5cf6)',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                      }}
                    >
                      ✓ Active Persona
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )
    },
    {
      id: 'theater-hud-style',
      title: 'Theater Playback HUD Style',
      description: 'Choose your preferred tailored floating playback bar in Theater / Fullscreen mode.',
      keywords: 'theater fullscreen hud playback bar floating capsule master minimal analog controls appearance UI',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {[
              {
                id: 'capsule' as TheaterHudStyle,
                name: 'Floating Studio Capsule',
                badge: 'DEFAULT / ISLAND',
                badgeColor: '#8b5cf6',
                icon: <Radio size={18} color="#a78bfa" />,
                desc: 'Balanced floating island pill with rounded glassmorphism, wave scrubber, centered transport, and quick tool popovers.',
                visual: (
                  <div className="thud-prev-box prev-capsule">
                    <div className="thud-prev-pill">
                      <div className="thud-prev-dot" style={{ background: '#8b5cf6' }} />
                      <div className="thud-prev-meta-line" style={{ width: '40px' }} />
                      <div className="thud-prev-controls">
                        <div className="thud-prev-btn" />
                        <div className="thud-prev-btn-play" style={{ background: '#8b5cf6' }} />
                        <div className="thud-prev-btn" />
                      </div>
                      <div className="thud-prev-meta-line" style={{ width: '28px' }} />
                    </div>
                  </div>
                )
              },
              {
                id: 'master' as TheaterHudStyle,
                name: 'Audiophile Master Deck',
                badge: 'PRO AUDIO / RACK',
                badgeColor: '#06b6d4',
                icon: <Sliders size={18} color="#22d3ee" />,
                desc: 'Precision studio rack chassis with brushed chamfered trim, segmented LED peak level indicators, and monospace telemetry.',
                visual: (
                  <div className="thud-prev-box prev-master">
                    <div className="thud-prev-rack">
                      <div className="thud-prev-screw left" />
                      <div className="thud-prev-leds">
                        <span className="thud-led green" />
                        <span className="thud-led green" />
                        <span className="thud-led yellow" />
                        <span className="thud-led red" />
                      </div>
                      <div className="thud-prev-center-deck">
                        <div className="thud-prev-btn square" />
                        <div className="thud-prev-btn-play square" style={{ background: '#06b6d4' }} />
                        <div className="thud-prev-btn square" />
                      </div>
                      <div className="thud-prev-telemetry">24/96k</div>
                      <div className="thud-prev-screw right" />
                    </div>
                  </div>
                )
              },
              {
                id: 'minimal' as TheaterHudStyle,
                name: 'Zen Minimalist Hairline',
                badge: 'ZERO DISTRACTION',
                badgeColor: '#10b981',
                icon: <Type size={18} color="#34d399" />,
                desc: 'Ultra low-profile hairline strip that sits quietly at the edge, dedicating maximum screen canvas to album art and lyrics.',
                visual: (
                  <div className="thud-prev-box prev-minimal">
                    <div className="thud-prev-hairline">
                      <div className="thud-prev-line-progress" />
                      <div className="thud-prev-minimal-btns">
                        <div className="thud-prev-btn-sm" />
                        <div className="thud-prev-btn-play sm" style={{ background: '#10b981' }} />
                        <div className="thud-prev-btn-sm" />
                      </div>
                    </div>
                  </div>
                )
              },
              {
                id: 'analog' as TheaterHudStyle,
                name: 'Retro Turntable Strip',
                badge: 'VINTAGE HI-FI',
                badgeColor: '#f59e0b',
                icon: <Disc size={18} color="#fbbf24" />,
                desc: 'Warm analog console with golden amber glow, vintage mechanical switches, retro VU levels, and tube-stage warmth.',
                visual: (
                  <div className="thud-prev-box prev-analog">
                    <div className="thud-prev-analog-console">
                      <div className="thud-prev-vu-strip">
                        <div className="thud-prev-vu-fill" />
                      </div>
                      <div className="thud-prev-center-deck">
                        <div className="thud-prev-btn round amber" />
                        <div className="thud-prev-btn-play round" style={{ background: '#f59e0b' }} />
                        <div className="thud-prev-btn round amber" />
                      </div>
                      <div className="thud-prev-analog-badge">VU STEREO</div>
                    </div>
                  </div>
                )
              },
            ].map((d) => {
              const isSelected = theaterHudStyle === d.id;
              return (
                <div
                  key={d.id}
                  onClick={() => {
                    setTheaterHudStyle(d.id);
                    window.dispatchEvent(new CustomEvent('ui-toast', {
                      detail: { message: `Switched Theater HUD style to ${d.name}!`, type: 'success' }
                    }));
                  }}
                  className={`settings-design-card ${isSelected ? 'active' : ''}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: 16,
                    borderRadius: 14,
                    border: isSelected ? '1.5px solid var(--accent, #8b5cf6)' : '1px solid var(--glass-border)',
                    background: isSelected ? 'rgba(var(--accent-rgb, 139, 92, 246), 0.08)' : 'var(--glass)',
                    cursor: 'pointer',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    position: 'relative',
                    gap: 12,
                    boxShadow: isSelected ? '0 8px 24px rgba(var(--accent-rgb), 0.2)' : 'none'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: isSelected ? 'rgba(var(--accent-rgb), 0.2)' : 'var(--glass-h)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {d.icon}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{d.name}</div>
                          <span style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: d.badgeColor,
                            background: `${d.badgeColor}18`,
                            padding: '2px 6px',
                            borderRadius: 4,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5
                          }}>
                            {d.badge}
                          </span>
                        </div>
                      </div>
                      <div style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        border: isSelected ? '5px solid var(--accent, #8b5cf6)' : '2px solid var(--glass-border)',
                        background: isSelected ? '#fff' : 'transparent',
                        transition: 'all 0.2s ease',
                        flexShrink: 0
                      }} />
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4, margin: '6px 0 0', minHeight: 32 }}>
                      {d.desc}
                    </p>
                  </div>
                  {d.visual}
                  {isSelected && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--accent, #8b5cf6)',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                      }}
                    >
                      ✓ Active HUD Style
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )
    },
    {
      id: 'aideo-page-design',
      title: 'Home Page Layout',
      description: 'Select your visual layout for the main Aideo home screen.',
      keywords: 'aideo page layout design theme editorial command stage classic studio home portal appearance UI',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {[
              {
                id: 'classic' as AideoPageDesign,
                name: 'Classic Studio',
                badge: 'Balanced Hub',
                badgeColor: '#3b82f6',
                icon: <Layers size={18} color="#60a5fa" />,
                desc: 'Comprehensive multi-shelf discovery layout with live library stats, quick recap grid, and dynamic smart mix builder.',
                visual: (
                  <div className="aideo-prev-box prev-classic">
                    <div className="aideo-prev-greeting">
                      <div className="aideo-prev-line title" />
                      <div className="aideo-prev-stats-group">
                        <div className="aideo-prev-stat-pill" />
                        <div className="aideo-prev-stat-pill" />
                      </div>
                    </div>
                    <div className="aideo-prev-shelf">
                      <div className="aideo-prev-thumb sm" />
                      <div className="aideo-prev-thumb sm" />
                      <div className="aideo-prev-thumb sm" />
                      <div className="aideo-prev-thumb sm" />
                    </div>
                    <div className="aideo-prev-recap-grid">
                      <div className="aideo-prev-recap-card" />
                      <div className="aideo-prev-recap-card" />
                    </div>
                  </div>
                )
              },
              {
                id: 'editorial' as AideoPageDesign,
                name: 'Editorial Feed',
                badge: 'Calm / Art-first',
                badgeColor: '#a855f7',
                icon: <LayoutGrid size={18} color="#c084fc" />,
                desc: 'One calm centered column: quiet stats, hero web search, and art-forward recommendation shelves with a reason line under every section.',
                visual: (
                  <div className="aideo-prev-box prev-bento">
                    <div className="aideo-prev-line title" style={{ width: '55%' }} />
                    <div className="aideo-prev-line xs" style={{ width: '80%' }} />
                    <div className="aideo-prev-shelf">
                      <div className="aideo-prev-thumb sm" />
                      <div className="aideo-prev-thumb sm" />
                      <div className="aideo-prev-thumb sm" />
                      <div className="aideo-prev-thumb sm" />
                    </div>
                    <div className="aideo-prev-line xs" style={{ width: '65%' }} />
                  </div>
                )
              },
              {
                id: 'command' as AideoPageDesign,
                name: 'Command Deck',
                badge: 'Hi-Res / Precision',
                badgeColor: '#06b6d4',
                icon: <Activity size={18} color="#22d3ee" />,
                desc: 'Audiophile two-zone console: persistent rail for search, sources and feeds on the left; a disciplined track table with reason and quality columns on the right.',
                visual: (
                  <div className="aideo-prev-box prev-audiophile">
                    <div className="aideo-prev-audio-header">
                      <div className="aideo-prev-mono-line" />
                      <div className="aideo-prev-badge-flac">FLAC</div>
                    </div>
                    <div className="aideo-prev-audio-rows">
                      <div className="aideo-prev-audio-row">
                        <div className="aideo-prev-mono-idx">01</div>
                        <div className="aideo-prev-line flex1" />
                        <div className="aideo-prev-badge-rate">24/96</div>
                      </div>
                      <div className="aideo-prev-audio-row">
                        <div className="aideo-prev-mono-idx">02</div>
                        <div className="aideo-prev-line flex1" />
                        <div className="aideo-prev-badge-rate">16/44</div>
                      </div>
                    </div>
                  </div>
                )
              },
              {
                id: 'stage' as AideoPageDesign,
                name: 'Ambient Stage',
                badge: 'Immersive / Hero',
                badgeColor: '#f59e0b',
                icon: <Sparkles size={18} color="#fbbf24" />,
                desc: 'A full-bleed color-wash hero with greeting, stats and pill search, then a discovery feed grouped by why each track was picked, plus a recently-played strip.',
                visual: (
                  <div className="aideo-prev-box prev-cinematic">
                    <div className="aideo-prev-cine-hero">
                      <div className="aideo-prev-cine-overlay">
                        <div className="aideo-prev-line white" />
                        <div className="aideo-prev-cine-play" />
                      </div>
                    </div>
                    <div className="aideo-prev-cine-reel">
                      <div className="aideo-prev-cine-card glow" />
                      <div className="aideo-prev-cine-card" />
                      <div className="aideo-prev-cine-card" />
                    </div>
                  </div>
                )
              }
            ].map((d) => {
              const isSelected = aideoPageDesign === d.id;
              return (
                <div
                  key={d.id}
                  onClick={() => {
                    setAideoPageDesign(d.id);
                    window.dispatchEvent(new CustomEvent('ui-toast', {
                      detail: { message: `Switched Aideo home page layout to ${d.name}!`, type: 'success' }
                    }));
                  }}
                  className={`settings-design-card ${isSelected ? 'active' : ''}`}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: isSelected ? 'rgba(var(--accent-rgb), 0.08)' : 'var(--glass)',
                    border: isSelected ? '1.5px solid var(--accent, #8b5cf6)' : '1px solid var(--glass-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 12,
                    position: 'relative',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: isSelected ? '0 8px 24px rgba(var(--accent-rgb), 0.2)' : 'none'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ 
                          width: 32, 
                          height: 32, 
                          borderRadius: 8, 
                          background: isSelected ? 'rgba(var(--accent-rgb), 0.2)' : 'var(--glass-h)', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center' 
                        }}>
                          {d.icon}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{d.name}</div>
                          <span style={{ 
                            fontSize: 9, 
                            fontWeight: 700, 
                            color: d.badgeColor, 
                            background: `${d.badgeColor}18`, 
                            padding: '2px 6px', 
                            borderRadius: 4, 
                            textTransform: 'uppercase', 
                            letterSpacing: 0.5 
                          }}>
                            {d.badge}
                          </span>
                        </div>
                      </div>
                      <div style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        border: isSelected ? '5px solid var(--accent, #8b5cf6)' : '2px solid var(--glass-border)',
                        background: isSelected ? '#fff' : 'transparent',
                        transition: 'all 0.2s ease',
                        flexShrink: 0
                      }} />
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: 6, minHeight: 32 }}>
                      {d.desc}
                    </div>
                  </div>

                  {d.visual}
                </div>
              );
            })}
          </div>
        </div>
      )
    },
    {
      id: 'playerbar-design',
      title: 'Player Bar Style',
      description: 'Select the bottom playback bar layout: Classic, Floating Pill, Waveform, Minimal, or Vinyl.',
      keywords: 'player bar playbar layout style design floating island waveform minimal vinyl deck classic spotify apple music tidal roon modern appearance',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {[
              {
                id: 'classic' as PlayerBarDesign,
                name: 'Classic Studio',
                badge: 'Desktop Default',
                badgeColor: '#3b82f6',
                icon: <Layers size={18} color="#60a5fa" />,
                desc: 'Balanced 3-column docked layout with interactive waveform seekbar, synchronized lyric peek, and full audio utility drawer.',
                visual: (
                  <div className="pbar-preview-box preview-classic">
                    <div className="pbar-prev-thumb" />
                    <div className="pbar-prev-meta">
                      <div className="pbar-prev-line short" />
                      <div className="pbar-prev-line mini" />
                    </div>
                    <div className="pbar-prev-controls">
                      <div className="pbar-prev-btn-group" />
                      <div className="pbar-prev-wave" />
                    </div>
                    <div className="pbar-prev-actions" />
                  </div>
                )
              },
              {
                id: 'floating' as PlayerBarDesign,
                name: 'Floating Dynamic Island',
                badge: 'Apple Music / macOS',
                badgeColor: '#a855f7',
                icon: <Radio size={18} color="#c084fc" />,
                desc: 'Elevated glassmorphic pill capsule suspended cleanly above the canvas with centered fluid controls and ambient glow.',
                visual: (
                  <div className="pbar-preview-box preview-floating">
                    <div className="pbar-prev-floating-pill">
                      <div className="pbar-prev-thumb circle" />
                      <div className="pbar-prev-meta">
                        <div className="pbar-prev-line short" />
                      </div>
                      <div className="pbar-prev-center-btn" />
                      <div className="pbar-prev-actions compact" />
                    </div>
                  </div>
                )
              },
              {
                id: 'waveform' as PlayerBarDesign,
                name: 'Audiophile Waveform Deck',
                badge: 'Pro Audio & DAW',
                badgeColor: '#06b6d4',
                icon: <Activity size={18} color="#22d3ee" />,
                desc: 'Prominent full-width high-definition audio waveform scrubbing deck paired with real-time audio telemetry engine HUD.',
                visual: (
                  <div className="pbar-preview-box preview-waveform">
                    <div className="pbar-prev-full-wave">
                      {[40, 70, 90, 60, 30, 80, 100, 75, 45, 65, 85, 50, 70, 90, 40].map((h, i) => (
                        <div key={i} style={{ height: `${h}%`, flex: 1, background: i < 7 ? 'var(--accent, #8b5cf6)' : 'var(--glass-h)', borderRadius: 1 }} />
                      ))}
                    </div>
                    <div className="pbar-prev-subdeck">
                      <div className="pbar-prev-thumb mini" />
                      <div className="pbar-prev-center-btn" />
                      <div className="pbar-prev-hud-chip" />
                    </div>
                  </div>
                )
              },
              {
                id: 'minimal' as PlayerBarDesign,
                name: 'Minimalist Compact',
                badge: 'Zen / Low-Profile',
                badgeColor: '#10b981',
                icon: <Minus size={18} color="#34d399" />,
                desc: 'Ultra-slim 48px distraction-free bar with top hairline scrubbing line, maximizing screen real estate for your library.',
                visual: (
                  <div className="pbar-preview-box preview-minimal">
                    <div className="pbar-prev-hairline" />
                    <div className="pbar-prev-single-row">
                      <div className="pbar-prev-thumb tiny" />
                      <div className="pbar-prev-line inline" />
                      <div className="pbar-prev-center-btn" />
                      <div className="pbar-prev-time-chip" />
                    </div>
                  </div>
                )
              },
              {
                id: 'vinyl' as PlayerBarDesign,
                name: 'Retro Vinyl Deck',
                badge: 'Analog Turntable',
                badgeColor: '#f59e0b',
                icon: <Disc size={18} color="#fbbf24" />,
                desc: 'Nostalgic turntable aesthetic featuring spinning vinyl disc album art, vintage warm amber accents, and glowing status LEDs.',
                visual: (
                  <div className="pbar-preview-box preview-vinyl">
                    <div className="pbar-prev-vinyl-disc">
                      <div className="pbar-prev-vinyl-grooves" />
                      <div className="pbar-prev-vinyl-label" />
                    </div>
                    <div className="pbar-prev-meta">
                      <div className="pbar-prev-line short amber" />
                    </div>
                    <div className="pbar-prev-center-btn amber" />
                    <div className="pbar-prev-led-chip" />
                  </div>
                )
              }
            ].map((d) => {
              const isSelected = playerBarDesign === d.id;
              return (
                <div
                  key={d.id}
                  onClick={() => {
                    setPlayerBarDesign(d.id);
                    window.dispatchEvent(new CustomEvent('ui-toast', {
                      detail: { message: `Switched player bar layout to ${d.name}!`, type: 'success' }
                    }));
                  }}
                  className={`settings-design-card ${isSelected ? 'active' : ''}`}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: isSelected ? 'rgba(var(--accent-rgb), 0.08)' : 'var(--glass)',
                    border: isSelected ? '1.5px solid var(--accent, #8b5cf6)' : '1px solid var(--glass-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 12,
                    position: 'relative',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: isSelected ? '0 8px 24px rgba(var(--accent-rgb), 0.2)' : 'none'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ 
                          width: 32, 
                          height: 32, 
                          borderRadius: 8, 
                          background: isSelected ? 'rgba(var(--accent-rgb), 0.2)' : 'var(--glass-h)', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center' 
                        }}>
                          {d.icon}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{d.name}</div>
                          <span style={{ 
                            fontSize: 9, 
                            fontWeight: 700, 
                            color: d.badgeColor, 
                            background: `${d.badgeColor}18`, 
                            padding: '2px 6px', 
                            borderRadius: 6,
                            marginTop: 2,
                            display: 'inline-block'
                          }}>
                            {d.badge}
                          </span>
                        </div>
                      </div>
                      <div style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        border: isSelected ? '5px solid var(--accent, #8b5cf6)' : '2px solid var(--glass-border)',
                        background: isSelected ? '#ffffff' : 'transparent',
                        transition: 'all 0.2s ease',
                        flexShrink: 0
                      }} />
                    </div>

                    {d.visual}

                    <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45, marginTop: 10 }}>
                      {d.desc}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )
    },
    {
      id: 'playerbar-transparency',
      title: 'Player Bar Transparency',
      description: 'Render the bottom playback bar with a translucent frosted glass background.',
      keywords: 'player bar playbar transparent transparency glass glassmorphism frosted acrylic blur backdrop appearance UI',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Translucent Glass Playbar</span>
          <SlidingSwitch 
            checked={playerBarTransparent} 
            onChange={togglePlayerBarTransparent} 
          />
        </div>
      )
    },
    {
      id: 'typography',
      title: 'Typography & Text Scaling',
      description: 'Choose your interface font family and global text scaling percentage.',
      keywords: 'font text typography size scaling scale outfit inter roboto montserrat jetbrains playfair design appearance UI',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-two-col-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Font Family</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>Select primary interface typeface</div>
              <div>
                <select 
                  className="settings-select"
                  value={selectedFont}
                  onChange={(e) => setSelectedFont(e.target.value)}
                >
                  {GOOGLE_FONTS.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Scale Size</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>Adjust UI text scaling percentage</div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, fontWeight: 600 }}>
                  <span style={{ color: 'var(--text-dim)' }}>Compact (80%)</span>
                  <span style={{ color: 'var(--accent)' }}>{fontScale}%</span>
                  <span style={{ color: 'var(--text-dim)' }}>Readable (120%)</span>
                </div>
                <input 
                  type="range"
                  min="80" max="120" step="5"
                  value={fontScale}
                  onChange={(e) => setFontScale(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'audio-visualizer-config',
      title: 'Audio Spectrum Visualizer',
      description: 'Customize visualizer rendering styles, decay kinetics, and display height in the player.',
      keywords: 'visualizer spectrum audio style bars wave circle mirror dots decay height now playing',
      tab: 'appearance',
      element: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Style selector chips */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: 0.5, marginBottom: 8 }}>
              Rendering Style
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              {[
                { id: 'bars', name: 'Studio Bars', desc: 'Floating peak caps' },
                { id: 'mirror', name: 'Bilateral Mirror', desc: 'Center-out stereo' },
                { id: 'wave', name: 'Silk Wave', desc: 'Analog oscilloscope' },
                { id: 'circle', name: 'Radial Halo', desc: 'Orbital burst' },
                { id: 'dots', name: 'Dot Matrix', desc: 'Phosphor LED grid' },
              ].map(style => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setVisualizerMode(style.id as any)}
                  className={`btn-style-chip ${visualizerMode === style.id ? 'active' : ''}`}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    textAlign: 'left',
                    background: visualizerMode === style.id ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${visualizerMode === style.id ? 'var(--accent)' : 'var(--glass-border)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  aria-label={style.name}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: visualizerMode === style.id ? 'var(--accent)' : 'var(--text)' }}>
                    {style.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                    {style.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Decay Profile Pills */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: 0.5, marginBottom: 8 }}>
              Decay Kinetics
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { id: 'snappy', label: 'Snappy', desc: 'Fast & punchy' },
                { id: 'balanced', label: 'Balanced', desc: 'Natural studio response' },
                { id: 'silky', label: 'Silky', desc: 'Liquid smooth transitions' },
              ].map(decay => (
                <button
                  key={decay.id}
                  type="button"
                  onClick={() => setVisualizerDecayRate(decay.id as any)}
                  className={`btn ${visualizerDecayRate === decay.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 11, padding: '6px 14px' }}
                  aria-label={decay.label}
                >
                  {decay.label}
                </button>
              ))}
            </div>
          </div>

          {/* Default Height Toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--glass-border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Expanded Now Playing Canvas</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Use taller 140px view instead of compact 64px
              </div>
            </div>
            <SlidingSwitch 
              checked={visualizerExpanded} 
              onChange={() => setVisualizerExpanded(!visualizerExpanded)} 
            />
          </div>
        </div>
      )
    },
    {
      id: 'library-folders',
      title: 'Local Music Directories',
      description: 'Folders monitored and indexed for local audio playback and tag metadata.',
      keywords: 'library folder folders directory path track music add remove scan scanDirs sync database sync status loader',
      tab: 'library',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {scanDirs.map(dir => (
              <div key={dir} className="settings-folder-item">
                <span className="settings-folder-path">{dir}</span>
                <button 
                  className="settings-folder-remove"
                  onClick={() => removeScanDir(dir)}
                  title="Untrack this folder path"
                >
                  <Trash2 size={12} style={{ marginRight: 4 }} /> Remove
                </button>
              </div>
            ))}
            {scanDirs.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '24px', textAlign: 'center', background: 'var(--glass)', borderRadius: 12, border: '1px dashed var(--glass-border)' }}>
                No storage folders tracked. Click below to add your directories.
              </div>
            )}
          </div>

          <div className="settings-actions-row">
            <button className="btn btn-secondary" onClick={browse} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px' }}>
              <FolderSearch size={14} /> Add Storage Folder
            </button>
            <button className="btn btn-primary" onClick={scanLibrary} disabled={scanDirs.length === 0} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px' }}>
              <RefreshCw size={14} /> Sync Audio Database
            </button>
          </div>
          {scanStatus && (
            <div className="settings-sync-status" style={{ marginTop: 12, fontSize: 11, background: 'rgba(var(--accent-rgb), 0.05)', padding: '8px 12px', borderRadius: 8, color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb), 0.1)', fontWeight: 500 }}>
              {scanStatus}
            </div>
          )}
        </div>
      )
    },
    {
      id: 'disliked-songs',
      title: 'Disliked Tracks',
      description: 'Tracks marked as disliked are hidden from autoplay recommendations, radio seeds, and Discovery shelves.',
      keywords: 'dislike disliked hate hated clear reset remove recommendations discovery',
      tab: 'library',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Clear all disliked tracks to restore them to recommendations:</span>
            <button 
              className="btn btn-secondary" 
              onClick={resetDislikedTracks}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 6, 
                padding: '8px 16px',
                border: '1px solid rgba(244, 63, 94, 0.2)',
                background: 'rgba(244, 63, 94, 0.05)',
                color: '#f43f5e',
                fontSize: 12
              }}
            >
              <Trash2 size={13} /> Reset Disliked List
            </button>
          </div>
        </div>
      )
    },

    {
      id: 'cloud-connections',
      title: 'Self-Hosted Cloud Servers',
      description: 'Connect Subsonic, Navidrome, or Jellyfin servers to search and stream your personal music library.',
      keywords: 'cloud subsonic navidrome jellyfin self-hosted stream api private credentials server connection integration music host remote',
      tab: 'library',
      element: (
        <div className="settings-ctrl-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Subsonic / Navidrome Console */}
            <div style={{ 
              background: 'var(--glass)', 
              border: '1px solid var(--glass-border)', 
              borderRadius: 12, 
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ 
                    width: 28, height: 28, borderRadius: 6, 
                    background: 'linear-gradient(135deg, #6366f1, #4f46e5)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 12, color: 'white' 
                  }}>S</div>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Subsonic / Navidrome</span>
                </div>

                {subsonicConnected ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, 
                      background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)',
                      borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#10b981'
                    }}>
                      <span className="settings-status-dot pulse" style={{ background: '#10b981', width: 6, height: 6, borderRadius: '50%' }} />
                      Connected to {subsonicUrl}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      Active User: <strong style={{ color: 'var(--text)' }}>{subsonicUser}</strong>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Server URL</label>
                      <input 
                        type="text" 
                        placeholder="https://music.yourdomain.com"
                        value={subsonicUrlInput}
                        onChange={e => setSubsonicUrlInput(e.target.value)}
                        className="settings-select"
                        style={{ width: '100%', padding: '8px 12px', fontSize: 12, background: 'rgba(0,0,0,0.2)' }}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Username</label>
                        <input 
                          type="text" 
                          placeholder="admin"
                          value={subsonicUserInput}
                          onChange={e => setSubsonicUserInput(e.target.value)}
                          className="settings-select"
                          style={{ width: '100%', padding: '8px 12px', fontSize: 12, background: 'rgba(0,0,0,0.2)' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Password</label>
                        <input 
                          type="password" 
                          placeholder="••••••••"
                          value={subsonicPassInput}
                          onChange={e => setSubsonicPassInput(e.target.value)}
                          className="settings-select"
                          style={{ width: '100%', padding: '8px 12px', fontSize: 12, background: 'rgba(0,0,0,0.2)' }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {subsonicError && (
                <div style={{ color: '#ef4444', fontSize: 10, marginTop: 10, padding: 8, background: 'rgba(239, 68, 68, 0.08)', borderRadius: 6, border: '1px solid rgba(239, 68, 68, 0.15)' }}>
                  {subsonicError}
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                {subsonicConnected ? (
                  <button 
                    className="btn btn-secondary"
                    onClick={() => {
                      disconnectSubsonic();
                      window.dispatchEvent(new CustomEvent('ui-toast', { 
                        detail: { message: 'Disconnected Subsonic server.', type: 'success' } 
                      }));
                    }}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 12 }}
                  >
                    Disconnect Server
                  </button>
                ) : (
                  <button 
                    className="btn btn-primary"
                    disabled={subsonicLoading || !subsonicUrlInput || !subsonicUserInput || !subsonicPassInput}
                    onClick={async () => {
                      setSubsonicError('');
                      const ok = await connectSubsonic(subsonicUrlInput.trim(), subsonicUserInput.trim(), subsonicPassInput);
                      if (ok) {
                        window.dispatchEvent(new CustomEvent('ui-toast', { 
                          detail: { message: 'Subsonic server connected successfully!', type: 'success' } 
                        }));
                      } else {
                        setSubsonicError('Failed to ping server. Check URL, credentials or TLS configuration.');
                      }
                    }}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 12 }}
                  >
                    {subsonicLoading ? 'Pinging Server...' : 'Verify & Connect'}
                  </button>
                )}
              </div>
            </div>

            {/* Jellyfin Console */}
            <div style={{ 
              background: 'var(--glass)', 
              border: '1px solid var(--glass-border)', 
              borderRadius: 12, 
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ 
                    width: 28, height: 28, borderRadius: 6, 
                    background: 'linear-gradient(135deg, #a855f7, #7c3aed)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 12, color: 'white' 
                  }}>J</div>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>Jellyfin Media Server</span>
                </div>

                {jellyfinConnected ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, 
                      background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)',
                      borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#10b981'
                    }}>
                      <span className="settings-status-dot pulse" style={{ background: '#10b981', width: 6, height: 6, borderRadius: '50%' }} />
                      Connected to {jellyfinUrl}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      Connection Mode: <strong style={{ color: 'var(--text)' }}>Token (API Key)</strong>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Server URL</label>
                      <input 
                        type="text" 
                        placeholder="http://192.168.1.50:8096"
                        value={jellyfinUrlInput}
                        onChange={e => setJellyfinUrlInput(e.target.value)}
                        className="settings-select"
                        style={{ width: '100%', padding: '8px 12px', fontSize: 12, background: 'rgba(0,0,0,0.2)' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, display: 'block', marginBottom: 4 }}>API Key</label>
                      <input 
                        type="password" 
                        placeholder="Paste your Jellyfin API Key..."
                        value={jellyfinApiKeyInput}
                        onChange={e => setJellyfinApiKeyInput(e.target.value)}
                        className="settings-select"
                        style={{ width: '100%', padding: '8px 12px', fontSize: 12, background: 'rgba(0,0,0,0.2)' }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {jellyfinError && (
                <div style={{ color: '#ef4444', fontSize: 10, marginTop: 10, padding: 8, background: 'rgba(239, 68, 68, 0.08)', borderRadius: 6, border: '1px solid rgba(239, 68, 68, 0.15)' }}>
                  {jellyfinError}
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                {jellyfinConnected ? (
                  <button 
                    className="btn btn-secondary"
                    onClick={() => {
                      disconnectJellyfin();
                      window.dispatchEvent(new CustomEvent('ui-toast', { 
                        detail: { message: 'Disconnected Jellyfin server.', type: 'success' } 
                      }));
                    }}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 12 }}
                  >
                    Disconnect Server
                  </button>
                ) : (
                  <button 
                    className="btn btn-primary"
                    disabled={jellyfinLoading || !jellyfinUrlInput || !jellyfinApiKeyInput}
                    onClick={async () => {
                      setJellyfinError('');
                      const ok = await connectJellyfin(jellyfinUrlInput.trim(), jellyfinApiKeyInput.trim());
                      if (ok) {
                        window.dispatchEvent(new CustomEvent('ui-toast', { 
                          detail: { message: 'Jellyfin connected successfully!', type: 'success' } 
                        }));
                      } else {
                        setJellyfinError('Failed to ping server. Verify URL and API Key.');
                      }
                    }}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 12 }}
                  >
                    {jellyfinLoading ? 'Pinging Server...' : 'Verify & Connect'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'tidal-connect',
      title: 'Tidal Hi-Res Streaming',
      description: 'Connect your Tidal account via device-code pairing for lossless FLAC streaming and library import.',
      keywords: 'tidal streaming connect login device code lossless hifi flac disconnect',
      tab: 'plugins',
      element: (
        <div className="settings-ctrl-card">
          <TidalConnectCard />
        </div>
      )
    },
    {
      id: 'qobuz-connect',
      title: 'Qobuz Streaming (Experimental)',
      description: 'Connect Qobuz account via browser session token for studio-quality lossless streaming up to 192 kHz / 24-bit.',
      keywords: 'qobuz streaming experimental connect login token lossless hifi flac studio hi-res',
      tab: 'plugins',
      element: (
        <div className="settings-ctrl-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Enable Qobuz Integration</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Experimental web session bridge. Requires active Qobuz subscription.
              </div>
            </div>
            <SlidingSwitch
              checked={qobuzExperimentalEnabled}
              onChange={toggleQobuzExperimental}
            />
          </div>
          {qobuzExperimentalEnabled && (
            <QobuzConnectCard />
          )}
        </div>
      )
    },
    {
      id: 'lastfm-connect',
      title: 'Last.fm Audioscrobbler',
      description: 'Connect your Last.fm profile to scrobble tracks and sync playback history.',
      keywords: 'last.fm lastfm scrobbler scrobbling connect stats threshold token disconnect sessions browser integration api key',
      tab: 'scrobbling',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-lfm-connect-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <div className="settings-lfm-brand" style={{ background: '#ba0000', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#white', fontWeight: 800 }}>
                fm
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Last.fm Integration</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Synchronize listening counts, hearts, and histories</div>
              </div>
            </div>

            {lastfmSessionKey ? (
              <div>
                <div className="settings-lfm-connected-header">
                  <div className="settings-status-indicator connected">
                    <span className="settings-status-dot pulse"></span>
                    <span>Connected Session Active</span>
                  </div>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: 11, width: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={toggleScrobble}
                  >
                    <LogOut size={11} /> Disconnect
                  </button>
                </div>

                <div className="settings-slider-wrapper" style={{ marginTop: 16 }}>
                  <div className="settings-slider-header">
                    <span style={{ fontSize: 11, fontWeight: 600 }}>Scrobble Trigger Threshold</span>
                    <span className="settings-slider-value">{scrobbleThreshold}%</span>
                  </div>
                  <input
                    type="range"
                    min="10" max="100" step="5"
                    value={scrobbleThreshold}
                    onChange={(e) => setScrobbleThreshold(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                    Aideo registers this track with Last.fm once you have listened to {scrobbleThreshold}% of its total duration.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="settings-status-indicator disconnected">
                  <span className="settings-status-dot"></span>
                  <span>Not authorized</span>
                </div>
                
                {!lastfmToken ? (
                  <button
                    className="btn btn-primary"
                    style={{ padding: '10px', fontSize: 12, marginTop: 8 }}
                    disabled={lfmLoading}
                    onClick={async () => {
                      setLfmLoading(true); setLfmError('');
                      try {
                        const [token, authUrl] = await invoke<[string, string]>('lastfm_get_auth_url');
                        useStore.setState({ lastfmToken: token });
                        await openUrl(authUrl);
                      } catch (e: any) {
                        setLfmError(String(e));
                        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Last.fm authentication error: ${e}`, type: 'error' } }));
                      } finally {
                        setLfmLoading(false);
                      }
                    }}
                  >
                    {lfmLoading ? 'Contacting Last.fm API...' : 'Authorize Aideo on Last.fm'}
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, padding: 14, background: 'var(--glass)', borderRadius: 8, border: '1px solid var(--glass-border)' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>Waiting for browser authorization. Verify in the opened window.</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '8px', fontSize: 11 }}
                        disabled={lfmLoading}
                        onClick={async () => {
                          setLfmLoading(true); setLfmError('');
                          try {
                            const session = await invoke<string>('lastfm_get_session', { token: lastfmToken });
                            setLastFmSession(session);
                            useStore.setState({ lastfmToken: null });
                          } catch (e: any) {
                            setLfmError("Authorization check failed. Confirm approval in the browser first.");
                            window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Last.fm session error: ${e}`, type: 'error' } }));
                          } finally {
                            setLfmLoading(false);
                          }
                        }}
                      >
                        {lfmLoading ? 'Checking...' : 'I Authorized Already'}
                      </button>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '8px', fontSize: 11, width: 'auto' }} 
                        onClick={() => useStore.setState({ lastfmToken: null })}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {lfmError && (
              <div style={{ color: '#ef4444', fontSize: 11, marginTop: 10, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.15)', display: 'flex', gap: 6, alignItems: 'center' }}>
                <ShieldAlert size={14} style={{ flexShrink: 0 }} />
                <span>{lfmError}</span>
              </div>
            )}
          </div>
        </div>
      )
    },
    {
      id: 'listenbrainz-connect',
      title: 'ListenBrainz Scrobbler',
      description: 'Submit listens and playback statistics to the open-source MetaBrainz catalog.',
      keywords: 'listenbrainz listen brainz scrobbler scrobbling connect stats threshold token disconnect sessions integration token user token validate',
      tab: 'scrobbling',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-lfm-connect-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <div className="settings-lfm-brand" style={{ background: 'linear-gradient(135deg, #eb743b, #ff9e59)', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 18 }}>
                LB
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>ListenBrainz Integration</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Submit your listens to an open, non-profit community catalog</div>
              </div>
            </div>

            {listenbrainzToken ? (
              <div>
                <div className="settings-lfm-connected-header">
                  <div className="settings-status-indicator connected">
                    <span className="settings-status-dot pulse" style={{ backgroundColor: 'rgba(235, 116, 59, 0.95)' }}></span>
                    <span>Connected as <strong style={{ color: 'var(--text)' }}>{listenbrainzUsername}</strong></span>
                  </div>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: 11, width: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => setListenbrainzToken(null)}
                  >
                    <LogOut size={11} /> Disconnect
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'var(--glass)', border: '1px solid var(--glass-border)' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Automatic Scrobbling</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>Send playback listens to ListenBrainz servers in real-time.</div>
                  </div>
                  <SlidingSwitch 
                    checked={listenbrainzEnabled} 
                    onChange={toggleListenbrainzScrobble} 
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="settings-status-indicator disconnected">
                  <span className="settings-status-dot"></span>
                  <span>Not connected</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>User Token (UUID)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="password"
                      placeholder="Paste your ListenBrainz User Token..."
                      value={lbToken}
                      onChange={e => setLbToken(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        fontSize: 12,
                        borderRadius: 8,
                        border: '1px solid var(--glass-border)',
                        background: 'rgba(0,0,0,0.2)',
                        color: 'white',
                        outline: 'none',
                        transition: 'border-color 0.2s'
                      }}
                    />
                    <button
                      className="btn btn-primary"
                      disabled={lbLoading || !lbToken.trim()}
                      style={{ padding: '0 20px', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onClick={async () => {
                        setLbLoading(true);
                        setLbError('');
                        try {
                          const success = await validateAndSetListenbrainzToken(lbToken.trim());
                          if (success) {
                            setLbToken('');
                            window.dispatchEvent(new CustomEvent('ui-toast', { 
                              detail: { message: 'Successfully connected to ListenBrainz!', type: 'success' } 
                            }));
                          } else {
                            setLbError('Invalid ListenBrainz user token. Please check and try again.');
                          }
                        } catch (e: any) {
                          setLbError(String(e));
                        } finally {
                          setLbLoading(false);
                        }
                      }}
                    >
                      {lbLoading ? 'Verifying...' : 'Connect'}
                    </button>
                  </div>
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4, marginTop: 4 }}>
                    To find your token, log in to{' '}
                    <a 
                      href="#" 
                      onClick={(e) => { e.preventDefault(); openUrl('https://listenbrainz.org/profile/'); }} 
                      style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      listenbrainz.org/profile/
                    </a>
                    , scroll down, and copy the User Token UUID.
                  </p>
                </div>
              </div>
            )}

            {lbError && (
              <div style={{ color: '#ef4444', fontSize: 11, marginTop: 10, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.15)', display: 'flex', gap: 6, alignItems: 'center' }}>
                <ShieldAlert size={14} style={{ flexShrink: 0 }} />
                <span>{lbError}</span>
              </div>
            )}
          </div>
        </div>
      )
    },
    {
      id: 'audio-profile',
      title: 'Audio Quality & DSP Profile',
      description: 'Select a DSP profile based on your processor capability and listening equipment.',
      keywords: 'audio quality profile tier resampler buffer latency dither battery cpu high res performance sync',
      tab: 'audio',
      element: (
        <div className="settings-ctrl-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              {
                id: 'low',
                name: 'Low Power',
                desc: 'Optimized for battery savings, older processors, or Bluetooth audio.',
                icon: <Laptop size={20} />,
                bullets: [
                  { label: 'Rubato Resampler', value: 'Linear (Fast)', active: false, premium: false },
                  { label: 'Oversampling Factor', value: '128x precision', active: false, premium: false },
                  { label: 'Sinc Kernel Length', value: '64 Taps', active: false, premium: false },
                  { label: 'FFmpeg Transcode', value: '16-bit / 44.1kHz', active: false, premium: false }
                ]
              },
              {
                id: 'normal',
                name: 'Balanced',
                desc: 'Optimal balance of audio fidelity and standard CPU efficiency.',
                icon: <Volume2 size={20} />,
                bullets: [
                  { label: 'Rubato Resampler', value: 'Cubic (Balanced)', active: true, premium: false },
                  { label: 'Oversampling Factor', value: '256x precision', active: true, premium: false },
                  { label: 'Sinc Kernel Length', value: '128 Taps', active: true, premium: false },
                  { label: 'FFmpeg Transcode', value: '24-bit / 48.0kHz', active: true, premium: false }
                ]
              },
              {
                id: 'high',
                name: 'Studio Reference',
                desc: 'Bit-perfect fidelity with high-resolution 256-tap sinc kernel.',
                icon: <Zap size={20} />,
                bullets: [
                  { label: 'Rubato Resampler', value: 'Cubic (High-Res)', active: true, premium: true },
                  { label: 'Oversampling Factor', value: '512x precision', active: true, premium: true },
                  { label: 'Sinc Kernel Length', value: '256 Taps (Ref)', active: true, premium: true },
                  { label: 'FFmpeg Transcode', value: '24-bit / 96.0kHz', active: true, premium: true }
                ]
              },
              {
                id: 'custom',
                name: 'Custom',
                desc: 'Customized DSP parameters configured in the advanced panel below.',
                icon: <Settings size={20} />,
                bullets: [
                  { label: 'Rubato Resampler', value: dsp.resampler_interpolation === 'linear' ? 'Linear (Fast)' : 'Cubic (High-Res)', active: dsp.resampler_interpolation === 'cubic', premium: false },
                  { label: 'Oversampling Factor', value: `${dsp.resampler_oversampling}x precision`, active: true, premium: dsp.resampler_oversampling === 512 },
                  { label: 'Sinc Kernel Length', value: `${dsp.resampler_sinc_len} Taps`, active: true, premium: dsp.resampler_sinc_len === 256 },
                  { label: 'FFmpeg Transcode', value: dsp.ffmpeg_transcode_quality === 'standard' ? '16-bit / 44.1k' : dsp.ffmpeg_transcode_quality === 'studio' ? '24-bit / 48.0k' : dsp.ffmpeg_transcode_quality === 'native' ? '24-bit / Source Rate' : '24-bit / 96.0k', active: true, premium: dsp.ffmpeg_transcode_quality === 'hires' }
                ]
              }
            ].map(profile => {
              const active = dsp.audio_profile === profile.id;
              return (
                <motion.div
                  key={profile.id}
                  onClick={() => setDSP({ audio_profile: profile.id as any })}
                  whileHover={{ scale: 1.02, translateY: -2 }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    flex: '1 1 22%',
                    minWidth: 230,
                    padding: 16,
                    borderRadius: 12,
                    border: active ? '1.5px solid var(--accent)' : '1px solid var(--glass-border)',
                    background: active ? 'rgba(var(--accent-rgb), 0.08)' : 'var(--glass)',
                    cursor: 'pointer',
                    transition: 'border 0.2s, background 0.2s',
                    boxShadow: active ? '0 8px 30px rgba(var(--accent-rgb), 0.15)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <div style={{
                        padding: 6,
                        borderRadius: 6,
                        background: active ? 'var(--accent)' : 'var(--glass-h)',
                        color: active ? 'white' : 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {profile.icon}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: active ? 'white' : 'var(--text)' }}>
                        {profile.name}
                      </span>
                    </div>

                    <p style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4, marginBottom: 12, height: 42, overflow: 'hidden' }}>
                      {profile.desc}
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--glass-border)', paddingTop: 10 }}>
                      {profile.bullets.map((b, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9 }}>
                          <span style={{ color: 'var(--text-dim)' }}>{b.label}</span>
                          <span style={{ 
                            fontWeight: 600, 
                            color: b.premium && active ? 'var(--accent)' : b.active ? '#10b981' : 'var(--text-dim)',
                            background: b.premium && active ? 'rgba(var(--accent-rgb), 0.08)' : '',
                            padding: b.premium && active ? '1px 4px' : '',
                            borderRadius: 4
                          }}>
                            {b.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 16, alignSelf: 'flex-end' }}>
                    <span style={{
                      fontSize: 8,
                      fontWeight: 850,
                      letterSpacing: 1.2,
                      textTransform: 'uppercase',
                      padding: '3px 8px',
                      borderRadius: 20,
                      background: active ? 'var(--accent)' : 'var(--glass-h)',
                      color: active ? 'white' : 'var(--text-dim)',
                      transition: 'all 0.2s'
                    }}>
                      {active ? 'Active' : 'Select'}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* GAME-STYLE INDIVIDUAL ADVANCED SETTINGS PANEL */}
          <div style={{ marginTop: 20, borderTop: '1px solid var(--glass-border)', paddingTop: 16 }}>
            <div 
              onClick={() => setAdvancedOpen(o => !o)} 
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '6px 4px', userSelect: 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Settings size={14} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Advanced Audio Engine Controls</span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600 }}>{advancedOpen ? 'COLLAPSE CONTROLS ▴' : 'EXPAND CONTROLS ▾'}</span>
            </div>

            <AnimatePresence>
              {advancedOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: 'hidden', marginTop: 16 }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, padding: '4px 0' }}>
                    
                    {/* 1. Resampler Interpolation */}
                    <div style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid var(--glass-border)', padding: 16, borderRadius: 8, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>Resampler Interpolation</div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.3, marginTop: 4, marginBottom: 12 }}>
                          Linear interpolation is light on the CPU; Cubic interpolation delivers reference-grade mathematical precision and superior anti-aliasing.
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[
                          { id: 'linear', label: 'Linear (Fast)' },
                          { id: 'cubic', label: 'Cubic (High-Res)' }
                        ].map(opt => {
                          const active = dsp.resampler_interpolation === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setDSP({ resampler_interpolation: opt.id as any })}
                              style={{
                                flex: 1, fontSize: 9, padding: '8px 4px', borderRadius: 4, cursor: 'pointer',
                                border: '1px solid var(--glass-border)',
                                background: active ? 'var(--accent)' : 'var(--glass)',
                                color: active ? 'white' : 'var(--text)',
                                fontWeight: active ? 700 : 500,
                                transition: 'all 0.15s'
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 2. Sinc Kernel Length */}
                    <div style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid var(--glass-border)', padding: 16, borderRadius: 8, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>Sinc Kernel tap length</div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.3, marginTop: 4, marginBottom: 12 }}>
                          Determines the filter tap length. Larger kernels provide a razor-sharp brick-wall cutoff at the cost of slight latency.
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[
                          { id: 64, label: '64 Taps' },
                          { id: 128, label: '128 Taps' },
                          { id: 256, label: '256 Taps' }
                        ].map(opt => {
                          const active = dsp.resampler_sinc_len === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setDSP({ resampler_sinc_len: opt.id as any })}
                              style={{
                                flex: 1, fontSize: 9, padding: '8px 4px', borderRadius: 4, cursor: 'pointer',
                                border: '1px solid var(--glass-border)',
                                background: active ? 'var(--accent)' : 'var(--glass)',
                                color: active ? 'white' : 'var(--text)',
                                fontWeight: active ? 700 : 500,
                                transition: 'all 0.15s'
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 3. Oversampling Factor */}
                    <div style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid var(--glass-border)', padding: 16, borderRadius: 8, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>Oversampling Lookup Factor</div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.3, marginTop: 4, marginBottom: 12 }}>
                          Controls the size and precision of the sinc filter coefficient table lookup. Higher values ensure lower distortion.
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[
                          { id: 128, label: '128x' },
                          { id: 256, label: '256x' },
                          { id: 512, label: '512x' }
                        ].map(opt => {
                          const active = dsp.resampler_oversampling === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setDSP({ resampler_oversampling: opt.id as any })}
                              style={{
                                flex: 1, fontSize: 9, padding: '8px 4px', borderRadius: 4, cursor: 'pointer',
                                border: '1px solid var(--glass-border)',
                                background: active ? 'var(--accent)' : 'var(--glass)',
                                color: active ? 'white' : 'var(--text)',
                                fontWeight: active ? 700 : 500,
                                transition: 'all 0.15s'
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 4. FFmpeg Transcode Quality */}
                    <div style={{ background: 'rgba(0,0,0,0.1)', border: '1px solid var(--glass-border)', padding: 16, borderRadius: 8, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>FFmpeg Fallback Transcode</div>
                        <div style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.3, marginTop: 4, marginBottom: 12 }}>
                          Sets the sample rate and bit depth generated by the FFmpeg background proxy for streams and fallback files.
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[
                          { id: 'standard', label: '16b/44k' },
                          { id: 'studio', label: '24b/48k' },
                          { id: 'hires', label: '24b/96k' },
                          { id: 'native', label: '24b Native' }
                        ].map(opt => {
                          const active = dsp.ffmpeg_transcode_quality === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setDSP({ ffmpeg_transcode_quality: opt.id as any })}
                              style={{
                                flex: 1, fontSize: 9, padding: '8px 4px', borderRadius: 4, cursor: 'pointer',
                                border: '1px solid var(--glass-border)',
                                background: active ? 'var(--accent)' : 'var(--glass)',
                                color: active ? 'white' : 'var(--text)',
                                fontWeight: active ? 700 : 500,
                                transition: 'all 0.15s'
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {(dsp.audio_profile === 'high' || dsp.resampler_sinc_len === 256) && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                marginTop: 16,
                padding: '12px 16px',
                background: 'rgba(217, 119, 6, 0.08)',
                border: '1px solid rgba(217, 119, 6, 0.2)',
                borderRadius: 8,
                fontSize: 10,
                color: '#f59e0b',
                lineHeight: 1.4,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <Info size={14} style={{ flexShrink: 0 }} />
              <span>
                <strong>High-Precision Audio Mode is active:</strong> High-precision interpolation and intensive sinc kernels will consume slightly more CPU. Recommended for systems with external audiophile DACs.
              </span>
            </motion.div>
          )}
        </div>
      )
    },
    {
      id: 'audio-hardware',
      title: 'Audio Output Device & Hardware Mode',
      description: 'Select audio output devices, WASAPI Exclusive mode, loudness normalization, and hardware upsampling.',
      keywords: 'audio device exclusive bit-perfect bypass dac driver hardware sound output asio wasapi dither tpdf resampler frequency rate latency soundstage spatial crossfeed',
      tab: 'audio',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-two-col-row">
            {/* Device Selector */}
            <div style={{ flex: 1.2, borderRight: '1px solid var(--glass-border)', paddingRight: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Playback Output Device</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      const diag = {
                        currentDevice: currentDevice || 'Default',
                        exclusive: playbackExclusive,
                        exclusiveTiming: dsp.exclusive_mode_timing,
                        bitPerfect: playbackBitPerfect,
                        audioProfile: dsp.audio_profile,
                        upsampleRate: dsp.upsample_rate,
                        dither: dsp.dither,
                        r128: dsp.r128_enabled,
                        resampler: dsp.resampler_interpolation,
                        oversampling: dsp.resampler_oversampling,
                        sincLen: dsp.resampler_sinc_len,
                        transcodeQuality: dsp.ffmpeg_transcode_quality
                      };
                      navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
                      window.dispatchEvent(new CustomEvent('ui-toast', {
                        detail: { message: 'Audio diagnostics copied to clipboard!', type: 'success' }
                      }));
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
                  >
                    <Copy size={10} /> Copy Diagnostics
                  </button>
                  <button 
                    onClick={() => fetchDevices()} 
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, textTransform: 'uppercase' }}
                  >
                    <RefreshCw size={10} /> Refresh Devices
                  </button>
                </div>
              </div>

              <div className="device-selector" style={{ position: 'relative', marginBottom: 20 }}>
                <div className="current-device" onClick={() => setDevOpen(o => !o)} style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--glass-border)', borderRadius: 8, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentDevice || 'System Default Device'}</span>
                  <span style={{ color: 'var(--text-dim)' }}>▾</span>
                </div>
                <AnimatePresence>
                  {devOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1200, background: '#101018', border: '1px solid var(--glass-border)', borderRadius: 8, marginTop: 4, overflow: 'hidden', maxHeight: 200, overflowY: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.8)' }}>
                      {devices.length === 0 && <div style={{ padding: 12, fontSize: 11, color: 'var(--text-dim)' }}>No device drivers identified</div>}
                      {devices.map(d => {
                        const isSelected = (!currentDevice && d === '[System Default Device]') || currentDevice === d;
                        return (
                          <div key={d} onClick={() => { setAudioDevice(d); setDevOpen(false); }}
                            style={{
                              padding: '12px 16px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--glass-border)',
                              color: isSelected ? 'var(--accent)' : 'var(--text)', background: isSelected ? 'rgba(var(--accent-rgb),0.1)' : '',
                              display: 'flex', alignItems: 'center', gap: 8
                            }}>
                            {d === '[System Default Device]' && <span style={{ fontSize: 8, background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', padding: '2px 6px', borderRadius: 4, fontWeight: 900, flexShrink: 0, border: '1px solid rgba(34, 197, 94, 0.3)' }}>DEFAULT</span>}
                            {d.startsWith('[ASIO]') && <span style={{ fontSize: 8, background: '#ef4444', color: 'white', padding: '2px 4px', borderRadius: 4, fontWeight: 900, flexShrink: 0 }}>ASIO</span>}
                            {d.startsWith('[WASAPI]') && <span style={{ fontSize: 8, background: '#3b82f6', color: 'white', padding: '2px 4px', borderRadius: 4, fontWeight: 900, flexShrink: 0 }}>WASAPI</span>}
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

              {/* Spatial Widener crossfeed */}
              <div style={{ marginTop: 24 }}>
                <div className="settings-ctrl-title">Haas Spatial Width & Speaker Crossfeed</div>
                <div className="settings-ctrl-desc">Adjust the headphone crossfeed (<span style={{ color: 'var(--accent)' }}>&lt; 100%</span>) or mid-side spatial stereo widener (<span style={{ color: 'var(--accent)' }}>&gt; 100%</span>).</div>
                
                <div style={{ marginTop: 12 }}>
                  <input type="range" min={0} max={3} step={0.01} value={dsp.width}
                    style={{ width: '100%', height: 6, accentColor: 'var(--accent)', cursor: 'pointer' }}
                    onChange={e => setDSP({ width: +e.target.value })} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', marginTop: 8 }}>
                    <span>Headphone Crossfeed</span>
                    <span style={{ color: 'var(--accent)', fontWeight: 800 }}>{Math.round(dsp.width * 100)}% ({dsp.width === 1.0 ? 'Bypass' : dsp.width < 1.0 ? 'Narrow Mono Blend' : 'Hyper-Spacialized Stereo'})</span>
                    <span>Wide Speaker</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Exclusive Mode settings */}
            <div style={{ flex: 1, paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="settings-ctrl-title">Bit-Perfect Signal Pass</div>
                <div className={`exclusive-toggle ${playbackBitPerfect ? 'active' : ''}`}
                  onClick={() => useStore.getState().toggleBitPerfect()}
                  style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: playbackBitPerfect ? 'rgba(6, 182, 212, 0.08)' : 'rgba(0,0,0,0.2)', borderColor: playbackBitPerfect ? '#06b6d4' : '', cursor: 'pointer', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Bit-Perfect Bypass</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: playbackBitPerfect ? '#06b6d4' : 'var(--glass-h)', color: playbackBitPerfect ? '#fff' : 'var(--text-dim)' }}>
                      {playbackBitPerfect ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                    Passes bitstream directly. Skips mixer resampler, volume gain, and all active DSP.
                  </div>
                </div>
              </div>

              <div>
                <div className="settings-ctrl-title">Exclusive Mode</div>
                <div className={`exclusive-toggle ${playbackExclusive ? 'active' : ''}`} 
                  onClick={toggleExclusive} 
                  style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: playbackExclusive ? 'rgba(var(--accent-rgb), 0.08)' : 'rgba(0,0,0,0.2)', cursor: 'pointer', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Exclusive Access</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: playbackExclusive ? 'var(--accent)' : 'var(--glass-h)', color: playbackExclusive ? '#fff' : 'var(--text-dim)' }}>
                      {playbackExclusive ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                    Bypass standard Windows WASAPI sound layers for low latency and zero resampling distortion.
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {playbackExclusive && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="settings-ctrl-title" style={{ marginTop: 8 }}>Exclusive Timing Method</div>
                    <div style={{ 
                      display: 'flex', 
                      gap: 6, 
                      background: 'rgba(0,0,0,0.2)', 
                      border: '1px solid var(--glass-border)', 
                      padding: 4, 
                      borderRadius: 8 
                    }}>
                      {[
                        { id: 'polling', label: 'Timer-Driven (Stability)', tag: 'Safe for USB DAC' },
                        { id: 'event', label: 'Event-Driven (Low Latency)', tag: 'Pure Kernel Stream' }
                      ].map(opt => {
                        const active = dsp.exclusive_mode_timing === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => setDSP({ exclusive_mode_timing: opt.id as any })}
                            style={{
                              flex: 1, 
                              fontSize: 10, 
                              padding: '8px 4px', 
                              borderRadius: 6, 
                              cursor: 'pointer',
                              border: '1px solid var(--glass-border)',
                              background: active ? 'var(--accent)' : 'transparent',
                              color: active ? 'white' : 'var(--text)',
                              fontWeight: active ? 700 : 500,
                              transition: 'all 0.2s',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 2
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>{opt.label}</span>
                            <span style={{ fontSize: 7, opacity: 0.6, letterSpacing: 0.5 }}>{opt.tag}</span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div>
                <div className="settings-ctrl-title">TPDF Dithering</div>
                <div className={`exclusive-toggle ${dsp.dither ? 'active' : ''}`}
                  onClick={() => setDSP({ dither: !dsp.dither })}
                  style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: dsp.dither ? 'rgba(var(--accent-rgb), 0.08)' : 'rgba(0,0,0,0.2)', cursor: 'pointer', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>TPDF Noise Dither</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: dsp.dither ? 'var(--accent)' : 'var(--glass-h)', color: dsp.dither ? '#fff' : 'var(--text-dim)' }}>
                      {dsp.dither ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                    Combats quantization artifacts on high-end DACs by introducing a linear 24-bit TPDF noise spectrum.
                  </div>
                </div>
              </div>

              <div>
                <div className="settings-ctrl-title">EBU R128 & ReplayGain Normalization</div>
                <div className={`exclusive-toggle ${dsp.r128_enabled ? 'active' : ''}`}
                  onClick={() => setDSP({ r128_enabled: !dsp.r128_enabled, enabled: !dsp.r128_enabled ? true : dsp.enabled })}
                  style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: dsp.r128_enabled ? 'rgba(59, 130, 246, 0.12)' : 'rgba(0,0,0,0.2)', borderColor: dsp.r128_enabled ? '#3b82f6' : '', cursor: 'pointer', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Loudness Normalization</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: dsp.r128_enabled ? '#3b82f6' : 'var(--glass-h)', color: dsp.r128_enabled ? '#fff' : 'var(--text-dim)' }}>
                      {dsp.r128_enabled ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                    Normalizes playback loudness across quiet and loud tracks to standard -14 LUFS / ReplayGain targets.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--glass-border)', marginTop: 24, paddingTop: 20 }}>
            <div className="settings-ctrl-title">Hi-Res Sinc Interpolation Upsampling</div>
            <div className="settings-ctrl-desc" style={{ marginBottom: 12 }}>
              Upsample sound waves using high-accuracy mathematical interpolation chips prior to hardware digital conversion.
            </div>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[0, 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000].map(rate => (
                <button
                  key={rate}
                  className={`rate-chip ${dsp.upsample_rate === rate ? 'active' : ''}`}
                  style={{
                    fontSize: 10,
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: '1px solid var(--glass-border)',
                    background: dsp.upsample_rate === rate ? 'var(--accent)' : 'var(--glass)',
                    color: dsp.upsample_rate === rate ? 'white' : 'var(--text)',
                    cursor: 'pointer',
                    fontWeight: dsp.upsample_rate === rate ? 700 : 500,
                    transition: 'all 0.2s',
                    flex: '1 0 10%'
                  }}
                  onClick={() => {
                    setDSP({ upsample_rate: rate });
                    if (rate > 0 && playbackBitPerfect) {
                      useStore.getState().toggleBitPerfect();
                    }
                  }}
                >
                  {rate === 0 ? 'OFF' : `${rate / 1000}kHz`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'audio-crossfade',
      title: 'Audio Crossfade & Transitions',
      description: 'Blend smoothly between queued tracks with customizable transition durations.',
      keywords: 'audio crossfade transition gapless blend dj fade smooth duration seconds fadeout fadein queue',
      tab: 'audio',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-ctrl-header-row">
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Gapless & Crossfade Transition</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Mix outgoing audio tail with incoming track intro
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className={`btn ${dsp.crossfade_transition_enabled ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '6px 14px' }}
                onClick={() => setDSP({ crossfade_transition_enabled: !dsp.crossfade_transition_enabled })}
              >
                {dsp.crossfade_transition_enabled ? 'Crossfade: ON' : 'Crossfade: OFF'}
              </button>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                Transition Duration: <span style={{ color: 'var(--accent)', fontWeight: 800 }}>{dsp.crossfade_transition_duration.toFixed(1)} seconds</span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {dsp.crossfade_transition_duration === 0 ? 'Pure Gapless Cut' : dsp.crossfade_transition_duration <= 3 ? 'Radio Blend' : dsp.crossfade_transition_duration <= 6 ? 'DJ Crossfade' : 'Club Ambient Morph'}
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
                height: 6,
                accentColor: 'var(--accent)',
                cursor: dsp.crossfade_transition_enabled ? 'pointer' : 'default',
                opacity: dsp.crossfade_transition_enabled ? 1 : 0.4
              }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {[
                { label: 'Off', val: 0, enable: false, desc: 'Gapless Cut' },
                { label: '2.5s', val: 2.5, enable: true, desc: 'Quick Fade' },
                { label: '5.0s', val: 5.0, enable: true, desc: 'Standard DJ' },
                { label: '8.0s', val: 8.0, enable: true, desc: 'Ambient Blend' },
              ].map(p => (
                <button
                  key={p.label}
                  onClick={() => setDSP({ crossfade_transition_enabled: p.enable, crossfade_transition_duration: p.val })}
                  style={{
                    flex: 1,
                    fontSize: 10,
                    padding: '8px 4px',
                    borderRadius: 6,
                    border: '1px solid var(--glass-border)',
                    background: dsp.crossfade_transition_enabled && dsp.crossfade_transition_duration === p.val ? 'var(--accent)' : 'var(--glass)',
                    color: dsp.crossfade_transition_enabled && dsp.crossfade_transition_duration === p.val ? 'white' : 'var(--text)',
                    cursor: 'pointer',
                    fontWeight: dsp.crossfade_transition_enabled && dsp.crossfade_transition_duration === p.val ? 700 : 500,
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{p.label}</span>
                  <span style={{ fontSize: 8, opacity: 0.6 }}>{p.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'system-behavior',
      title: 'System Sleep & Discord RPC',
      description: 'Prevent PC sleep during active playback and broadcast now playing status to Discord profile.',
      keywords: 'system sleep behavior discord rich presence profiles listening music toggles prevent sleep keep awake',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-two-col-row">
            <div style={{ flex: 1, borderRight: '1px solid var(--glass-border)', paddingRight: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Prevent System Sleep</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Keep Windows awake during active music playback</div>
                </div>
                <SlidingSwitch 
                  checked={keepAwake} 
                  onChange={toggleKeepAwake} 
                />
              </div>
            </div>

            <div style={{ flex: 1, paddingLeft: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Discord Rich Presence</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Display current song title, artist, and art on Discord</div>
                </div>
                <SlidingSwitch 
                  checked={discordEnabled} 
                  onChange={toggleDiscord} 
                />
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'stream-engine-settings',
      title: 'Stream Downloader & Pre-Buffering',
      description: 'Select your web stream engine and configure look-ahead gapless background caching.',
      keywords: 'stream engine youtube direct web stream yt-dlp reqwest fallback pre-buffer cache look-ahead seamless gapless',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-two-col-row">
            {/* Stream Engine Selection */}
            <div style={{ flex: 1, borderRight: '1px solid var(--glass-border)', paddingRight: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Streaming Engine</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    yt-dlp for reliable downloads, Direct HTTP for lightweight streaming
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', background: 'var(--glass)', padding: 3, borderRadius: 8, border: '1px solid var(--glass-border)', gap: 4 }}>
                {[
                  { id: 'yt-dlp', label: 'yt-dlp', desc: 'Fast, unthrottled downloads' },
                  { id: 'reqwest', label: 'Direct HTTP', desc: 'Lightweight direct audio streaming' }
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setDSP({ stream_engine: opt.id as any })}
                    title={opt.desc}
                    style={{
                      flex: 1,
                      background: dsp.stream_engine === opt.id ? 'var(--glass-h)' : 'transparent',
                      border: 'none',
                      color: dsp.stream_engine === opt.id ? 'white' : 'var(--text-dim)',
                      padding: '8px 10px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Gapless Pre-buffering */}
            <div style={{ flex: 1, paddingLeft: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Gapless Pre-Buffering</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    Pre-download upcoming queue tracks for seamless playback
                  </div>
                </div>
                <SlidingSwitch 
                  checked={dsp.lookahead_prebuffer_enabled} 
                  onChange={() => { setDSP({ lookahead_prebuffer_enabled: !dsp.lookahead_prebuffer_enabled }); }} 
                />
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'aideo-connect',
      title: 'Aideo Connect (Remote Control)',
      description: 'Control playback from your phone or browser on the local Wi-Fi network.',
      keywords: 'aideo connect remote control host web server phone tablet qr code web interface browser link network',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 250 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Web Remote URL</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>
                Open this URL or scan the QR code to control playback from another device on your network:
              </div>
              {remoteUrl ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <a 
                    href={remoteUrl} 
                    target="_blank" 
                    rel="noreferrer"
                    style={{ 
                      color: 'var(--accent)', 
                      fontSize: 14, 
                      fontWeight: 600, 
                      textDecoration: 'underline',
                      wordBreak: 'break-all'
                    }}
                  >
                    {remoteUrl}
                  </a>
                </div>
              ) : (
                <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  Starting Aideo Connect Server...
                </div>
              )}
            </div>

            {remoteUrl && (
              <div style={{ 
                background: 'white', 
                padding: 10, 
                borderRadius: 12, 
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid var(--glass-border)'
              }}>
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(remoteUrl)}`} 
                  alt="Aideo Connect QR Code"
                  style={{ width: 120, height: 120, display: 'block' }}
                />
              </div>
            )}
          </div>
        </div>
      )
    },
    {
      id: 'cloud-autoplay-behavior',
      title: 'Cloud Queue Autoplay',
      description: 'Continue playback with local library tracks when a remote cloud queue ends.',
      keywords: 'cloud stream autoplay local library subsonic navidrome jellyfin connection end stop transition webstream',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, paddingRight: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Autoplay Local Tracks after Cloud Stream</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Transition to local library files when a Subsonic, Jellyfin, or stream list completes
              </div>
            </div>
            <SlidingSwitch 
              checked={autoplayLocal} 
              onChange={() => {
                const newVal = !autoplayLocal;
                setAutoplayLocal(newVal);
                localStorage.setItem('aideo_autoplay_local_for_cloud', String(newVal));
                window.dispatchEvent(new CustomEvent('ui-toast', { 
                  detail: { message: `Cloud Autoplay changed to: ${newVal ? 'Autoplay Local Tracks' : 'Stop Playback'}`, type: 'info' } 
                }));
              }} 
            />
          </div>
        </div>
      )
    },
    {
      id: 'autoplay-discovery-level',
      title: 'Discovery & Radio Familiarity',
      description: 'Adjust how closely recommendations adhere to your existing library vs. new artist discovery.',
      keywords: 'autoplay discovery level taste profile familiarity balanced J-Pop K-Pop Pop mainstream settings',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', gap: 10, background: 'rgba(0,0,0,0.12)', padding: 6, borderRadius: 12, border: '1px solid var(--glass-border)' }}>
            {[
              { 
                id: 'familiarity', 
                label: 'Familiarity-Heavy', 
                desc: 'Focus on artists already in your local library',
                color: 'var(--accent)'
              },
              { 
                id: 'balanced', 
                label: 'Balanced Mix', 
                desc: 'Blend of favorite library artists and related recommendations',
                color: 'var(--accent)'
              },
              { 
                id: 'discovery', 
                label: 'Discovery-Heavy', 
                desc: 'Prioritize new tracks and unplayed recommendations',
                color: 'var(--accent)'
              }
            ].map(level => {
              const active = autoplayDiscoveryLevel === level.id;
              return (
                <motion.div
                  key={level.id}
                  onClick={() => {
                    setAutoplayDiscoveryLevel(level.id as any);
                    window.dispatchEvent(new CustomEvent('ui-toast', { 
                      detail: { message: `Discovery Taste Profile set to: ${level.label}`, type: 'success' } 
                    }));
                  }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: active ? 'rgba(var(--accent-rgb), 0.1)' : 'transparent',
                    border: active ? '1.5px solid var(--accent)' : '1px solid transparent',
                    transition: 'all 0.25s ease',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: active ? '0 4px 20px rgba(var(--accent-rgb), 0.15)' : 'none'
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: active ? 'white' : 'var(--text-dim)', transition: 'color 0.2s' }}>
                    {level.label}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.3, display: 'block', opacity: active ? 0.9 : 0.6 }}>
                    {level.desc}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      )
    },
    {
      id: 'performance-calibration',
      title: 'Low-Spec Hardware Mode',
      description: 'Reduce animation and DSP overhead for older processors and battery saving.',
      keywords: 'performance calibration low-spec low spec lag latency frame battery gpu cpu animations backdrop filter blur canvas shadow',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, paddingRight: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Hardware Throttling Optimization</span>
                {lowSpecMode && (
                  <span style={{ fontSize: 9, background: 'var(--accent)', color: 'white', padding: '2px 6px', borderRadius: 10, fontWeight: 700 }}>
                    ACTIVE
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Disables liquid visualizers, backdrop blur filters, and background FFT analysis to conserve CPU/GPU
              </div>
            </div>
            <SlidingSwitch 
              checked={lowSpecMode} 
              onChange={toggleLowSpecMode} 
            />
          </div>
        </div>
      )
    },
    {
      id: 'system-dependencies',
      title: 'External Dependencies',
      description: 'Manage optional helper binaries (yt-dlp, FFmpeg) for web streams and audio transcoding.',
      keywords: 'system extensions dependencies manager ytdlp ffmpeg install uninstall delete space clean plugins tool',
      tab: 'plugins',
      element: <DependencyManagerPanel />
    },
    {
      id: 'app-onboarding-setup',
      title: 'Setup Wizard',
      description: 'Relaunch the initial configuration wizard for quick library and audio setup.',
      keywords: 'setup onboarding wizard reconfigure run config walkthrough local hybrid preferences calibration debug',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, paddingRight: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Relaunch Onboarding</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Step through folder selection, soundcard configuration, and scrobbling setup
              </div>
            </div>
            <button
              onClick={() => {
                setShowOnboarding(true);
                setOnboardingCompleted(false);
                window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Launching Setup Onboarding Wizard...', type: 'info' } }));
              }}
              className="btn btn-secondary"
              style={{
                fontSize: 11,
                padding: '8px 16px'
              }}
            >
              Launch Setup Wizard
            </button>
          </div>
        </div>
      )
    },

    {
      id: 'window-close-behavior',
      title: 'Close Button Action',
      description: 'Choose whether closing the window minimizes to the system tray or exits.',
      keywords: 'tray system minimize close window background taskbar trayicon exit',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, paddingRight: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Minimize to System Tray on Close</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                Keep music playing in the background when clicking the window close button
              </div>
            </div>
            <SlidingSwitch 
              checked={closeToTray} 
              onChange={async () => {
                const newVal = !closeToTray;
                setCloseToTray(newVal);
                localStorage.setItem('aideo_close_to_tray', String(newVal));
                try {
                  await invoke('set_close_to_tray', { enabled: newVal });
                } catch (e) {
                  console.error('Failed to set close to tray:', e);
                }
                window.dispatchEvent(new CustomEvent('ui-toast', { 
                  detail: { message: `Close Behavior set to: ${newVal ? 'Minimize to Tray' : 'Exit Application'}`, type: 'info' } 
                }));
              }} 
            />
          </div>
        </div>
      )
    },
    {
      id: 'cache-management',
      title: 'Storage & Cache Cleanup',
      description: 'Manage local streaming cache and temporary file storage limits.',
      keywords: 'cache clear clean delete temp storage cloud cache cloudcache youtube ytdlp temporary disk space usage size',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 20 }}>
            <div style={{ flex: '1 1 500px', minWidth: 300 }}>
              {/* Cache Size Limit Slider */}
              <div style={{ background: 'var(--glass)', padding: '14px 18px', borderRadius: 10, border: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', display: 'block' }}>Local Stream Cache Limit</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, display: 'block' }}>
                      Current usage: <strong style={{ color: cacheInfo.bytes > cacheSizeLimit * 1024 * 1024 * 1024 ? '#f87171' : '#4ade80' }}>{cacheInfo.formatted}</strong> ({cacheInfo.count} files)
                    </span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>{cacheSizeLimit.toFixed(1)} GB limit</span>
                </div>
                <input 
                  type="range" 
                  min={2} 
                  max={10} 
                  step={0.5} 
                  value={cacheSizeLimit}
                  style={{ width: '100%', height: 6, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setCacheSizeLimit(val);
                    setTimeout(fetchCacheInfo, 300);
                  }} 
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginTop: 6, fontWeight: 600 }}>
                  <span>2.0 GB</span>
                  <span>4.0 GB</span>
                  <span>6.0 GB</span>
                  <span>8.0 GB</span>
                  <span>10.0 GB</span>
                </div>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: 8, alignSelf: 'center' }}>
              <button
                onClick={async () => {
                  try {
                    await invoke('open_cache_folder');
                  } catch (e: any) {
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to open cache folder: ${e}`, type: 'error' } }));
                  }
                }}
                className="btn btn-secondary"
                style={{
                  fontSize: 11,
                  padding: '8px 16px'
                }}
              >
                Open Cache Folder
              </button>
              <button
                onClick={async () => {
                  try {
                    await invoke('clear_application_cache');
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'All application caches deleted successfully!', type: 'success' } }));
                  } catch (e: any) {
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to clear cache: ${e}`, type: 'error' } }));
                  }
                }}
                className="btn btn-secondary"
                style={{
                  fontSize: 11,
                  padding: '8px 16px',
                  color: '#f43f5e',
                  borderColor: 'rgba(244, 63, 94, 0.3)'
                }}
              >
                Clear Cache
              </button>
            </div>
          </div>
        </div>
      )
    },

    {
      id: 'system-diagnostics-logs',
      title: 'Diagnostics, Terminal Logs & Crash Reporting',
      description: 'Inspect live backend & frontend terminal logs, export debug bundles, or open the persistent log storage directory.',
      keywords: 'logs terminal debug diagnostics crash report bug troubleshoot errors developer trace stdout stderr',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ flex: '1 1 400px', minWidth: 280 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Application Observability & Crash Tracing</div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
                Aideo records timestamped logs, audio hardware state, and Rust panic / JavaScript crash dumps in your AppData directory. Use the live terminal viewer or export full diagnostics when troubleshooting.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={() => setShowDebugModal(true)}
                className="btn btn-primary"
                style={{
                  fontSize: 11,
                  padding: '8px 14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <Terminal size={13} />
                <span>View Live Logs</span>
              </button>

              <button
                onClick={async () => {
                  try {
                    await logger.openLogsFolder();
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Opened logs directory in File Explorer', type: 'info' } }));
                  } catch (e: any) {
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to open logs directory: ${e}`, type: 'error' } }));
                  }
                }}
                className="btn btn-secondary"
                style={{
                  fontSize: 11,
                  padding: '8px 14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <FolderOpen size={13} />
                <span>Open Logs Folder</span>
              </button>

              <button
                onClick={async () => {
                  try {
                    const report = await logger.exportDebugReport();
                    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `aideo-debug-report-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
                    link.click();
                    URL.revokeObjectURL(url);
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Diagnostic report exported successfully!', type: 'success' } }));
                  } catch (e: any) {
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to export report: ${e}`, type: 'error' } }));
                  }
                }}
                className="btn btn-secondary"
                style={{
                  fontSize: 11,
                  padding: '8px 14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <DownloadCloud size={13} />
                <span>Export Report</span>
              </button>
            </div>
          </div>
        </div>
      )
    },

    {
      id: 'auto-updater',
      title: 'Application Updates',
      description: 'Check for and install updates from GitHub releases.',
      keywords: 'updater check update manual automatic github releases install progress downloads versions status logs error',
      tab: 'updates',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-update-card" style={{ background: 'transparent', border: 'none', padding: 0 }}>
            <div className="settings-update-flex">
              <div className="settings-update-text">
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>GitHub Release Updates</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Check if a newer version of Aideo is available</div>
              </div>
              <button
                className="btn btn-primary"
                style={{ padding: '8px 16px', fontSize: 11, width: 'auto' }}
                disabled={updateChecking}
                onClick={async () => {
                  setUpdateChecking(true);
                  setUpdateStatus('Checking for updates...');
                  try {
                    const res = await invoke<any>('check_update');
                    if (res.available) {
                      setUpdateStatus(`Version ${res.version} is available!`);
                      window.dispatchEvent(new CustomEvent('update-available', { detail: res }));
                    } else {
                      setUpdateStatus(`Latest version is installed (${res.version}).`);
                    }
                  } catch (e: any) {
                    setUpdateStatus(`Error checking updates: ${e}`);
                  } finally {
                    setUpdateChecking(false);
                  }
                }}
              >
                {updateChecking ? 'Checking...' : 'Check for Updates'}
              </button>
            </div>
            {updateStatus && (
              <div className="settings-update-status-msg" style={{ background: 'var(--glass)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--glass-border)', marginTop: 16 }}>
                {updateStatus}
              </div>
            )}
          </div>
        </div>
      )
    },
    {
      id: 'user-authentication',
      title: 'Account & Cloud Sync',
      description: 'Log in to synchronize favorite streams, playlists, and preferences across devices.',
      keywords: 'login signup register account auth authenticate sync cloud user profiles email session credentials',
      tab: 'account',
      element: <AccountAuthPanel />
    }
  ];

  // Simple query matcher
  const getFilteredItems = () => {
    if (!searchQuery.trim()) {
      return settingsItems.filter(item => item.tab === activeTab);
    }
    const q = searchQuery.toLowerCase().trim();
    return settingsItems.filter(item => 
      item.title.toLowerCase().includes(q) || 
      item.description.toLowerCase().includes(q) || 
      item.keywords.includes(q)
    );
  };

  const filteredItems = getFilteredItems();

  return (
    <div className="settings-view-wrap">
      <div className="settings-bg-tint"></div>

      {/* Header */}
      <div className="settings-view-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Settings size={24} className="settings-gear-icon" />
          <h1 className="settings-main-title">Settings</h1>
        </div>
        <p className="settings-main-subtitle">Manage playback behavior, audio hardware, appearance, and integrations.</p>
      </div>

      {/* Interactive Search Bar */}
      <div className="settings-search-wrapper">
        <Search size={18} className="settings-search-icon" />
        <input 
          type="text" 
          placeholder="Search settings, hardware drivers, shortcuts..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="settings-search-input"
        />
        {searchQuery && (
          <button className="settings-search-clear" onClick={() => setSearchQuery('')}>Clear</button>
        )}
      </div>

      {/* Horizontal Routing Tabs (Hidden during search) */}
      {!searchQuery.trim() && (
        <div className="settings-tabs-list">
          <button 
            className={`settings-tab-btn ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <Palette size={14} />
            <span>Appearance</span>
            {activeTab === 'appearance' && <motion.div layoutId="active-tab-line" className="settings-active-tab-line" />}
          </button>
          
          <button 
            className={`settings-tab-btn ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => setActiveTab('library')}
          >
            <Library size={14} />
            <span>Library</span>
            {activeTab === 'library' && <motion.div layoutId="active-tab-line" className="settings-active-tab-line" />}
          </button>

          <button 
            className={`settings-tab-btn ${activeTab === 'plugins' ? 'active' : ''}`}
            onClick={() => setActiveTab('plugins')}
          >
            <Puzzle size={14} />
            <span>Plugins</span>
            {activeTab === 'plugins' && <motion.div layoutId="active-tab-line" className="settings-active-tab-line" />}
          </button>

          <button 
            className={`settings-tab-btn ${activeTab === 'scrobbling' ? 'active' : ''}`}
            onClick={() => setActiveTab('scrobbling')}
          >
            <Radio size={14} />
            <span>Scrobbling</span>
            {activeTab === 'scrobbling' && <motion.div layoutId="active-tab-line" className="settings-active-tab-line" />}
          </button>

          <button 
            className={`settings-tab-btn ${activeTab === 'audio' ? 'active' : ''}`}
            onClick={() => setActiveTab('audio')}
          >
            <Volume2 size={14} />
            <span>Audio Engine</span>
            {activeTab === 'audio' && <motion.div layoutId="active-tab-line" className="settings-active-tab-line" />}
          </button>

          <button 
            className={`settings-tab-btn ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            <Laptop size={14} />
            <span>System</span>
            {activeTab === 'system' && <motion.div layoutId="active-tab-line" className="settings-active-tab-line" />}
          </button>

          <button 
            className={`settings-tab-btn ${activeTab === 'updates' ? 'active' : ''}`}
            onClick={() => setActiveTab('updates')}
          >
            <DownloadCloud size={14} />
            <span>Updates</span>
            {activeTab === 'updates' && <motion.div layoutId="active-tab-line" className="settings-active-tab-line" />}
          </button>

          <button 
            className={`settings-tab-btn ${activeTab === 'account' ? 'active' : ''}`}
            onClick={() => setActiveTab('account')}
          >
            <User size={14} />
            <span>Account & Sync</span>
            {activeTab === 'account' && <motion.div layoutId="active-tab-line" className="settings-active-tab-line" />}
          </button>

          <button 
            className={`settings-tab-btn ${activeTab === 'shortcuts' ? 'active' : ''}`}
            onClick={() => setActiveTab('shortcuts')}
          >
            <Keyboard size={14} />
            <span>Shortcuts</span>
            {activeTab === 'shortcuts' && <motion.div layoutId="active-tab-line" className="settings-active-tab-line" />}
          </button>
        </div>
      )}

      {/* Main Settings List Area */}
      <div className="settings-view-scrollable">
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 60 }}>
          {searchQuery.trim() && (
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent)', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Info size={14} />
              Found {filteredItems.length} matching settings rows
            </div>
          )}

          {!searchQuery.trim() && activeTab !== 'updates' && activeTab !== 'plugins' && activeTab !== 'account' && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 2px 12px 2px',
              borderBottom: '1px solid var(--glass-border)',
              marginBottom: 4
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize' }}>
                {activeTab} Settings
              </span>
              <button
                onClick={() => {
                  if (activeTab === 'appearance') resetAppearance();
                  else if (activeTab === 'library') resetLibrary();
                  else if (activeTab === 'scrobbling') resetScrobbling();
                  else if (activeTab === 'audio') resetAudio();
                  else if (activeTab === 'system') resetSystem();
                  else if (activeTab === 'shortcuts') resetShortcuts();
                }}
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '4px 12px', color: 'var(--text-dim)' }}
              >
                Reset {activeTab} to Defaults
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div 
              key={searchQuery ? 'search-results' : activeTab}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
            >
              {filteredItems.map((item) => (
                <div key={item.id} className="settings-card-wrapper">
                  <div className="settings-row-meta">
                    <h2 className="settings-row-title">{item.title}</h2>
                    <p className="settings-row-desc">{item.description}</p>
                  </div>
                  <div className="settings-row-control-area">
                    {item.element}
                  </div>
                </div>
              ))}

              {filteredItems.length === 0 && (
                <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-dim)' }}>
                  <HelpCircle size={40} style={{ margin: '0 auto 16px', display: 'block', opacity: 0.5 }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>No settings found</div>
                  <div>No settings matched your query "{searchQuery}". Try a different keyword.</div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <DebugLogsModal isOpen={showDebugModal} onClose={() => setShowDebugModal(false)} />
    </div>
  );
}

function DependencyManagerPanel() {
  const [status, setStatus] = useState<any>(null);
  const [downloads, setDownloads] = useState<any>({});

  const fetchStatus = async () => {
    try {
      const res = await invoke('get_dependencies_status');
      setStatus(res);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchStatus();

    const unlisten = listen<any>('dependency-download-progress', (event) => {
      const { id, percent, downloaded, total } = event.payload;
      setDownloads((prev: any) => ({
        ...prev,
        [id]: { percent, downloaded, total, active: percent < 100 }
      }));
      if (percent >= 100) {
        setTimeout(fetchStatus, 1000);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const handleInstall = async (id: string) => {
    setDownloads((prev: any) => ({
      ...prev,
      [id]: { percent: 0, downloaded: 0, total: 0, active: true }
    }));
    try {
      await invoke('install_dependency', { depId: id });
    } catch (e) {
      console.error(e);
      setDownloads((prev: any) => ({
        ...prev,
        [id]: { percent: 0, downloaded: 0, total: 0, active: false }
      }));
    }
    fetchStatus();
  };

  const handleUninstall = async (id: string) => {
    try {
      await invoke('uninstall_dependency', { depId: id });
    } catch (e) {
      console.error(e);
    }
    fetchStatus();
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const deps = [
    {
      id: 'ytdlp',
      name: 'Web Stream Decoder',
      desc: 'Enables playing, parsing, and downloading high-fidelity web audio streams.',
      installed: status?.ytdlp_installed,
      size: status?.ytdlp_size
    },
    {
      id: 'ffmpeg',
      name: 'FFmpeg Transcoder & Muxer',
      desc: 'Enables precise dynamic audio splitting, crossovers, and stem transcoding.',
      installed: status?.ffmpeg_installed,
      size: status?.ffmpeg_size
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {deps.map(dep => {
        const download = downloads[dep.id];
        const isDownloading = download?.active;

        return (
          <div key={dep.id} className="settings-ctrl-card" style={{ padding: '16px 20px', background: 'var(--glass)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1, paddingRight: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="settings-ctrl-title">{dep.name}</span>
                  {dep.installed ? (
                    <span style={{ fontSize: 9, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                      INSTALLED ({formatSize(dep.size)})
                    </span>
                  ) : isDownloading ? (
                    <span style={{ fontSize: 9, background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                      DOWNLOADING
                    </span>
                  ) : (
                    <span style={{ fontSize: 9, background: 'rgba(239, 68, 68, 0.12)', color: '#f87171', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                      NOT INSTALLED
                    </span>
                  )}
                </div>
                <div className="settings-ctrl-desc" style={{ marginTop: 4 }}>{dep.desc}</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {dep.installed ? (
                  <>
                    {dep.id === 'ytdlp' && (
                      <button 
                        onClick={async () => {
                          try {
                            await invoke('check_update_ytdlp');
                            fetchStatus();
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="settings-btn" 
                        style={{ fontSize: 11, padding: '6px 12px', background: 'rgba(var(--accent-rgb, 139, 92, 246), 0.15)', color: 'var(--accent, #8b5cf6)', border: '1px solid rgba(var(--accent-rgb, 139, 92, 246), 0.3)' }}
                      >
                        Check Updates
                      </button>
                    )}
                    <button 
                      onClick={() => handleUninstall(dep.id)} 
                      className="settings-btn settings-btn-danger" 
                      style={{ fontSize: 11, padding: '6px 12px' }}
                    >
                      Uninstall
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={() => handleInstall(dep.id)} 
                    className="settings-btn settings-btn-success" 
                    style={{ fontSize: 11, padding: '6px 12px' }}
                    disabled={isDownloading}
                  >
                    {isDownloading ? 'Downloading...' : 'Install'}
                  </button>
                )}
              </div>
            </div>

            {isDownloading && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>
                  <span>Downloading data chunks...</span>
                  <span>{Math.round(download.percent)}%</span>
                </div>
                <div style={{ width: '100%', height: 4, background: 'var(--glass-h)', borderRadius: 2, overflow: 'hidden' }}>
                  <motion.div 
                    style={{ height: '100%', background: 'var(--accent)' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${download.percent}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AccountAuthPanel() {
  const { user, signIn, signUp, signOut, syncToCloud, syncFromCloud, signInWithOAuth, syncing, authLoading } = useStore(useShallow(s => ({
    user: s.user,
    signIn: s.signIn,
    signUp: s.signUp,
    signOut: s.signOut,
    syncToCloud: s.syncToCloud,
    syncFromCloud: s.syncFromCloud,
    signInWithOAuth: s.signInWithOAuth,
    syncing: s.syncing,
    authLoading: s.authLoading,
  })));
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Confirmation and restore setup states
  const [showBackupConfirm, setShowBackupConfirm] = useState(false);
  const [showRestoreSetup, setShowRestoreSetup] = useState(false);

  // Selective import toggles (all ON by default)
  const [restoreLikedTracks, setRestoreLikedTracks] = useState(true);
  const [restorePlaylists, setRestorePlaylists] = useState(true);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [restorePlayCounts, setRestorePlayCounts] = useState(true);

  if (user) {
    return (
      <div className="settings-ctrl-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>Logged In As</div>
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>{user.email}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button 
            onClick={() => setShowBackupConfirm(true)}
            disabled={syncing}
            className="settings-btn"
            style={{ fontSize: 11, padding: '8px 16px', background: 'rgba(var(--accent-rgb), 0.1)', color: 'white' }}
          >
            {syncing ? 'Syncing...' : 'Backup Local to Cloud'}
          </button>
          <button 
            onClick={() => setShowRestoreSetup(true)}
            disabled={syncing}
            className="settings-btn"
            style={{ fontSize: 11, padding: '8px 16px', background: 'rgba(var(--accent-rgb), 0.1)', color: 'white' }}
          >
            {syncing ? 'Syncing...' : 'Restore Cloud to Local'}
          </button>
          <button 
            onClick={() => signOut()}
            className="settings-btn settings-btn-danger"
            style={{ fontSize: 11, padding: '8px 16px' }}
          >
            Log Out Account
          </button>
        </div>

        {/* Backup Confirmation Modal */}
        <AnimatePresence>
          {showBackupConfirm && (
            <div 
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                style={{
                  background: 'rgba(12, 12, 20, 0.85)',
                  backdropFilter: 'blur(30px)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 20,
                  padding: 28,
                  width: '100%',
                  maxWidth: 420,
                  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.7)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20
                }}
              >
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: 'white', marginBottom: 8 }}>Confirm Backup to Cloud</h3>
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                    Are you sure you want to write your local music library state to the cloud? This will update your cloud account with current local playlists, liked tracks, settings, and play counts.
                  </p>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button 
                    type="button"
                    className="settings-btn"
                    onClick={() => setShowBackupConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    className="settings-btn settings-btn-success"
                    onClick={() => {
                      setShowBackupConfirm(false);
                      syncToCloud();
                    }}
                  >
                    Confirm Backup
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Restore Selective Import Modal */}
        <AnimatePresence>
          {showRestoreSetup && (
            <div 
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                style={{
                  background: 'rgba(12, 12, 20, 0.85)',
                  backdropFilter: 'blur(30px)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 20,
                  padding: 28,
                  width: '100%',
                  maxWidth: 440,
                  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.7)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20
                }}
              >
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: 'white', marginBottom: 6 }}>Restore Cloud Backup</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                    Toggle the categories you want to import from your account into this device:
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* 1. Liked Songs */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Liked Songs & Streams</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Import loved track selections</div>
                    </div>
                    <SlidingSwitch 
                      checked={restoreLikedTracks} 
                      onChange={() => setRestoreLikedTracks(!restoreLikedTracks)} 
                    />
                  </div>

                  {/* 2. Playlists */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Playlists & Tracks</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Import custom playlist structures</div>
                    </div>
                    <SlidingSwitch 
                      checked={restorePlaylists} 
                      onChange={() => setRestorePlaylists(!restorePlaylists)} 
                    />
                  </div>

                  {/* 3. Settings */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Player Configurations</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Import settings & scrobbler tokens</div>
                    </div>
                    <SlidingSwitch 
                      checked={restoreSettings} 
                      onChange={() => setRestoreSettings(!restoreSettings)} 
                    />
                  </div>

                  {/* 4. Play Counts */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Scrobble Statistics</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Import track playback counts</div>
                    </div>
                    <SlidingSwitch 
                      checked={restorePlayCounts} 
                      onChange={() => setRestorePlayCounts(!restorePlayCounts)} 
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                  <button 
                    type="button"
                    className="settings-btn"
                    onClick={() => setShowRestoreSetup(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    className="settings-btn"
                    style={{ background: 'var(--accent)', color: 'white', fontWeight: 700 }}
                    disabled={!restoreLikedTracks && !restorePlaylists && !restoreSettings && !restorePlayCounts}
                    onClick={() => {
                      setShowRestoreSetup(false);
                      syncFromCloud({
                        likedTracks: restoreLikedTracks,
                        playlists: restorePlaylists,
                        settings: restoreSettings,
                        playCounts: restorePlayCounts
                      });
                    }}
                  >
                    Start Import
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (isRegister) {
      await signUp(email.trim(), password);
    } else {
      await signIn(email.trim(), password);
    }
  };

  return (
    <div className="settings-ctrl-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header Info */}
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'white', marginBottom: 4 }}>Cloud Account</h3>
        <p style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>
          Access your account to back up and restore your liked tracks, playlists, and settings.
        </p>
      </div>

      {/* Social Logins (Primary Options) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Google Button */}
          <button
            type="button"
            disabled={authLoading}
            onClick={() => signInWithOAuth('google')}
            className="settings-btn"
            style={{ 
              flex: 1, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: 8, 
              padding: '10px 0',
              background: 'var(--glass)',
              border: '1px solid var(--glass-border)',
              color: 'white',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 10,
              cursor: 'pointer',
              transition: 'background 0.2s, border-color 0.2s'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
            Google
          </button>

          {/* GitHub Button */}
          <button
            type="button"
            disabled={authLoading}
            onClick={() => signInWithOAuth('github')}
            className="settings-btn"
            style={{ 
              flex: 1, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: 8, 
              padding: '10px 0',
              background: 'var(--glass)',
              border: '1px solid var(--glass-border)',
              color: 'white',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 10,
              cursor: 'pointer',
              transition: 'background 0.2s, border-color 0.2s'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
            </svg>
            GitHub
          </button>
        </div>
      </div>

      {/* Separator Line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          or email sign-in
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
      </div>

      {/* Email Login Form (Secondary Option) */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, marginBottom: 4, color: 'var(--text-dim)' }}>EMAIL ADDRESS</label>
            <input 
              type="email" 
              placeholder="name@example.com" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              className="settings-search-input"
              required
              style={{ width: '100%', height: 36, padding: '0 12px', fontSize: 12 }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, marginBottom: 4, color: 'var(--text-dim)' }}>PASSWORD</label>
            <input 
              type="password" 
              placeholder="••••••••" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="settings-search-input"
              required
              style={{ width: '100%', height: 36, padding: '0 12px', fontSize: 12 }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <button 
            type="submit" 
            disabled={authLoading}
            className="settings-btn"
            style={{ fontSize: 11, padding: '8px 20px', background: 'var(--accent)', color: 'white', fontWeight: 700 }}
          >
            {authLoading ? 'Please wait...' : isRegister ? 'Register Account' : 'Log In Account'}
          </button>
          <span 
            onClick={() => setIsRegister(!isRegister)}
            style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
          >
            {isRegister ? 'Already have an account? Log In' : 'Need an account? Register'}
          </span>
        </div>
      </form>
    </div>
  );
}

