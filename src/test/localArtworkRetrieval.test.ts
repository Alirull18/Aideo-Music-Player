import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore, type Track } from '../store';
import { cancelSourcePlayback, playUnifiedTrack } from '../store/sourcePlayback';
import { clearSourceCache, groupRecordings } from '../utils/unifiedSources';

const localFlacTrack: Track = {
  id: 10,
  path: 'C:/Music/test_song.flac',
  title: 'Test FLAC Song',
  artist: 'Test Artist',
  album: 'Test Album',
  duration: 210,
  format: 'FLAC',
  lyric_offset: 0,
  cover_url: null,
};

describe('Local Artwork Retrieval in Unified Playback', () => {
  beforeEach(() => {
    cancelSourcePlayback();
    clearSourceCache();
    localStorage.clear();
    useStore.setState({
      queue: [],
      tracks: [localFlacTrack],
      currentTrack: null,
      coverArt: null,
      playHistory: [],
      playCounts: {},
      playbackError: null,
      tidalConnected: false,
      qobuzConnected: false,
      sourceQueueManaged: false,
      chromecast_connected: false,
      upnp_connected: false,
      streamingQuality: 'best_available',
      playback: {
        current_track: null,
        status: 'Stopped',
        volume: 1,
        position_secs: 0,
        backend_position_secs: 0,
        is_buffering: false,
        bit_perfect: false,
        exclusive: false,
        dev_rate: 44100,
        driver_type: 'WASAPI',
      },
      recordPlaybackTransition: vi.fn().mockResolvedValue(undefined),
      autoFetchLyricsOnline: vi.fn().mockResolvedValue(undefined),
      updateDiscordPresence: vi.fn(),
    });

    vi.mocked(invoke).mockReset().mockImplementation(async (cmd, args: any) => {
      if (cmd === 'check_files_exist') return [true];
      if (cmd === 'read_audio_tags') return { lossless: true, sample_rate: 44100, bit_depth: 16, format: 'FLAC' };
      if (cmd === 'get_cover_art') {
        if (args?.path === 'C:/Music/test_song.flac') {
          return 'data:image/jpeg;base64,embeddedCoverData123';
        }
        return null;
      }
      if (cmd === 'play_track') return null;
      if (cmd === 'update_media_metadata') return null;
      return null;
    });
  });

  it('retrieves and sets embedded cover art when playing a local track via playUnifiedTrack', async () => {
    const row = groupRecordings([localFlacTrack], '')[0];
    await playUnifiedTrack(useStore.setState, useStore.getState, row);

    // Wait for async get_cover_art promise
    await vi.waitFor(() => {
      expect(useStore.getState().coverArt).toBe('data:image/jpeg;base64,embeddedCoverData123');
    });

    expect(vi.mocked(invoke)).toHaveBeenCalledWith('get_cover_art', { path: 'C:/Music/test_song.flac' });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('update_media_metadata', expect.objectContaining({
      title: 'Test FLAC Song',
      artist: 'Test Artist',
      coverUrl: 'data:image/jpeg;base64,embeddedCoverData123',
    }));
  });

  it('restores coverArt for local currentTrack in loadLibrary if previously missing', async () => {
    useStore.setState({
      currentTrack: localFlacTrack,
      coverArt: null,
    });

    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === 'get_library') return [localFlacTrack];
      if (cmd === 'get_unified_favorites') return [];
      if (cmd === 'get_cover_art') {
        if (args?.path === 'C:/Music/test_song.flac') return 'data:image/jpeg;base64,embeddedCoverData123';
      }
      return null;
    });

    await useStore.getState().loadLibrary();

    await vi.waitFor(() => {
      expect(useStore.getState().coverArt).toBe('data:image/jpeg;base64,embeddedCoverData123');
    });
  });
});
