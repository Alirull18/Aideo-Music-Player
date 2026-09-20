import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/types';

describe('Queue Reset on Song Click & Algorithmic Population', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useStore.setState({
      queue: [],
      tracks: [],
      currentTrack: null,
      autoplayEnabled: true,
      autoplaySeedTrack: null,
      autoplaySessionHistory: [],
      recentlyClearedAutoplayPaths: [],
      playback: {
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        volume: 1.0,
        exclusive: false,
        bit_perfect: false,
        dev_rate: 44100,
        driver_type: 'WASAPI',
        is_buffering: false,
      },
    });
  });

  it('clears the existing queue and populates recommendations when playing a new track', async () => {
    const existingTrack1: Track = {
      id: 1,
      path: 'C:/Music/song1.mp3',
      title: 'Old Song 1',
      artist: 'Old Artist 1',
      duration: 180,
      format: 'MP3',
      lyric_offset: 0,
    };
    const existingTrack2: Track = {
      id: 2,
      path: 'C:/Music/song2.mp3',
      title: 'Old Song 2',
      artist: 'Old Artist 2',
      duration: 200,
      format: 'MP3',
      lyric_offset: 0,
    };

    useStore.setState({ queue: [existingTrack1, existingTrack2] });
    expect(useStore.getState().queue).toHaveLength(2);

    const mockRecommendations = [
      {
        id: 'rec_auto_1',
        title: 'Algorithmic Rec 1',
        artist: 'Rec Artist 1',
        cover_url: 'https://example.com/cover1.jpg',
        duration_raw: '3:30',
        url: 'https://www.youtube.com/watch?v=rec_auto_1',
      },
      {
        id: 'rec_auto_2',
        title: 'Algorithmic Rec 2',
        artist: 'Rec Artist 2',
        cover_url: 'https://example.com/cover2.jpg',
        duration_raw: '4:00',
        url: 'https://www.youtube.com/watch?v=rec_auto_2',
      },
    ];

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_youtube_autoplay_recommendations') {
        return mockRecommendations;
      }
      return null;
    });

    const newTrackToPlay: Track = {
      id: -1,
      path: 'https://www.youtube.com/watch?v=new_seed_track',
      title: 'New Seed Song',
      artist: 'New Artist',
      duration: 210,
      format: 'YouTube Direct',
      lyric_offset: 0,
    };

    // User clicks new song to play
    await useStore.getState().playTrack(newTrackToPlay);

    // Verify invoke('clear_queue') was called to clear the audio backend queue
    expect(invoke).toHaveBeenCalledWith('clear_queue');

    // Verify queue no longer has old songs, and now contains the algorithm's recommendations
    const queue = useStore.getState().queue;
    expect(queue.some(t => t.title === 'Old Song 1')).toBe(false);
    expect(queue.some(t => t.title === 'Old Song 2')).toBe(false);
    expect(queue.length).toBe(2);
    expect(queue[0].title).toBe('Algorithmic Rec 1');
    expect(queue[0].is_autoplay).toBe(true);
    expect(queue[1].title).toBe('Algorithmic Rec 2');
    expect(queue[1].is_autoplay).toBe(true);
  });

  it('preserves the queue when the user explicitly uses addToQueue', async () => {
    const track1: Track = {
      id: 1,
      path: 'C:/Music/track1.flac',
      title: 'Track 1',
      artist: 'Artist 1',
      duration: 180,
      format: 'FLAC',
      lyric_offset: 0,
    };
    const track2: Track = {
      id: 2,
      path: 'C:/Music/track2.flac',
      title: 'Track 2',
      artist: 'Artist 2',
      duration: 200,
      format: 'FLAC',
      lyric_offset: 0,
    };

    await useStore.getState().addToQueue(track1);
    await useStore.getState().addToQueue(track2);

    const queue = useStore.getState().queue;
    expect(queue).toHaveLength(2);
    expect(queue[0].title).toBe('Track 1');
    expect(queue[1].title).toBe('Track 2');
  });

  it('preserves the queue when the user explicitly uses playNextInQueue', async () => {
    const track1: Track = {
      id: 1,
      path: 'C:/Music/track1.flac',
      title: 'Track 1',
      artist: 'Artist 1',
      duration: 180,
      format: 'FLAC',
      lyric_offset: 0,
    };
    const trackNext: Track = {
      id: 2,
      path: 'C:/Music/track_next.flac',
      title: 'Track Next',
      artist: 'Artist 2',
      duration: 220,
      format: 'FLAC',
      lyric_offset: 0,
    };

    await useStore.getState().addToQueue(track1);
    await useStore.getState().playNextInQueue(trackNext);

    const queue = useStore.getState().queue;
    expect(queue).toHaveLength(2);
    expect(queue[0].title).toBe('Track Next');
    expect(queue[1].title).toBe('Track 1');
  });

  it('preserves the rest of the queue when playing from queue via playFromQueue', async () => {
    const q1: Track = {
      id: 10,
      path: 'C:/Music/q1.flac',
      title: 'Queued Track 1',
      artist: 'Artist',
      duration: 180,
      format: 'FLAC',
      lyric_offset: 0,
    };
    const q2: Track = {
      id: 11,
      path: 'C:/Music/q2.flac',
      title: 'Queued Track 2',
      artist: 'Artist',
      duration: 210,
      format: 'FLAC',
      lyric_offset: 0,
    };

    useStore.setState({ queue: [q1, q2] });

    await useStore.getState().playFromQueue(0);

    const remainingQueue = useStore.getState().queue;
    expect(remainingQueue.some(t => t.id === 10)).toBe(false);
    expect(remainingQueue[0].id).toBe(11);
    expect(remainingQueue[0].title).toBe('Queued Track 2');
  });

  it('populates local similarity recommendations into queue when playing a local track', async () => {
    const localSeed: Track = {
      id: 100,
      path: 'C:/Music/local_seed.flac',
      title: 'Local Seed Song',
      artist: 'Local Artist',
      duration: 240,
      format: 'FLAC',
      lyric_offset: 0,
    };

    const mockSimilar = [
      {
        id: 101,
        path: 'C:/Music/local_similar_1.flac',
        title: 'Similar Song 1',
        artist: 'Similar Artist 1',
        album: 'Album 1',
        duration: 200,
        format: 'FLAC',
        lyric_offset: 0,
        cover_url: null,
      },
      {
        id: 102,
        path: 'C:/Music/local_similar_2.flac',
        title: 'Similar Song 2',
        artist: 'Similar Artist 2',
        album: 'Album 2',
        duration: 220,
        format: 'FLAC',
        lyric_offset: 0,
        cover_url: null,
      },
    ];

    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'get_similar_tracks') {
        return mockSimilar;
      }
      return null;
    });

    await useStore.getState().playTrack(localSeed);

    const queue = useStore.getState().queue;
    expect(queue.length).toBeGreaterThanOrEqual(2);
    expect(queue[0].title).toBe('Similar Song 1');
    expect(queue[0].is_autoplay).toBe(true);
    expect(queue[1].title).toBe('Similar Song 2');
    expect(queue[1].is_autoplay).toBe(true);
  });
});
