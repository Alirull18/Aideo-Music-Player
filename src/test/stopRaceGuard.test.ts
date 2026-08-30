import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';

const YT_URL = 'https://www.youtube.com/watch?v=stoprace0001';

const backendStatus = (status: string, current_track: string | null) => ({
  status,
  current_track,
  position_secs: 5,
  volume: 1,
});

describe('Stop-button race guard (pollStatus recovery branch)', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      currentTrack: null,
      queue: [],
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        last_poll_time: 0,
        last_stop_time: Date.now(),
      },
    });
  });

  afterEach(() => {
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
  });

  it('does not resurrect a track the user just stopped (backend stop is async)', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_playback_status') return backendStatus('Playing', YT_URL);
      return null;
    });

    const queueBefore = useStore.getState().queue.length;
    await useStore.getState().pollStatus();

    const s = useStore.getState();
    expect(s.currentTrack).toBeNull();
    expect(s.queue.length).toBe(queueBefore);
  });

  it('still performs legitimate backend-driven recovery when no stop happened', async () => {
    useStore.setState({
      playback: {
        ...useStore.getState().playback,
        last_stop_time: 0,
      },
    });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_playback_status') return backendStatus('Playing', YT_URL);
      return null;
    });

    await useStore.getState().pollStatus();

    const s = useStore.getState();
    expect(s.currentTrack?.path).toBe(YT_URL);
    expect(s.playback.status).toBe('Playing');
  });
});
