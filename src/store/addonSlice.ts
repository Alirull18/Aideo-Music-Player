import { StateCreator } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PlayerState } from './types';
import { registerAddonNames } from '../utils/unifiedSources';
import featuredAddons from '../../addons-sdk/cloud/featured.json';

export interface AddonAuthField {
  key: string;
  label: string;
  type?: string | null;
  placeholder?: string | null;
  required?: boolean | null;
}

export interface AddonAuthSpec {
  type: 'device_code' | 'credentials' | 'token' | string;
  label?: string | null;
  helpText?: string | null;
  fields?: AddonAuthField[];
  /** Set by the desktop host (never by the addon) when it can sign in through a browser window. */
  browserLogin?: boolean;
}

export interface AddonAuthStatus {
  ok?: boolean;
  provider?: string;
  authenticated: boolean;
  hasRefreshToken?: boolean;
  hasClientCredentials?: boolean;
  expiresAt?: number | null;
  error?: string;
}

export interface FeaturedAddonCatalogItem {
  id: string;
  name: string;
  manifestUrl: string;
  resources: string[];
  description: string;
  authType: 'device_code' | 'credentials' | 'token';
  auth: AddonAuthSpec;
}

export interface AddonInfo {
  id: string;
  name: string;
  version: string;
  description?: string | null;
  icon?: string | null;
  origin: string;
  resources: string[];
  builtin?: boolean;
  enabled?: boolean;
  auth?: AddonAuthSpec | null;
}

/** Derived from `addons-sdk/cloud/featured.json`, which the Node adapter and the Rust host also read. */
export const FEATURED_ADDON_CATALOG: readonly FeaturedAddonCatalogItem[] = featuredAddons.map((item) => ({
  id: item.id,
  name: item.name,
  manifestUrl: `http://127.0.0.1:${item.port}/manifest.json`,
  resources: item.resources,
  description: item.description,
  authType: item.auth.type as FeaturedAddonCatalogItem['authType'],
  auth: item.auth,
}));

const toast = (message: string, type: 'success' | 'error') =>
  window.dispatchEvent(new CustomEvent('ui-toast', { detail: { message, type } }));

export const createAddonSlice: StateCreator<PlayerState, [], [], any> = (set, get) => ({
  addons: [] as AddonInfo[],
  addonBusy: false,

  loadAddons: async () => {
    try {
      const addons = (await invoke<AddonInfo[]>('addon_list')) ?? [];
      const list = Array.isArray(addons) ? addons : [];
      registerAddonNames(list);
      set({ addons: list });
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
