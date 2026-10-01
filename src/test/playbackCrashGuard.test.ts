import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';

const track = { id: 1, path: 'C:/Music/track1.mp3', title: 'Track 1', artist: null, duration: 180, format: 'MP3', lyric_offset: 0 };
const nextTrack = { ...track, id: 2, path: 'C:/Music/track2.mp3', title: 'Track 2' };
const originalPlayNext = useStore.getState().playNext;
const originalTransition = useStore.getState().handleTrackTransition;

describe('Playback polling crash recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    vi.clearAllMocks();
    useStore.setState({
      tracks: [track, nextTrack], currentTrack: track, queue: [], currentAttemptId: undefined,
      playNext: originalPlayNext, handleTrackTransition: originalTransition,
      chromecast_connected: false, upnp_connected: false, autoplayEnabled: false,
      playback: {
        ...useStore.getState().playback,
        status: 'Playing', current_track: track.path, position_secs: 10,
        volume: 1, is_buffering: false, last_skip_time: 0, last_seek_time: 0,
        last_stop_time: 0, last_poll_time: 0, backend_stop_detected_at: 0,
        attempt_id: undefined,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useStore.setState({ playNext: originalPlayNext, handleTrackTransition: originalTransition });
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    vi.useRealTimers();
  });

  it('updates the same track without re-running its transition', async () => {
    const transition = vi.spyOn(useStore.getState(), 'handleTrackTransition');
    vi.mocked(invoke).mockImplementation(async command => command === 'get_playback_status'
      ? { status: 'Playing', current_track: track.path, position_secs: 12, volume: 0.9 }
      : null);

    await useStore.getState().pollStatus();

    expect(useStore.getState().playback.position_secs).toBe(12);
    expect(useStore.getState().playback.volume).toBe(0.9);
    expect(transition).not.toHaveBeenCalled();
  });

  it('advances the queued track only after the backend-stop recovery grace period', async () => {
    useStore.setState({ queue: [nextTrack] });
    vi.mocked(invoke).mockImplementation(async command => command === 'get_playback_status'
      ? { status: 'Stopped', current_track: null, position_secs: 0, volume: 1 }
      : null);
    const playNext = vi.spyOn(useStore.getState(), 'playNext').mockImplementation(async () => {
      useStore.setState({ currentTrack: nextTrack, queue: [], playback: { ...useStore.getState().playback, current_track: nextTrack.path } });
    });

    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(2999);
    await useStore.getState().pollStatus();
    expect(playNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await useStore.getState().pollStatus();

    expect(playNext).toHaveBeenCalledTimes(1);
    expect(useStore.getState().currentTrack?.path).toBe(nextTrack.path);
    expect(useStore.getState().queue).toEqual([]);
  });
});
