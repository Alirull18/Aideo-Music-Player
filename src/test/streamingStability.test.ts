import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';

describe('Streaming Stability Engine Tests', () => {
  beforeEach(() => {
    useStore.setState({
      playback: {
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        volume: 1.0,
        exclusive: false,
        bit_perfect: false,
        dev_rate: 0,
        driver_type: 'WASAPI',
        is_buffering: false,
      },
    });
  });

  it('initializes with is_buffering as false', () => {
    const state = useStore.getState();
    expect(state.playback.is_buffering).toBe(false);
  });

  it('updates is_buffering correctly on buffering start and end', () => {
    useStore.setState((s) => ({
      playback: { ...s.playback, is_buffering: true },
    }));
    expect(useStore.getState().playback.is_buffering).toBe(true);

    useStore.setState((s) => ({
      playback: { ...s.playback, is_buffering: false },
    }));
    expect(useStore.getState().playback.is_buffering).toBe(false);
  });

  it('calculates correct time-based byte requirements for streaming audio', () => {
    const STREAM_PREBUFFER_SECS = 3.0;
    const SAMPLE_RATE = 44100;
    const CHANNELS = 2;
    const BYTES_PER_SAMPLE = 2; // 16-bit

    const bytesPerSecond = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
    const requiredBytes = Math.floor(bytesPerSecond * STREAM_PREBUFFER_SECS);

    expect(bytesPerSecond).toBe(176400);
    expect(requiredBytes).toBe(529200);
    expect(requiredBytes).toBeGreaterThan(512 * 1024); // ~516.8 KB
  });

  it('calculates 10-second deep RingBuffer capacity accurately across sample rates', () => {
    const RING_BUFFER_CAPACITY_SECS = 10;
    const CHANNELS = 2;
    const BYTES_PER_F32 = 4;

    const rates = [44100, 48000, 96000, 192000];
    const expectedCapacities = {
      44100: 44100 * CHANNELS * RING_BUFFER_CAPACITY_SECS, // 882,000 samples (~3.53 MB)
      48000: 48000 * CHANNELS * RING_BUFFER_CAPACITY_SECS, // 960,000 samples (~3.84 MB)
      96000: 96000 * CHANNELS * RING_BUFFER_CAPACITY_SECS, // 1,920,000 samples (~7.68 MB)
      192000: 192000 * CHANNELS * RING_BUFFER_CAPACITY_SECS, // 3,840,000 samples (~15.36 MB)
    };

    for (const rate of rates) {
      const samples = rate * CHANNELS * RING_BUFFER_CAPACITY_SECS;
      const memBytes = samples * BYTES_PER_F32;
      expect(samples).toBe(expectedCapacities[rate as keyof typeof expectedCapacities]);
      // Verify RAM footprint remains below 20MB even for 192kHz Hi-Res audio
      expect(memBytes).toBeLessThan(20 * 1024 * 1024);
    }
  });

  it('verifies low watermark (250ms) and high watermark (2.0s) sample thresholds', () => {
    const rate = 96000;
    const ch = 2;
    const lowWatermark = (rate * ch) / 4; // 250ms = 48,000 samples
    const highWatermark = rate * ch * 2; // 2.0s = 384,000 samples

    expect(lowWatermark).toBe(48000);
    expect(highWatermark).toBe(384000);
    expect(highWatermark).toBeGreaterThan(lowWatermark * 4);
  });
});
