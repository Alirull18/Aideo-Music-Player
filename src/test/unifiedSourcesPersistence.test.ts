import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore, type Track, type RecordingSources } from '../store';
import { createPlaybackSlice } from '../store/playbackSlice';
import { createLibrarySlice } from '../store/librarySlice';

const sources: RecordingSources = {
  recording_id: 'recording-1',
  sources: [{ provider: 'tidal', id: '123' }, { provider: 'qobuz', id: '123' }],
  selection: { mode: 'auto' },
};
const legacy: Track = {
  id: 1, path: '123', title: 'Song', artist: 'Artist', duration: 180,
  format: 'Tidal FLAC', lyric_offset: 0, playlist_entry_id: 11,
};
const unified: Track = { ...legacy, playlist_entry_id: 12, source_context: sources };
const freshPlayback = () => createPlaybackSlice(useStore.setState, useStore.getState, useStore);

describe('Unified source persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    useStore.setState({ tracks: [legacy, unified], queue: [], currentTrack: null, currentPlaylist: null });
  });

  it('defaults to Best available and restores each preference independently of DSP', () => {
    expect(freshPlayback().streamingQuality).toBe('best_available');
    const dsp = useStore.getState().dsp;
    for (const quality of ['best_available', 'standard_lossless', 'data_saver'] as const) {
      useStore.getState().setStreamingQuality(quality);
      expect(freshPlayback().streamingQuality).toBe(quality);
      expect(useStore.getState().dsp).toBe(dsp);
    }
    localStorage.setItem('aideo_streaming_quality', 'invalid');
    expect(freshPlayback().streamingQuality).toBe('best_available');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps path-only saves legacy and carries Auto only from the supplied entry', async () => {
    await useStore.getState().addToPlaylist(3, legacy.path);
    expect(invoke).toHaveBeenLastCalledWith('add_to_playlist', { playlistId: 3, path: '123' });
    await useStore.getState().addToPlaylist(3, unified);
    expect(invoke).toHaveBeenLastCalledWith('add_to_playlist', {
      playlistId: 3, path: '123', sourceContext: sources, metadata: unified,
    });
    expect(legacy.source_context).toBeUndefined();
  });

  it('removes and reorders using entry IDs when paths are identical', async () => {
    await useStore.getState().removeFromPlaylist(3, unified);
    expect(invoke).toHaveBeenLastCalledWith('remove_from_playlist', {
      playlistId: 3, path: '123', entryId: 12,
    });
    useStore.setState({ currentPlaylist: { id: 3, name: 'Test' } });
    await useStore.getState().reorderPlaylistTracks(3, 0, 1);
    expect(invoke).toHaveBeenLastCalledWith('reorder_playlist', {
      playlistId: 3, trackPaths: ['123', '123'], entryIds: [12, 11],
    });
  });

  it('carries the selected entry when saving a favorite with the same path as a legacy song', async () => {
    await useStore.getState().toggleLoveTrack('123', unified);
    expect(invoke).toHaveBeenCalledWith('toggle_love_track', expect.objectContaining({ sourceContext: sources }));
    expect(useStore.getState().tracks[0].loved).toBeUndefined();
    expect(useStore.getState().tracks[1].loved).toBe(1);
  });

  it('preserves explicit choice in the restored session', () => {
    const selected = {
      ...unified,
      source_context: { ...sources, selection: { mode: 'explicit', source: sources.sources[1] } },
    };
    localStorage.setItem('aideo_current_track', JSON.stringify(selected));
    const slice = createLibrarySlice(useStore.setState, useStore.getState, useStore);
    expect(slice.currentTrack.source_context).toEqual(selected.source_context);
  });

  it('keeps queued entry metadata ahead of library metadata for the same path', async () => {
    const local = { ...legacy, path: 'C:/Music/song.flac', format: 'FLAC' };
    const auto = { ...local, playlist_entry_id: 12, source_context: {
      ...sources, sources: [{ provider: 'local' as const, id: local.path }],
    } };
    useStore.setState({ tracks: [local], queue: [auto, local] });
    vi.mocked(invoke).mockResolvedValue([local.path, local.path]);
    await useStore.getState().fetchQueue();
    expect(useStore.getState().queue).toEqual([auto, local]);
    expect(JSON.parse(localStorage.getItem('aideo_queue')!)).toEqual([auto, local]);
  });

  it('restores a queued Auto entry without converting a legacy entry', async () => {
    const local = { ...legacy, path: 'C:/Music/song.flac', format: 'FLAC' };
    const auto = { ...local, source_context: { ...sources, sources: [{ provider: 'local' as const, id: local.path }] } };
    localStorage.setItem('aideo_queue', JSON.stringify([auto, local]));
    vi.mocked(invoke).mockImplementation(async command => command === 'check_files_exist' ? [true, true] : null);
    await useStore.getState().initializeQueue();
    expect(useStore.getState().queue).toEqual([auto, local]);
    expect(JSON.parse(localStorage.getItem('aideo_queue')!)).toEqual([auto, local]);
  });

  it('keeps a source choice and provider metadata through library reload', async () => {
    useStore.setState({ currentTrack: unified, queue: [unified] });
    vi.mocked(invoke).mockImplementation(async command => command === 'get_library'
      ? [{ ...legacy, title: 'Different provider with the same numeric ID' }] : []);
    await useStore.getState().loadLibrary();
    expect(useStore.getState().currentTrack).toEqual(unified);
    expect(useStore.getState().queue).toEqual([unified]);
  });
});
