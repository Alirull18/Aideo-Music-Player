import { invoke } from '@tauri-apps/api/core';
import { parseDeviceProfile } from './deviceProfiles';

export const backupCategories = ['playlists', 'favorites', 'history', 'recommendations', 'settings'] as const;
export type BackupCategory = typeof backupCategories[number];
export const backupSettingValues: Record<string, readonly string[]> = {
  'aideo-color-scheme': ['dark', 'light', 'system'],
  'aideo-album-art-fit': ['cover', 'contain'],
  'aideo_repeat': ['none', 'one', 'all'],
  'aideo_autoplay': ['true', 'false'],
  'aideo_autoplay_discovery_level': ['familiarity', 'balanced', 'discovery'],
  'aideo_recommendation_engine': ['youtube', 'tidal', 'our'],
  'aideo-notifications-enabled': ['true', 'false'],
  'aideo-liquid-bg': ['true', 'false'],
  'aideo-app-mode': ['local', 'hybrid'],
  'aideo-discovery-layout': ['shelves', 'unified'],
  'aideo-discovery-view-mode': ['grid', 'list'],
  'aideo-playerbar-design': ['classic', 'floating', 'waveform', 'minimal', 'vinyl'],
  'aideo-page-design': ['classic', 'editorial', 'command', 'stage', 'spotify', 'apple'],
  'aideo-library-design': ['classic', 'studio', 'editorial', 'crate', 'ambient', 'brutalist'],
  'aideo-album-view-mode': ['classic', 'compact', 'editorial'],
  'aideo-theater-design': ['stage', 'zen', 'studio', 'vinyl', 'poster', 'scope'],
  'aideo-theater-hud-style': ['capsule', 'master', 'minimal', 'analog'],
  'aideo-canvas-mode': ['off', 'artwork', 'backdrop', 'both'],
  'aideo_visualizer_mode': ['bars', 'mirror', 'wave', 'circle', 'dots', 'baseline'],
  'aideo_visualizer_decay': ['snappy', 'balanced', 'silky'],
  ...Object.fromEntries(['aideo-sidebar-lastfm', 'aideo-sidebar-listenbrainz', 'aideo-sidebar-collapsed', 'aideo-show-smart-mix', 'aideo-os-notifications-enabled', 'aideo-os-notify-bg-only', 'aideo-playerbar-transparent', 'aideo-canvas-enabled', 'aideo-canvas-allow-online', 'aideo_visualizer_expanded', 'aideo_crossfade_enabled'].map(k => [k, ['true', 'false']])),
};
const shortcutKeys = ['playPause', 'next', 'prev', 'volumeUp', 'volumeDown', 'mute', 'dspBypass', 'fullscreenToggle'];
export function validateBackupSettings(settings: Record<string, string>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith('aideo_device_profile_')) {
      if (key.length > 2048 || !parseDeviceProfile(JSON.parse(value))) throw new Error('Invalid output device preference');
    } else if (key === 'aideo-loved-albums') {
      const albums: unknown = JSON.parse(value);
      if (!Array.isArray(albums) || albums.length > 10000 || albums.some(a => typeof a !== 'string' || a.length > 1024)) throw new Error('Invalid loved albums');
    } else if (key === 'aideo_volume' || key === 'aideo_crossfade_duration') {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n) || n < 0 || n > (key === 'aideo_volume' ? 1 : 30)) throw new Error('Invalid playback preference');
    } else if (key === 'aideo-keyboard-shortcuts' || key === 'aideo-global-hotkeys') {
      const shortcuts: unknown = JSON.parse(value);
      if (!shortcuts || typeof shortcuts !== 'object' || Array.isArray(shortcuts) || Object.entries(shortcuts).some(([action, binding]) => !shortcutKeys.includes(action) || (binding !== null && (typeof binding !== 'string' || binding.length > 100)))) throw new Error('Invalid shortcuts');
    } else if (!backupSettingValues[key]?.includes(value)) throw new Error(`Unsupported backup preference: ${key}`);
  }
}
export function collectBackupSettings(): Record<string, string> {
  const result: Record<string, string> = {};
  const profileKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => !!key?.startsWith('aideo_device_profile_'));
  for (const key of [...Object.keys(backupSettingValues), 'aideo-loved-albums', 'aideo-keyboard-shortcuts', 'aideo-global-hotkeys', 'aideo_volume', 'aideo_crossfade_duration', ...profileKeys]) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      try { validateBackupSettings({ [key]: value }); result[key] = value; } catch { /* Ignore invalid stored preferences. */ }
    }
  }
  return result;
}
export async function replayPendingBackupSettings(): Promise<void> {
  const pending = await invoke<{ backup_id: string; settings: Record<string, string> }[]>('local_backup_pending_settings');
  for (const item of pending ?? []) {
    validateBackupSettings(item.settings);
    for (const [key, value] of Object.entries(item.settings)) {
      if (key === 'aideo-loved-albums') {
        const existing: unknown = JSON.parse(localStorage.getItem(key) || '[]');
        if (!Array.isArray(existing) || existing.some(a => typeof a !== 'string')) throw new Error('Invalid existing album bookmarks');
        localStorage.setItem(key, JSON.stringify([...new Set([...existing, ...JSON.parse(value)])]));
      } else localStorage.setItem(key, value);
    }
    await invoke('local_backup_ack_settings', { backupId: item.backup_id });
  }
}
export interface BackupPreview {
  backup_id: string;
  counts: Record<BackupCategory, number>;
  missing_paths: string[];
  playlist_collisions: string[];
  settings: Record<string, string>;
  already_imported: string[];
  fingerprint: string;
  categories: BackupCategory[];
}

