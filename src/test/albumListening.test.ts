import { describe, expect, it } from 'vitest';
import { createLibrarySlice } from '../store/librarySlice';

const track = (id: number) => ({ id, path: `C:/music/${id}.flac`, title: `Track ${id}`, artist: 'Artist', album: 'Album', format: 'FLAC', duration: 120, lyric_offset: 0 });
describe('album listening boundary', () => {
  it('advances the captured order before repeat, shuffle and radio without consuming later queue', async () => {
    const calls: number[] = [];
    let state: any;
    const set = (update: any) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
    state = { ...createLibrarySlice(set as any, (() => state) as any, {} as any),
      albumSession: { title: 'Album', tracks: [track(1), track(2)], index: 0 },
      stopBoundary: null, queue: [track(9)], repeat: 'one', shuffle: true, autoplayEnabled: true,
      playTrack: async (t: any) => { calls.push(t.id); }, cancelStopAfter: async () => {},
      fulfillStopBoundary: async () => { calls.push(-1); }, playback: { status: 'Playing' },
    };
    await state.playNext();
    expect(calls).toEqual([2]);
    expect(state.albumSession.index).toBe(1);
    expect(state.queue.map((t: any) => t.id)).toEqual([9]);
  });
});
