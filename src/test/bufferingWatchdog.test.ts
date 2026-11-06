import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';

const path = 'C:/Users/Alirul/Music/01 - IVE - BLACKHOLE.flac';
const backend = (position: number, extra: Record<string, unknown> = {}) => ({
  status: 'Playing', current_track: path, position_secs: position, volume: 1, ...extra,
});

let attemptCounter = 0;

describe('stuck buffering indicator', () => {
  beforeEach(() => {
    const attempt = `local_attempt_${++attemptCounter}`;
    vi.mocked(invoke).mockReset();
    useStore.setState({
      currentTrack: { id: 1, path, title: 'BLACKHOLE', artist: 'IVE', duration: 200, format: 'FLAC', lyric_offset: 0 } as any,
      currentAttemptId: attempt,
      chromecast_connected: false,
      upnp_connected: false,
      playback: { ...useStore.getState().playback, status: 'Playing', current_track: path, attempt_id: attempt, is_buffering: true, position_secs: 0, backend_position_secs: 0, last_skip_time: 0 },
    });
  });

  it('keeps showing buffering while the backend position is not moving', async () => {
    vi.mocked(invoke).mockResolvedValue(backend(0));
    await useStore.getState().pollStatus();
    await useStore.getState().pollStatus();
    await useStore.getState().pollStatus();
    expect(useStore.getState().playback.is_buffering).toBe(true);
  });

  it('clears buffering once the backend position advances, even if playback-ready was missed', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(backend(12.0)).mockResolvedValueOnce(backend(12.5));
    await useStore.getState().pollStatus();
    expect(useStore.getState().playback.is_buffering).toBe(true);
    await useStore.getState().pollStatus();
    expect(useStore.getState().playback.is_buffering).toBe(false);
  });

  it('does not clear buffering for a different track than the one being started', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(backend(5, { current_track: 'C:/Other.flac' })).mockResolvedValueOnce(backend(6, { current_track: 'C:/Other.flac' }));
    await useStore.getState().pollStatus();
    await useStore.getState().pollStatus();
    expect(useStore.getState().playback.is_buffering).toBe(true);
  });
});
