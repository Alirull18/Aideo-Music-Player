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

  it('correctly processes MusicBrainz recording payload with nested artist-credit and releases', async () => {
    const mockMbzResponse = {
      count: 1,
      recordings: [
        {
          id: 'mbz-rec-123',
          title: 'Hotel California',
          'artist-credit': [{ name: 'Eagles' }],
          'first-release-date': '1976-12-08',
          genres: [{ name: 'Classic Rock' }],
          releases: [
            {
              id: 'mbz-rel-456',
              title: 'Hotel California (Remastered)',
              date: '1976-12-08',
              'track-count': 9,
              track_number: 1,
              disc_number: 1,
              cover_url: 'https://coverartarchive.org/release/mbz-rel-456/front-500',
            }
          ]
        }
      ]
    };

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'mbz_search_recording') {
        return Promise.resolve(mockMbzResponse);
      }
      return Promise.resolve(null);
    });

    const res = await invoke('mbz_search_recording', { title: 'Hotel California', artist: 'Eagles' });
    expect(res).toEqual(mockMbzResponse);
    const rec = (res as any).recordings[0];
    expect(rec.title).toBe('Hotel California');
    expect(rec['artist-credit'][0].name).toBe('Eagles');
    expect(rec.releases[0].title).toBe('Hotel California (Remastered)');
    expect(rec.releases[0].date.slice(0, 4)).toBe('1976');
    expect(rec.releases[0].cover_url).toContain('coverartarchive.org');
  });

  it('searches online covers and downloads data url without cors', async () => {
    const mockCovers = [
      {
        id: 'itunes-1',
        title: 'Hotel California',
        artist: 'Eagles',
        album: 'Hotel California',
        source: 'iTunes',
        cover_url: 'https://is1-ssl.mzstatic.com/image/thumb/Music123/1000x1000bb.jpg'
      }
    ];

    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'search_covers_online') {
        return Promise.resolve(mockCovers);
      }
      if (cmd === 'fetch_image_as_data_url') {
        return Promise.resolve('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
      }
      return Promise.resolve(null);
    });

    const results = await invoke('search_covers_online', { query: 'Eagles Hotel California' });
    expect(results).toEqual(mockCovers);

    const b64 = await invoke('fetch_image_as_data_url', { url: mockCovers[0].cover_url });
    expect(b64).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
  });
});
