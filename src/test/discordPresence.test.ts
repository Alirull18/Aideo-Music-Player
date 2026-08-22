import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Track } from '../store/types';
import { setOnlineTrackCache } from '../utils';

describe('Discord Rich Presence (RPC) Integration & Fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useStore.setState({
      discordEnabled: true,
      currentTrack: null,
      tracks: [],
      queue: [],
      playHistory: [],
      playback: {
        current_track: null,
        status: 'Stopped',
        position_secs: 0,
        volume: 1,
        dev_rate: 44100,
        file_ch: 2,
        bit_perfect: false,
        driver_type: 'WASAPI',
        exclusive: false
      }
    });
  });

  it('sends Idle status when stopped or no track is loaded', () => {
    useStore.getState().updateDiscordPresence();

    expect(invoke).toHaveBeenCalledWith('update_discord_presence', {
      details: 'Idle',
      stateStr: 'Browsing Library',
      isPlaying: false
    });
  });

  it('clears discord presence when discordEnabled is false', () => {
    useStore.setState({ discordEnabled: false });
    useStore.getState().updateDiscordPresence();

    expect(invoke).toHaveBeenCalledWith('clear_discord_presence');
    expect(invoke).not.toHaveBeenCalledWith('update_discord_presence', expect.anything());
  });

  it('correctly reports local library track to Discord', () => {
    const localTrack: Track = {
      id: 1,
      path: 'C:\\Music\\Daft Punk\\Get Lucky.mp3',
      title: 'Get Lucky',
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      duration: 248,
      format: 'MP3',
      lyric_offset: 0
    };

    useStore.setState({
      tracks: [localTrack],
      currentTrack: localTrack,
      playback: {
        ...useStore.getState().playback,
        current_track: localTrack.path,
        status: 'Playing'
      }
    });

    useStore.getState().updateDiscordPresence();

    expect(invoke).toHaveBeenCalledWith('update_discord_presence', {
      details: 'Get Lucky',
      stateStr: 'by Daft Punk',
      isPlaying: true
    });
  });

  it('correctly reports cached cloud track to Discord without showing Unknown Artist', () => {
    // Cloud tracks / cached tracks are not in state.tracks (which holds local files)
    const cachedCloudTrack: Track = {
      id: -1,
      path: 'https://subsonic.server.com/rest/stream?id=98765',
      title: 'Starboy',
      artist: 'The Weeknd',
      album: 'Starboy',
      duration: 230,
      format: 'SUBSONIC',
      lyric_offset: 0
    };

    useStore.setState({
      tracks: [], // Not in local library!
      currentTrack: cachedCloudTrack,
      playback: {
        ...useStore.getState().playback,
        current_track: cachedCloudTrack.path,
        status: 'Playing'
      }
    });

    useStore.getState().updateDiscordPresence();

    expect(invoke).toHaveBeenCalledWith('update_discord_presence', {
      details: 'Starboy',
      stateStr: 'by The Weeknd',
      isPlaying: true
    });
  });

  it('correctly reports offline cached file (e.g. CloudCache temp file) to Discord', () => {
    const cachedTempPath = 'C:\\Users\\User\\AppData\\Roaming\\aideo\\CloudCache\\a1b2c3d4e5f60718293a4b5c6d7e8f90.tmp';
    const cachedVirtualTrack: Track = {
      id: -2,
      path: cachedTempPath,
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      album: 'After Hours',
      duration: 200,
      format: 'JELLYFIN',
      lyric_offset: 0
    };

    useStore.setState({
      tracks: [],
      currentTrack: cachedVirtualTrack,
      playback: {
        ...useStore.getState().playback,
        current_track: cachedTempPath,
        status: 'Playing'
      }
    });

    useStore.getState().updateDiscordPresence();

    expect(invoke).toHaveBeenCalledWith('update_discord_presence', {
      details: 'Blinding Lights',
      stateStr: 'by The Weeknd',
      isPlaying: true
    });
  });

  it('triggers updateDiscordPresence during playStream with webstream metadata', async () => {
    const streamUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const streamMeta = {
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      duration: 213,
      cover_url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    };

    await useStore.getState().playStream(streamUrl, streamMeta, false);

    expect(invoke).toHaveBeenCalledWith('update_discord_presence', {
      details: 'Never Gonna Give You Up',
      stateStr: 'by Rick Astley',
      isPlaying: true
    });
  });

  it('resolves track metadata from queue if not in currentTrack or tracks', () => {
    const queuedTrack: Track = {
      id: 55,
      path: 'https://stream.radio.org/live.mp3',
      title: 'Chillhop Radio',
      artist: 'Lofi Girl',
      duration: null,
      format: 'URL',
      lyric_offset: 0
    };

    useStore.setState({
      tracks: [],
      currentTrack: null,
      queue: [queuedTrack],
      playback: {
        ...useStore.getState().playback,
        current_track: queuedTrack.path,
        status: 'Playing'
      }
    });

    useStore.getState().updateDiscordPresence();

    expect(invoke).toHaveBeenCalledWith('update_discord_presence', {
      details: 'Chillhop Radio',
      stateStr: 'by Lofi Girl',
      isPlaying: true
    });
  });

  it('resolves track metadata from onlineTrackCache when playing online/cached track', () => {
    const onlineUrl = 'https://example.com/audio/track-12345.mp3';
    const cachedInfo = {
      id: -99,
      path: onlineUrl,
      title: 'Cyberpunk Synthwave',
      artist: 'Master Boot Record',
      format: 'URL',
      lyric_offset: 0
    };
    setOnlineTrackCache(onlineUrl, cachedInfo);

    useStore.setState({
      tracks: [],
      currentTrack: null,
      queue: [],
      playback: {
        ...useStore.getState().playback,
        current_track: onlineUrl,
        status: 'Playing'
      }
    });

    useStore.getState().updateDiscordPresence();

    expect(invoke).toHaveBeenCalledWith('update_discord_presence', {
      details: 'Cyberpunk Synthwave',
      stateStr: 'by Master Boot Record',
      isPlaying: true
    });
  });

  it('splits "Artist - Title" formatted title when artist is unknown or generic', () => {
    const formattedTrack: Track = {
      id: 77,
      path: 'C:\\Music\\Downloads\\Kavinsky - Nightcall.flac',
      title: 'Kavinsky - Nightcall',
      artist: 'Unknown Artist',
      duration: 259,
      format: 'FLAC',
      lyric_offset: 0
    };

    useStore.setState({
      tracks: [],
      currentTrack: formattedTrack,
      playback: {
        ...useStore.getState().playback,
        current_track: formattedTrack.path,
        status: 'Playing'
      }
    });

    useStore.getState().updateDiscordPresence();

    expect(invoke).toHaveBeenCalledWith('update_discord_presence', {
      details: 'Nightcall',
      stateStr: 'by Kavinsky',
      isPlaying: true
    });
  });
});
