import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { UpnpDevice } from '../store/types';

describe('Lossless UPnP / DLNA Network Streamer Store & Actions', () => {
  const mockDevices: UpnpDevice[] = [
    {
      id: 'uuid:marantz-hi-fi-1234',
      name: 'Marantz PM7000N Hi-Res Streamer',
      manufacturer: 'Marantz',
      model_name: 'PM7000N',
      location: 'http://192.168.1.50:8080/description.xml',
      ip: '192.168.1.50',
      av_transport_url: 'http://192.168.1.50:8080/AVTransport/control',
      rendering_control_url: 'http://192.168.1.50:8080/RenderingControl/control',
      is_connected: false,
    },
    {
      id: 'uuid:sonos-amp-5678',
      name: 'Sonos Amp Living Room',
      manufacturer: 'Sonos, Inc.',
      model_name: 'Sonos Amp',
      location: 'http://192.168.1.55:1400/xml/device_description.xml',
      ip: '192.168.1.55',
      av_transport_url: 'http://192.168.1.55:1400/MediaRenderer/AVTransport/Control',
      rendering_control_url: 'http://192.168.1.55:1400/MediaRenderer/RenderingControl/Control',
      is_connected: false,
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      upnp_devices: [],
      upnp_active_device: null,
      upnp_scanning: false,
      upnp_connected: false,
      chromecast_connected: false,
      chromecast_active_device: null,
      playbackError: null,
      recordPlaybackTransition: vi.fn().mockResolvedValue(undefined),
      updateDiscordPresence: vi.fn(),
      autoFetchLyricsOnline: vi.fn().mockResolvedValue(undefined),
      currentTrack: {
        id: 1,
        title: 'Comfortably Numb',
        artist: 'Pink Floyd',
        album: 'The Wall',
        duration: 382,
        path: 'C:/Music/comfortably_numb.flac',
        format: 'FLAC',
        loved: 1,
        disliked: 0,
        lyric_offset: 0,
      },
      playback: {
        status: 'Stopped',
        current_track: null,
        last_played_track: null,
        position_secs: 0,
        volume: 0.8,
        driver_type: 'WASAPI',
        exclusive: false,
        bit_perfect: false,
        dev_rate: 44100,
      }
    });
  });

  it('discovers UPnP / DLNA renderers and stores device list', async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === 'upnp_discover') {
        return Promise.resolve(mockDevices);
      }
      return Promise.resolve(null);
    });

    await useStore.getState().discoverUpnpDevices();
    expect(invoke).toHaveBeenCalledWith('upnp_discover');
    expect(useStore.getState().upnp_devices).toEqual(mockDevices);
    expect(useStore.getState().upnp_scanning).toBe(false);
  });

  it('connects to selected UPnP device and sets upnp_connected', async () => {
    (invoke as any).mockResolvedValue(undefined);

    const device = mockDevices[0];
    await useStore.getState().connectUpnpDevice(device);

    expect(invoke).toHaveBeenCalledWith('upnp_connect', { deviceId: device.id });
    expect(useStore.getState().upnp_active_device).toBe(device.id);
    expect(useStore.getState().upnp_connected).toBe(true);
  });

  it('disconnects from UPnP device and restores local state', async () => {
    useStore.setState({
      upnp_active_device: mockDevices[0].id,
      upnp_connected: true,
    });

    (invoke as any).mockResolvedValue(undefined);

    await useStore.getState().disconnectUpnpDevice();
    expect(invoke).toHaveBeenCalledWith('upnp_disconnect');
    expect(useStore.getState().upnp_active_device).toBeNull();
    expect(useStore.getState().upnp_connected).toBe(false);
  });

  it('routes pause, resume, and stop controls to upnp_control when connected', async () => {
    useStore.setState({
      upnp_connected: true,
      upnp_active_device: mockDevices[0].id,
      playback: {
        ...useStore.getState().playback,
        status: 'Playing',
        current_track: 'C:/Music/comfortably_numb.flac',
      }
    });

    (invoke as any).mockResolvedValue(undefined);

    // Test Pause
    await useStore.getState().pauseTrack();
    expect(invoke).toHaveBeenCalledWith('upnp_control', { action: 'pause' });
    expect(useStore.getState().playback.status).toBe('Paused');

    // Test Resume
    await useStore.getState().resumeTrack();
    expect(invoke).toHaveBeenCalledWith('upnp_control', { action: 'play' });
    expect(useStore.getState().playback.status).toBe('Playing');

    // Test Stop
    await useStore.getState().stopTrack();
    expect(invoke).toHaveBeenCalledWith('upnp_control', { action: 'stop' });
  });

  it('routes seek to upnp_control when connected', async () => {
    useStore.setState({
      upnp_connected: true,
      upnp_active_device: mockDevices[0].id,
    });

    (invoke as any).mockResolvedValue(undefined);

    await useStore.getState().seek(120);
    expect(invoke).toHaveBeenCalledWith('upnp_control', { action: 'seek', value: 120 });
    expect(useStore.getState().playback.position_secs).toBe(120);
  });

  it('uses the UPnP renderer status without polling the stopped local decoder', async () => {
    useStore.setState({ upnp_connected: true, upnp_active_device: mockDevices[0].id,
      playback: { ...useStore.getState().playback, status: 'Playing', current_track: 'https://example.com/song', is_buffering: false } });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => cmd === 'upnp_get_status'
      ? { active_device_id: mockDevices[0].id, is_playing: true, position_secs: 42, duration_secs: 382, volume: 80 }
      : null);

    await useStore.getState().pollStatus();
    expect(useStore.getState().playback).toMatchObject({ status: 'Playing', position_secs: 42 });
    expect(invoke).not.toHaveBeenCalledWith('get_playback_status');
  });

  it('does not turn a paused UPnP renderer back into Playing on a status poll', async () => {
    useStore.setState({ upnp_connected: true, upnp_active_device: mockDevices[0].id,
      playback: { ...useStore.getState().playback, status: 'Paused', current_track: 'https://example.com/song' } });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => cmd === 'upnp_get_status'
      ? { active_device_id: mockDevices[0].id, is_playing: false, position_secs: 18, duration_secs: 382, volume: 80 }
      : null);

    await useStore.getState().pollStatus();
    expect(useStore.getState().playback.status).toBe('Paused');
    expect(invoke).not.toHaveBeenCalledWith('get_playback_status');
  });

  it('treats a nonplaying UPnP report as paused, not as a track end', async () => {
    useStore.setState({ upnp_connected: true, upnp_active_device: mockDevices[0].id,
      playback: { ...useStore.getState().playback, status: 'Playing', current_track: 'https://example.com/song', position_secs: 80 } });
    vi.mocked(invoke).mockImplementation(async cmd => cmd === 'upnp_get_status'
      ? { active_device_id: mockDevices[0].id, is_playing: false, position_secs: 80, duration_secs: 382, volume: 80 }
      : null);
    await useStore.getState().pollStatus();
    expect(useStore.getState().playback.status).toBe('Paused');
    expect(invoke).not.toHaveBeenCalledWith('get_playback_status');
  });

  it('ignores status from an old UPnP renderer after a route switch', async () => {
    let finish!: (value: unknown) => void;
    useStore.setState({ upnp_connected: true, upnp_active_device: mockDevices[0].id,
      playback: { ...useStore.getState().playback, status: 'Playing', position_secs: 34 } });
    vi.mocked(invoke).mockImplementation(async cmd => cmd === 'upnp_get_status' ? new Promise(resolve => { finish = resolve; }) : null);
    const pending = useStore.getState().pollStatus();
    useStore.setState({ upnp_connected: false, chromecast_connected: true,
      playback: { ...useStore.getState().playback, position_secs: 90 } });
    finish({ active_device_id: mockDevices[0].id, is_playing: false, position_secs: 2 });
    await pending;
    expect(useStore.getState().playback).toMatchObject({ status: 'Playing', position_secs: 90 });
  });
  it('clears a previous local strict path before remote playback', async () => {
    useStore.setState({ currentTrack: null, playback: { ...useStore.getState().playback,
      effective_audio_path: { active: true, engine: 'WASAPI', share_mode: 'exclusive',
        source: { sample_rate: 44100, channels: 2 }, pipeline_sample_format: 'f32',
        output: { sample_rate: 44100, channels: 2 }, requested_exclusive: true,
        requested_bit_perfect: true, resampling: false, volume_applied: false,
        active_transforms: [], underruns: 0, strict_bit_perfect: true } } });
    vi.mocked(invoke).mockResolvedValue(null);
    await useStore.getState().connectCastDevice({ name: 'Cast', ip: '192.168.1.60', port: 8009 });
    expect(useStore.getState().playback.effective_audio_path).toBeNull();
  });
  it('ignores a pending local status response after connecting a remote renderer', async () => {
    let finish!: (value: unknown) => void;
    const promise = new Promise<unknown>(resolve => { finish = resolve; });
    useStore.setState({ playback: { ...useStore.getState().playback,
      status: 'Playing', current_track: 'C:/Music/comfortably_numb.flac', position_secs: 12 } });
    vi.mocked(invoke).mockImplementation(async cmd => cmd === 'get_playback_status' ? promise : null);
    const pending = useStore.getState().pollStatus();
    await useStore.getState().connectCastDevice({ name: 'Cast', ip: '192.168.1.60', port: 8009 });
    finish({ status: 'Playing', current_track: 'C:/Music/comfortably_numb.flac', position_secs: 40,
      effective_audio_path: { strict_bit_perfect: true } });
    await pending;
    expect(useStore.getState().playback.effective_audio_path).toBeNull();
    expect(useStore.getState().playback.position_secs).not.toBe(40);
  });



  it.each([
    ['upnp', 'cast', 'upnp_disconnect', 'chromecast_connect'],
    ['cast', 'upnp', 'chromecast_disconnect', 'upnp_connect'],
  ] as const)('switches %s to %s without restarting local audio and preserves pause', async (from, to, stopCommand, connectCommand) => {
    const calls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => { calls.push(cmd); return null; });
    useStore.setState({
      chromecast_connected: from === 'cast', chromecast_active_device: from === 'cast' ? '192.168.1.60' : null,
      upnp_connected: from === 'upnp', upnp_active_device: from === 'upnp' ? mockDevices[0].id : null,
      playback: { ...useStore.getState().playback, status: 'Paused', position_secs: 53, current_track: null },
    });

    if (to === 'cast') await useStore.getState().connectCastDevice({ name: 'Cast', ip: '192.168.1.60', port: 8009 });
    else await useStore.getState().connectUpnpDevice(mockDevices[1]);

    expect(calls.indexOf(stopCommand)).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(stopCommand)).toBeLessThan(calls.indexOf(connectCommand));
    expect(invoke).toHaveBeenCalledWith(from === 'cast' ? 'chromecast_control' : 'upnp_control', { action: 'stop' });
    expect(calls).not.toContain('play_track');
    expect(useStore.getState().chromecast_connected).toBe(to === 'cast');
    expect(useStore.getState().upnp_connected).toBe(to === 'upnp');
    expect(useStore.getState().playback.status).toBe('Paused');
    const playCommand = to === 'cast' ? 'chromecast_play' : 'upnp_play';
    const controlCommand = to === 'cast' ? 'chromecast_control' : 'upnp_control';
    expect(calls).toContain(playCommand);
    expect(invoke).toHaveBeenCalledWith(controlCommand, { action: 'pause' });
    if (to === 'cast') expect(invoke).toHaveBeenCalledWith('chromecast_play', expect.objectContaining({ startTime: 53 }));
    else expect(invoke).toHaveBeenCalledWith('upnp_control', { action: 'seek', value: 53 });
  });

  it.each(['cast', 'upnp'] as const)('does not connect Cast when %s stop fails', async route => {
    useStore.setState({
      chromecast_connected: route === 'cast', upnp_connected: route === 'upnp',
      upnp_active_device: route === 'upnp' ? mockDevices[0].id : null,
    });
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === (route === 'cast' ? 'chromecast_control' : 'upnp_control')) throw new Error('Stop failed');
      return null;
    });
    await useStore.getState().connectCastDevice({ name: 'Other Cast', ip: '192.168.1.70', port: 8009 });
    expect(invoke).not.toHaveBeenCalledWith('chromecast_connect', expect.anything());
    expect(useStore.getState().chromecast_connected).toBe(route === 'cast');
    expect(useStore.getState().upnp_connected).toBe(route === 'upnp');
  });

  it('applies UPnP volume only after receiver command succeeds, without adjusting local gain', async () => {
    useStore.setState({ upnp_connected: true, upnp_active_device: mockDevices[0].id });
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'upnp_control') throw new Error('Receiver rejected volume');
      return null;
    });
    await useStore.getState().setVolume(0.2);
    expect(useStore.getState().playback.volume).toBe(0.8);
    expect(invoke).not.toHaveBeenCalledWith('set_volume', expect.anything());

    vi.mocked(invoke).mockImplementation(async () => null);
    await useStore.getState().setVolume(0.2);
    expect(useStore.getState().playback.volume).toBe(0.2);
    expect(invoke).toHaveBeenCalledWith('upnp_control', { action: 'volume', value: 20 });
    expect(invoke).not.toHaveBeenCalledWith('set_volume', expect.anything());
  });

  it('does not report Cast volume or mute as changed when receiver volume is unavailable', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    useStore.setState({ chromecast_connected: true, playback: { ...useStore.getState().playback, volume: 0.8 }, isMuted: false });
    await useStore.getState().setVolume(0.2);
    await useStore.getState().toggleMute();
    expect(useStore.getState().playback.volume).toBe(0.8);
    expect(useStore.getState().isMuted).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith('set_volume', expect.anything());
  });
});
