import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open } from '@tauri-apps/plugin-dialog';
import { 
  Settings, Library, Radio, FolderSearch, RefreshCw, DownloadCloud, 
  Search, Palette, Volume2, Info, ShieldAlert, Laptop, HelpCircle, 
  Trash2, Plus, Sparkles, LogOut, Zap, Puzzle
} from 'lucide-react';

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
        background: checked ? 'var(--dynamic-accent, #8b5cf6)' : 'rgba(255, 255, 255, 0.08)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
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
    dsp, setDSP, playback, toggleExclusive, devices, currentDevice, setAudioDevice, fetchDevices,
    listenbrainzToken, listenbrainzUsername, listenbrainzEnabled,
    validateAndSetListenbrainzToken, setListenbrainzToken, toggleListenbrainzScrobble,
    sidebarLastfmVisible, sidebarListenbrainzVisible,
    toggleSidebarLastfmVisible, toggleSidebarListenbrainzVisible,
    liquidBackgroundEnabled, toggleLiquidBackground,
    showSmartMixWidget, toggleSmartMixWidget,
    notificationsEnabled, developerNotifications,
    toggleNotificationsEnabled, toggleDeveloperNotifications,
    subsonicUrl, subsonicUser, subsonicPass, subsonicConnected, subsonicLoading,
    jellyfinUrl, jellyfinConnected, jellyfinLoading,
    connectSubsonic, disconnectSubsonic, connectJellyfin, disconnectJellyfin,
    autoplayDiscoveryLevel, setAutoplayDiscoveryLevel,
    setShowOnboarding, setOnboardingCompleted
  } = useStore();

  // Tab navigation State
  const [activeTab, setActiveTab] = useState<'appearance' | 'library' | 'plugins' | 'scrobbling' | 'audio' | 'system' | 'updates'>('appearance');
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

  // Tab-specific reset handlers
  const resetAppearance = () => {
    setThemeMode('dynamic');
    setSelectedFont('Outfit');
    setFontScale(100);
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
    if (lastfmSessionKey) toggleScrobble();
    if (listenbrainzToken) setListenbrainzToken(null);
    if (!listenbrainzEnabled) toggleListenbrainzScrobble();
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
    if (playback.exclusive) await toggleExclusive();
    if (playback.bit_perfect) await useStore.getState().toggleBitPerfect();
    
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
      title: 'Appearance Accent Theme',
      description: 'Choose between dynamic accent colors extracted from song cover art or select from curated static HSL presets (Forest, Ocean, Mocha, etc.).',
      keywords: 'theme appearance style layout accent color green blue black white forest ocean mocha pink frappé custom palette colorpicker',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-ctrl-header-row">
            <div>
              <div className="settings-ctrl-title">Accent Styling Mode</div>
              <div className="settings-ctrl-desc">Dynamic extraction from album cover art vs premium static colors.</div>
            </div>
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

          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: 0.5, marginBottom: 12 }}>
              Curated Theme Presets
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
                  <div className="settings-chip-name">System Dynamic</div>
                  <div className="settings-chip-desc">Flowing song accents</div>
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
                  <div className="settings-chip-desc">Sync with OS Color</div>
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
                  <div className="settings-chip-color" style={{ backgroundColor: customColor, border: '1px solid rgba(255,255,255,0.1)' }}>
                    <Plus size={10} color="white" />
                  </div>
                  <div className="settings-chip-info">
                    <div className="settings-chip-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      Custom Color
                    </div>
                    <div className="settings-chip-desc">Hex Palette Choice</div>
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
      id: 'sidebar-visibility',
      title: 'Sidebar Layout Configuration',
      description: 'Choose which scrobbling services or pages are displayed in the main sidebar. Main features like Library, Aideo, Search, and Now Playing are locked for persistent navigation.',
      keywords: 'sidebar menu visible toggle hide show lastfm stats listenbrainz clean layout configuration optimize layout settings',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-ctrl-title">Sidebar Visibility Toggles</div>
          <div className="settings-ctrl-desc" style={{ marginBottom: 20 }}>
            Optimize your workspace by hiding optional panels. Essential core features are excluded and remain permanently visible.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Core Locked Features Info (Excluded) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: 10, border: '1px solid var(--glass-border)', marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                <strong style={{ color: 'white', display: 'block', marginBottom: 4 }}>Locked Core Views:</strong>
                Library, Aideo, Aideo Search, Now Playing
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontStyle: 'italic' }}>
                Always visible for core system navigation.
              </div>
            </div>

            {/* Last.fm Visibility Switch */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Last.fm Stats Tab</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Show/hide your Last.fm statistics dashboard in the sidebar.</div>
              </div>
              <SlidingSwitch 
                checked={sidebarLastfmVisible} 
                onChange={toggleSidebarLastfmVisible} 
              />
            </div>

            {/* ListenBrainz Visibility Switch */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>ListenBrainz Tab</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Show/hide your ListenBrainz scrobbling feed and recommendations.</div>
              </div>
              <div style={{ marginTop: 8 }}>
                <SlidingSwitch 
                  checked={sidebarListenbrainzVisible} 
                  onChange={toggleSidebarListenbrainzVisible} 
                />
              </div>
            </div>

            {/* AI Smart Mix Builder Visibility Switch */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>AI Smart Mix Builder</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Show or hide the smart playlist builder card in the Aideo tab.</div>
              </div>
              <div style={{ marginTop: 8 }}>
                <SlidingSwitch 
                  checked={showSmartMixWidget} 
                  onChange={toggleSmartMixWidget} 
                />
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'system-notifications',
      title: 'System UI Notifications',
      description: 'Enable or disable all visual overlay toast notifications across the application, or customize them between clean consumer alerts and raw technical developer diagnostics.',
      keywords: 'notifications toast popups alert messages appearance UI settings mute enable disable developer diagnostics debug error logs system level',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-ctrl-title">Application Notifications Center</div>
          <div className="settings-ctrl-desc" style={{ marginBottom: 20 }}>
            Manage the behavior of real-time overlay notifications, alerts, and system-wide diagnostic messaging.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Notifications Enabled Toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>System Overlay Toasts</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  Show real-time toast alerts for actions, uploads, updates, and errors.
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
                padding: '8px 4px', 
                borderTop: '1px solid rgba(255,255,255,0.04)',
                opacity: notificationsEnabled ? 1 : 0.5,
                transition: 'opacity 0.2s',
                pointerEvents: notificationsEnabled ? 'auto' : 'none'
              }}
            >
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>Developer Diagnostics Mode</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  Prepend active file domains, internal function context, and raw telemetry to error messages.
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
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
      title: 'Interactive Liquid Art Backdrop',
      description: 'Enable or disable a highly immersive, audio-reactive liquid backdrop in the background of Now Playing. Morphing colors shift harmonically based on active cover art, and pulse dynamically with music tempo and frequencies.',
      keywords: 'liquid backdrop background dynamic webgl dynamic waves audio reactive animated visualizer settings option layout appearance',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, paddingRight: 24 }}>
              <div className="settings-ctrl-title">Dynamic Liquid Art Backdrop</div>
              <div className="settings-ctrl-desc" style={{ marginTop: 4 }}>
                Renders custom organic morphing fluid waves in the background of the player. Synchronized in real-time with the track's audio spectrum frequencies and cover art colors. Bypassed automatically in Low-Spec Mode.
              </div>
            </div>
            <SlidingSwitch 
              checked={liquidBackgroundEnabled} 
              onChange={toggleLiquidBackground} 
            />
          </div>
        </div>
      )
    },
    {
      id: 'typography',
      title: 'Global Typography (Fonts)',
      description: 'Set custom user interface font family across Aideo. Dynamically downloads from Google Fonts.',
      keywords: 'font text typography size scaling scale outfit inter roboto montserrat jetbrains playfair design appearance UI',
      tab: 'appearance',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-two-col-row">
            <div style={{ flex: 1 }}>
              <div className="settings-ctrl-title">Interface Font Family</div>
              <div className="settings-ctrl-desc">Choose a Google Font to update all labels and lists.</div>
              <div style={{ marginTop: 12 }}>
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
              <div className="settings-ctrl-title">Typography Scaling</div>
              <div className="settings-ctrl-desc">Scale size from compact 80% to readable 120%.</div>
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, fontWeight: 600 }}>
                  <span style={{ color: 'var(--text-dim)' }}>Compact</span>
                  <span style={{ color: 'var(--accent)' }}>{fontScale}%</span>
                  <span style={{ color: 'var(--text-dim)' }}>Readable</span>
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
      id: 'library-folders',
      title: 'Offline Music Library Folders',
      description: 'Define multiple absolute paths or folders containing offline MP3, FLAC, M4A, or WAV files. Sync instantly to database.',
      keywords: 'library folder folders directory path track music add remove scan scanDirs sync database sync status loader',
      tab: 'library',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-ctrl-title">Tracked Audio Folders</div>
          <div className="settings-ctrl-desc" style={{ marginBottom: 16 }}>
            Aideo scans these directories recursively, indexing tags and cached artwork inside the SQLite engine.
          </div>

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
              <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '24px', textAlign: 'center', background: 'rgba(0,0,0,0.15)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.05)' }}>
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
      id: 'cloud-connections',
      title: 'Cloud Servers & Private Connections',
      description: 'Connect self-hosted personal music libraries (Subsonic/Navidrome or Jellyfin) directly to Aideo Search for dynamic lossless streaming.',
      keywords: 'cloud subsonic navidrome jellyfin self-hosted stream api private credentials server connection integration music host remote',
      tab: 'library',
      element: (
        <div className="settings-ctrl-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <div className="settings-ctrl-title">Cloud Servers & Private Connections</div>
            <div className="settings-ctrl-desc">
              Link your private media servers to stream your personal high-fidelity library directly. Dynamically merges with search feeds.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Subsonic / Navidrome Console */}
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.02)', 
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
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'white' }}>Subsonic / Navidrome</span>
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
                      Active User: <strong style={{ color: 'white' }}>{subsonicUser}</strong>
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
              background: 'rgba(255, 255, 255, 0.02)', 
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
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'white' }}>Jellyfin Media Server</span>
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
                      Connection Mode: <strong style={{ color: 'white' }}>Token (API Key)</strong>
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
      id: 'lastfm-connect',
      title: 'Last.fm Audioscrobbler',
      description: 'Connect your Last.fm profile with standard secure API token authorization. Set custom scrobble duration percentage thresholds.',
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
                <div style={{ fontWeight: 700, fontSize: 14, color: 'white' }}>Last.fm Integration</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Synchronize listening counts, hearts, and histories.</div>
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
                        const token = await invoke<string>('lastfm_get_token');
                        useStore.setState({ lastfmToken: token });
                        const apiKey = "f4cbad896003f0f61f05b844ee3c5b0b";
                        await openUrl(`https://www.last.fm/api/auth/?api_key=${apiKey}&token=${token}`);
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, padding: 14, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
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
      title: 'ListenBrainz Scrobbler & Stats',
      description: 'Connect your ListenBrainz profile to scrobble tracks automatically and receive personalized recommendations based on collaborative-filtering.',
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
                <div style={{ fontWeight: 700, fontSize: 14, color: 'white' }}>ListenBrainz Integration</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>Submit your listens to an open, non-profit community catalog.</div>
              </div>
            </div>

            {listenbrainzToken ? (
              <div>
                <div className="settings-lfm-connected-header">
                  <div className="settings-status-indicator connected">
                    <span className="settings-status-dot pulse" style={{ backgroundColor: 'rgba(235, 116, 59, 0.95)' }}></span>
                    <span>Connected as <strong style={{ color: 'white' }}>{listenbrainzUsername}</strong></span>
                  </div>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: 11, width: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => setListenbrainzToken(null)}
                  >
                    <LogOut size={11} /> Disconnect
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, padding: '12px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'white' }}>Automatic Scrobbling</div>
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
      title: 'Audio Engine Quality Tier',
      description: 'Configure your global audio output profile based on your processor capability and audio equipment.',
      keywords: 'audio quality profile tier resampler buffer latency dither battery cpu high res performance sync',
      tab: 'audio',
      element: (
        <div className="settings-ctrl-card" style={{ padding: 20 }}>
          <div style={{ marginBottom: 20 }}>
            <div className="settings-ctrl-title">Audio Pipeline Performance & Quality Profiles</div>
            <div className="settings-ctrl-desc">
              Tailor Aideo's real-time DSP pipeline, resampler kernel, buffer latency, and visualizer resolution using simple presets or individual customizable variables.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              {
                id: 'low',
                name: 'Low Quality Preset',
                desc: 'Optimized for battery savings, older processors, or high-latency bluetooth devices.',
                icon: <Laptop size={20} />,
                bullets: [
                  { label: 'Rubato Resampler', value: 'Linear (Cheap)', active: false, premium: false },
                  { label: 'Oversampling Factor', value: '128x precision', active: false, premium: false },
                  { label: 'Sinc Kernel Length', value: '64 Taps (Low Latency)', active: false, premium: false },
                  { label: 'FFmpeg Transcode', value: '16-bit / 44.1kHz', active: false, premium: false }
                ]
              },
              {
                id: 'normal',
                name: 'Normal Preset',
                desc: 'Perfect balance of extreme audio fidelity and standard CPU/battery performance.',
                icon: <Volume2 size={20} />,
                bullets: [
                  { label: 'Rubato Resampler', value: 'Cubic (Balanced)', active: true, premium: false },
                  { label: 'Oversampling Factor', value: '256x precision', active: true, premium: false },
                  { label: 'Sinc Kernel Length', value: '128 Taps (Balanced)', active: true, premium: false },
                  { label: 'FFmpeg Transcode', value: '24-bit / 48.0kHz', active: true, premium: false }
                ]
              },
              {
                id: 'high',
                name: 'High Preset',
                desc: 'Bit-perfect, zero-compromise audio delivery with absolute math precision.',
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
                name: 'Custom Profile',
                desc: 'Create a bespoke sound configuration by customizing individual variables below.',
                icon: <Settings size={20} />,
                bullets: [
                  { label: 'Rubato Resampler', value: dsp.resampler_interpolation === 'linear' ? 'Linear (Fast)' : 'Cubic (High-Res)', active: dsp.resampler_interpolation === 'cubic', premium: false },
                  { label: 'Oversampling Factor', value: `${dsp.resampler_oversampling}x precision`, active: true, premium: dsp.resampler_oversampling === 512 },
                  { label: 'Sinc Kernel Length', value: `${dsp.resampler_sinc_len} Taps`, active: true, premium: dsp.resampler_sinc_len === 256 },
                  { label: 'FFmpeg Transcode', value: dsp.ffmpeg_transcode_quality === 'standard' ? '16-bit / 44.1k' : dsp.ffmpeg_transcode_quality === 'studio' ? '24-bit / 48.0k' : '24-bit / 96.0k', active: true, premium: dsp.ffmpeg_transcode_quality === 'hires' }
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
                    background: active ? 'rgba(var(--accent-rgb), 0.08)' : 'rgba(255,255,255,0.015)',
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
                        background: active ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
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
                      background: active ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
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
                                background: active ? 'var(--accent)' : 'rgba(255,255,255,0.03)',
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
                                background: active ? 'var(--accent)' : 'rgba(255,255,255,0.03)',
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
                                background: active ? 'var(--accent)' : 'rgba(255,255,255,0.03)',
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
                          { id: 'hires', label: '24b/96k' }
                        ].map(opt => {
                          const active = dsp.ffmpeg_transcode_quality === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setDSP({ ffmpeg_transcode_quality: opt.id as any })}
                              style={{
                                flex: 1, fontSize: 9, padding: '8px 4px', borderRadius: 4, cursor: 'pointer',
                                border: '1px solid var(--glass-border)',
                                background: active ? 'var(--accent)' : 'rgba(255,255,255,0.03)',
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
      title: 'Soundcard Output & Hardware Mode',
      description: 'Select ASIO/WASAPI device drivers, exclusive sound card access, upsampling rates, and TPDF dithering options.',
      keywords: 'audio device exclusive bit-perfect bypass dac driver hardware sound output asio wasapi dither tpdf resampler frequency rate latency soundstage spatial crossfeed',
      tab: 'audio',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-two-col-row">
            {/* Device Selector */}
            <div style={{ flex: 1.2, borderRight: '1px solid var(--glass-border)', paddingRight: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div className="settings-ctrl-title">Playback Output Device</div>
                <button 
                  onClick={() => fetchDevices()} 
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, textTransform: 'uppercase' }}
                >
                  <RefreshCw size={10} /> Refresh Devices
                </button>
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
                <div className={`exclusive-toggle ${playback.bit_perfect ? 'active' : ''}`}
                  onClick={() => useStore.getState().toggleBitPerfect()}
                  style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: playback.bit_perfect ? 'rgba(6, 182, 212, 0.08)' : 'rgba(0,0,0,0.2)', borderColor: playback.bit_perfect ? '#06b6d4' : '', cursor: 'pointer', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Bit-Perfect Bypass</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: playback.bit_perfect ? '#06b6d4' : 'rgba(255,255,255,0.05)', color: playback.bit_perfect ? '#fff' : 'var(--text-dim)' }}>
                      {playback.bit_perfect ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                    Passes bitstream directly. Skips mixer resampler, volume gain, and all active DSP.
                  </div>
                </div>
              </div>

              <div>
                <div className="settings-ctrl-title">Exclusive Mode</div>
                <div className={`exclusive-toggle ${playback.exclusive ? 'active' : ''}`} 
                  onClick={toggleExclusive} 
                  style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--glass-border)', background: playback.exclusive ? 'rgba(var(--accent-rgb), 0.08)' : 'rgba(0,0,0,0.2)', cursor: 'pointer', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Exclusive Access</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: playback.exclusive ? 'var(--accent)' : 'rgba(255,255,255,0.05)', color: playback.exclusive ? '#fff' : 'var(--text-dim)' }}>
                      {playback.exclusive ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                    Bypass standard Windows WASAPI sound layers for low latency and zero resampling distortion.
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {playback.exclusive && (
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
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: dsp.dither ? 'var(--accent)' : 'rgba(255,255,255,0.05)', color: dsp.dither ? '#fff' : 'var(--text-dim)' }}>
                      {dsp.dither ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.3 }}>
                    Combats quantization artifacts on high-end DACs by introducing a linear 24-bit TPDF noise spectrum.
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
                    background: dsp.upsample_rate === rate ? 'var(--accent)' : 'rgba(255,255,255,0.03)',
                    color: dsp.upsample_rate === rate ? 'white' : 'var(--text)',
                    cursor: 'pointer',
                    fontWeight: dsp.upsample_rate === rate ? 700 : 500,
                    transition: 'all 0.2s',
                    flex: '1 0 10%'
                  }}
                  onClick={() => {
                    setDSP({ upsample_rate: rate });
                    if (rate > 0 && playback.bit_perfect) {
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
      id: 'system-behavior',
      title: 'System Sleep & Discord rich presence',
      description: 'Toggle system sleep prevention during playback, and show active track status directly on Discord rich profiles.',
      keywords: 'system sleep behavior discord rich presence profiles listening music toggles prevent sleep keep awake',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-two-col-row">
            <div style={{ flex: 1, borderRight: '1px solid var(--glass-border)', paddingRight: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div className="settings-ctrl-title">Prevent System Hibernation</div>
                  <div className="settings-ctrl-desc">Keep Windows PC fully awake and active during background playback.</div>
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
                  <div className="settings-ctrl-title">Discord Rich Presence (RPC)</div>
                  <div className="settings-ctrl-desc">Broadcasting your listening cover art, title, and timeline status on Discord profile badges.</div>
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
      id: 'cloud-autoplay-behavior',
      title: 'Cloud Streams Autoplay Behavior',
      description: 'Configure whether cloud or online streams (Subsonic/Jellyfin/Web Stream) should auto-play local library music when the cloud queue finishes.',
      keywords: 'cloud stream autoplay local library subsonic navidrome jellyfin connection end stop transition webstream',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, paddingRight: 24 }}>
              <div className="settings-ctrl-title">Autoplay Local Tracks after Cloud Stream</div>
              <div className="settings-ctrl-desc" style={{ marginTop: 4 }}>
                If enabled, Aideo will seamlessly transition and autoplay your local library files once a Subsonic, Jellyfin, or online preview list finishes. If disabled, playback will cleanly stop at the end of the cloud queue.
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
      title: 'Autoplay & Discovery Taste Profile',
      description: 'Fine-tune how closely recommended stream tracks match your mainstream J-Pop/K-Pop/Pop offline library taste.',
      keywords: 'autoplay discovery level taste profile familiarity balanced J-Pop K-Pop Pop mainstream settings',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ marginBottom: 16 }}>
            <div className="settings-ctrl-title">Discovery & Radio Taste Level</div>
            <div className="settings-ctrl-desc">
              Select how adventurous Aideo\'s Autoplay Radio and Discovery Hub should be when curating stream previews.
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: 10, background: 'rgba(0,0,0,0.12)', padding: 6, borderRadius: 12, border: '1px solid var(--glass-border)' }}>
            {[
              { 
                id: 'familiarity', 
                label: 'Familiarity-Heavy', 
                desc: 'Plays songs by artists you already love in your library. Safe and comfortable.',
                color: 'var(--accent)'
              },
              { 
                id: 'balanced', 
                label: 'Balanced Mix', 
                desc: 'Premium blend of favorite local artists and fresh, highly related mainstream suggestions.',
                color: 'var(--accent)'
              },
              { 
                id: 'discovery', 
                label: 'Discovery-Heavy', 
                desc: 'Actively pushes J-Pop/K-Pop/Pop gems you have never listened to before.',
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
      title: 'Performance & Device Calibration',
      description: 'Optimize Aideo for older, low-specification, or battery-sensitive hardware.',
      keywords: 'performance calibration low-spec low spec lag latency frame battery gpu cpu animations backdrop filter blur canvas shadow',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, paddingRight: 24 }}>
              <div className="settings-ctrl-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Low-Spec Hardware Mode</span>
                {lowSpecMode && (
                  <span style={{ fontSize: 9, background: 'var(--accent)', color: 'white', padding: '2px 6px', borderRadius: 10, fontWeight: 700 }}>
                    ACTIVE
                  </span>
                )}
              </div>
              <div className="settings-ctrl-desc" style={{ marginTop: 4 }}>
                Suspends background audio FFT analysis threads, disables heavy real-time canvas shadow calculations, bypasses CSS backdrop-filter blurs, and forces Framer Motion layout vectors to resolve instantly. Perfect for conserving battery and reducing CPU/GPU overhead.
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
      title: 'System Extensions & Dependencies Manager',
      description: 'Manage optional external helper libraries to extend Aideo features or reclaim system space.',
      keywords: 'system extensions dependencies manager ytdlp ffmpeg install uninstall delete space clean plugins tool',
      tab: 'plugins',
      element: <DependencyManagerPanel />
    },
    {
      id: 'app-onboarding-setup',
      title: 'App Setup & Onboarding Wizard',
      description: 'Launch the premium configuration walkthrough to adjust your core application mode (Local Only vs. Hybrid Explorer) and toggle multiple audio and integration preferences in a single spot.',
      keywords: 'setup onboarding wizard reconfigure run config walkthrough local hybrid preferences calibration debug',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, paddingRight: 24 }}>
              <div className="settings-ctrl-title">App Setup Wizard Walkthrough</div>
              <div className="settings-ctrl-desc" style={{ marginTop: 4 }}>
                Run the glowing glassmorphic calibration walkthrough at any time. Tweak your offline directory libraries, exclusive audio drivers, and online statistics integrations on the fly.
              </div>
            </div>
            <button
              onClick={() => {
                setShowOnboarding(true);
                setOnboardingCompleted(false);
                window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Launching Setup Onboarding Wizard...', type: 'info' } }));
              }}
              className="settings-btn"
              style={{
                fontSize: 11,
                padding: '8px 16px',
                background: 'rgba(var(--accent-rgb), 0.15)',
                color: 'var(--dynamic-accent, #8b5cf6)',
                fontWeight: 700,
                border: '1px solid rgba(var(--accent-rgb), 0.25)',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Launch Setup Wizard
            </button>
          </div>
        </div>
      )
    },

    {
      id: 'cache-management',
      title: 'Cache and Storage Management',
      description: 'Clear temporary files, cached streaming audio files, and temporary url lookup parameters to reclaim local disk storage.',
      keywords: 'cache clear clean delete temp storage cloud cache cloudcache youtube ytdlp temporary disk space usage size',
      tab: 'system',
      element: (
        <div className="settings-ctrl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ flex: 1, paddingRight: 24 }}>
              <div className="settings-ctrl-title">Cache & Temp Storage Cleanup</div>
              <div className="settings-ctrl-desc" style={{ marginTop: 4 }}>
                Aideo stores four types of caches locally:
                <ul style={{ margin: '8px 0 0 16px', padding: 0, listStyleType: 'disc', color: 'var(--text-dim)', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <li><strong>Cloud Audio Stream Cache:</strong> Local copies of streamed Subsonic, Jellyfin, YouTube, and Tidal tracks saved for offline access.</li>
                  <li><strong>yt-dlp temporary cache:</strong> Temporary files created during background URL extractions.</li>
                  <li><strong>Temporary Decrypted Audio:</strong> Piped stream buffers in the system temp directory.</li>
                  <li><strong>In-Memory URL Resolves:</strong> Cached YouTube streaming URLs to avoid rate limits.</li>
                </ul>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => {
                  try {
                    await invoke('open_cache_folder');
                  } catch (e: any) {
                    window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: `Failed to open cache folder: ${e}`, type: 'error' } }));
                  }
                }}
                className="settings-btn"
                style={{
                  fontSize: 11,
                  padding: '8px 16px',
                  fontWeight: 700,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
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
                className="settings-btn settings-btn-danger"
                style={{
                  fontSize: 11,
                  padding: '8px 16px',
                  fontWeight: 700,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
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
      id: 'auto-updater',
      title: 'App Auto-Updater Updates',
      description: 'Silent and manual release checks to query Aideo binaries directly from official GitHub repositories.',
      keywords: 'updater check update manual automatic github releases install progress downloads versions status logs error',
      tab: 'updates',
      element: (
        <div className="settings-ctrl-card">
          <div className="settings-update-card" style={{ background: 'transparent', border: 'none', padding: 0 }}>
            <div className="settings-update-flex">
              <div className="settings-update-text">
                <div className="settings-ctrl-title">GitHub Release Auto-Updater</div>
                <div className="settings-ctrl-desc">Verify your currently running copy and trigger standard delta patches immediately.</div>
              </div>
              <button
                className="btn btn-primary"
                style={{ padding: '10px 20px', fontSize: 12, width: 'auto' }}
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
                {updateChecking ? 'Checking API...' : 'Check for Updates'}
              </button>
            </div>
            {updateStatus && (
              <div className="settings-update-status-msg" style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)', marginTop: 16 }}>
                {updateStatus}
              </div>
            )}
          </div>
        </div>
      )
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
          <Settings size={26} className="settings-gear-icon" />
          <h1 className="settings-main-title">Settings</h1>
        </div>
        <p className="settings-main-subtitle">Fine-tune your local audio hardware, library directories, and premium visual interfaces.</p>
      </div>

      {/* Interactive Search Bar */}
      <div className="settings-search-wrapper">
        <Search size={18} className="settings-search-icon" />
        <input 
          type="text" 
          placeholder="Search for themes, WASAPI hardware drivers, library sync options..." 
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

          {!searchQuery.trim() && activeTab !== 'updates' && activeTab !== 'plugins' && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.01)',
              border: '1px solid rgba(255, 255, 255, 0.04)',
              padding: '14px 20px',
              borderRadius: 12,
              marginBottom: 10
            }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'white', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {activeTab} calibration panel
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                  Fine-tune or restore all parameters in this settings category.
                </span>
              </div>
              <button
                onClick={() => {
                  if (activeTab === 'appearance') resetAppearance();
                  else if (activeTab === 'library') resetLibrary();
                  else if (activeTab === 'scrobbling') resetScrobbling();
                  else if (activeTab === 'audio') resetAudio();
                  else if (activeTab === 'system') resetSystem();
                }}
                className="settings-btn settings-btn-danger"
                style={{ fontSize: 11, padding: '8px 16px' }}
              >
                Reset Section to Defaults
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
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'white', marginBottom: 4 }}>No settings found</div>
                  <div>No settings matched your query "{searchQuery}". Try a different keyword.</div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
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
      name: 'Web Stream Decoder (yt-dlp)',
      desc: 'Enables streaming, parsing, and searching community web stream catalogues.',
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
          <div key={dep.id} className="settings-ctrl-card" style={{ padding: '16px 20px', background: 'rgba(255,255,255,0.01)' }}>
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
                  <button 
                    onClick={() => handleUninstall(dep.id)} 
                    className="settings-btn settings-btn-danger" 
                    style={{ fontSize: 11, padding: '6px 12px' }}
                  >
                    Uninstall
                  </button>
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
                <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
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

