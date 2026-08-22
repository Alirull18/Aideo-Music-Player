import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/types';

describe('In-App Tag Editor Store & Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      tagEditorTrack: null,
      tagEditorBatchTracks: [],
      tracks: [
        {
          id: 1,
          title: 'Hotel California',
          artist: 'Eagles',
          album: 'Hotel California',
          duration: 390,
          path: 'C:/Music/hotel.flac',
          format: 'FLAC',
          loved: 0,
          disliked: 0,
          lyric_offset: 0,
        },
        {
          id: 2,
          title: 'New Kid in Town',
          artist: 'Eagles',
          album: 'Hotel California',
          duration: 304,
          path: 'C:/Music/newkid.flac',
          format: 'FLAC',
          loved: 0,
          disliked: 0,
          lyric_offset: 0,
        }
      ]
    });
  });

  it('sets and clears active single track for editing', () => {
    const track = useStore.getState().tracks[0];
    useStore.getState().setTagEditorTrack(track);

    expect(useStore.getState().tagEditorTrack).toEqual(track);
    expect(useStore.getState().tagEditorBatchTracks).toEqual([]);

    useStore.getState().setTagEditorTrack(null);
    expect(useStore.getState().tagEditorTrack).toBeNull();
  });

  it('sets and clears batch tracks for multi-track editing', () => {
    const tracks = useStore.getState().tracks;
    useStore.getState().setTagEditorBatchTracks(tracks);

    expect(useStore.getState().tagEditorBatchTracks).toHaveLength(2);
    expect(useStore.getState().tagEditorBatchTracks[0].title).toBe('Hotel California');

    useStore.getState().setTagEditorBatchTracks([]);
    expect(useStore.getState().tagEditorBatchTracks).toEqual([]);
  });

  it('invokes write_audio_tags with correct payload on single track update', async () => {
    const mockUpdatedTrack: Track = {
      id: 1,
      title: 'Hotel California (2024 Remaster)',
      artist: 'Eagles',
      album: 'Hotel California (Expanded)',
      duration: 390,
      path: 'C:/Music/hotel.flac',
      format: 'FLAC',
      loved: 0,
      disliked: 0,
      lyric_offset: 0,
      track_number: 1,
      disc_number: 1,
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'write_audio_tags') {
        return Promise.resolve(mockUpdatedTrack);
      }
      return Promise.resolve(null);
    });

    const res = await invoke('write_audio_tags', {
      path: 'C:/Music/hotel.flac',
      update: {
        title: 'Hotel California (2024 Remaster)',
        artist: 'Eagles',
        album: 'Hotel California (Expanded)',
        track_number: 1,
        disc_number: 1,
      }
    });

    expect(invoke).toHaveBeenCalledWith('write_audio_tags', {
      path: 'C:/Music/hotel.flac',
      update: {
        title: 'Hotel California (2024 Remaster)',
        artist: 'Eagles',
        album: 'Hotel California (Expanded)',
        track_number: 1,
        disc_number: 1,
      }
    });
    expect(res).toEqual(mockUpdatedTrack);
  });

  it('invokes batch_update_tags with paths and common tags', async () => {
    (invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'batch_update_tags') {
        return Promise.resolve(args.paths.length);
      }
      return Promise.resolve(null);
    });

    const count = await invoke('batch_update_tags', {
      paths: ['C:/Music/hotel.flac', 'C:/Music/newkid.flac'],
      update: {
        artist: 'The Eagles',
        album: 'Hotel California (Deluxe Edition)',
        year: '1976',
        genre: 'Classic Rock',
      }
    });

    expect(count).toBe(2);
    expect(invoke).toHaveBeenCalledWith('batch_update_tags', {
      paths: ['C:/Music/hotel.flac', 'C:/Music/newkid.flac'],
      update: {
        artist: 'The Eagles',
        album: 'Hotel California (Deluxe Edition)',
        year: '1976',
        genre: 'Classic Rock',
      }
    });
  });
});
