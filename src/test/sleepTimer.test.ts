import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createUISlice } from '../store/uiSlice';

function fixture() {
  let state: any;
  const set = (update: any) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
  state = {
    ...createUISlice(set as any, (() => state) as any, {} as any),
    pauseTrack: vi.fn(),
    cancelStopAfter: vi.fn(async () => {}),
  };
  return () => state;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sleep timer', () => {
  it('fires on wall-clock time even when the webview throttles its interval', () => {
    const get = fixture();
    get().startSleepTimer(1);

    // A minimized/tray window can deliver a single late tick long after the deadline.
    vi.setSystemTime(Date.now() + 61_000);
    vi.advanceTimersByTime(1000);

    expect(get().pauseTrack).toHaveBeenCalledOnce();
    expect(get().sleepTimer.active).toBe(false);
  });

  it('reports remaining seconds from the deadline', () => {
    const get = fixture();
    get().startSleepTimer(2);
    vi.setSystemTime(Date.now() + 30_000);
    vi.advanceTimersByTime(1000);
    expect(get().sleepTimer.remaining).toBe(89);
    expect(get().pauseTrack).not.toHaveBeenCalled();
    get().stopSleepTimer();
  });
});
