import { StateCreator } from 'zustand';
import { PlayerState, LEGACY_AIDEO_PAGE_DESIGNS, SidebarNavItemConfig, SidebarNavItemId } from './types';
import { invoke } from '@tauri-apps/api/core';
import { safeGetStorage, safeSetStorage } from '../utils/storage';

export const DEFAULT_SIDEBAR_NAV_ITEMS: SidebarNavItemConfig[] = [
  { id: 'aideo', label: 'Aideo', visible: true },
  { id: 'charts', label: 'Top Charts', visible: true, requiresHybrid: true },
  { id: 'library', label: 'Library', visible: true },
  { id: 'nowplaying', label: 'Now Playing', visible: true },
  { id: 'loved_streams', label: 'Loved Streams', visible: true, requiresHybrid: true },
  { id: 'downloaded', label: 'Downloaded', visible: true },
  { id: 'aideo_lab', label: 'Aideo Lab', visible: true },
  { id: 'insights', label: 'Aideo Insights', visible: true },
  { id: 'lastfm', label: 'Last.fm Stats', visible: true, requiresAuth: 'lastfm' },
  { id: 'listenbrainz', label: 'ListenBrainz', visible: true, requiresAuth: 'listenbrainz' },
];

const getSavedSidebarNavItems = (): SidebarNavItemConfig[] => {
  const raw = safeGetStorage('aideo-sidebar-nav-items');
  const legacyLastfm = safeGetStorage('aideo-sidebar-lastfm') !== 'false';
  const legacyListenbrainz = safeGetStorage('aideo-sidebar-listenbrainz') !== 'false';

  if (raw) {
    try {
      const parsed: SidebarNavItemConfig[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const result: SidebarNavItemConfig[] = [];
        const seenIds = new Set<string>();

        for (const item of parsed) {
          const defaultItem = DEFAULT_SIDEBAR_NAV_ITEMS.find(d => d.id === item.id);
          if (defaultItem) {
            result.push({
              ...defaultItem,
              visible: typeof item.visible === 'boolean' ? item.visible : defaultItem.visible,
            });
            seenIds.add(item.id);
          }
        }
        for (const defaultItem of DEFAULT_SIDEBAR_NAV_ITEMS) {
          if (!seenIds.has(defaultItem.id)) {
            result.push({ ...defaultItem });
          }
        }
        return result;
      }
    } catch (_) {}
  }
  return DEFAULT_SIDEBAR_NAV_ITEMS.map(i => {
    if (i.id === 'lastfm') return { ...i, visible: legacyLastfm };
    if (i.id === 'listenbrainz') return { ...i, visible: legacyListenbrainz };
    return { ...i };
  });
};

let sleepTimerInterval: any = null;

const getSavedShortcuts = () => {
  const raw = safeGetStorage('aideo-keyboard-shortcuts');
  const defaults = {
    playPause: 'Space',
    next: 'ArrowRight',
    prev: 'ArrowLeft',
    volumeUp: 'ArrowUp',
    volumeDown: 'ArrowDown',
    mute: 'm',
    dspBypass: 'b',
    fullscreenToggle: 'F11'
  };
  if (raw) {
    try {
      return { ...defaults, ...JSON.parse(raw) };
    } catch (_) {}
  }
  return defaults;
};

const getSavedGlobalHotkeys = (): Record<string, string | null> => {
  const defaults: Record<string, string | null> = {
    playPause: 'Ctrl+Alt+P',
    next: 'Ctrl+Alt+Right',
    prev: 'Ctrl+Alt+Left'
  };
  const raw = safeGetStorage('aideo-global-hotkeys');
  if (raw) {
    try {
      return { ...defaults, ...JSON.parse(raw) };
    } catch (_) {}
  }
  return defaults;
};

