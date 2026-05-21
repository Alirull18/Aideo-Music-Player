import { StateCreator } from 'zustand';
import { PlayerState } from './types';

export const createUISlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  view: 'aideo',
  accentColor: '#8b5cf6',
  showProMode: false,
  showControlCenter: false,
  showSettings: false,
  playbackError: null,
  playbackSuccess: null,
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

  setPlaybackError: (err: string | null) => {
    set({ playbackError: err });
    if (err) setTimeout(() => get().setPlaybackError(null), 5000);
  },

  setPlaybackSuccess: (msg: string | null) => {
    set({ playbackSuccess: msg });
    if (msg) setTimeout(() => get().setPlaybackSuccess(null), 4000);
  },

  setView: (view: any) => set({ view }),

  toggleSettings: () => set(s => ({ showSettings: !s.showSettings })),

  toggleProMode: () => set(s => ({ showProMode: !s.showProMode })),

  toggleControlCenter: () => set(s => ({ showControlCenter: !s.showControlCenter })),

  resetProMode: () => {
    get().setDSP({
      enabled: false,
      width: 1.0,
      upsample_rate: 0,
      dither: false,
      eq_enabled: false,
      eq_parametric: false,
      eq_graphic_gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      eq_parametric_bands: [
        { freq: 80, gain: 0, q: 0.7, band_type: 'lowshelf' },
        { freq: 240, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 750, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 2200, gain: 0, q: 1.0, band_type: 'peaking' },
        { freq: 6000, gain: 0, q: 0.7, band_type: 'highshelf' }
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
