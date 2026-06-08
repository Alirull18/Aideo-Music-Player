import { StateCreator } from 'zustand';
import { PlayerState } from './types';

export const createUISlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  view: 'aideo',
  accentColor: '#8b5cf6',
  showProMode: false,
  showControlCenter: false,
  showSettings: false,
  sidebarLastfmVisible: localStorage.getItem('aideo-sidebar-lastfm') !== 'false',
  sidebarListenbrainzVisible: localStorage.getItem('aideo-sidebar-listenbrainz') !== 'false',
  sidebarCollapsed: localStorage.getItem('aideo-sidebar-collapsed') === 'true',
  liquidBackgroundEnabled: localStorage.getItem('aideo-liquid-bg') !== 'false',
  showSmartMixWidget: localStorage.getItem('aideo-show-smart-mix') !== 'false',
  playbackError: null,
  playbackSuccess: null,
  appMode: (localStorage.getItem('aideo-app-mode') as 'local' | 'hybrid') || 'hybrid',
  onboardingCompleted: localStorage.getItem('aideo-onboarding-completed') === 'true',
  showOnboarding: localStorage.getItem('aideo-onboarding-completed') !== 'true',
  notificationsEnabled: localStorage.getItem('aideo-notifications-enabled') !== 'false',
  developerNotifications: localStorage.getItem('aideo-developer-notifications') === 'true',
  discoveryData: null,
  isLoadingRecs: true,
  activeDiscoveryTab: 'recommendations',
  customPrompt: {
    open: false,
    title: '',
    placeholder: '',
    initialValue: '',
    actionLabel: '',
    onSubmit: () => { }
  },

  setCustomPrompt: (prompt: any) => set(s => ({
    customPrompt: { ...s.customPrompt, ...prompt }
  })),

  coverArtModalTrack: null,
  setCoverArtModalTrack: (track: any) => set({ coverArtModalTrack: track }),

  setPlaybackError: (err: string | null) => {
    set({ playbackError: err });
    if (err) setTimeout(() => get().setPlaybackError(null), 5000);
  },

  setPlaybackSuccess: (msg: string | null) => {
    set({ playbackSuccess: msg });
    if (msg) setTimeout(() => get().setPlaybackSuccess(null), 4000);
  },

  setView: (view: any) => set({ view }),

  setDiscoveryData: (discoveryData: any) => set({ discoveryData }),
  setIsLoadingRecs: (isLoadingRecs: boolean) => set({ isLoadingRecs }),
  setActiveDiscoveryTab: (activeDiscoveryTab: string) => set({ activeDiscoveryTab }),

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

  toggleSidebarLastfmVisible: () => {
    const next = !get().sidebarLastfmVisible;
    localStorage.setItem('aideo-sidebar-lastfm', String(next));
    set({ sidebarLastfmVisible: next });
  },

  toggleSidebarListenbrainzVisible: () => {
    const next = !get().sidebarListenbrainzVisible;
    localStorage.setItem('aideo-sidebar-listenbrainz', String(next));
    set({ sidebarListenbrainzVisible: next });
  },

  toggleSidebarCollapsed: () => {
    const next = !get().sidebarCollapsed;
    localStorage.setItem('aideo-sidebar-collapsed', String(next));
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
      r128_enabled: false
    });
  },
});
