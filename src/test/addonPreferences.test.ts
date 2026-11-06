import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useStore.setState({ addons: [] });
});

it('persists addon enablement and reloads the registry', async () => {
  const addon = { id: 'org.aideo.youtube', name: 'YouTube', version: '1', origin: 'internal', resources: ['search', 'stream'], builtin: true, enabled: false };
  vi.mocked(invoke).mockImplementation(async command => command === 'addon_list' ? [addon] : null);
  await useStore.getState().setAddonEnabled(addon.id, false);
  expect(invoke).toHaveBeenCalledWith('addon_set_enabled', { addonId: addon.id, enabled: false });
  expect(useStore.getState().addons).toEqual([addon]);
});

it('retains the last known registry and reports a failed reload', async () => {
  const addon = { id: 'org.example.music', name: 'Music', version: '1', origin: 'https://music.test', resources: ['search', 'stream'], enabled: true };
  useStore.setState({ addons: [addon] });
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Registry unavailable'));
  const onToast = vi.fn();
  window.addEventListener('ui-toast', onToast);
  try {
    await useStore.getState().loadAddons();
    expect(useStore.getState().addons).toEqual([addon]);
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({
      detail: { message: 'Failed to load addons. Please try again.', type: 'error' },
    }));
  } finally {
    window.removeEventListener('ui-toast', onToast);
  }
});
