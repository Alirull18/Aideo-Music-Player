import { StateCreator } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PlayerState } from './types';
import { registerAddonNames } from '../utils/unifiedSources';

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

export const FEATURED_ADDON_CATALOG: readonly FeaturedAddonCatalogItem[] = [
  {
    id: 'org.aideo.tidal',
    name: 'Tidal HiFi / MAX',
    manifestUrl: 'http://127.0.0.1:7013/manifest.json',
    resources: ['search', 'stream'],
    description: 'Lossless & Hi-Res FLAC streaming with OAuth Device Login',
    authType: 'device_code',
  },
  {
    id: 'org.aideo.qobuz',
    name: 'Qobuz Studio',
    manifestUrl: 'http://127.0.0.1:7014/manifest.json',
    resources: ['search', 'stream'],
    description: '24-bit / 192 kHz Studio Masters streaming',
    authType: 'credentials',
  },
  {
    id: 'org.aideo.subsonic',
    name: 'Subsonic / Navidrome',
    manifestUrl: 'http://127.0.0.1:7011/manifest.json',
    resources: ['search', 'stream'],
    description: 'Personal cloud music server (Subsonic / Navidrome API)',
    authType: 'credentials',
  },
  {
    id: 'org.aideo.jellyfin',
    name: 'Jellyfin Audio',
    manifestUrl: 'http://127.0.0.1:7012/manifest.json',
    resources: ['search', 'stream'],
    description: 'Self-hosted Jellyfin media library',
    authType: 'credentials',
  },
];

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
