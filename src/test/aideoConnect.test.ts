import { describe, it, expect } from 'vitest';

interface LyricLine {
  time_secs: number;
  text: string;
}

interface ConnectPayload {
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  volume: number;
  is_playing: boolean;
  cover_art: string | null;
  lyrics: LyricLine[];
}

function resolveActiveLyricIndex(lyrics: LyricLine[], positionSecs: number): number {
  if (!lyrics.length) return -1;
  let activeIdx = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time_secs <= positionSecs) {
      activeIdx = i;
    } else {
      break;
    }
  }
  return activeIdx;
}

function createSeekCommand(timeSecs: number): string {
  return JSON.stringify({ action: 'seek', value: timeSecs });
}

describe('Aideo Connect Mobile Synced Lyrics', () => {
  const mockLyrics: LyricLine[] = [
    { time_secs: 0, text: 'Intro Instrumental' },
    { time_secs: 14.5, text: 'Looking at the stars tonight' },
    { time_secs: 28.0, text: 'Underneath the neon lights' },
    { time_secs: 45.2, text: 'Fade into the morning glow' },
  ];

  it('should find the matching active lyric index in real-time', () => {
    expect(resolveActiveLyricIndex(mockLyrics, 5)).toBe(0);
    expect(resolveActiveLyricIndex(mockLyrics, 14.5)).toBe(1);
    expect(resolveActiveLyricIndex(mockLyrics, 20.0)).toBe(1);
    expect(resolveActiveLyricIndex(mockLyrics, 30.0)).toBe(2);
    expect(resolveActiveLyricIndex(mockLyrics, 50.0)).toBe(3);
  });

  it('should return -1 when lyrics list is empty', () => {
    expect(resolveActiveLyricIndex([], 20)).toBe(-1);
  });

  it('should format tap-to-seek action payload correctly', () => {
    const payload = createSeekCommand(28.0);
    const parsed = JSON.parse(payload);
    expect(parsed.action).toBe('seek');
    expect(parsed.value).toBe(28.0);
  });

  it('should validate complete WebSocket connect payload structure', () => {
    const payload: ConnectPayload = {
      title: 'Midnight City',
      artist: 'M83',
      album: 'Hurry Up, We\'re Dreaming',
      duration: 244,
      position: 45.2,
      volume: 0.85,
      is_playing: true,
      cover_art: 'http://127.0.0.1:38562/cover.jpg',
      lyrics: mockLyrics,
    };

    expect(payload.lyrics.length).toBe(4);
    expect(payload.is_playing).toBe(true);
    expect(resolveActiveLyricIndex(payload.lyrics, payload.position)).toBe(3);
  });

  it('should route playback to upnp_play when upnp_connected is true', async () => {
    let invokedCmd = '';
    let invokedArgs: any = null;

    const mockInvoke = async (cmd: string, args: any) => {
      invokedCmd = cmd;
      invokedArgs = args;
    };

    const routePlayback = async (
      state: { chromecast_connected: boolean; upnp_connected: boolean },
      track: { path: string; title: string; artist: string; album: string; cover_url?: string },
      invokeFn: typeof mockInvoke
    ) => {
      if (state.chromecast_connected) {
        await invokeFn('chromecast_play', { path: track.path, title: track.title });
      } else if (state.upnp_connected) {
        await invokeFn('upnp_play', {
          path: track.path,
          title: track.title,
          artist: track.artist,
          album: track.album,
          coverUrl: track.cover_url || null,
        });
      } else {
        await invokeFn('play_track', { path: track.path, startPos: 0.0 });
      }
    };

    const track = { path: 'C:/Music/test.flac', title: 'Test Title', artist: 'Test Artist', album: 'Test Album' };

    // When UPnP is connected:
    await routePlayback({ chromecast_connected: false, upnp_connected: true }, track, mockInvoke);
    expect(invokedCmd).toBe('upnp_play');
    expect(invokedArgs.title).toBe('Test Title');
    expect(invokedArgs.album).toBe('Test Album');

    // When UPnP is not connected:
    await routePlayback({ chromecast_connected: false, upnp_connected: false }, track, mockInvoke);
    expect(invokedCmd).toBe('play_track');
  });
});
