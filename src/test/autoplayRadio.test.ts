import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { isStreamTrack } from '../utils';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/types';

describe('Autoplay & Recommendation Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      queue: [],
      autoplayEnabled: true,
      autoplaySeedTrack: null,
      autoplaySessionHistory: [],
      recentlyClearedAutoplayPaths: [],
      tracks: [],
      playCounts: {},
      playback: {
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        volume: 1.0,
        exclusive: false,
        bit_perfect: false,
        dev_rate: 44100,
        driver_type: 'WASAPI'
      },
      currentTrack: null
    });
  });

  describe('Stream Track Identification (isStreamTrack)', () => {
    it('should correctly identify HTTP and HTTPS streams', () => {
      expect(isStreamTrack('https://stream.radioparadise.com/flac', null)).toBe(true);
      expect(isStreamTrack('http://192.168.1.100:4533/rest/stream', null)).toBe(true);
    });

    it('should correctly identify formats as streams', () => {
      expect(isStreamTrack('some-path', 'YouTube Direct')).toBe(true);
      expect(isStreamTrack('12345', 'Tidal FLAC')).toBe(true);
      expect(isStreamTrack('subsonic:99', 'SUBSONIC')).toBe(true);
      expect(isStreamTrack('jellyfin:10', 'JELLYFIN')).toBe(true);
      expect(isStreamTrack('radio:1', 'RADIO')).toBe(true);
      expect(isStreamTrack('stream:2', 'STREAM')).toBe(true);
    });

    it('should correctly identify raw 11-character YouTube video IDs as stream tracks', () => {
      expect(isStreamTrack('dQw4w9WgXcQ', null)).toBe(true);
      expect(isStreamTrack('kJQP7kiw5Fk', 'YouTube Direct')).toBe(true);
      // Local audio files with extension shouldn't match
      expect(isStreamTrack('C:\\Music\\song.flac', 'FLAC')).toBe(false);
      expect(isStreamTrack('/home/user/song.mp3', 'MP3')).toBe(false);
    });

    it('should return false for local tracks and falsy paths', () => {
      expect(isStreamTrack(null, null)).toBe(false);
      expect(isStreamTrack('', null)).toBe(false);
      expect(isStreamTrack('D:\\Audio\\Album\\01.Track.wav', 'WAV')).toBe(false);
    });
  });

  describe('triggerAutoplayRadio Resilience & Handling', () => {
    it('should handle null or undefined responses from backend without throwing', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null);

      const track: Track = {
        id: -1,
        path: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        duration: 213,
        format: 'YouTube Direct',
        lyric_offset: 0
      };

      await expect(useStore.getState().triggerAutoplayRadio(track, true)).resolves.not.toThrow();
      expect(useStore.getState().queue).toEqual([]);
    });

    it('should successfully populate recommendations into the queue', async () => {
      const mockRecommendations = [
        {
          id: 'rec12345678',
          title: 'Together Forever',
          artist: 'Rick Astley',
          cover_url: 'https://i.ytimg.com/vi/rec12345678/mqdefault.jpg',
          duration_raw: '3:25',
          url: 'https://www.youtube.com/watch?v=rec12345678'
        },
        {
          id: 'rec87654321',
          title: 'Whenever You Need Somebody',
          artist: 'Rick Astley',
          cover_url: 'https://i.ytimg.com/vi/rec87654321/mqdefault.jpg',
          duration_raw: '3:52',
          url: 'https://www.youtube.com/watch?v=rec87654321'
        }
      ];

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'get_youtube_autoplay_recommendations') {
          return mockRecommendations;
        }
        return null;
      });

      const track: Track = {
        id: -1,
        path: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        duration: 213,
        format: 'YouTube Direct',
        lyric_offset: 0
      };

      await useStore.getState().triggerAutoplayRadio(track, true);

      const queue = useStore.getState().queue;
      expect(queue.length).toBe(2);
      expect(queue[0].title).toBe('Together Forever');
      expect(queue[0].is_autoplay).toBe(true);
      expect(queue[1].title).toBe('Whenever You Need Somebody');
      expect(queue[1].is_autoplay).toBe(true);
    });

    it('should filter out disliked and recently cleared tracks from recommendations', async () => {
      const mockRecommendations = [
        {
          id: 'rec1',
          title: 'Disliked Song',
          artist: 'Artist A',
          cover_url: '',
          duration_raw: '3:00',
          url: 'https://www.youtube.com/watch?v=rec1'
        },
        {
          id: 'rec2',
          title: 'Good Song',
          artist: 'Artist B',
          cover_url: '',
          duration_raw: '3:30',
          url: 'https://www.youtube.com/watch?v=rec2'
        }
      ];

      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === 'get_youtube_autoplay_recommendations') return mockRecommendations;
        return null;
      });

      useStore.setState({
        tracks: [
          {
            id: 1,
            path: 'https://www.youtube.com/watch?v=rec1',
            title: 'Disliked Song',
            artist: 'Artist A',
            disliked: 1,
            duration: 180,
            format: 'YouTube Direct',
            lyric_offset: 0
          }
        ]
      });

      const track: Track = {
        id: -1,
        path: 'https://www.youtube.com/watch?v=seed1234567',
        title: 'Seed Track',
        artist: 'Artist A',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0
      };

      await useStore.getState().triggerAutoplayRadio(track, true);

      const queue = useStore.getState().queue;
      expect(queue.length).toBe(1);
      expect(queue[0].title).toBe('Good Song');
    });

    it('should toggle autoplay on and off, preserving manual user queued tracks', async () => {
      const manualTrack: Track = {
        id: 100,
        path: 'C:\\Music\\manual.mp3',
        title: 'Manual Track',
        artist: 'Local Artist',
        duration: 240,
        format: 'MP3',
        lyric_offset: 0,
        is_autoplay: false
      };

      const autoplayTrack: Track = {
        id: -30001,
        path: 'https://www.youtube.com/watch?v=auto1',
        title: 'Autoplay Track',
        artist: 'Online Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
        is_autoplay: true
      };

      useStore.setState({
        autoplayEnabled: true,
        queue: [manualTrack, autoplayTrack]
      });

      // Toggle off
      await useStore.getState().toggleAutoplay();
      expect(useStore.getState().autoplayEnabled).toBe(false);
      expect(useStore.getState().queue).toEqual([manualTrack]);

      // Toggle on
      await useStore.getState().toggleAutoplay();
      expect(useStore.getState().autoplayEnabled).toBe(true);
    });
  });
});
