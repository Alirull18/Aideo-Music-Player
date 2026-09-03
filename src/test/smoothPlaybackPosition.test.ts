import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';

const TRACK_PATH = 'C:/Music/test-song.flac';

describe('Smooth playback position and snap-back prevention in pollStatus', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      currentTrack: {
        id: 1,
        path: TRACK_PATH,
        title: 'Test Song',
        artist: 'Test Artist',
        duration: 240,
      } as any,
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: TRACK_PATH,
        position_secs: 114.0, // 1:54
        last_seek_time: 0,
        last_skip_time: 0,
      },
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
  });

  it('prevents micro snap-back when backend position is slightly behind due to ringbuffer delay', async () => {
    // Backend reports 113.2s (1:53) due to 800ms hardware ringbuffer delay, while frontend smoothly reached 114.0s (1:54)
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_playback_status') {
        return {
          status: 'Playing',
          current_track: TRACK_PATH,
          position_secs: 113.2,
          volume: 1,
        };
      }
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    // Position should stay at 114.0s without snapping back to 113.2s
    expect(s.playback.position_secs).toBe(114.0);
  });

  it('prevents snap-back when backend lag reaches 2.0s during continuous playback without seek', async () => {
    // Backend reports 112.0s (2.0s behind frontend due to ringbuffer depth + audio clock drift)
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_playback_status') {
        return {
          status: 'Playing',
          current_track: TRACK_PATH,
          position_secs: 112.0,
          volume: 1,
        };
      }
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    // Must remain monotonic — never snap backward during normal playback
    expect(s.playback.position_secs).toBe(114.0);
  });

  it('immediately accepts backward seek when user explicitly seeks', async () => {
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        last_seek_time: Date.now(),
        position_secs: 50.0,
      }
    });

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_playback_status') {
        return {
          status: 'Playing',
          current_track: TRACK_PATH,
          position_secs: 50.0,
          volume: 1,
        };
      }
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    expect(s.playback.position_secs).toBe(50.0);
  });

  it('correctly accepts genuine large seeks (e.g. jumped from 114s to 30s)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_playback_status') {
        return {
          status: 'Playing',
          current_track: TRACK_PATH,
          position_secs: 30.0,
          volume: 1,
        };
      }
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    expect(s.playback.position_secs).toBe(30.0);
  });

  it('correctly accepts forward jumps (e.g. skipped forward to 150s)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_playback_status') {
        return {
          status: 'Playing',
          current_track: TRACK_PATH,
          position_secs: 150.0,
          volume: 1,
        };
      }
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    expect(s.playback.position_secs).toBe(150.0);
  });
});
