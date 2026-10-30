import { StateCreator } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PlayerState } from './types';

export interface AddonInfo {
  id: string;
  name: string;
  version: string;
  icon?: string | null;
  origin: string;
  resources: string[];
  builtin?: boolean;
  enabled?: boolean;
}

const toast = (message: string, type: 'success' | 'error') =>
  window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message, type } }));

export const createAddonSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  addons: [] as AddonInfo[],
  addonBusy: false,

  loadAddons: async () => {
    try {
      set({ addons: (await invoke<AddonInfo[]>('addon_list')) ?? [] });
    } catch {
      toast('Failed to load addons. Please try again.', 'error');
    }
  },

  installAddon: async (manifestUrl: string) => {
    set({ addonBusy: true });
    try {
      const info = await invoke<AddonInfo>('addon_install', { manifestUrl });
      await get().loadAddons();
      toast(`Installed ${info.name}`, 'success');
    } catch (e) {
      toast(`Addon install failed: ${e}`, 'error');
    } finally {
      set({ addonBusy: false });
    }
  },

  setAddonEnabled: async (addonId: string, enabled: boolean) => {
    try {
      await invoke('addon_set_enabled', { addonId, enabled });
      await get().loadAddons();
    } catch (e) {
      toast(`Failed to update addon: ${e}`, 'error');
    }
  },

  removeAddon: async (addonId: string) => {
    try {
      await invoke('addon_remove', { addonId });
      await get().loadAddons();
    } catch (e) {
      toast(`Failed to remove addon: ${e}`, 'error');
    }
  },
});
