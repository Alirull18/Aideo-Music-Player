import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { isStreamTrack } from '../utils';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/types';

describe('Autoplay & Recommendation Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useStore.setState({
      recommendationEngine: 'our',
      tidalConnected: true,
      appMode: 'hybrid',
      repeat: 'all',
      recordPlaybackTransition: useStore.getInitialState().recordPlaybackTransition,
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
      expect(isStreamTrack('138614268', 'Qobuz FLAC')).toBe(true);
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
    it('uses the active online source when a recording is represented by a local library path', async () => {
      const seed: Track = { id: 1, path: 'C:/Music/song.flac', title: 'Seed', artist: 'Artist', duration: 180, format: 'FLAC', lyric_offset: 0,
        active_source: { provider: 'youtube', id: 'aaaaaaaaaaa' } };
      useStore.setState({ currentTrack: seed, tracks: [seed], recommendationEngine: 'youtube' });
      vi.mocked(invoke).mockImplementation(async (command, args?: any) => {
        if (command === 'get_recommendations') return { tracks: args.request.candidates, generation: args.request.generation, reasons: {} };
        return null;
      });
      await useStore.getState().triggerAutoplayRadio(seed, true);
      const calls = vi.mocked(invoke).mock.calls;
      expect((calls.find(([command]) => command === 'get_youtube_autoplay_recommendations')![1] as any).videoId).toBe('aaaaaaaaaaa');
      expect((calls.find(([command]) => command === 'get_recommendations')![1] as any).request.allow_local).toBe(false);
    });

    it.each([false, true])('mixes local files into online radio only when allowed (%s)', async allowLocal => {
      const seed: Track = { id: -1, path: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Seed', artist: 'Artist', duration: 180, format: 'YouTube Direct', lyric_offset: 0 };
      const local: Track = { ...seed, id: 2, path: 'C:/Music/local.flac', title: 'Local', format: 'FLAC' };
      localStorage.setItem('aideo_autoplay_local_for_cloud', String(allowLocal));
      useStore.setState({ currentTrack: seed, tracks: [local], recommendationEngine: 'youtube' });
      vi.mocked(invoke).mockImplementation(async (command, args?: any) => {
        if (command === 'get_youtube_autoplay_recommendations') return [{ id: 'bbbbbbbbbbb', title: 'Online', artist: 'Artist', duration_raw: '3:00', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' }];
        if (command === 'get_recommendations') return { tracks: args.request.candidates, generation: args.request.generation, reasons: {} };
        return null;
      });
      await useStore.getState().triggerAutoplayRadio(seed, true);
      const request = (vi.mocked(invoke).mock.calls.find(([command]) => command === 'get_recommendations')![1] as any).request;
      expect(request.allow_local).toBe(allowLocal);
      expect(request.candidates.some((track: Track) => track.path === local.path)).toBe(allowLocal);
      expect(useStore.getState().queue.some(track => track.path === local.path)).toBe(allowLocal);
    });

    it('does not silently fill online radio with local files when providers return nothing', async () => {
      const seed: Track = { id: -1, path: '123', title: 'Seed', artist: 'Artist', duration: 180, format: 'Tidal FLAC', lyric_offset: 0 };
      const local: Track = { ...seed, id: 2, path: 'C:/Music/local.flac', title: 'Local', format: 'FLAC' };
      useStore.setState({ currentTrack: seed, tracks: [local], recommendationEngine: 'tidal' });
      vi.mocked(invoke).mockImplementation(async (command, args?: any) => {
        if (command === 'get_recommendations') return { tracks: args.request.candidates, generation: args.request.generation, reasons: {} };
        return null;
      });
      await useStore.getState().triggerAutoplayRadio(seed, true);
      expect(useStore.getState().queue).toEqual([]);
    });

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

      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
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
    it('does not switch explicit Tidal radio to YouTube when no related Tidal recording matches', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_tidal_autoplay_recommendations') return [];
        return null;
      });
      const seed: Track = {
        id: -1,
        path: '12345',
        title: 'Bukan Bang Toyib',
        artist: 'Wali',
        duration: 210,
        format: 'Tidal FLAC',
        lyric_offset: 0,
      };
      useStore.setState({ recommendationEngine: 'tidal', currentTrack: seed });
      await useStore.getState().triggerAutoplayRadio(seed, true);

      expect(useStore.getState().queue).toEqual([]);
      expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'get_youtube_autoplay_recommendations')).toBe(false);
    });

    it('should not commit a pending response after autoplay is disabled', async () => {
      let resolveRecommendations: ((value: unknown) => void) | undefined;
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') {
          return new Promise(resolve => { resolveRecommendations = resolve; });
        }
        return null;
      });

      const manualTrack: Track = {
        id: 7,
        path: 'C:\\Music\\manual.mp3',
        title: 'Manual Track',
        artist: 'Local Artist',
        duration: 200,
        format: 'MP3',
        lyric_offset: 0,
      };
      useStore.setState({ queue: [manualTrack] });

      const request = useStore.getState().triggerAutoplayRadio({
        id: 1,
        path: 'https://www.youtube.com/watch?v=seed1234567',
        title: 'Seed Track',
        artist: 'Seed Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
      }, true);
      await Promise.resolve();
      await useStore.getState().toggleAutoplay();
      resolveRecommendations?.([{
        id: 'late',
        title: 'Late Recommendation',
        artist: 'Another Artist',
        duration_raw: '3:00',
        url: 'https://www.youtube.com/watch?v=late1234567',
      }]);
      await request;

      expect(useStore.getState().queue).toEqual([manualTrack]);
    });

    it('should not commit a pending response after the seed track changes', async () => {
      const resolvers: Array<(value: unknown) => void> = [];
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') {
          return new Promise(resolve => { resolvers.push(resolve); });
        }
        return null;
      });

      const firstRequest = useStore.getState().triggerAutoplayRadio({
        id: 1,
        path: 'https://www.youtube.com/watch?v=first123456',
        title: 'First Song',
        artist: 'First Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
      }, true);
      await Promise.resolve();
      const secondRequest = useStore.getState().triggerAutoplayRadio({
        id: 2,
        path: 'https://www.youtube.com/watch?v=second12345',
        title: 'Second Song',
        artist: 'Second Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
      }, true);
      await Promise.resolve();

      resolvers[0]?.([{
        id: 'stale',
        title: 'Stale Recommendation',
        artist: 'Stale Artist',
        duration_raw: '3:00',
        url: 'https://www.youtube.com/watch?v=stale123456',
      }]);
      await firstRequest;
      expect(useStore.getState().queue).toEqual([]);

      resolvers[1]?.([{
        id: 'fresh',
        title: 'Fresh Recommendation',
        artist: 'Fresh Artist',
        duration_raw: '3:00',
        url: 'https://www.youtube.com/watch?v=fresh123456',
      }]);
      await secondRequest;
      expect(useStore.getState().queue.map(track => track.title)).toEqual(['Fresh Recommendation']);
    });
    it('should discard a pending response when playback changes without another radio request', async () => {
      let resolveRecommendations: ((value: unknown) => void) | undefined;
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') {
          return new Promise(resolve => { resolveRecommendations = resolve; });
        }
        return null;
      });
      const seed: Track = {
        id: 1,
        path: 'https://www.youtube.com/watch?v=seed1234567',
        title: 'Seed Song',
        artist: 'Seed Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
      };
      const next: Track = {
        id: 2,
        path: 'https://www.youtube.com/watch?v=next1234567',
        title: 'Next Song',
        artist: 'Next Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
      };
      useStore.setState({ currentTrack: seed });
      const pending = useStore.getState().triggerAutoplayRadio(seed);
      await Promise.resolve();
      useStore.setState({ currentTrack: next });
      resolveRecommendations?.([{
        id: 'late',
        title: 'Late Recommendation',
        artist: 'Late Artist',
        duration_raw: '3:00',
        url: 'https://www.youtube.com/watch?v=late1234567',
      }]);
      await pending;

      expect(useStore.getState().queue).toEqual([]);
    });
    it('should discard a pending response once another track starts changing', async () => {
      let finishPlaybackTransition: (() => void) | undefined;
      const transition = new Promise<void>(resolve => { finishPlaybackTransition = resolve; });
      let resolveRecommendations: ((value: unknown) => void) | undefined;
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') {
          return new Promise(resolve => { resolveRecommendations = resolve; });
        }
        return null;
      });
      const seed: Track = {
        id: 1,
        path: 'C:\\Music\\seed.mp3',
        title: 'Seed Song',
        artist: 'Seed Artist',
        duration: 200,
        format: 'MP3',
        lyric_offset: 0,
      };
      useStore.setState({ currentTrack: seed, recommendationEngine: 'youtube' });
      const pending = useStore.getState().triggerAutoplayRadio(seed);
      await Promise.resolve();
      const originalTransition = useStore.getState().recordPlaybackTransition;
      useStore.setState({ recordPlaybackTransition: async () => transition });
      const nextPlayback = useStore.getState().playTrack({
        ...seed,
        id: 2,
        path: 'C:\\Music\\next.mp3',
        title: 'Next Song',
      }, false, false);
      resolveRecommendations?.([{
        id: 'late',
        title: 'Late Recommendation',
        artist: 'Late Artist',
        duration_raw: '3:00',
        url: 'https://www.youtube.com/watch?v=late1234567',
      }]);
      await pending;
      const queueAfterStaleResponse = useStore.getState().queue;
      finishPlaybackTransition?.();
      await nextPlayback;
      useStore.setState({ recordPlaybackTransition: originalTransition });
      expect(queueAfterStaleResponse).toEqual([]);
    });

    it('should not re-add played or cleared tracks when recommendations are exhausted', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') {
          return [{
            id: 'played',
            title: 'Played Song',
            artist: 'Played Artist',
            duration_raw: '3:00',
            url: 'https://www.youtube.com/watch?v=played123456',
          }, {
            id: 'cleared',
            title: 'Cleared Song',
            artist: 'Cleared Artist',
            duration_raw: '3:00',
            url: 'https://www.youtube.com/watch?v=cleared12345',
          }];
        }
        return null;
      });
      useStore.setState({
        autoplaySessionHistory: [{
          id: 2,
          path: 'https://www.youtube.com/watch?v=played123456',
          title: 'Played Song',
          artist: 'Played Artist',
          duration: 180,
          format: 'YouTube Direct',
          lyric_offset: 0,
        }],
        recentlyClearedAutoplayPaths: ['https://www.youtube.com/watch?v=cleared12345'],
      });

      await useStore.getState().triggerAutoplayRadio({
        id: 1,
        path: 'https://www.youtube.com/watch?v=seed1234567',
        title: 'Seed Song',
        artist: 'Seed Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
      }, true);

      expect(useStore.getState().queue).toEqual([]);
    });

    it('should only append one copy of a song within a refill', async () => {
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') {
          return [{
            id: 'duplicate01',
            title: 'Same Song',
            artist: 'Same Artist',
            duration_raw: '3:00',
            url: 'https://www.youtube.com/watch?v=duplicate01',
          }, {
            id: 'duplicate02',
            title: 'Same Song (Official Audio)',
            artist: 'Same Artist',
            duration_raw: '3:00',
            url: 'https://www.youtube.com/watch?v=duplicate02',
          }];
        }
        return null;
      });

      await useStore.getState().triggerAutoplayRadio({
        id: 1,
        path: 'https://www.youtube.com/watch?v=seed1234567',
        title: 'Seed Song',
        artist: 'Seed Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
      }, true);

      expect(useStore.getState().queue).toHaveLength(1);
      expect(useStore.getState().queue[0].title).toBe('Same Song');
    });
    it('should rebuild the backend from newer queue state after a deferred clear', async () => {
      let resolveClear: (() => void) | undefined;
      let resolveClearStarted: (() => void) | undefined;
      const clearStarted = new Promise<void>(resolve => { resolveClearStarted = resolve; });
      const deferredClear = new Promise<void>(resolve => { resolveClear = resolve; });
      const bulkPaths: string[][] = [];
      vi.mocked(invoke).mockImplementation(async (cmd, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') {
          return [{
            id: 'radio1',
            title: 'Radio Song',
            artist: 'Radio Artist',
            duration_raw: '3:00',
            url: 'https://www.youtube.com/watch?v=radio123456',
          }];
        }
        if (cmd === 'clear_queue') {
          resolveClearStarted?.();
          return deferredClear;
        }
        if (cmd === 'add_to_queue_bulk') {
          if (args && typeof args === 'object' && 'paths' in args && Array.isArray(args.paths)) bulkPaths.push(args.paths);
        }
        return null;
      });

      const pending = useStore.getState().triggerAutoplayRadio({
        id: 1,
        path: 'https://www.youtube.com/watch?v=seed1234567',
        title: 'Seed Song',
        artist: 'Seed Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
      }, true);
      await clearStarted;

      const manualTrack: Track = {
        id: 9,
        path: 'C:\\Music\\newer-manual.mp3',
        title: 'Newer Manual Track',
        artist: 'Manual Artist',
        duration: 200,
        format: 'MP3',
        lyric_offset: 0,
      };
      useStore.setState({ queue: [manualTrack] });
      resolveClear?.();
      await pending;

      expect(bulkPaths).toContainEqual([manualTrack.path]);
    });

    it('should remove queued autoplay from the backend when entering repeat one', async () => {
      const commands: string[] = [];
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        commands.push(cmd);
        return null;
      });
      useStore.setState({
        repeat: 'all',
        queue: [{
          id: 15,
          path: 'C:\\Music\\local-radio.mp3',
          title: 'Local Radio',
          artist: 'Artist',
          duration: 180,
          format: 'MP3',
          lyric_offset: 0,
          is_autoplay: true,
        }],
      });

      useStore.getState().toggleRepeat();
      await vi.waitFor(() => expect(commands).toContain('clear_queue'));

      expect(useStore.getState().repeat).toBe('one');
      expect(commands).not.toContain('add_to_queue_bulk');
    });

    it('should exclude played, cleared, queued, disliked and seed paths before shared ranking limits', async () => {
      const seed: Track = {
        id: 1,
        path: 'C:\\Music\\seed.mp3',
        title: 'Seed Song',
        artist: 'Seed Artist',
        duration: 200,
        format: 'MP3',
        lyric_offset: 0,
      };
      const played = { ...seed, id: 2, path: 'C:\\Music\\played.mp3' };
      const disliked = { ...seed, id: 3, path: 'C:\\Music\\disliked.mp3', disliked: 1 };
      const manual = { ...seed, id: 4, path: 'C:\\Music\\manual.mp3' };
      useStore.setState({
        autoplaySessionHistory: [played],
        recentlyClearedAutoplayPaths: ['C:\\Music\\cleared.mp3'],
        tracks: [disliked],
        queue: [manual],
      });
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_similar_tracks') return [];
        return null;
      });

      await useStore.getState().triggerAutoplayRadio(seed);

      expect(invoke).toHaveBeenCalledWith('get_recommendations', { request: expect.objectContaining({
        candidates: expect.arrayContaining([expect.objectContaining({ path: disliked.path, disliked: 1 })]),
        seed: expect.objectContaining({ path: seed.path }),
        excluded_paths: expect.arrayContaining([
          seed.path,
          played.path,
          manual.path,
          'C:\\Music\\cleared.mp3',
        ]),
      }) });
    });

    it('should preserve manual queue priority during a forced radio refill', async () => {
      const manualTrack: Track = {
        id: 11,
        path: 'C:\\Music\\manual-priority.mp3',
        title: 'Manual Priority',
        artist: 'Manual Artist',
        duration: 220,
        format: 'MP3',
        lyric_offset: 0,
      };
      useStore.setState({ queue: [manualTrack] });
      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') {
          return [{
            id: 'radio1',
            title: 'Radio Song',
            artist: 'Radio Artist',
            duration_raw: '3:00',
            url: 'https://www.youtube.com/watch?v=radio123456',
          }];
        }
        return null;
      });

      await useStore.getState().triggerAutoplayRadio({
        id: 1,
        path: 'https://www.youtube.com/watch?v=seed1234567',
        title: 'Seed Song',
        artist: 'Seed Artist',
        duration: 200,
        format: 'YouTube Direct',
        lyric_offset: 0,
      }, true);

      expect(useStore.getState().queue.map(track => track.path)).toEqual([
        manualTrack.path,
        'https://www.youtube.com/watch?v=radio123456',
      ]);
    });

    it('should filter out disliked and recently cleared tracks from recommendations', async () => {
      const mockRecommendations = [
        {
          id: 'recommend01',
          title: 'Disliked Song',
          artist: 'Artist A',
          cover_url: '',
          duration_raw: '3:00',
          url: 'https://www.youtube.com/watch?v=recommend01'
        },
        {
          id: 'recommend02',
          title: 'Good Song',
          artist: 'Artist B',
          cover_url: '',
          duration_raw: '3:30',
          url: 'https://www.youtube.com/watch?v=recommend02'
        }
      ];

      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') return mockRecommendations;
        return null;
      });

      useStore.setState({
        tracks: [
          {
            id: 1,
            path: 'https://www.youtube.com/watch?v=recommend01',
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

    it('should default recommendationEngine to "our" and support changing engine', () => {
      expect(useStore.getState().recommendationEngine).toBe('our');

      useStore.getState().setRecommendationEngine('youtube');
      expect(useStore.getState().recommendationEngine).toBe('youtube');
      expect(localStorage.getItem('aideo_recommendation_engine')).toBe('youtube');

      useStore.getState().setRecommendationEngine('tidal');
      expect(useStore.getState().recommendationEngine).toBe('tidal');
      expect(localStorage.getItem('aideo_recommendation_engine')).toBe('tidal');

      useStore.getState().setRecommendationEngine('our');
      expect(useStore.getState().recommendationEngine).toBe('our');
    });

    it('uses local candidates even when an online engine is selected in local-only mode', async () => {
      const seed: Track = { id: 1, path: 'C:/Music/seed.flac', title: 'Seed', artist: 'Artist', duration: 180, format: 'FLAC', lyric_offset: 0 };
      const local: Track = { ...seed, id: 2, path: 'C:/Music/local.flac', title: 'Local' };
      const commands: string[] = [];
      vi.mocked(invoke).mockImplementation(async (cmd, args?: any) => {
        commands.push(cmd);
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        commands.push(cmd);
        if (cmd === 'get_similar_tracks') return [local];
        if (cmd === 'get_youtube_autoplay_recommendations') return [{ id: 'online', title: 'Online', artist: 'Artist', duration_raw: '3:00', url: 'https://youtube.com/watch?v=online' }];
        return null;
      });
      useStore.setState({ appMode: 'local', recommendationEngine: 'youtube', currentTrack: seed, tracks: [seed, local] });

      await useStore.getState().triggerAutoplayRadio(seed, true);

      expect(commands).toContain('get_recommendations');
      expect(commands).not.toContain('get_youtube_autoplay_recommendations');
      expect(useStore.getState().queue.map(t => t.path)).toEqual([local.path]);
    });

    it('should query YouTube autoplay recommendations when engine is "youtube" even for local track', async () => {
      useStore.setState({ recommendationEngine: 'youtube' });

      let youtubeCalled = false;
      let localSimilarCalled = false;

      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_youtube_autoplay_recommendations') {
          youtubeCalled = true;
          return [
            {
              id: 'youtube1234',
              title: 'YouTube Rec',
              artist: 'YT Artist',
              cover_url: '',
              duration_raw: '3:10',
              url: 'https://www.youtube.com/watch?v=youtube1234'
            }
          ];
        }
        if (cmd === 'get_similar_tracks') {
          localSimilarCalled = true;
          return [];
        }
        return null;
      });

      const localTrack: Track = {
        id: 1,
        path: 'C:\\Music\\song.flac',
        title: 'Local Song',
        artist: 'Local Artist',
        duration: 200,
        format: 'FLAC',
        lyric_offset: 0
      };

      await useStore.getState().triggerAutoplayRadio(localTrack, true);

      expect(youtubeCalled).toBe(true);
      expect(localSimilarCalled).toBe(false);
      const queue = useStore.getState().queue;
      expect(queue.length).toBe(1);
      expect(queue[0].title).toBe('YouTube Rec');
    });

    it('should query Tidal autoplay recommendations when engine is "tidal"', async () => {
      useStore.setState({ recommendationEngine: 'tidal' });

      let tidalCalled = false;

      vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_recommendations') return { tracks: args.request.candidates.filter((t: Track) => !args.request.excluded_paths.includes(t.path) && t.disliked !== 1), generation: args.request.generation, reasons: {} };
        if (cmd === 'get_tidal_autoplay_recommendations') {
          tidalCalled = true;
          return [
            {
              id: '999888',
              title: 'Tidal Rec',
              artist: 'Tidal Artist',
              duration: 220,
              cover_url: 'https://tidal.com/cover.jpg'
            }
          ];
        }
        return null;
      });

      const track: Track = {
        id: 2,
        path: 'C:\\Music\\song2.flac',
        title: 'Song 2',
        artist: 'Artist 2',
        duration: 190,
        format: 'FLAC',
        lyric_offset: 0
      };

      await useStore.getState().triggerAutoplayRadio(track, true);

      expect(tidalCalled).toBe(true);
      const queue = useStore.getState().queue;
      expect(queue.length).toBe(1);
      expect(queue[0].title).toBe('Tidal Rec');
      expect(queue[0].format).toBe('Tidal FLAC');
    });

  });
});
