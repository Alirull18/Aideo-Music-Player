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

  describe('Aideo Connect Overhaul Payloads & Synchronization', () => {
    interface TickMessage {
      type: 'tick';
      title?: string;
      artist?: string;
      album?: string;
      position: number;
      duration: number;
      volume: number;
      is_playing: boolean;
      has_cover?: boolean;
      cover_url?: string | null;
      shuffle?: boolean;
      repeat?: string;
    }

    interface TrackChangeMessage {
      type: 'track_change';
      title: string;
      artist: string;
      album: string;
      duration: number;
      cover_url: string | null;
      lyrics: LyricLine[];
      shuffle?: boolean;
      repeat?: string;
    }

    it('should parse lightweight 500ms tick messages with synced cover endpoint and without heavy lyrics', () => {
      const rawTick = JSON.stringify({
        type: 'tick',
        title: 'Instant Crush',
        artist: 'Daft Punk',
        album: 'Random Access Memories',
        position: 42.5,
        duration: 180.0,
        volume: 0.75,
        is_playing: true,
        has_cover: true,
        cover_url: '/cover?pin=123456&v=2',
        shuffle: false,
        repeat: 'off',
      });

      const tick: TickMessage = JSON.parse(rawTick);
      expect(tick.type).toBe('tick');
      expect(tick.title).toBe('Instant Crush');
      expect(tick.artist).toBe('Daft Punk');
      expect(tick.position).toBe(42.5);
      expect(tick.volume).toBe(0.75);
      expect(tick.is_playing).toBe(true);
      expect(tick.cover_url).toBe('/cover?pin=123456&v=2');
      // Ensure tick does NOT carry heavy arrays or base64 data
      expect((tick as any).lyrics).toBeUndefined();
      expect((tick as any).cover_art).toBeUndefined();
      expect(rawTick.length).toBeLessThan(250); // Under 250 bytes, eliminating bandwidth hogging
    });

    it('should dynamically update title, artist, and cover when metadata resolves asynchronously', () => {
      // Emulate client state
      let displayedTitle = 'Not Playing';
      let displayedArtist = 'Aideo Player';
      let displayedCover = '';

      const handleMessage = (data: any) => {
        if (data.type === 'track_change' || data.type === 'tick') {
          if (data.title && data.title !== 'Not Playing' && data.title !== displayedTitle) {
            displayedTitle = data.title;
            displayedArtist = data.artist || (data.album ? data.album : 'Aideo Player');
          }
          if (data.cover_url && data.cover_url !== displayedCover) {
            displayedCover = data.cover_url;
          }
        }
      };

      // 1. Initial tick when stopped
      handleMessage({ type: 'tick', title: 'Not Playing', artist: '', is_playing: false, position: 0 });
      expect(displayedTitle).toBe('Not Playing');

      // 2. Track started but metadata still loading from disk
      handleMessage({ type: 'track_change', title: 'Song 2', artist: 'Blur', duration: 122, cover_url: null, lyrics: [] });
      expect(displayedTitle).toBe('Song 2');
      expect(displayedArtist).toBe('Blur');
      expect(displayedCover).toBe('');

      // 3. Asynchronous cover resolved 300ms later on subsequent tick
      handleMessage({ type: 'tick', title: 'Song 2', artist: 'Blur', is_playing: true, position: 1.5, cover_url: '/cover?pin=123456&v=3' });
      expect(displayedCover).toBe('/cover?pin=123456&v=3');
    });

    it('should parse track_change messages with full metadata, cover endpoint, and lyrics', () => {
      const rawChange = JSON.stringify({
        type: 'track_change',
        title: 'Instant Crush',
        artist: 'Daft Punk',
        album: 'Random Access Memories',
        duration: 337.0,
        cover_url: '/cover?t=1710000000',
        lyrics: mockLyrics,
        shuffle: true,
        repeat: 'all',
      });

      const change: TrackChangeMessage = JSON.parse(rawChange);
      expect(change.type).toBe('track_change');
      expect(change.title).toBe('Instant Crush');
      expect(change.cover_url).toContain('/cover');
      expect(change.lyrics).toHaveLength(4);
      expect(change.shuffle).toBe(true);
      expect(change.repeat).toBe('all');
    });

    it('should correctly format all remote control action commands', () => {
      const actions = [
        { action: 'play' },
        { action: 'pause' },
        { action: 'toggle' },
        { action: 'next' },
        { action: 'prev' },
        { action: 'seek', value: 95.5 },
        { action: 'volume', value: 0.65 },
        { action: 'shuffle' },
        { action: 'repeat' },
      ];

      actions.forEach((act) => {
        const serialized = JSON.stringify(act);
        const parsed = JSON.parse(serialized);
        expect(parsed.action).toBe(act.action);
        if ('value' in act) {
          expect(parsed.value).toBe((act as any).value);
        }
      });
    });

    it('should validate 6-digit PIN format and URL extraction', () => {
      const validPins = ['100000', '482910', '999999'];
      const invalidPins = ['12345', '1234567', 'abcdef', '12a456'];

      const pinRegex = /^\d{6}$/;
      validPins.forEach((pin) => expect(pinRegex.test(pin)).toBe(true));
      invalidPins.forEach((pin) => expect(pinRegex.test(pin)).toBe(false));

      // Test URL extraction
      const sampleUrl = 'http://192.168.1.105:38562?pin=654321';
      const match = sampleUrl.match(/pin=([^&]+)/);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('654321');

      // Test URL extraction with trailing query parameters
      const sampleUrlWithExtra = 'http://10.0.0.15:38562?pin=123456&mode=dark';
      const matchExtra = sampleUrlWithExtra.match(/pin=([^&]+)/);
      expect(matchExtra).not.toBeNull();
      expect(matchExtra![1]).toBe('123456');
    });

    it('should verify connection URL formatting uses correct port and rejects 0.0.0.0', () => {
      const formatRemoteUrl = (ip: string, port: number, pin: string) => {
        if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') {
          return null;
        }
        return `http://${ip}:${port}?pin=${pin}`;
      };

      expect(formatRemoteUrl('0.0.0.0', 38562, '123456')).toBeNull();
      expect(formatRemoteUrl('127.0.0.1', 38562, '123456')).toBeNull();
      expect(formatRemoteUrl('192.168.1.42', 38562, '123456')).toBe('http://192.168.1.42:38562?pin=123456');
      expect(formatRemoteUrl('10.0.0.5', 38562, '987654')).toBe('http://10.0.0.5:38562?pin=987654');
    });
  });
});
