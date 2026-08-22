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
});
