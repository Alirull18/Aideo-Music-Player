import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createUISlice } from '../store/uiSlice';
import { createLibrarySlice } from '../store/librarySlice';
import { sortAlbumTracks } from '../utils/albumUtils';
import { remapLibraryReferences } from '../utils/libraryRelocation';

const track = (id: number, extra = {}) => ({ id, path: `C:/music/${id}.flac`, title: 'Same title', artist: 'Artist', album: 'Album', format: 'FLAC', duration: 120, lyric_offset: 0, ...extra });
function fixture(extra: any = {}) {
  let state: any;
  const set = (update: any) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
  state = { ...createUISlice(set as any, (() => state) as any, {} as any), ...createLibrarySlice(set as any, (() => state) as any, {} as any),
    currentTrack: track(1), queue: [track(9)], playback: { status: 'Playing', current_track: track(1).path },
    stopTrack: vi.fn(async () => {}), playTrack: vi.fn(async () => {}), syncBackendQueue: vi.fn(async () => {}), ...extra,
  };
  return () => state;
}
beforeEach(() => { localStorage.clear(); vi.mocked(invoke).mockResolvedValue(null); });
describe('stop and captured album policy', () => {
  it('stops before repeat/radio, retains queue and clears both one-shot timers', async () => {
    const get = fixture({ repeat: 'one', shuffle: true, autoplayEnabled: true });
    await get().armStopAfter('track');
    get().sleepTimer = { active: true, duration: 10, remaining: 100 };
    await get().handleNaturalTrackEnd();
    expect(get().stopTrack).toHaveBeenCalledOnce();
    expect(get().playTrack).not.toHaveBeenCalled();
    expect(get().queue).toEqual([track(9)]);
    expect(get().stopBoundary).toBeNull();
    expect(get().sleepTimer.active).toBe(false);
  });
  it('rejects remote stopping and only allows an album boundary with a session', async () => {
    const get = fixture({ chromecast_connected: true });
    await expect(get().armStopAfter('track')).rejects.toThrow('remote output');
    expect(get().stopBoundary).toBeNull();
    get().chromecast_connected = false;
    await get().armStopAfter('album');
    expect(get().stopBoundary).toBeNull();
  });
  it('starts ordered album without changing preferences or replacing unrelated queue', async () => {
    const get = fixture({ repeat: 'one', shuffle: true, autoplayEnabled: true });
    await get().playAlbumToEnd([track(3, { disc_number: 2, track_number: 1 }), track(2, { track_number: 2 }), track(1, { track_number: 1 })], 'Album');
    expect(get().albumSession.tracks.map((t: any) => t.id)).toEqual([1, 2, 3]);
    expect(get().playTrack).toHaveBeenCalledWith(track(1, { track_number: 1 }), undefined, false);
    expect(get().queue).toEqual([track(9)]);
    expect([get().repeat, get().shuffle, get().autoplayEnabled]).toEqual(['one', true, true]);
    expect(get().sourceQueueManaged).toBe(true);
    expect(JSON.parse(localStorage.getItem('aideo_album_session')!).index).toBe(0);
  });
  it('advances captured order instead of repeat/shuffle/radio, and final skip stops', async () => {
    const get = fixture({ albumSession: { title: 'Album', tracks: [track(1), track(2)], index: 0 }, repeat: 'one', shuffle: true, autoplayEnabled: true });
    await get().playNext();
    expect(get().albumSession.index).toBe(1);
    expect(get().playTrack).toHaveBeenCalledWith(track(2), undefined, false);
    await get().playNext();
    expect(get().stopTrack).toHaveBeenCalledOnce();
    expect(get().queue).toEqual([track(9)]);
    expect(get().albumSession).toBeNull();
  });
  it('keeps mixed provider album order ahead of the unrelated queue', async () => {
    const remote = track(2, { path: 'tidal:2', format: 'Tidal FLAC', source_context: {
      recording_id: 'album-2', sources: [{ provider: 'tidal', id: '2' }],
      selection: { mode: 'explicit', source: { provider: 'tidal', id: '2' } },
    } });
    const get = fixture({ albumSession: { title: 'Album', tracks: [track(1), remote], index: 0 }, repeat: 'one', shuffle: true, autoplayEnabled: true });
    await get().playNext();
    expect(get().playTrack).toHaveBeenCalledWith(remote, undefined, false);
    expect(get().queue).toEqual([track(9)]);
    await get().playNext();
    expect(get().stopTrack).toHaveBeenCalledOnce();
    expect(get().playTrack).toHaveBeenCalledTimes(1);
  });
  it('restores references while leaving one-shot stopping unarmed, remapping local paths only', () => {
    localStorage.setItem('aideo_album_session', JSON.stringify({ title: 'Album', tracks: [track(1), track(2)], index: 1 }));
    const get = fixture();
    expect(get().albumSession.index).toBe(1);
    expect(get().stopBoundary).toBeNull();
    const remapped: any = remapLibraryReferences(get().albumSession, [{ old_path: track(2).path, new_path: 'D:/music/2.flac' }]);
    expect(remapped.tracks[1].path).toBe('D:/music/2.flac');
    expect(remapped.index).toBe(1);
  });
  it('preserves distinct entries with identical titles and stable missing tag fallback', () => {
    expect(sortAlbumTracks([track(3, { path: 'C:/music/c.flac' }), track(2, { path: 'C:/music/b.flac' }), track(1, { path: 'C:/music/a.flac' })]).map(t => t.id)).toEqual([3, 2, 1]);
  });
  it('does not arm a replacement logical track when acknowledgement arrives late', async () => {
    const get = fixture({ currentAttemptId: 'A' });
    let release!: () => void;
    const ack = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(invoke).mockImplementationOnce(() => ack);
    const pending = get().armStopAfter('track');
    get().currentAttemptId = 'B'; get().currentTrack = track(2);
    release(); await pending;
    expect(get().stopBoundary).toBeNull();
    expect(invoke).toHaveBeenCalledWith('set_stop_after_path', { path: null });
  });
  it('does not stop a replacement play while boundary cancellation is pending', async () => {
    const get = fixture();
    let release!: () => void;
    const ack = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(invoke).mockImplementationOnce(() => ack);
    const pending = get().fulfillStopBoundary();
    expect(get().stopTrack).toHaveBeenCalledOnce();
    get().currentTrack = track(2);
    release(); await pending;
    expect(get().stopTrack).toHaveBeenCalledOnce();
  });});
