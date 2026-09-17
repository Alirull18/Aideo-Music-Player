import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore, Track } from '../store';

const REMEMBERED_YT_TRACK: Track = {
  id: -1001,
  path: 'https://www.youtube.com/watch?v=qh7F1sFkOaY',
  title: 'Lemon Tang',
  artist: 'Hearts2Hearts',
  duration: 180,
  format: 'YouTube Direct',
  lyric_offset: 0,
  cover_url: null,
};

const SAVED_QUEUE_TRACK: Track = {
  id: -1002,
  path: 'https://www.youtube.com/watch?v=savedqueue01',
  title: 'Saved Song',
  artist: 'Saved Artist',
  duration: 200,
  format: 'YouTube Direct',
  lyric_offset: 0,
  cover_url: null,
};

describe('Startup Recovery Regression (pollStatus & autoplay loop)', () => {
  let invokedCommands: { cmd: string; args?: any }[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    invokedCommands = [];

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      invokedCommands.push({ cmd, args });
      if (cmd === 'get_playback_status') {
        return {
          status: 'Stopped',
          current_track: null,
          position_secs: 0,
          volume: 1.0,
        };
      }
      if (cmd === 'get_youtube_autoplay_recommendations') {
        return [
          {
            url: 'https://www.youtube.com/watch?v=auto001',
            title: 'Auto Track 1',
            artist: 'Auto Artist',
            duration_raw: '3:00',
            cover_url: '',
          }
        ];
      }
      return null;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    const m = vi.mocked(invoke);
    m.mockReset();
    m.mockResolvedValue(null);
  });

  it('Case 1: Stopped, remembered online track, autoplay on -> remains stopped, no playback or radio request', async () => {
    localStorage.setItem('aideo_current_track', JSON.stringify(REMEMBERED_YT_TRACK));
    localStorage.setItem('aideo_autoplay', 'true');

    // Simulate startup state:
    useStore.setState({
      currentTrack: REMEMBERED_YT_TRACK,
      queue: [],
      autoplayEnabled: true,
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: REMEMBERED_YT_TRACK.path,
        position_secs: 0,
        last_poll_time: 0,
        last_skip_time: 0,
        backend_stop_detected_at: 0,
      },
    });

    // Initial poll at startup
    await useStore.getState().pollStatus();

    // Advance beyond skip window (2000ms)
    vi.advanceTimersByTime(2100);
    await useStore.getState().pollStatus();

    // Advance beyond recovery grace period (3000ms)
    vi.advanceTimersByTime(3500);
    await useStore.getState().pollStatus();

    const state = useStore.getState();
    const playCommands = invokedCommands.filter(c => c.cmd === 'play_track' || c.cmd === 'get_youtube_autoplay_recommendations');

    // Expected: No play_track or autoplay radio calls should have occurred!
    expect(playCommands).toEqual([]);
    expect(state.playback.status).toBe('Stopped');
    expect(state.queue).toEqual([]);
  });

  it('Case 2: Stopped, remembered track, saved queue -> queue remains unchanged and unplayed', async () => {
    useStore.setState({
      currentTrack: REMEMBERED_YT_TRACK,
      queue: [SAVED_QUEUE_TRACK],
      autoplayEnabled: true,
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: REMEMBERED_YT_TRACK.path,
        position_secs: 0,
        last_poll_time: 0,
        last_skip_time: 0,
        backend_stop_detected_at: 0,
      },
    });

    // Advance past grace periods with repeated polling
    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(2100);
    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(3500);
    await useStore.getState().pollStatus();

    const state = useStore.getState();
    const playCommands = invokedCommands.filter(c => c.cmd === 'play_track' || c.cmd === 'get_youtube_autoplay_recommendations');

    expect(playCommands).toEqual([]);
    expect(state.playback.status).toBe('Stopped');
    expect(state.queue.length).toBe(1);
    expect(state.queue[0].path).toBe(SAVED_QUEUE_TRACK.path);
  });

  it('Case 3: Paused, remembered track -> backend Stopped does not automatically advance', async () => {
    useStore.setState({
      currentTrack: REMEMBERED_YT_TRACK,
      queue: [SAVED_QUEUE_TRACK],
      autoplayEnabled: true,
      playback: {
        ...useStore.getState().playback,
        status: 'Paused',
        current_track: REMEMBERED_YT_TRACK.path,
        position_secs: 50,
        last_poll_time: 0,
        last_skip_time: 0,
        backend_stop_detected_at: 0,
      },
    });

    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(2100);
    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(3500);
    await useStore.getState().pollStatus();

    const state = useStore.getState();
    const playCommands = invokedCommands.filter(c => c.cmd === 'play_track' || c.cmd === 'get_youtube_autoplay_recommendations');

    expect(playCommands).toEqual([]);
    expect(state.playback.status).not.toBe('Playing');
  });

  it('Case 4: No remembered track -> remains idle', async () => {
    useStore.setState({
      currentTrack: null,
      queue: [],
      autoplayEnabled: true,
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        last_poll_time: 0,
        last_skip_time: 0,
        backend_stop_detected_at: 0,
      },
    });

    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(2100);
    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(3500);
    await useStore.getState().pollStatus();

    const state = useStore.getState();
    const playCommands = invokedCommands.filter(c => c.cmd === 'play_track' || c.cmd === 'get_youtube_autoplay_recommendations');

    expect(playCommands).toEqual([]);
    expect(state.playback.status).toBe('Stopped');
    expect(state.currentTrack).toBeNull();
  });

  it('Case 5: Unexpected mid-track stop (position 30s of 180s) -> settles into Stopped, does not trigger autoplay loop', async () => {
    useStore.setState({
      currentTrack: REMEMBERED_YT_TRACK,
      queue: [],
      autoplayEnabled: true,
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: REMEMBERED_YT_TRACK.path,
        position_secs: 30,
        last_poll_time: 0,
        last_skip_time: 0,
        backend_stop_detected_at: 0,
      },
    });

    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(2100);
    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(3500);
    await useStore.getState().pollStatus();

    const state = useStore.getState();
    const playCommands = invokedCommands.filter(c => c.cmd === 'play_track' || c.cmd === 'get_youtube_autoplay_recommendations');

    // Should NOT have advanced because position 30s does not support natural completion
    expect(playCommands).toEqual([]);
    expect(state.playback.status).toBe('Stopped');
    expect(state.playback.current_track).toBeNull();
  });

  it('Case 6: Genuine missed natural end (position 178s of 180s) -> legitimately recovers via autoplay', async () => {
    useStore.setState({
      currentTrack: REMEMBERED_YT_TRACK,
      queue: [],
      autoplayEnabled: true,
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: REMEMBERED_YT_TRACK.path,
        position_secs: 178,
        last_poll_time: 0,
        last_skip_time: 0,
        backend_stop_detected_at: 0,
      },
    });

    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(2100);
    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(3500);
    await useStore.getState().pollStatus();

    const recCommands = invokedCommands.filter(c => c.cmd === 'get_youtube_autoplay_recommendations');
    // Legitimate recovery: triggers autoplay recommendations for next track
    expect(recCommands.length).toBeGreaterThanOrEqual(1);
  });

  it('Case 7: User stops track while recovery timer was active -> stop wins, no advance', async () => {
    useStore.setState({
      currentTrack: REMEMBERED_YT_TRACK,
      queue: [SAVED_QUEUE_TRACK],
      autoplayEnabled: true,
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: REMEMBERED_YT_TRACK.path,
        position_secs: 178,
        last_poll_time: 0,
        last_skip_time: 0,
        backend_stop_detected_at: 0,
      },
    });

    await useStore.getState().pollStatus();
    vi.advanceTimersByTime(2100);
    await useStore.getState().pollStatus();

    // User stops playback before grace timer expires
    await useStore.getState().stopTrack();

    vi.advanceTimersByTime(3500);
    await useStore.getState().pollStatus();

    const state = useStore.getState();
    const playCommands = invokedCommands.filter(c => c.cmd === 'play_track');
    expect(playCommands).toEqual([]);
    expect(state.playback.status).toBe('Stopped');
  });
});

