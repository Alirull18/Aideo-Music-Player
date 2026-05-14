import { StateCreator } from 'zustand';
import { PlayerState } from './types';

export const createUISlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  view: 'library',
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

  setView: (view: 'library' | 'nowplaying' | 'lastfm') => set({ view }),

  toggleSettings: () => set(s => ({ showSettings: !s.showSettings })),

  toggleProMode: () => set(s => ({ showProMode: !s.showProMode })),

  toggleControlCenter: () => set(s => ({ showControlCenter: !s.showControlCenter })),

  resetProMode: () => {
    const def = { width: 1.0, enabled: false, upsample_rate: 0, dither: false };
    set({ dsp: def });
    // Note: setDSP is in playbackSlice, but we can call it if needed.
    // For now, we'll just set the state.
  },
});
