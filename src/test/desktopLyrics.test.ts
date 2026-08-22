import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

describe('Floating Desktop Lyric Bar Store & Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      desktopLyricsOpen: false,
      desktopLyricsLocked: false,
      lyrics: [
        { time_secs: 0.0, text: 'Welcome to the Hotel California' },
        { time_secs: 4.5, text: 'Such a lovely place' },
        { time_secs: 8.0, text: 'Such a lovely face' },
      ],
      playback: {
        status: 'Playing',
        current_track: 'C:/Music/hotel.flac',
        last_played_track: null,
        position_secs: 5.2,
        volume: 0.8,
        driver_type: 'WASAPI',
        exclusive: false,
        bit_perfect: false,
        dev_rate: 44100,
      }
    });
  });

  it('toggles desktop lyrics window visibility via Tauri command', async () => {
    (invoke as any).mockResolvedValue(true);

    expect(useStore.getState().desktopLyricsOpen).toBe(false);

    await useStore.getState().toggleDesktopLyrics();
    expect(invoke).toHaveBeenCalledWith('toggle_desktop_lyrics', { show: true });
    expect(useStore.getState().desktopLyricsOpen).toBe(true);

    await useStore.getState().toggleDesktopLyrics();
    expect(invoke).toHaveBeenCalledWith('toggle_desktop_lyrics', { show: false });
    expect(useStore.getState().desktopLyricsOpen).toBe(false);
  });

  it('toggles click-through HUD locking mode', async () => {
    (invoke as any).mockResolvedValue(undefined);

    expect(useStore.getState().desktopLyricsLocked).toBe(false);

    await useStore.getState().toggleDesktopLyricsLocked();
    expect(invoke).toHaveBeenCalledWith('set_desktop_lyrics_ignore_cursor', { ignore: true });
    expect(useStore.getState().desktopLyricsLocked).toBe(true);

    await useStore.getState().toggleDesktopLyricsLocked();
    expect(invoke).toHaveBeenCalledWith('set_desktop_lyrics_ignore_cursor', { ignore: false });
    expect(useStore.getState().desktopLyricsLocked).toBe(false);
  });
});
