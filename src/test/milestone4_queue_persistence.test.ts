import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore, type Track, type PlaybackSource, type RecordingSources } from '../store';
import {
  createQueueOccurrenceId,
  isLocalUnifiedTrack,
  cleanSourceContext,
  applySourcePreference,
  groupRecordings,
  clearSourceCache,
} from '../utils/unifiedSources';
import {
  cancelSourcePlayback,
  playUnifiedTrack,
} from '../store/sourcePlayback';

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    path: 'C:/Music/test.flac',
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 180,
    format: 'FLAC',
    lyric_offset: 0,
    ...overrides,
  };
}

describe('Milestone 4: Queue Ownership, Persistence & Output Safety (Features 35-41)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearSourceCache();
    cancelSourcePlayback();
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    useStore.setState({
      tracks: [],
      queue: [],
      currentTrack: null,
      currentPlaylist: null,
      sourceQueueManaged: false,
      appMode: 'hybrid',
      streamingQuality: 'best_available',
      playback: {
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        volume: 1,
        exclusive: false,
        bit_perfect: false,
        dev_rate: 44100,
        driver_type: 'WASAPI',
        is_buffering: false,
      },
    });
  });

  afterEach(() => {
    cancelSourcePlayback();
  });

  // Feature 35: Authoritative Logical Queue & Duplicate Tolerance
  describe('Feature 35: Authoritative Logical Queue', () => {
    it('F35.6: allows intentional duplicate local tracks in addToQueue without warning toast', async () => {
      const toastSpy = vi.fn();
      window.addEventListener('ui-toast', toastSpy);

      const track = createTrack({ path: 'C:/Music/repeat.flac' });
      await useStore.getState().addToQueue(track);
      await useStore.getState().addToQueue(track);

      const queue = useStore.getState().queue;
      expect(queue).toHaveLength(2);
      expect(queue[0].path).toBe('C:/Music/repeat.flac');
      expect(queue[1].path).toBe('C:/Music/repeat.flac');

      // Verify no duplicate rejection toast was fired
      const warningToasts = toastSpy.mock.calls.filter(call => (call[0] as CustomEvent).detail?.type === 'warning');
      expect(warningToasts).toHaveLength(0);

      window.removeEventListener('ui-toast', toastSpy);
    });

    it('F35.7: allows intentional duplicate local tracks in playNextInQueue', async () => {
      const track1 = createTrack({ path: 'C:/Music/first.flac' });
      const trackRepeat = createTrack({ path: 'C:/Music/repeat.flac' });

      await useStore.getState().addToQueue(track1);
      await useStore.getState().playNextInQueue(trackRepeat);
      await useStore.getState().playNextInQueue(trackRepeat);

      const queue = useStore.getState().queue;
      expect(queue).toHaveLength(3);
      expect(queue[0].path).toBe('C:/Music/repeat.flac');
      expect(queue[1].path).toBe('C:/Music/repeat.flac');
      expect(queue[2].path).toBe('C:/Music/first.flac');
    });

    it('F35.8: preserves authoritative user queue order across reordering and operations', async () => {
      const t1 = createTrack({ path: 'C:/1.flac' });
      const t2 = createTrack({ path: 'C:/2.flac' });
      const t3 = createTrack({ path: 'C:/3.flac' });

      await useStore.getState().addToQueue(t1);
      await useStore.getState().addToQueue(t2);
      await useStore.getState().addToQueue(t3);

      expect(useStore.getState().queue.map(t => t.path)).toEqual(['C:/1.flac', 'C:/2.flac', 'C:/3.flac']);
      await useStore.getState().reorderQueue(0, 2);
      expect(useStore.getState().queue.map(t => t.path)).toEqual(['C:/2.flac', 'C:/3.flac', 'C:/1.flac']);
    });
  });

  // Feature 36: Decouple Playlist & Queue Occurrence IDs
  describe('Feature 36: Decouple Playlist & Queue IDs', () => {
    it('F36.6: generates unique queue_occurrence_id for identical playlist tracks', async () => {
      expect(createQueueOccurrenceId()).toMatch(/^qocc_/);
      const playlistTrack = createTrack({
        path: 'C:/Music/playlist_item.flac',
        playlist_entry_id: 42,
      });

      await useStore.getState().addToQueue(playlistTrack);
      await useStore.getState().addToQueue(playlistTrack);

      const queue = useStore.getState().queue;
      expect(queue).toHaveLength(2);
      expect(queue[0].playlist_entry_id).toBe(42);
      expect(queue[1].playlist_entry_id).toBe(42);

      // Distinct occurrence IDs
      expect(queue[0].queue_occurrence_id).toBeDefined();
      expect(queue[1].queue_occurrence_id).toBeDefined();
      expect(queue[0].queue_occurrence_id).not.toBe(queue[1].queue_occurrence_id);
    });

    it('F36.7: playUnifiedTrack removes only the targeted occurrence when identical duplicates exist in queue', async () => {
      const track1 = createTrack({
        path: 'C:/Music/song.flac',
        title: 'Song',
        artist: 'Artist',
        playlist_entry_id: 10,
        source_context: {
          recording_id: 'rec_same',
          sources: [{ provider: 'local', id: 'C:/Music/song.flac' }],
          selection: { mode: 'auto' },
        },
      });

      await useStore.getState().addToQueue(track1);
      await useStore.getState().addToQueue(track1);

      const queueBefore = useStore.getState().queue;
      expect(queueBefore).toHaveLength(2);
      const targetOccurrence = queueBefore[0];
      const remainingOccurrence = queueBefore[1];
      expect(targetOccurrence.queue_occurrence_id).not.toBe(remainingOccurrence.queue_occurrence_id);

      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'check_files_exist') return [true];
        return null;
      });

      // Play the first occurrence specifically
      await playUnifiedTrack(useStore.setState, useStore.getState, targetOccurrence);

      const queueAfter = useStore.getState().queue;
      expect(queueAfter).toHaveLength(1);
      expect(queueAfter[0].queue_occurrence_id).toBe(remainingOccurrence.queue_occurrence_id);
    });
  });

  // Feature 37: Local Native Gapless Audio Preservation
  describe('Feature 37: Local Native Gapless Audio Preservation', () => {
    it('F37.6: local unified track followed by local queued track preserves native queue mode', async () => {
      const currentLocal = groupRecordings([createTrack({ path: 'C:/Music/track1.flac' })], '')[0];
      const nextLocal = groupRecordings([createTrack({ path: 'C:/Music/track2.flac' })], '')[0];

      useStore.setState({
        queue: [nextLocal],
        sourceQueueManaged: false,
      });

      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'check_files_exist') return [true];
        return null;
      });

      await playUnifiedTrack(useStore.setState, useStore.getState, currentLocal);

      // Should NOT enable sourceQueueManaged
      expect(useStore.getState().sourceQueueManaged).toBe(false);
      expect(invoke).not.toHaveBeenCalledWith('set_source_queue_mode', { enabled: true });
      // Should queue next local track into native queue for 0ms gapless transition
      expect(invoke).toHaveBeenCalledWith('add_to_queue', { path: 'C:/Music/track2.flac' });
    });

    it('F37.7: isLocalUnifiedTrack correctly identifies local vs online unified tracks', () => {
      const localTrack: Track = createTrack({
        source_context: {
          recording_id: 'r1',
          sources: [{ provider: 'local', id: 'C:/Music/test.flac' }],
          selection: { mode: 'auto' },
        },
      });
      expect(isLocalUnifiedTrack(localTrack)).toBe(true);

      const onlineTrack: Track = createTrack({
        source_context: {
          recording_id: 'r2',
          sources: [{ provider: 'tidal', id: '12345' }],
          selection: { mode: 'auto' },
        },
      });
      expect(isLocalUnifiedTrack(onlineTrack)).toBe(false);
    });
  });

  // Feature 38: Additive Persistence (v1->v2)
  describe('Feature 38: Additive Persistence (v1->v2)', () => {
    it('F38.3: cleanSourceContext preserves known fields and structure when v2 fields are absent', () => {
      const legacyContext: RecordingSources = {
        recording_id: 'rec_legacy',
        sources: [{ provider: 'local', id: 'C:/Music/legacy.flac' }],
        selection: { mode: 'auto' },
      };

      const cleaned = cleanSourceContext(legacyContext);
      expect(cleaned.recording_id).toBe('rec_legacy');
      expect(cleaned.sources).toHaveLength(1);
      expect(cleaned.selection.mode).toBe('auto');
    });

    it('F38.4: accepts unknown future fields in local storage preferences without throwing', () => {
      const track = createTrack({ format: 'FLAC', path: 'C:/Music/future.flac' });
      const futurePayload = {
        recording_id: 'rec_future',
        sources: [{ provider: 'local', id: 'C:/Music/future.flac' }],
        selection: { mode: 'auto' },
        future_version: 3,
        unknown_metadata_bucket: { tags: ['ambient', 'drone'] },
      };

      localStorage.setItem('aideo_library_source_choices', JSON.stringify({
        [`${track.format}:${track.path}`]: futurePayload,
      }));

      const applied = applySourcePreference(track);
      expect(applied.source_context).toBeDefined();
      expect(applied.source_context?.recording_id).toBe('rec_future');
    });
  });

  // Feature 39: 32-Source Durable Ceiling
  describe('Feature 39: 32-Source Durable Ceiling', () => {
    it('F39.3: cleanSourceContext preserves explicit choice even when sources are at 32 ceiling', () => {
      const sources: PlaybackSource[] = [];
      for (let i = 1; i <= 32; i++) {
        sources.push({
          provider: 'tidal',
          id: `tidal_track_${i}`,
        });
      }

      // Explicit source that wasn't in the initial 32
      const explicitSource: PlaybackSource = {
        provider: 'youtube',
        id: '12345678901',
      };

      const context: RecordingSources = {
        recording_id: 'rec_at_ceiling',
        sources,
        selection: { mode: 'explicit', source: explicitSource },
      };

      const cleaned = cleanSourceContext(context);
      expect(cleaned.sources.length).toBeLessThanOrEqual(32);
      expect(cleaned.selection.mode).toBe('explicit');
      if (cleaned.selection.mode === 'explicit') {
        expect(cleaned.selection.source.id).toBe('12345678901');
      }
      expect(cleaned.sources.some(s => s.id === '12345678901')).toBe(true);
    });
  });

  // Feature 40: Path-Only Legacy Entry Safety
  describe('Feature 40: Path-Only Legacy Entry Safety', () => {
    it('F40.3: legacy track without source_context is returned unmodified by applySourcePreference', () => {
      const legacyTrack = createTrack({ source_context: null });
      const result = applySourcePreference(legacyTrack);
      expect(result.source_context).toBeNull();
    });

    it('F40.4: legacy playlist entry without source_context skips library preferences', () => {
      const playlistTrack = createTrack({ playlist_entry_id: 77, source_context: null });
      localStorage.setItem('aideo_library_source_choices', JSON.stringify({
        [`${playlistTrack.format}:${playlistTrack.path}`]: {
          recording_id: 'rec_should_not_apply',
          sources: [{ provider: 'local', id: playlistTrack.path }],
          selection: { mode: 'auto' },
        },
      }));

      const result = applySourcePreference(playlistTrack);
      expect(result.source_context).toBeNull();
    });
  });

  // Feature 41: Audio Output & WASAPI Settings Safety
  describe('Feature 41: Audio Output Settings Safety', () => {
    it('F41.6: playing unified tracks never modifies WASAPI exclusive, bit-perfect, or sample rate settings', async () => {
      const track = groupRecordings([createTrack({ path: 'C:/Music/test.flac' })], '')[0];

      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'check_files_exist') return [true];
        return null;
      });

      await playUnifiedTrack(useStore.setState, useStore.getState, track);

      // Verify no audio output configuration commands were called
      expect(invoke).not.toHaveBeenCalledWith('toggle_exclusive_mode', expect.anything());
      expect(invoke).not.toHaveBeenCalledWith('toggle_bit_perfect_mode', expect.anything());
      expect(invoke).not.toHaveBeenCalledWith('set_output_device', expect.anything());
      expect(invoke).not.toHaveBeenCalledWith('set_device_sample_rate', expect.anything());
      expect(invoke).not.toHaveBeenCalledWith('set_dsp_state', expect.anything());
    });
  });
});