export const createUISlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  view: (safeGetStorage('aideo-last-view') as any) || 'aideo',
  accentColor: '#8b5cf6',
  showProMode: false,
  showControlCenter: false,
  showSettings: false,
  sidebarNavItems: getSavedSidebarNavItems(),
  sidebarLastfmVisible: safeGetStorage('aideo-sidebar-lastfm') !== 'false',
  sidebarListenbrainzVisible: safeGetStorage('aideo-sidebar-listenbrainz') !== 'false',
  sidebarCollapsed: safeGetStorage('aideo-sidebar-collapsed') === 'true',
  liquidBackgroundEnabled: safeGetStorage('aideo-liquid-bg') !== 'false',
  showSmartMixWidget: safeGetStorage('aideo-show-smart-mix') !== 'false',
  qobuzExperimentalEnabled: safeGetStorage('aideo-qobuz-experimental') === 'true',
  playbackError: null,
  playbackSuccess: null,
  appMode: (safeGetStorage('aideo-app-mode') as 'local' | 'hybrid') || 'hybrid',
  onboardingCompleted: safeGetStorage('aideo-onboarding-completed') === 'true',
  showOnboarding: safeGetStorage('aideo-onboarding-completed') !== 'true',
  notificationsEnabled: safeGetStorage('aideo-notifications-enabled') !== 'false',
  developerNotifications: safeGetStorage('aideo-developer-notifications') === 'true',
  discoveryData: null,
  isLoadingRecs: true,
  activeDiscoveryTab: 'all',
  discoveryLayout: (safeGetStorage('aideo-discovery-layout') as 'shelves' | 'unified') || 'shelves',
  customPrompt: {
    open: false,
    title: '',
    placeholder: '',
    initialValue: '',
    actionLabel: '',
    onSubmit: () => { }
  },

  miniPlayerMode: false,
  shortcuts: getSavedShortcuts(),
  globalHotkeys: getSavedGlobalHotkeys(),
  sleepTimer: { duration: 0, remaining: 0, active: false },
  colorScheme: (safeGetStorage('aideo-color-scheme') as 'dark' | 'light' | 'system') || 'dark',
  albumArtFit: (safeGetStorage('aideo-album-art-fit') as 'cover' | 'contain') || 'contain',
  playerBarDesign: (safeGetStorage('aideo-playerbar-design') as any) || 'classic',
  aideoPageDesign: (() => {
    const stored = safeGetStorage('aideo-page-design') as string | null;
    if (!stored) return 'classic' as const;
    return LEGACY_AIDEO_PAGE_DESIGNS.includes(stored as any) ? 'classic' as const : stored;
  })(),
  playerBarTransparent: safeGetStorage('aideo-playerbar-transparent') === 'true',

  setCustomPrompt: (prompt: any) => set(s => ({
    customPrompt: { ...s.customPrompt, ...prompt }
  })),

  coverArtModalTrack: null,
  setCoverArtModalTrack: (track: any) => set({ coverArtModalTrack: track }),

  tagEditorTrack: null,
  tagEditorBatchTracks: [],
  setTagEditorTrack: (track: any) => set({ tagEditorTrack: track }),
  setTagEditorBatchTracks: (tracks: any[]) => set({ tagEditorBatchTracks: tracks }),

  desktopLyricsOpen: false,
  desktopLyricsLocked: false,

  toggleDesktopLyrics: async () => {
    const next = !get().desktopLyricsOpen;
    try {
      await invoke('toggle_desktop_lyrics', { show: next });
      set({ desktopLyricsOpen: next });
    } catch (e) {
      console.error('Failed to toggle desktop lyrics:', e);
    }
  },

  toggleDesktopLyricsLocked: async () => {
    const next = !get().desktopLyricsLocked;
    try {
      await invoke('set_desktop_lyrics_ignore_cursor', { ignore: next });
      set({ desktopLyricsLocked: next });
    } catch (e) {
      console.error('Failed to set desktop lyrics click-through:', e);
    }
  },

  setPlaybackError: (err: string | null) => {
    set({ playbackError: err });
    if (err) setTimeout(() => get().setPlaybackError(null), 5000);
  },

  setPlaybackSuccess: (msg: string | null) => {
    set({ playbackSuccess: msg });
    if (msg) setTimeout(() => get().setPlaybackSuccess(null), 4000);
  },

  setView: (view: any) => {
    if (view && typeof view === 'string') {
      safeSetStorage('aideo-last-view', view);
    }
    set({ view });
  },

  setDiscoveryData: (discoveryData: any) => set({ discoveryData }),
  setIsLoadingRecs: (isLoadingRecs: boolean) => set({ isLoadingRecs }),
  setActiveDiscoveryTab: (activeDiscoveryTab: string) => set({ activeDiscoveryTab }),
  setDiscoveryLayout: (discoveryLayout: 'shelves' | 'unified') => {
    localStorage.setItem('aideo-discovery-layout', discoveryLayout);
    set({ discoveryLayout });
  },

  toggleNotificationsEnabled: () => {
    const next = !get().notificationsEnabled;
    localStorage.setItem('aideo-notifications-enabled', String(next));
    set({ notificationsEnabled: next });
  },

  toggleDeveloperNotifications: () => {
    const next = !get().developerNotifications;
    localStorage.setItem('aideo-developer-notifications', String(next));
    set({ developerNotifications: next });
  },

  setAppMode: (mode: 'local' | 'hybrid') => {
    localStorage.setItem('aideo-app-mode', mode);
    set({ appMode: mode });
  },

  setOnboardingCompleted: (completed: boolean) => {
    localStorage.setItem('aideo-onboarding-completed', String(completed));
    set({ onboardingCompleted: completed });
  },

  setShowOnboarding: (show: boolean) => set({ showOnboarding: show }),

  toggleSettings: () => set(s => ({ showSettings: !s.showSettings })),

  toggleProMode: () => set(s => ({ showProMode: !s.showProMode })),

  toggleControlCenter: () => set(s => ({ showControlCenter: !s.showControlCenter })),

  setSidebarNavItems: (items: SidebarNavItemConfig[]) => {
    safeSetStorage('aideo-sidebar-nav-items', JSON.stringify(items));
    set({ sidebarNavItems: items });
  },

  toggleSidebarNavItemVisibility: (id: SidebarNavItemId) => {
    const current = get().sidebarNavItems;
    const target = current.find(i => i.id === id);
    if (!target) return;

    // Safety guard: Ensure at least one item remains visible
    if (target.visible) {
      const currentlyVisible = current.filter(i => i.visible);
      if (currentlyVisible.length <= 1) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('ui-toast', {
            detail: { message: 'At least one sidebar navigation item must remain visible.', type: 'warning' }
          }));
        }
        return;
      }
    }

    const updated = current.map(item =>
      item.id === id ? { ...item, visible: !item.visible } : item
    );
    safeSetStorage('aideo-sidebar-nav-items', JSON.stringify(updated));

    if (id === 'lastfm') {
      const nextVal = !target.visible;
      safeSetStorage('aideo-sidebar-lastfm', String(nextVal));
      set({ sidebarLastfmVisible: nextVal, sidebarNavItems: updated });
    } else if (id === 'listenbrainz') {
      const nextVal = !target.visible;
      safeSetStorage('aideo-sidebar-listenbrainz', String(nextVal));
      set({ sidebarListenbrainzVisible: nextVal, sidebarNavItems: updated });
    } else {
      set({ sidebarNavItems: updated });
    }
  },

  moveSidebarNavItem: (index: number, direction: 'up' | 'down') => {
    const current = [...get().sidebarNavItems];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= current.length) return;

    const [moved] = current.splice(index, 1);
    current.splice(targetIndex, 0, moved);

    safeSetStorage('aideo-sidebar-nav-items', JSON.stringify(current));
    set({ sidebarNavItems: current });
  },

  resetSidebarNavItems: () => {
    const defaults = DEFAULT_SIDEBAR_NAV_ITEMS.map(i => ({ ...i }));
    safeSetStorage('aideo-sidebar-nav-items', JSON.stringify(defaults));
    safeSetStorage('aideo-sidebar-lastfm', 'true');
    safeSetStorage('aideo-sidebar-listenbrainz', 'true');
    set({
      sidebarNavItems: defaults,
      sidebarLastfmVisible: true,
      sidebarListenbrainzVisible: true
    });
  },

  toggleSidebarLastfmVisible: () => {
    const next = !get().sidebarLastfmVisible;
    safeSetStorage('aideo-sidebar-lastfm', String(next));
    const items = get().sidebarNavItems.map(i => i.id === 'lastfm' ? { ...i, visible: next } : i);
    safeSetStorage('aideo-sidebar-nav-items', JSON.stringify(items));
    set({ sidebarLastfmVisible: next, sidebarNavItems: items });
  },

  toggleSidebarListenbrainzVisible: () => {
    const next = !get().sidebarListenbrainzVisible;
    safeSetStorage('aideo-sidebar-listenbrainz', String(next));
    const items = get().sidebarNavItems.map(i => i.id === 'listenbrainz' ? { ...i, visible: next } : i);
    safeSetStorage('aideo-sidebar-nav-items', JSON.stringify(items));
    set({ sidebarListenbrainzVisible: next, sidebarNavItems: items });
  },

  toggleSidebarCollapsed: () => {
    const next = !get().sidebarCollapsed;
    safeSetStorage('aideo-sidebar-collapsed', String(next));
    set({ sidebarCollapsed: next });
  },

  toggleLiquidBackground: () => {
    const next = !get().liquidBackgroundEnabled;
    localStorage.setItem('aideo-liquid-bg', String(next));
    set({ liquidBackgroundEnabled: next });
  },

  toggleSmartMixWidget: () => {
    const next = !get().showSmartMixWidget;
    localStorage.setItem('aideo-show-smart-mix', String(next));
    set({ showSmartMixWidget: next });
  },

  toggleQobuzExperimental: () => {
    const next = !get().qobuzExperimentalEnabled;
    localStorage.setItem('aideo-qobuz-experimental', String(next));
    set({ qobuzExperimentalEnabled: next });
  },

  resetProMode: () => {
    get().setDSP({
      enabled: false,
      low_spec_mode: false,
      width: 1.0,
      upsample_rate: 0,
      dither: false,
      eq_enabled: false,
      eq_parametric: false,
      eq_graphic_gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      eq_parametric_bands: [
        { freq: 80, gain: 0, q: 0.7, band_type: 'lowshelf' },
        { freq: 120, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 240, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 400, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 750, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 1500, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 2200, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 4000, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 6000, gain: 0, q: 0.7, band_type: 'highshelf' },
        { freq: 10000, gain: 0, q: 0.7, band_type: 'peaking' }
      ],
      crossfeed_enabled: false,
      crossfeed_level: -6.0,
      crossfeed_corner: 700.0,
      spatial_enabled: false,
      spatial_haas_delay: 7.5,
      spatial_wet: 0.15,
      subsonic_enabled: false,
      night_mode_enabled: false,
      r128_enabled: false,
      convolution_enabled: false,
      convolution_ir_path: '',
      convolution_wet: 0.5,
      aideo_filter_enabled: false,
      aideo_filter_room_size: 0.85,
      aideo_filter_bass_thump: 6.0
    });
  },

  setMiniPlayerMode: async (mini: boolean) => {
    try {
      await invoke('set_mini_player_mode', { mini });
      set({ miniPlayerMode: mini });
    } catch (e) {
      console.error('Failed to toggle mini player mode:', e);
    }
  },

  setShortcut: (action: string, binding: string) => {
    const nextShortcuts = { ...get().shortcuts, [action]: binding };
    localStorage.setItem('aideo-keyboard-shortcuts', JSON.stringify(nextShortcuts));
    set({ shortcuts: nextShortcuts });
  },

  startSleepTimer: (durationMinutes: number) => {
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    const durationSeconds = durationMinutes * 60;
    set({
      sleepTimer: {
        duration: durationMinutes,
        remaining: durationSeconds,
        active: true
      }
    });
    sleepTimerInterval = setInterval(() => {
      const current = get().sleepTimer;
      if (!current.active) {
        if (sleepTimerInterval) {
          clearInterval(sleepTimerInterval);
          sleepTimerInterval = null;
        }
        return;
      }
      if (current.remaining <= 1) {
        clearInterval(sleepTimerInterval);
        sleepTimerInterval = null;
        set({
          sleepTimer: { duration: 0, remaining: 0, active: false }
        });
        get().pauseTrack();
        window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message: 'Sleep timer finished. Playback paused.', type: 'info' } }));
      } else {
        set({
          sleepTimer: {
            ...current,
            remaining: current.remaining - 1
          }
        });
      }
    }, 1000);
  },

  stopSleepTimer: () => {
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
    }
    set({
      sleepTimer: { duration: 0, remaining: 0, active: false }
    });
  },

  setColorScheme: (mode: 'dark' | 'light' | 'system') => {
    localStorage.setItem('aideo-color-scheme', mode);
    set({ colorScheme: mode });
  },

  setAlbumArtFit: (fit: 'cover' | 'contain') => {
    localStorage.setItem('aideo-album-art-fit', fit);
    set({ albumArtFit: fit });
  },

  setPlayerBarDesign: (design: any) => {
    safeSetStorage('aideo-playerbar-design', design);
    set({ playerBarDesign: design });
  },

  setAideoPageDesign: (design: any) => {
    safeSetStorage('aideo-page-design', design);
    set({ aideoPageDesign: design });
  },

  setPlayerBarTransparent: (transparent: boolean) => {
    safeSetStorage('aideo-playerbar-transparent', String(transparent));
    set({ playerBarTransparent: transparent });
  },

  togglePlayerBarTransparent: () => {
    const next = !get().playerBarTransparent;
    safeSetStorage('aideo-playerbar-transparent', String(next));
    set({ playerBarTransparent: next });
  },

  setGlobalHotkey: (action: string, binding: string | null) => {
    const next = { ...get().globalHotkeys, [action]: binding };
    safeSetStorage('aideo-global-hotkeys', JSON.stringify(next));
    set({ globalHotkeys: next });
    const payload: Record<string, string | null> = {};
    Object.entries(next).forEach(([k, v]) => {
      payload[k] = v && v.length > 0 ? v : null;
    });
    invoke('set_global_shortcuts', { bindings: payload }).catch(e => {
      console.error('Failed to apply global shortcut:', e);
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Global hotkey failed: ${e}`, type: 'error' }
      }));
    });
  },

  initGlobalHotkeys: () => {
    const next = get().globalHotkeys;
    const hasAny = Object.values(next).some(v => v && v.length > 0);
    if (!hasAny) return;
    const payload: Record<string, string | null> = {};
    Object.entries(next).forEach(([k, v]) => {
      payload[k] = v && v.length > 0 ? v : null;
    });
    invoke('set_global_shortcuts', { bindings: payload }).catch(e => {
      console.error('Failed to restore global shortcuts:', e);
    });
  },
});
