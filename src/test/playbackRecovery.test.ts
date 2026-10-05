import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore, type Track } from '../store';
import { cancelSourcePlayback } from '../store/sourcePlayback';
import { invoke } from '@tauri-apps/api/core';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlaybackRecovery } from '../components/PlaybackRecovery';
const track = { id: 1, path: 'C:/song.flac', title: 'Song', artist: 'Artist', duration: 180, format: 'FLAC', lyric_offset: 0 } as Track;
const originalPlay = useStore.getState().playTrack;
const originalHistory = useStore.getState().recordPlaybackTransition;
const originalNext = useStore.getState().playNext;
afterEach(() => {
  cleanup();
  useStore.setState({ playTrack: originalPlay, playNext: originalNext, recordPlaybackTransition: originalHistory, playbackRecovery: null, playbackError: null, albumSession: null });
  vi.mocked(invoke).mockReset();
});
describe('Playback recovery', () => {
  it('offers an explicit album skip alongside retry', async () => {
    const next = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentTrack: track, albumSession: { title: 'Album', tracks: [track], index: 0 }, playNext: next,
      playback: { ...useStore.getState().playback, status: 'Stopped' } });
    useStore.getState().reportPlaybackFailure('File not found');
    render(createElement(PlaybackRecovery));
    fireEvent.click(screen.getByRole('button', { name: 'Skip album track' }));
    expect(next).toHaveBeenCalledOnce();
    expect(useStore.getState().playbackRecovery).toBeNull();
  });
  it('retains the queue after a local playback failure and never schedules advancement', async () => {
    vi.useFakeTimers();
    try {
      const next = vi.fn();
      const originalNext = useStore.getState().playNext;
      useStore.setState({ playTrack: originalPlay, queue: [track], autoplayEnabled: false, sourceQueueManaged: false, playNext: next });
      vi.mocked(invoke).mockImplementation(async command => { if (command === 'play_track') throw new Error('File not found'); return undefined; });
      await originalPlay(track, false, false);
      await vi.advanceTimersByTimeAsync(2000);
      expect(useStore.getState().playbackRecovery).toMatchObject({ track, action: 'library' });
      expect(useStore.getState().queue).toEqual([track]);
      expect(next).not.toHaveBeenCalled();
      useStore.setState({ playNext: originalNext });
    } finally { vi.useRealTimers(); }
  });
  it('retains failed track and position and retries without replacing queue', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentTrack: track, playback: { ...useStore.getState().playback, position_secs: 42 }, queue: [track], playTrack: play });
    useStore.getState().reportPlaybackFailure('File not found');
    expect(useStore.getState().playbackRecovery).toMatchObject({ track, position: 42, action: 'library' });
    await useStore.getState().retryPlaybackRecovery();
    expect(play).toHaveBeenCalledWith(track, true, false, undefined, 42, true);
    expect(useStore.getState().queue).toEqual([track]);
  });
  it('keeps another failed retry actionable', async () => {
    useStore.setState({ currentTrack: track, playTrack: vi.fn().mockRejectedValue(new Error('Still offline')) });
    useStore.getState().reportPlaybackFailure('Offline');
    await useStore.getState().retryPlaybackRecovery();
    expect(useStore.getState().playbackRecovery).toMatchObject({ pending: false, error: 'Error: Still offline' });
  });
  it('does not erase a new track after the stop IPC completes late', async () => {
    let finish!: () => void;
    useStore.setState({ currentTrack: track, currentAttemptId: 'old', recordPlaybackTransition: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(invoke).mockImplementation(() => new Promise(resolve => { finish = () => resolve(null); }));
    const pending = useStore.getState().stopTrack();
    await Promise.resolve();
    useStore.setState({ currentTrack: { ...track, path: 'new' }, currentAttemptId: 'new' });
    finish(); await pending;
    expect(useStore.getState().currentTrack?.path).toBe('new');
  });
  it('does not replace a newer recovery with a late retry rejection', async () => {
    let reject!: (e: Error) => void;
    useStore.setState({ currentTrack: track, playTrack: () => new Promise((_, fail) => { reject = fail; }) });
    useStore.getState().reportPlaybackFailure('Offline');
    const retry = useStore.getState().retryPlaybackRecovery();
    useStore.setState({ currentTrack: { ...track, path: 'C:/new.flac' } });
    useStore.getState().reportPlaybackFailure('New failure');
    reject(new Error('Old failure'));
    await retry;
    expect(useStore.getState().playbackRecovery?.error).toBe('New failure');
  });
  it('does not stop a new track after awaiting old history', async () => {
    let finish!: () => void;
    const stop = useStore.getState().stopTrack;
    useStore.setState({ currentTrack: track, currentAttemptId: 'old', recordPlaybackTransition: () => new Promise<void>(resolve => { finish = resolve; }) });
    vi.mocked(invoke).mockClear();
    const pending = stop();
    useStore.setState({ currentTrack: { ...track, path: 'new' }, currentAttemptId: 'new' });
    finish(); await pending;
    expect(useStore.getState().currentTrack?.path).toBe('new');
    expect(invoke).not.toHaveBeenCalledWith('stop_track');
  });
  it('does not send an old stop while a newer playback request is still resolving', async () => {
    let finish!: () => void;
    useStore.setState({ currentTrack: track, currentAttemptId: 'old', recordPlaybackTransition: () => new Promise<void>(resolve => { finish = resolve; }) });
    vi.mocked(invoke).mockClear();
    const pending = useStore.getState().stopTrack();
    cancelSourcePlayback();
    finish();
    await pending;
    expect(invoke).not.toHaveBeenCalledWith('stop_track');
    expect(useStore.getState().currentTrack).toBe(track);
  });
});
