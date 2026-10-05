import { describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { collectBackupSettings, replayPendingBackupSettings } from '../utils/localBackup';
import { DEVICE_DSP_DEFAULTS } from '../utils/deviceProfiles';

describe('portable backup settings', () => {
  it('includes validated device profiles but excludes nested credentials', () => {
    localStorage.clear();
    const profile = { version: 1, volume: 0.3, dsp: DEVICE_DSP_DEFAULTS, autoEq: null, exclusive: false, bitPerfect: false };
    localStorage.setItem('aideo_device_profile_DAC', JSON.stringify(profile));
    localStorage.setItem('aideo_device_profile_unsafe', JSON.stringify({ ...profile, token: 'SECRET' }));
    expect(Object.keys(collectBackupSettings())).toEqual(['aideo_device_profile_DAC']);
  });
  it('exports only validated allowed preferences and album bookmarks', () => {
    localStorage.clear();
    localStorage.setItem('tidal_token', 'SECRET');
    localStorage.setItem('aideo-color-scheme', 'dark');
    localStorage.setItem('aideo-loved-albums', '["artist::album"]');
    expect(collectBackupSettings()).toEqual({ 'aideo-color-scheme': 'dark', 'aideo-loved-albums': '["artist::album"]' });
  });
  it('does not acknowledge a failed storage replay; a retry unions albums', async () => {
    localStorage.clear();
    localStorage.setItem('aideo-loved-albums', '["existing"]');
    vi.mocked(invoke).mockResolvedValueOnce([{ backup_id: 'b', settings: { 'aideo-loved-albums': '["imported"]', 'aideo-color-scheme': 'light' } }]);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await expect(replayPendingBackupSettings()).rejects.toThrow('full');
    expect(invoke).not.toHaveBeenCalledWith('local_backup_ack_settings', expect.anything());
    spy.mockRestore();
    vi.mocked(invoke).mockResolvedValueOnce([{ backup_id: 'b', settings: { 'aideo-loved-albums': '["imported"]' } }]).mockResolvedValueOnce(undefined);
    await replayPendingBackupSettings();
    expect(JSON.parse(localStorage.getItem('aideo-loved-albums')!)).toEqual(['existing', 'imported']);
  });
});
