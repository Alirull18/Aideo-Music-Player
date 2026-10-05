import type { DSPState, PlayerState } from '../store/types';
import { safeGetStorage, safeSetStorage } from './storage';

export interface AutoEqIdentity { url: string; name: string; fullSource: string }
export interface DeviceProfile {
  version: 1;
  volume: number;
  dsp: DSPState;
  autoEq: AutoEqIdentity | null;
  exclusive: boolean;
  bitPerfect: boolean;
}
export const deviceProfileKey = (name: string | null) => `aideo_device_profile_${name || 'Default'}`;
export function isAmbiguousDevice(name: string, devices: string[]): boolean {
  const base = name.replace(/ #\d+$/, '');
  return devices.filter(device => device.replace(/ #\d+$/, '') === base).length > 1;
}
export const DEVICE_DSP_DEFAULTS: DSPState = {
  enabled: false, low_spec_mode: false, audio_profile: 'normal', resampler_interpolation: 'linear',
  resampler_sinc_len: 128, resampler_oversampling: 256, ffmpeg_transcode_quality: 'native', width: 1,
  upsample_rate: 0, dither: false, exclusive_mode_timing: 'event', preamp_gain: 0, limiter_threshold: -0.1,
  resampler_phase_mode: 'linear', eq_enabled: false, eq_parametric: false, eq_graphic_gains: Array(10).fill(0),
  eq_parametric_bands: [80, 120, 240, 400, 750, 1500, 2200, 4000, 6000, 10000].map(freq => ({ freq, gain: 0, q: 0.7, band_type: 'peaking' })),
  crossfeed_enabled: false, crossfeed_level: -6, crossfeed_corner: 700, spatial_enabled: false,
  spatial_haas_delay: 7.5, spatial_wet: 0.15, convolution_enabled: false, convolution_ir_path: '', convolution_wet: 0.5,
  subsonic_enabled: false, night_mode_enabled: false, r128_enabled: false, aideo_filter_enabled: false,
  aideo_filter_room_size: 0.85, aideo_filter_bass_thump: 6, aideo_filter_dampening: 0.5, auto_headroom: false,
  saturation_enabled: false, saturation_drive: 0, crossfade_transition_enabled: false, crossfade_transition_duration: 5,
  stream_engine: 'reqwest', lookahead_prebuffer_enabled: true,
  track_replaygain_gain: 0, playback_rate: 1,
};

export function validateDeviceDsp(value: unknown, defaults: DSPState = DEVICE_DSP_DEFAULTS, strict = false): DSPState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = { ...defaults };
  const enums: Record<string, unknown[]> = {
    audio_profile: ['low', 'normal', 'high', 'custom'], resampler_interpolation: ['linear', 'cubic'],
    resampler_sinc_len: [64, 128, 256], resampler_oversampling: [128, 256, 512],
    ffmpeg_transcode_quality: ['standard', 'studio', 'hires', 'native'], exclusive_mode_timing: ['event', 'polling'],
    resampler_phase_mode: ['linear', 'minimum', 'intermediate'], stream_engine: ['yt-dlp', 'reqwest'],
  };
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(DEVICE_DSP_DEFAULTS, key)) { if (strict) return null; else continue; }
    const fallback = defaults[key as keyof DSPState];
    if (enums[key]) { if (!enums[key].includes(entry)) return null; }
    else if (key === 'eq_graphic_gains') {
      if (!Array.isArray(entry) || entry.length !== 10 || !entry.every(g => Number.isFinite(g) && Math.abs(g) <= 36)) return null;
    } else if (key === 'eq_parametric_bands') {
      if (!Array.isArray(entry) || entry.length > 32 || !entry.every(b => b && Number.isFinite(b.freq) && b.freq >= 10 && b.freq <= 48000 && Number.isFinite(b.gain) && Math.abs(b.gain) <= 36 && Number.isFinite(b.q) && b.q >= 0.01 && b.q <= 100 && ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'notch', 'bandpass'].includes(b.band_type))) return null;
      (result as unknown as Record<string, unknown>)[key] = entry.map(b => ({ freq: b.freq, gain: b.gain, q: b.q, band_type: b.band_type }));
      continue;
    } else if (typeof entry !== typeof fallback || (typeof entry === 'number' && (!Number.isFinite(entry) || Math.abs(entry) > 768000)) || (typeof entry === 'string' && entry.length > 4096)) return null;
    if (key === 'convolution_ir_path' && entry !== '' && (typeof entry !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(entry))) return null;
    (result as unknown as Record<string, unknown>)[key] = entry;
  }
  const ranges: Record<string, [number, number]> = { width: [0, 4], upsample_rate: [0, 768000], preamp_gain: [-30, 30], limiter_threshold: [-30, 0], crossfeed_level: [-30, 0], crossfeed_corner: [100, 5000], spatial_haas_delay: [0, 50], spatial_wet: [0, 1], convolution_wet: [0, 1], aideo_filter_room_size: [0, 1], aideo_filter_bass_thump: [0, 24], aideo_filter_dampening: [0, 1], saturation_drive: [0, 1], crossfade_transition_duration: [0, 30] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const entry = result[key as keyof DSPState] as number;
    if (!Number.isFinite(entry) || entry < min || entry > max) return null;
  }
  return result;
}

export function parseDeviceProfile(value: unknown, defaults: DSPState = DEVICE_DSP_DEFAULTS): DeviceProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = value as Record<string, unknown>;
  const dsp = validateDeviceDsp(profile.dsp, defaults, true);
  if (Object.keys(profile).some(key => !['version', 'volume', 'dsp', 'autoEq', 'exclusive', 'bitPerfect'].includes(key)) || profile.version !== 1 || !dsp || typeof profile.volume !== 'number' || !Number.isFinite(profile.volume) || profile.volume < 0 || profile.volume > 1 || typeof profile.exclusive !== 'boolean' || typeof profile.bitPerfect !== 'boolean') return null;
  const eq = profile.autoEq as Record<string, unknown> | null;
  if (eq !== null && (!eq || typeof eq !== 'object' || Object.keys(eq).some(key => !['url', 'name', 'fullSource'].includes(key)) || !['url', 'name', 'fullSource'].every(key => typeof eq[key] === 'string' && (eq[key] as string).length <= 4096) || !(eq.url as string).startsWith('https://raw.githubusercontent.com/jaakkopasanen/AutoEq/'))) return null;
  if (eq) {
    try {
      const url = new URL(eq.url as string);
      if (url.search || url.hash || url.username || url.password) return null;
    } catch { return null; }
  }
  return { version: 1, volume: profile.volume, dsp, autoEq: eq ? { url: eq.url as string, name: eq.name as string, fullSource: eq.fullSource as string } : null, exclusive: profile.exclusive, bitPerfect: profile.bitPerfect };
}

export function readDeviceProfile(name: string | null, defaults: DSPState): DeviceProfile | null {
  try {
    const raw = safeGetStorage(deviceProfileKey(name));
    const legacyDsp = safeGetStorage(`aideo_dev_dsp_${name || 'Default'}`);
    const legacyVolume = safeGetStorage(`aideo_dev_vol_${name || 'Default'}`);
    if (!raw && !legacyDsp && legacyVolume === null) return null;
    const profile = raw ? JSON.parse(raw) : { version: 1, volume: legacyVolume === null ? 1 : Number(legacyVolume), dsp: legacyDsp ? JSON.parse(legacyDsp) : defaults, autoEq: null, exclusive: false, bitPerfect: false };
    if (!raw) profile.dsp = validateDeviceDsp(profile.dsp, defaults);
    return parseDeviceProfile(profile, defaults);
  } catch { return null; }
}

export function saveDeviceProfile(state: PlayerState): void {
  if (state.currentDevice === null || state.audioDeviceSwitching) return;
  const previous = readDeviceProfile(state.currentDevice, state.dsp);
  // ponytail: display names are the current backend identity; endpoint IDs follow duplicate-name evidence.
  const profile: DeviceProfile = { version: 1, volume: state.playback.volume,
    dsp: state.playback.bit_perfect && previous ? previous.dsp : state.dsp,
    autoEq: state.activeAutoEq, exclusive: state.requestedAudioModes.exclusive, bitPerfect: state.requestedAudioModes.bitPerfect };
  safeSetStorage(deviceProfileKey(state.currentDevice), JSON.stringify(profile));
}
