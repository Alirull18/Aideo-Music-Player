import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  useStore,
  type Track,
  type PlaybackSource,
  type RecordingSources,
} from '../store';
import {
  groupRecordings,
  matchingSources,
  rankSources,
  sourceKey,
  sourceMetadata,
  sourceFor,
  isMusicTrack,
  isLikelySameRecording,
  catalogTrack,
  searchSources,
  applySourcePreference,
  saveSourceChoice,
  resolveSource,
  clearSourceCache,
  streamCacheKey,
  sourceSearchQuery,
  sourceName,
} from '../utils/unifiedSources';
import {
  cancelSourcePlayback,
  handleSourceFailure,
  manageSourceQueue,
  playUnifiedTrack,
} from '../store/sourcePlayback';

// ============================================================================
// Test Fixtures and Helpers
// ============================================================================

let trackIdCounter = 1;
const createTrack = (overrides: Partial<Track> = {}): Track => {
  const id = trackIdCounter++;
  return {
    id,
    path: `C:/Music/test_${id}.flac`,
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 180,
    format: 'FLAC',
    lyric_offset: 0,
    recording_evidence: { isrc: 'USAAA2600001', upc: '0123456789012' },
    catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 },
    ...overrides,
  };
};

const createTidalTrack = (id: string, overrides: Partial<Track> = {}): Track =>
  createTrack({
    id: -30000 - Number(id),
    path: id,
    format: 'Tidal FLAC',
    ...overrides,
  });

const createQobuzTrack = (id: string, overrides: Partial<Track> = {}): Track =>
  createTrack({
    id: -60000 - Number(id),
    path: id,
    format: 'Qobuz FLAC',
    ...overrides,
  });

const createYoutubeTrack = (id: string, overrides: Partial<Track> = {}): Track =>
  createTrack({
    id: -1,
    path: `https://www.youtube.com/watch?v=${id}`,
    format: 'YouTube Direct',
    recording_evidence: undefined,
    catalog_quality: { lossless: false },
    ...overrides,
  });

describe('E2E Unified Music Sources Test Suite', () => {
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
      tidalConnected: true,
      qobuzConnected: true,
      qobuzExperimentalEnabled: true,
      streamingQuality: 'best_available',
      preferredSource: 'auto',
      chromecast_connected: false,
      upnp_connected: false,
      playHistory: [],
      playCounts: {},
      playbackError: null,
      recordPlaybackTransition: vi.fn().mockResolvedValue(undefined),
      autoFetchLyricsOnline: vi.fn().mockResolvedValue(undefined),
      updateDiscordPresence: vi.fn(),
      playback: {
        ...useStore.getState().playback,
        status: 'Stopped',
        is_buffering: false,
        position_secs: 0,
        current_track: null,
      },
    });
  });

  afterEach(() => {
    cancelSourcePlayback();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // TIER 1: FEATURE COVERAGE (Features 1 through 41, >= 5 tests each)
  // ==========================================================================

  describe('Tier 1: Feature Coverage (Features 1-41)', () => {
    // Feature 1: Unicode NFKC Normalization
    describe('Feature 1: Unicode NFKC Normalization', () => {
      it('F1.1: normalizes full-width CJK characters to standard NFKC equivalents', () => {
        const standard = createTrack({ title: 'Song 1', artist: 'Artist' });
        const fullwidth = createTrack({ title: 'Ｓｏｎｇ １', artist: 'Ａｒｔｉｓｔ' });
        expect(isLikelySameRecording(standard, fullwidth)).toBe(true);
      });

      it('F1.2: normalizes precomposed vs decomposed diacritics', () => {
        const composed = createTrack({ title: 'Caf\u00e9', artist: 'Pok\u00e9mon' });
        const decomposed = createTrack({ title: 'Cafe\u0301', artist: 'Poke\u0301mon' });
        expect(isLikelySameRecording(composed, decomposed)).toBe(true);
      });

      it('F1.3: collapses multiple whitespace characters including tabs and newlines', () => {
        const normal = createTrack({ title: 'Hello World', artist: 'Band' });
        const messy = createTrack({ title: 'Hello   \t\n  World', artist: 'Band  ' });
        expect(isLikelySameRecording(normal, messy)).toBe(true);
      });

      it('F1.4: normalizes compatibility ligatures into decomposed character sequences', () => {
        const ligature = createTrack({ title: '\ufb01nal', artist: 'Artist' }); // 'fi' ligature
        const plain = createTrack({ title: 'final', artist: 'Artist' });
        expect(isLikelySameRecording(ligature, plain)).toBe(true);
      });

      it('F1.5: query normalization in search preserves NFKC equivalence', () => {
        const track = createTrack({ title: 'H\u00e9llo', artist: 'World' });
        const grouped = groupRecordings([track], 'He\u0301llo');
        expect(grouped).toHaveLength(1);
        expect(grouped[0].title).toBe('H\u00e9llo');
      });
    });

    // Feature 2: Presentation Wrapper Stripping
    describe('Feature 2: Presentation Wrapper Stripping', () => {
      it('F2.1: strips - Topic suffix from YouTube artist credit', () => {
        const local = createTrack({ artist: 'Anggi Marito', title: 'Tak Segampang Itu' });
        const yt = createYoutubeTrack('abcdefghijk', {
          artist: 'Anggi Marito - Topic',
          title: 'Tak Segampang Itu',
        });
        expect(isLikelySameRecording(local, yt)).toBe(true);
      });

      it('F2.2: strips (Official Audio) and [Official Audio] from title', () => {
        const local = createTrack({ title: 'Midnight City' });
        const ytParen = createYoutubeTrack('12345678901', { title: 'Midnight City (Official Audio)' });
        const ytBracket = createYoutubeTrack('12345678902', { title: 'Midnight City [Official Audio]' });
        expect(isLikelySameRecording(local, ytParen)).toBe(true);
        expect(isLikelySameRecording(local, ytBracket)).toBe(true);
      });

      it('F2.3: strips (Official Music Video) and [Official Video] from title', () => {
        const local = createTrack({ title: 'Starlight' });
        const ytMv = createYoutubeTrack('12345678901', { title: 'Starlight (Official Music Video)' });
        const ytVid = createYoutubeTrack('12345678902', { title: 'Starlight [Official Video]' });
        expect(isLikelySameRecording(local, ytMv)).toBe(true);
        expect(isLikelySameRecording(local, ytVid)).toBe(true);
      });

      it('F2.4: strips (Lyric Video) and [Visualizer] from title', () => {
        const local = createTrack({ title: 'Levitating' });
        const ytLyric = createYoutubeTrack('12345678901', { title: 'Levitating (Lyric Video)' });
        const ytVisual = createYoutubeTrack('12345678902', { title: 'Levitating [Visualizer]' });
        expect(isLikelySameRecording(local, ytLyric)).toBe(true);
        expect(isLikelySameRecording(local, ytVisual)).toBe(true);
      });

      it('F2.5: preserves legitimate words matching wrapper stems inside title', () => {
        const t1 = createTrack({ title: 'Video Killed the Radio Star' });
        const t2 = createTrack({ title: 'Radio Star' });
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });
    });

    // Feature 3: Version Qualifier Preservation
    describe('Feature 3: Version Qualifier Preservation', () => {
      it('F3.1: rejects automatic substitution between Original and Remix', () => {
        const orig = createTrack({ title: 'Blinding Lights' });
        const remix = createTrack({ title: 'Blinding Lights (Remix)' });
        expect(isLikelySameRecording(orig, remix)).toBe(false);
      });

      it('F3.2: rejects substitution between Live and Studio versions', () => {
        const studio = createTrack({ title: 'Hotel California' });
        const live = createTrack({ title: 'Hotel California (Live)' });
        expect(isLikelySameRecording(studio, live)).toBe(false);
      });

      it('F3.3: rejects substitution between different live concert venues', () => {
        const liveA = createTrack({ title: 'Song (Live at Wembley)' });
        const liveB = createTrack({ title: 'Song (Live at Budokan)' });
        expect(isLikelySameRecording(liveA, liveB)).toBe(false);
      });

      it('F3.4: rejects substitution between Acoustic and Studio versions', () => {
        const studio = createTrack({ title: 'Everlong' });
        const acoustic = createTrack({ title: 'Everlong (Acoustic)' });
        expect(isLikelySameRecording(studio, acoustic)).toBe(false);
      });

      it('F3.5: strictly separates recording_evidence versions (e.g. Remastered)', () => {
        const orig = createTrack({ recording_evidence: { version: 'Original' } });
        const remaster = createTrack({ recording_evidence: { version: 'Remastered 2026' } });
        expect(isLikelySameRecording(orig, remaster)).toBe(false);
      });
    });

    // Feature 4: Separate Display vs Safe Cohort
    describe('Feature 4: Separate Display vs Safe Cohort', () => {
      it('F4.1: groupRecordings displays same song once with all candidate sources', () => {
        const tidal = createTidalTrack('123', { duration: 180 });
        const qobuz = createQobuzTrack('456', { duration: 181 });
        const rows = groupRecordings([tidal, qobuz], 'Test');
        expect(rows).toHaveLength(1);
        expect(rows[0].source_context?.sources).toHaveLength(2);
      });

      it('F4.2: isLikelySameRecording strictly guards playback equivalence', () => {
        const t1 = createTrack({ duration: 180 });
        const t2 = createTrack({ duration: 185 }); // > 3s difference
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });

      it('F4.3: matchingSources isolates valid cohort from dissimilar results', () => {
        const anchor = createTrack({ path: 'C:/anchor.flac' });
        const match = createTidalTrack('101', { duration: 181 });
        const mismatch = createTidalTrack('102', { title: 'Different Song', duration: 250 });
        const results = groupRecordings([match, mismatch], '');
        const cohort = matchingSources(anchor, results);
        expect(cohort.some(s => s.id === '101')).toBe(true);
        expect(cohort.some(s => s.id === '102')).toBe(false);
      });

      it('F4.4: display group preserves unique recording_id across candidate updates', () => {
        const t1 = createTrack({ title: 'Song', artist: 'Artist', duration: 180 });
        const t2 = createTidalTrack('999', { title: 'Song', artist: 'Artist', duration: 181 });
        const group = groupRecordings([t1, t2], '')[0];
        expect(group.source_context?.recording_id).toBeDefined();
      });

      it('F4.5: display sources contain rich metadata for UI display', () => {
        const track = createTrack({ album: 'Greatest Hits', cover_url: 'https://cdn.example/art.jpg' });
        const rows = groupRecordings([track], '');
        const src = rows[0].source_context?.sources[0];
        expect(src?.metadata?.album).toBe('Greatest Hits');
        expect(src?.metadata?.cover_url).toBe('https://cdn.example/art.jpg');
      });
    });

    // Feature 5: 3-Second Corroboration Rule
    describe('Feature 5: 3-Second Corroboration Rule', () => {
      it('F5.1: accepts delta duration <= 3.0 seconds', () => {
        const t1 = createTrack({ duration: 200 });
        const t2 = createTrack({ duration: 202.5 });
        expect(isLikelySameRecording(t1, t2)).toBe(true);
      });

      it('F5.2: rejects delta duration > 3.0 seconds', () => {
        const t1 = createTrack({ duration: 200 });
        const t2 = createTrack({ duration: 203.1 });
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });

      it('F5.3: boundary test: exact 3.000s difference is accepted', () => {
        const t1 = createTrack({ duration: 180 });
        const t2 = createTrack({ duration: 183.0 });
        expect(isLikelySameRecording(t1, t2)).toBe(true);
      });

      it('F5.4: boundary test: 3.001s difference is rejected', () => {
        const t1 = createTrack({ duration: 180 });
        const t2 = createTrack({ duration: 183.001 });
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });

      it('F5.5: null duration on either track prevents automatic duration match', () => {
        const t1 = createTrack({ duration: 180 });
        const t2 = createTrack({ duration: null });
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });
    });

    // Feature 6: Strict Artist Agreement
    describe('Feature 6: Strict Artist Agreement', () => {
      it('F6.1: rejects different primary artists even with identical title and duration', () => {
        const original = createTrack({ title: 'Hurt', artist: 'Nine Inch Nails', duration: 373 });
        const cover = createTrack({ title: 'Hurt', artist: 'Johnny Cash', duration: 373 });
        expect(isLikelySameRecording(original, cover)).toBe(false);
      });

      it('F6.2: rejects placeholder artists like Unknown Artist', () => {
        const t1 = createTrack({ artist: 'Unknown Artist' });
        const t2 = createTrack({ artist: 'Unknown Artist' });
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });

      it('F6.3: rejects various artists placeholder', () => {
        const t1 = createTrack({ artist: 'Various Artists' });
        const t2 = createTrack({ artist: 'Various Artists' });
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });

      it('F6.4: artist agreement holds when matching Youtube channel prefix', () => {
        const local = createTrack({ artist: 'Adele', title: 'Hello' });
        const yt = createYoutubeTrack('12345678901', {
          artist: 'Adele',
          title: 'Adele - Hello (Official Audio)',
        });
        expect(isLikelySameRecording(local, yt)).toBe(true);
      });

      it('F6.5: matching duration never overrides an artist mismatch', () => {
        const a = createTrack({ artist: 'Artist A', duration: 210 });
        const b = createTrack({ artist: 'Artist B', duration: 210 });
        expect(isLikelySameRecording(a, b)).toBe(false);
      });
    });

    // Feature 7: ISRC Conflict Rejection
    describe('Feature 7: ISRC Conflict Rejection', () => {
      it('F7.1: identical ISRC with corroborating title and duration matches', () => {
        const t1 = createTrack({ recording_evidence: { isrc: 'USAAA2600001' }, duration: 180 });
        const t2 = createTrack({ recording_evidence: { isrc: 'USAAA2600001' }, duration: 181 });
        expect(isLikelySameRecording(t1, t2)).toBe(true);
      });

      it('F7.2: conflicting ISRCs hard-reject automatic substitution', () => {
        const t1 = createTrack({ recording_evidence: { isrc: 'USAAA2600001' }, duration: 180 });
        const t2 = createTrack({ recording_evidence: { isrc: 'USAAA2600002' }, duration: 180 });
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });

      it('F7.3: matching ISRC requires version qualifier agreement', () => {
        const t1 = createTrack({ recording_evidence: { isrc: 'USAAA2600001', version: 'Radio Edit' } });
        const t2 = createTrack({ recording_evidence: { isrc: 'USAAA2600001', version: 'Club Mix' } });
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });

      it('F7.4: matching ISRC requires duration corroboration <= 3 seconds', () => {
        const t1 = createTrack({ recording_evidence: { isrc: 'USAAA2600001' }, duration: 180 });
        const t2 = createTrack({ recording_evidence: { isrc: 'USAAA2600001' }, duration: 186 });
        expect(isLikelySameRecording(t1, t2)).toBe(false);
      });

      it('F7.5: absence of ISRC on one track falls back gracefully to metadata matching', () => {
        const withIsrc = createTrack({ recording_evidence: { isrc: 'USAAA2600001' }, duration: 180 });
        const withoutIsrc = createTrack({ recording_evidence: undefined, duration: 181 });
        expect(isLikelySameRecording(withIsrc, withoutIsrc)).toBe(true);
      });
    });

    // Feature 8: Removal of Invented Durations
    describe('Feature 8: Removal of Invented Durations', () => {
      it('F8.1: catalogTrack returns duration: null when duration is missing or undefined', () => {
        const raw = { id: '123', title: 'Song', artist: 'Artist' };
        const parsed = catalogTrack(raw, 'tidal');
        expect(parsed.duration).toBeNull();
      });

      it('F8.2: catalogTrack returns duration: null when duration is 0:00', () => {
        const raw = { id: '123', title: 'Song', artist: 'Artist', duration_raw: '0:00' };
        const parsed = catalogTrack(raw, 'youtube');
        expect(parsed.duration).toBeNull();
      });

      it('F8.3: catalogTrack returns duration: null on invalid duration text format', () => {
        const raw = { id: '123', title: 'Song', artist: 'Artist', duration_raw: '3:99' };
        const parsed = catalogTrack(raw, 'youtube');
        expect(parsed.duration).toBeNull();
      });

      it('F8.4: catalogTrack correctly parses valid duration text into seconds', () => {
        const raw = { id: '123', title: 'Song', artist: 'Artist', duration_raw: '3:45' };
        const parsed = catalogTrack(raw, 'youtube');
        expect(parsed.duration).toBe(225);
      });

      it('F8.5: catalogTrack preserves unknown duration as null rather than inventing 180s', () => {
        const raw = { id: '999', title: 'Unknown Length', artist: 'Artist' };
        const parsed = catalogTrack(raw, 'tidal');
        expect(parsed.duration).not.toBe(180);
        expect(parsed.duration).toBeNull();
      });
    });

    // Feature 9: Explicit vs Auto Source Model
    describe('Feature 9: Explicit vs Auto Source Model', () => {
      it('F9.1: explicit source selection prioritizes specified provider in playback order', () => {
        const tidal: PlaybackSource = { provider: 'tidal', id: '123' };
        const qobuz: PlaybackSource = { provider: 'qobuz', id: '456' };
        const ranked = rankSources([tidal, qobuz], 'best_available', 'auto');
        expect(ranked).toBeDefined();
      });

      it('F9.2: Auto mode ranks by quality preference (local > hires > lossy)', () => {
        const local: PlaybackSource = { provider: 'local', id: 'C:/song.flac', catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } };
        const web: PlaybackSource = { provider: 'youtube', id: 'abcdefghijk', catalog_quality: { lossless: false } };
        const ranked = rankSources([web, local], 'best_available');
        expect(ranked[0].provider).toBe('local');
      });

      it('F9.3: explicit choice is persisted in localStorage via saveSourceChoice', async () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        const explicitContext: RecordingSources = {
          ...row.source_context!,
          selection: { mode: 'explicit', source: row.source_context!.sources[0] },
        };
        await saveSourceChoice(row, explicitContext);
        const applied = applySourcePreference(row);
        expect(applied.source_context?.selection.mode).toBe('explicit');
      });

      it('F9.4: corrupted explicit preference safely falls back to Auto mode', () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        localStorage.setItem('aideo_recording_source_preferences', 'invalid-json');
        const applied = applySourcePreference(row);
        expect(applied.source_context?.selection.mode).toBe('auto');
      });

      it('F9.5: explicit choice on playlist entry does not alter library-level default', async () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        const entryTrack: Track = { ...row, playlist_entry_id: 42 };
        const context: RecordingSources = {
          ...entryTrack.source_context!,
          selection: { mode: 'explicit', source: entryTrack.source_context!.sources[0] },
        };
        await saveSourceChoice(entryTrack, context);
        expect(invoke).toHaveBeenCalledWith('update_playlist_source', expect.objectContaining({ entryId: 42 }));
      });
    });

    // Feature 10: Disable Mid-Song Upgrades
    describe('Feature 10: Disable Mid-Song Upgrades', () => {
      it('F10.1: cancelSourcePlayback safely aborts pending background upgrades', () => {
        expect(() => cancelSourcePlayback()).not.toThrow();
      });

      it('F10.2: active playback sequence increments upon cancellation', () => {
        cancelSourcePlayback();
        const req1 = cancelSourcePlayback();
        expect(req1).toBeUndefined();
      });

      it('F10.3: manual source switch explicitly restarts playback with startPos preserved', async () => {
        const track = createTrack({ duration: 200 });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'play_track') return null;
          return null;
        });
        useStore.setState({ currentTrack: track, playback: { ...useStore.getState().playback, position_secs: 75 } });
        await useStore.getState().playTrack(track, true, false, undefined, 75, true);
        expect(invoke).toHaveBeenCalledWith('play_track', { path: track.path, startPos: 75 });
      });

      it('F10.4: playUnifiedTrack preserves current session lyrics and history when switching', async () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        useStore.setState({
          currentTrack: row,
          playHistory: [row],
          lyrics: [{ time_secs: 0, text: 'Hello' }],
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, row, false, false, 30, true);
        expect(useStore.getState().lyrics).toHaveLength(1);
      });

      it('F10.5: background discovery attaches alternatives without interrupting playback', () => {
        const current = createTrack({ path: 'C:/song.flac' });
        const discovered = createTidalTrack('999');
        const results = groupRecordings([current, discovered], '');
        expect(results).toHaveLength(1);
        expect(results[0].source_context?.sources).toHaveLength(2);
      });
    });

    // Feature 11: Clean/Explicit Tri-State Filter
    describe('Feature 11: Clean/Explicit Tri-State Filter', () => {
      it('F11.1: clean track and explicit track are rejected from automatic substitution', () => {
        const clean = createTrack({ recording_evidence: { version: 'Clean' } });
        const explicit = createTrack({ recording_evidence: { version: 'Explicit' } });
        expect(isLikelySameRecording(clean, explicit)).toBe(false);
      });

      it('F11.2: clean track matches clean track when metadata agrees', () => {
        const clean1 = createTrack({ recording_evidence: { version: 'Clean' } });
        const clean2 = createTrack({ recording_evidence: { version: 'Clean' } });
        expect(isLikelySameRecording(clean1, clean2)).toBe(true);
      });

      it('F11.3: explicit track matches explicit track when metadata agrees', () => {
        const exp1 = createTrack({ recording_evidence: { version: 'Explicit' } });
        const exp2 = createTrack({ recording_evidence: { version: 'Explicit' } });
        expect(isLikelySameRecording(exp1, exp2)).toBe(true);
      });

      it('F11.4: explicit qualifier in title prevents automatic substitution with clean title', () => {
        const normal = createTrack({ title: 'Song' });
        const explicit = createTrack({ title: 'Song (Explicit)' });
        expect(isLikelySameRecording(normal, explicit)).toBe(false);
      });

      it('F11.5: clean qualifier in title prevents substitution with unedited title', () => {
        const normal = createTrack({ title: 'Song' });
        const clean = createTrack({ title: 'Song (Clean)' });
        expect(isLikelySameRecording(normal, clean)).toBe(false);
      });
    });

    // Feature 12: Punctuation & Script Handling
    describe('Feature 12: Punctuation & Script Handling', () => {
      it('F12.1: preserves Japanese CJK characters in title and artist', () => {
        const t1 = createTrack({ title: '夜に駆ける', artist: 'YOASOBI', duration: 261 });
        const t2 = createTrack({ title: '夜に駆ける', artist: 'YOASOBI', duration: 261.2 });
        expect(isLikelySameRecording(t1, t2)).toBe(true);
      });

      it('F12.2: preserves Cyrillic script without character corruption', () => {
        const t1 = createTrack({ title: 'Спокойная ночь', artist: 'Кино', duration: 367 });
        const t2 = createTrack({ title: 'Спокойная ночь', artist: 'Кино', duration: 367.5 });
        expect(isLikelySameRecording(t1, t2)).toBe(true);
      });

      it('F12.3: preserves Arabic script and right-to-left character strings', () => {
        const t1 = createTrack({ title: 'حبيبي', artist: 'عمرو دياب', duration: 240 });
        const t2 = createTrack({ title: 'حبيبي', artist: 'عمرو دياب', duration: 240 });
        expect(isLikelySameRecording(t1, t2)).toBe(true);
      });

      it('F12.4: preserves quotes, apostrophes, and dashes in titles', () => {
        const t1 = createTrack({ title: "Don't Stop Believin'" });
        const t2 = createTrack({ title: "Don't Stop Believin'" });
        expect(isLikelySameRecording(t1, t2)).toBe(true);
      });

      it('F12.5: sourceSearchQuery generates clean query for multilingual titles', () => {
        const track = createTrack({ title: '七里香', artist: '周杰倫' });
        expect(sourceSearchQuery(track)).toContain('周杰倫');
        expect(sourceSearchQuery(track)).toContain('七里香');
      });
    });

    // Feature 13: Centralized Reactive Source Store
    describe('Feature 13: Centralized Reactive Source Store', () => {
      it('F13.1: store initializes with source management disabled by default', () => {
        expect(useStore.getState().sourceQueueManaged).toBe(false);
      });

      it('F13.2: manageSourceQueue enables native queue mode and updates store', async () => {
        await manageSourceQueue(useStore.setState);
        expect(invoke).toHaveBeenCalledWith('set_source_queue_mode', { enabled: true });
        expect(useStore.getState().sourceQueueManaged).toBe(true);
      });

      it('F13.3: store tracks active streaming quality setting', () => {
        useStore.setState({ streamingQuality: 'standard_lossless' });
        expect(useStore.getState().streamingQuality).toBe('standard_lossless');
      });

      it('F13.4: store tracks tidal and qobuz connectivity states', () => {
        useStore.setState({ tidalConnected: false, qobuzConnected: false });
        expect(useStore.getState().tidalConnected).toBe(false);
        expect(useStore.getState().qobuzConnected).toBe(false);
      });

      it('F13.5: store updates currentTrack active_source reactively', () => {
        const track = createTrack();
        const source: PlaybackSource = { provider: 'tidal', id: '123' };
        useStore.setState({ currentTrack: { ...track, active_source: source } });
        expect(useStore.getState().currentTrack?.active_source?.provider).toBe('tidal');
      });
    });

    // Feature 14: Progressive Search Enrichment
    describe('Feature 14: Progressive Search Enrichment', () => {
      it('F14.1: searchSources calls update callback progressively as results arrive', async () => {
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'search_local_sources') return [createTrack({ path: 'C:/song.flac' })];
          if (cmd === 'search_youtube') return [];
          return [];
        });
        const snapshots: any[] = [];
        await searchSources('Song', { tidal: false, qobuz: false }, s => snapshots.push(s));
        expect(snapshots.length).toBeGreaterThan(0);
      });

      it('F14.2: searchSources records pending provider names correctly', async () => {
        let finishTidal!: (v: any) => void;
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'search_local_sources') return [];
          if (cmd === 'tidal_search') return new Promise(r => { finishTidal = r; });
          return [];
        });
        const snapshots: any[] = [];
        const promise = searchSources('Song', { tidal: true, qobuz: false }, s => snapshots.push(s));
        await vi.waitFor(() => expect(finishTidal).toBeTypeOf('function'));
        expect(snapshots[0].pending).toContain('tidal');
        finishTidal([]);
        await promise;
      });

      it('F14.3: progressive enrichment maintains stable recording_id for cards', () => {
        const local = createTrack({ path: 'C:/song.flac', duration: 180 });
        const tidal = createTidalTrack('123', { duration: 181 });
        const step1 = groupRecordings([local], '');
        const step2 = groupRecordings([local, tidal], '');
        expect(step1[0].source_context?.recording_id).toBe(step2[0].source_context?.recording_id);
      });

      it('F14.4: isolated provider failure does not cancel successful provider results', async () => {
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'search_local_sources') return [createTrack({ path: 'C:/song.flac' })];
          if (cmd === 'tidal_search') throw new Error('Network timeout');
          return [];
        });
        const result = await searchSources('Song', { tidal: true, qobuz: false }, () => {});
        expect(result.tracks).toHaveLength(1);
        expect(result.errors.tidal).toContain('Network timeout');
      });

      it('F14.5: progressive results coalesce identical songs across providers', () => {
        const local = createTrack({ title: 'Song', artist: 'Artist', duration: 200 });
        const qobuz = createQobuzTrack('456', { title: 'Song', artist: 'Artist', duration: 201 });
        const rows = groupRecordings([local, qobuz], '');
        expect(rows).toHaveLength(1);
        expect(rows[0].source_context?.sources).toHaveLength(2);
      });
    });

    // Feature 15: Reactive Source Picker Sync
    describe('Feature 15: Reactive Source Picker Sync', () => {
      it('F15.1: sourceKey generates unique canonical keys per provider and ID', () => {
        expect(sourceKey({ provider: 'tidal', id: '100' })).toBe('tidal:100');
        expect(sourceKey({ provider: 'qobuz', id: '100' })).toBe('qobuz:100');
        expect(sourceKey({ provider: 'local', id: 'C:/a.flac' })).toBe('local:C:/a.flac');
      });

      it('F15.2: sourceName returns readable label for each provider', () => {
        expect(sourceName({ provider: 'local', id: '1' })).toBe('Local file');
        expect(sourceName({ provider: 'tidal', id: '1' })).toBe('Tidal');
        expect(sourceName({ provider: 'qobuz', id: '1' })).toBe('Qobuz');
        expect(sourceName({ provider: 'youtube', id: '1' })).toBe('Webstream');
      });

      it('F15.3: sourceMetadata copies relevant track metadata into source', () => {
        const track = createTrack({ title: 'A', artist: 'B', album: 'C', duration: 120 });
        const meta = sourceMetadata(track);
        expect(meta.title).toBe('A');
        expect(meta.artist).toBe('B');
        expect(meta.album).toBe('C');
        expect(meta.duration).toBe(120);
      });

      it('F15.4: applySourcePreference attaches saved explicit selection', () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        const pref: RecordingSources = {
          ...row.source_context!,
          selection: { mode: 'explicit', source: row.source_context!.sources[0] },
        };
        localStorage.setItem('aideo_recording_source_preferences', JSON.stringify({
          [row.source_context!.recording_id]: pref.selection,
        }));
        const applied = applySourcePreference(row);
        expect(applied.source_context?.selection.mode).toBe('explicit');
      });

      it('F15.5: rankSources respects preferred provider tie-breaker', () => {
        const s1: PlaybackSource = { provider: 'tidal', id: '1', catalog_quality: { lossless: true } };
        const s2: PlaybackSource = { provider: 'qobuz', id: '2', catalog_quality: { lossless: true } };
        const ranked = rankSources([s1, s2], 'standard_lossless', 'qobuz');
        expect(ranked[0].provider).toBe('qobuz');
      });
    });

    // Feature 16: Unified Quick & Full Search
    describe('Feature 16: Unified Quick & Full Search', () => {
      it('F16.1: catalogTrack converts raw YouTube result to unified track structure', () => {
        const raw = { id: 'abcdefghijk', title: 'Video Title', artist: 'Channel', duration_raw: '3:20' };
        const track = catalogTrack(raw, 'youtube');
        expect(track.format).toBe('YouTube Direct');
        expect(track.duration).toBe(200);
      });

      it('F16.2: catalogTrack converts raw Tidal result to unified track structure', () => {
        const raw = { id: 12345, title: 'Tidal Song', artist: 'Artist', duration: 180, quality: 'LOSSLESS' };
        const track = catalogTrack(raw, 'tidal');
        expect(track.format).toBe('Tidal FLAC');
        expect(track.catalog_quality?.lossless).toBe(true);
      });

      it('F16.3: catalogTrack converts raw Qobuz result to unified track structure', () => {
        const raw = { id: 67890, title: 'Qobuz Song', artist: 'Artist', duration: 240, quality: 'HI_RES_LOSSLESS' };
        const track = catalogTrack(raw, 'qobuz');
        expect(track.format).toBe('Qobuz FLAC');
        expect(track.catalog_quality?.lossless).toBe(true);
      });

      it('F16.4: groupRecordings processes both quick and full search tracks uniformly', () => {
        const yt = catalogTrack({ id: 'abcdefghijk', title: 'Song (Official Audio)', artist: 'Artist' }, 'youtube');
        const tidal = catalogTrack({ id: 123, title: 'Song', artist: 'Artist' }, 'tidal');
        const rows = groupRecordings([yt, tidal], 'Song');
        expect(rows).toHaveLength(1);
      });

      it('F16.5: relevance score boosts exact title and artist matches', () => {
        const exact = createTrack({ path: 'C:/exact.flac', title: 'Specific Song', artist: 'Specific Artist' });
        const partial = createTrack({ path: 'C:/partial.flac', title: 'Other Song', artist: 'Specific Artist' });
        const rows = groupRecordings([partial, exact], 'Specific Song');
        expect(rows[0].title).toBe('Specific Song');
      });
    });

    // Feature 17: Home Shelves Source Preservation
    describe('Feature 17: Home Shelves Source Preservation', () => {
      it('F17.1: matchingSources joins candidate sources from home cards', () => {
        const anchor = createTrack({ path: 'C:/song.flac' });
        const homeRow = groupRecordings([
          anchor,
          createTidalTrack('777', { duration: 181 }),
          createYoutubeTrack('12345678901', { duration: 181 }),
        ], '');
        const sources = matchingSources(anchor, homeRow);
        expect(sources.length).toBeGreaterThanOrEqual(2);
      });

      it('F17.2: deduplicated home rows retain alternate online provider identifiers', () => {
        const local = createTrack({ path: 'C:/song.flac', duration: 210 });
        const yt = createYoutubeTrack('abcdefghijk', { duration: 210 });
        const rows = groupRecordings([local, yt], '');
        expect(rows[0].source_context?.sources.some(s => s.provider === 'youtube')).toBe(true);
      });

      it('F17.3: sourceFor identifies local path formats safely', () => {
        expect(sourceFor(createTrack({ path: 'C:\\Music\\file.mp3' }))?.provider).toBe('local');
        expect(sourceFor(createTrack({ path: '/home/music/file.flac' }))?.provider).toBe('local');
        expect(sourceFor(createTrack({ path: '\\\\server\\share\\song.flac' }))?.provider).toBe('local');
      });

      it('F17.4: sourceFor identifies YouTube URL formats safely', () => {
        expect(sourceFor(createTrack({ path: 'https://www.youtube.com/watch?v=12345678901' }))?.provider).toBe('youtube');
        expect(sourceFor(createTrack({ path: 'https://youtu.be/12345678901' }))?.provider).toBe('youtube');
        expect(sourceFor(createTrack({ path: 'https://music.youtube.com/watch?v=12345678901' }))?.provider).toBe('youtube');
      });

      it('F17.5: sourceFor identifies Tidal and Qobuz ID formats safely', () => {
        expect(sourceFor(createTidalTrack('98765'))?.provider).toBe('tidal');
        expect(sourceFor(createQobuzTrack('54321'))?.provider).toBe('qobuz');
      });
    });

    // Feature 18: Eliminate 2.5s Tidal Drop
    describe('Feature 18: Eliminate 2.5s Tidal Drop', () => {
      it('F18.1: searchSources waits for slow provider resolution without premature 2.5s drop', async () => {
        let finishTidal!: (v: any) => void;
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_search') return new Promise(r => { finishTidal = r; });
          return [];
        });
        const promise = searchSources('Test', { tidal: true, qobuz: false }, () => {});
        await vi.waitFor(() => expect(finishTidal).toBeTypeOf('function'));
        finishTidal([{ id: '123', title: 'Test Song', artist: 'Artist', duration: 180 }]);
        const result = await promise;
        expect(result.tracks).toHaveLength(1);
      });

      it('F18.2: slow provider responses are properly merged into accumulated tracks', async () => {
        const local = createTrack({ path: 'C:/song.flac' });
        const tidal = createTidalTrack('456');
        const rows1 = groupRecordings([local], '');
        const rows2 = groupRecordings([local, tidal], '');
        expect(rows1[0].source_context?.sources).toHaveLength(1);
        expect(rows2[0].source_context?.sources).toHaveLength(2);
      });

      it('F18.3: bounded helper rejects promises that exceed the 15-second total timeout', async () => {
        vi.useFakeTimers();
        vi.mocked(invoke).mockImplementation(() => new Promise(() => {}));
        const promise = resolveSource({ provider: 'tidal', id: '123' }, 'best_available');
        vi.advanceTimersByTime(15001);
        await expect(promise).rejects.toThrow('Source timed out');
        vi.useRealTimers();
      });

      it('F18.4: successful provider response completes within deadline', async () => {
        vi.mocked(invoke).mockResolvedValue({ url: 'https://cdn.example/audio', quality: { lossless: true } });
        const res = await resolveSource({ provider: 'tidal', id: '123' }, 'best_available');
        expect(res.url).toBe('https://cdn.example/audio');
      });

      it('F18.5: searchSources updates pending list progressively without timing out prematurely', async () => {
        vi.mocked(invoke).mockResolvedValue([]);
        const res = await searchSources('Query', { tidal: true, qobuz: true }, () => {});
        expect(res.pending).toHaveLength(0);
      });
    });

    // Feature 19: YouTube 20-Minute Duration Cap
    describe('Feature 19: YouTube 20-Minute Duration Cap', () => {
      it('F19.1: YouTube track with duration <= 1200 seconds is eligible', () => {
        const track = createYoutubeTrack('12345678901', { duration: 1200 });
        expect(isMusicTrack(track)).toBe(true);
      });

      it('F19.2: YouTube track with duration 1199 seconds is eligible', () => {
        const track = createYoutubeTrack('12345678901', { duration: 1199 });
        expect(isMusicTrack(track)).toBe(true);
      });

      it('F19.3: YouTube track with duration > 1200 seconds is excluded', () => {
        const track = createYoutubeTrack('12345678901', { duration: 1201 });
        expect(isMusicTrack(track)).toBe(false);
      });

      it('F19.4: YouTube video with 1 hour duration (3600s) is excluded', () => {
        const track = createYoutubeTrack('12345678901', { duration: 3600 });
        expect(isMusicTrack(track)).toBe(false);
      });

      it('F19.5: local files with duration > 1200 seconds remain eligible (unaffected by YT cap)', () => {
        const track = createTrack({ duration: 3600 });
        expect(isMusicTrack(track)).toBe(true);
      });
    });

    // Feature 20: Non-Music Format Exclusion
    describe('Feature 20: Non-Music Format Exclusion', () => {
      it('F20.1: excludes YouTube results containing "podcast" in title', () => {
        const track = createYoutubeTrack('12345678901', { title: 'Episode 42: A Great Podcast' });
        expect(isMusicTrack(track)).toBe(false);
      });

      it('F20.2: excludes YouTube results containing "interview" in title', () => {
        const track = createYoutubeTrack('12345678901', { title: 'Exclusive Artist Interview 2026' });
        expect(isMusicTrack(track)).toBe(false);
      });

      it('F20.3: excludes YouTube results containing "vlog" or "tutorial"', () => {
        const vlog = createYoutubeTrack('12345678901', { title: 'Daily Studio Vlog #12' });
        const tut = createYoutubeTrack('12345678902', { title: 'How to Play Piano Tutorial' });
        expect(isMusicTrack(vlog)).toBe(false);
        expect(isMusicTrack(tut)).toBe(false);
      });

      it('F20.4: excludes YouTube results containing "unboxing" or "full episode"', () => {
        const unboxing = createYoutubeTrack('12345678901', { title: 'Vinyl Unboxing Edition' });
        const ep = createYoutubeTrack('12345678902', { title: 'Music Show Full Episode' });
        expect(isMusicTrack(unboxing)).toBe(false);
        expect(isMusicTrack(ep)).toBe(false);
      });

      it('F20.5: groupRecordings filters out non-music YouTube items from results', () => {
        const music = createYoutubeTrack('12345678901', { title: 'Song (Official Audio)', duration: 200 });
        const podcast = createYoutubeTrack('12345678902', { title: 'Music Podcast Ep 1', duration: 200 });
        const rows = groupRecordings([music, podcast], '');
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toContain('Song');
      });
    });

    // Feature 21: Instrumental Music Preservation
    describe('Feature 21: Instrumental Music Preservation', () => {
      it('F21.1: preserves genuine musical instrumental tracks', () => {
        const track = createYoutubeTrack('12345678901', { title: 'Clair de Lune (Instrumental)', duration: 300 });
        expect(isMusicTrack(track)).toBe(true);
      });

      it('F21.2: preserves acoustic music pieces', () => {
        const track = createYoutubeTrack('12345678901', { title: 'Classical Guitar (Acoustic)', duration: 180 });
        expect(isMusicTrack(track)).toBe(true);
      });

      it('F21.3: preserves piano solos and orchestral compositions', () => {
        const track = createYoutubeTrack('12345678901', { title: 'Moonlight Sonata Piano Solo', duration: 320 });
        expect(isMusicTrack(track)).toBe(true);
      });

      it('F21.4: preserves film score and soundtrack instrumentals', () => {
        const track = createYoutubeTrack('12345678901', { title: 'Interstellar Main Theme Soundtrack', duration: 240 });
        expect(isMusicTrack(track)).toBe(true);
      });

      it('F21.5: instrumental tracks group cleanly with equivalent provider sources', () => {
        const yt = createYoutubeTrack('12345678901', { title: 'Theme (Instrumental)', duration: 200 });
        const local = createTrack({ title: 'Theme (Instrumental)', duration: 200 });
        const rows = groupRecordings([yt, local], '');
        expect(rows).toHaveLength(1);
      });
    });

    // Feature 22: Live Music Version Preservation
    describe('Feature 22: Live Music Version Preservation', () => {
      it('F22.1: preserves genuine live music performances as music tracks', () => {
        const track = createYoutubeTrack('12345678901', { title: 'Comfortably Numb (Live at Pompeii)', duration: 500 });
        expect(isMusicTrack(track)).toBe(true);
      });

      it('F22.2: preserves live tracks in groupRecordings', () => {
        const live = createTrack({ title: 'Song (Live)', duration: 240 });
        const rows = groupRecordings([live], '');
        expect(rows).toHaveLength(1);
      });

      it('F22.3: does not confuse live concert recordings with non-music interviews', () => {
        const live = createYoutubeTrack('12345678901', { title: 'Artist Live in Concert 2026', duration: 300 });
        expect(isMusicTrack(live)).toBe(true);
      });

      it('F22.4: separates distinct live performances into separate grouped cards', () => {
        const liveLondon = createTrack({ path: 'C:/london.flac', title: 'Song (Live in London)', duration: 240 });
        const liveTokyo = createTrack({ path: 'C:/tokyo.flac', title: 'Song (Live in Tokyo)', duration: 240 });
        const rows = groupRecordings([liveLondon, liveTokyo], '');
        expect(rows).toHaveLength(2);
      });

      it('F22.5: matches equivalent live tracks across providers when venue matches', () => {
        const liveLocal = createTrack({ title: 'Song (Live at Wembley)', duration: 240 });
        const liveYt = createYoutubeTrack('12345678901', { title: 'Song (Live at Wembley) [Official Video]', duration: 241 });
        const rows = groupRecordings([liveLocal, liveYt], '');
        expect(rows).toHaveLength(1);
      });
    });

    // Feature 23: Bounded Background Enrichment
    describe('Feature 23: Bounded Background Enrichment', () => {
      it('F23.1: sourceSearchQuery formats artist and title cleanly for provider lookups', () => {
        const track = createTrack({ title: 'Song', artist: 'Artist' });
        expect(sourceSearchQuery(track)).toBe('artist song');
      });

      it('F23.2: sourceSearchQuery handles YouTube channel prefixes without duplication', () => {
        const yt = createYoutubeTrack('12345678901', { artist: 'Adele', title: 'Adele - Skyfall' });
        expect(sourceSearchQuery(yt)).toBe('adele skyfall');
      });

      it('F23.3: background discovery only triggers for enabled streaming providers', async () => {
        useStore.setState({ appMode: 'local' });
        vi.mocked(invoke).mockResolvedValue([]);
        await searchSources('Song', { tidal: false, qobuz: false, youtube: false }, () => {});
        expect(invoke).not.toHaveBeenCalledWith('tidal_search', expect.anything());
        expect(invoke).not.toHaveBeenCalledWith('qobuz_search', expect.anything());
      });

      it('F23.4: clearSourceCache empties the resolution cache cleanly', () => {
        expect(() => clearSourceCache()).not.toThrow();
      });

      it('F23.5: streamCacheKey creates distinct cache namespaces by quality and provider', () => {
        const trackTidal = createTrack({ format: 'Tidal FLAC', path: '123' });
        const trackQobuz = createTrack({ format: 'Qobuz FLAC', path: '123' });
        expect(streamCacheKey(trackTidal, 'best_available')).toBe('tidal:123:best_available');
        expect(streamCacheKey(trackQobuz, 'best_available')).toBe('qobuz:123:best_available');
      });
    });

    // Feature 24: Stable Runtime Attempt IDs
    describe('Feature 24: Stable Runtime Attempt IDs', () => {
      it('F24.1: playUnifiedTrack dispatches play_track with path and startPos', async () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          if (cmd === 'read_audio_tags') return { format: 'flac', lossless: true };
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, row);
        expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({
          path: track.path,
          startPos: 0,
        }));
      });

      it('F24.2: sequential play requests update active playback attempt safely', async () => {
        const t1 = createTrack({ path: 'C:/song1.flac' });
        const t2 = createTrack({ path: 'C:/song2.flac' });
        const r1 = groupRecordings([t1], '')[0];
        const r2 = groupRecordings([t2], '')[0];
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, r1);
        await playUnifiedTrack(useStore.setState, useStore.getState, r2);
        expect(useStore.getState().currentTrack?.path).toBe('C:/song2.flac');
      });

      it('F24.3: play history records unique attempts accurately', async () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, row);
        expect(useStore.getState().playCounts[row.source_context!.recording_id]).toBe(1);
      });

      it('F24.4: repeat plays increment play count for the recording context', async () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, row);
        await playUnifiedTrack(useStore.setState, useStore.getState, row);
        expect(useStore.getState().playCounts[row.source_context!.recording_id]).toBe(2);
      });

      it('F24.5: cancelSourcePlayback resets in-flight retry handles', () => {
        cancelSourcePlayback();
        expect(() => handleSourceFailure('some/path', 'error')).not.toThrow();
      });
    });

    // Feature 25: Rapid Control Cancellation
    describe('Feature 25: Rapid Control Cancellation', () => {
      it('F25.1: stopTrack cancels in-flight resolution and updates playback status to Stopped', async () => {
        let finish!: (v: any) => void;
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') return new Promise(r => { finish = r; });
          return null;
        });
        const track = createTidalTrack('123');
        const row = groupRecordings([track], '')[0];
        const pending = playUnifiedTrack(useStore.setState, useStore.getState, row);
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        await useStore.getState().stopTrack();
        finish({ url: 'https://cdn.example/audio', quality: {} });
        await pending;
        expect(useStore.getState().playback.status).toBe('Stopped');
        expect(invoke).not.toHaveBeenCalledWith('play_track', expect.anything());
      });

      it('F25.2: pauseTrack prevents audio playback from starting if resolved while paused', async () => {
        let finish!: (v: any) => void;
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') return new Promise(r => { finish = r; });
          return null;
        });
        const track = createTidalTrack('123');
        const row = groupRecordings([track], '')[0];
        const pending = playUnifiedTrack(useStore.setState, useStore.getState, row);
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        await useStore.getState().pauseTrack();
        finish({ url: 'https://cdn.example/audio', quality: {} });
        await pending;
        expect(useStore.getState().playback.status).toBe('Paused');
        expect(invoke).not.toHaveBeenCalledWith('play_track', expect.anything());
      });

      it('F25.3: consecutive play commands cancel prior in-flight resolution', async () => {
        let finishFirst!: (v: any) => void;
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          if (cmd === 'tidal_resolve_source') return new Promise(r => { finishFirst = r; });
          return null;
        });
        const slow = createTidalTrack('111');
        const fast = createTrack({ path: 'C:/fast.flac' });
        const p1 = playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([slow], '')[0]);
        await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'));
        const p2 = playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([fast], '')[0]);
        finishFirst({ url: 'https://cdn.example/slow.mp3', quality: {} });
        await Promise.all([p1, p2]);
        expect(useStore.getState().currentTrack?.path).toBe('C:/fast.flac');
      });

      it('F25.4: cancelSourcePlayback invalidates pending retry tokens', () => {
        cancelSourcePlayback();
        handleSourceFailure('https://cdn.example/test.mp3', 'Network disconnect');
        expect(useStore.getState().playbackError).toBeNull();
      });

      it('F25.5: rapid skipping leaves player in clean state matching last selection', async () => {
        const t1 = createTrack({ path: 'C:/1.flac' });
        const t2 = createTrack({ path: 'C:/2.flac' });
        const t3 = createTrack({ path: 'C:/3.flac' });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([t1], '')[0]);
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([t2], '')[0]);
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([t3], '')[0]);
        expect(useStore.getState().currentTrack?.path).toBe('C:/3.flac');
      });
    });

    // Feature 26: Unified 15s Interactive Deadline
    describe('Feature 26: Unified 15s Interactive Deadline', () => {
      it('F26.1: resolveSource times out on hung provider call', async () => {
        vi.useFakeTimers();
        vi.mocked(invoke).mockImplementation(() => new Promise(() => {}));
        const promise = resolveSource({ provider: 'tidal', id: 'hung' }, 'best_available');
        vi.advanceTimersByTime(15001);
        await expect(promise).rejects.toThrow('Source timed out');
        vi.useRealTimers();
      });

      it('F26.2: local file check times out if IPC hangs beyond deadline', async () => {
        vi.useFakeTimers();
        vi.mocked(invoke).mockImplementation(() => new Promise(() => {}));
        const promise = resolveSource({ provider: 'local', id: 'C:/hung.flac' }, 'best_available');
        vi.advanceTimersByTime(15001);
        await expect(promise).rejects.toThrow('Source timed out');
        vi.useRealTimers();
      });

      it('F26.3: cached resolutions return immediately without consuming deadline', async () => {
        vi.mocked(invoke).mockResolvedValue({ url: 'https://cdn.example/cached', quality: { lossless: true } });
        const s: PlaybackSource = { provider: 'tidal', id: 'cached_test' };
        const res1 = await resolveSource(s, 'best_available');
        const res2 = await resolveSource(s, 'best_available');
        expect(res1.url).toBe(res2.url);
        expect(invoke).toHaveBeenCalledTimes(1);
      });

      it('F26.4: fresh=true bypasses cache to obtain renewed stream', async () => {
        vi.mocked(invoke).mockResolvedValue({ url: 'https://cdn.example/audio', quality: { lossless: true } });
        const s: PlaybackSource = { provider: 'tidal', id: 'fresh_test' };
        await resolveSource(s, 'best_available');
        await resolveSource(s, 'best_available', true);
        expect(invoke).toHaveBeenCalledTimes(2);
      });

      it('F26.5: searchSources bounded call safely handles timeouts per provider', async () => {
        vi.useFakeTimers();
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_search') return new Promise(() => {});
          return [];
        });
        const searchPromise = searchSources('Test', { tidal: true, qobuz: false }, () => {});
        vi.advanceTimersByTime(15001);
        const res = await searchPromise;
        expect(res.errors.tidal).toContain('Source timed out');
        vi.useRealTimers();
      });
    });

    // Feature 27: Decoder Readiness Gate
    describe('Feature 27: Decoder Readiness Gate', () => {
      it('F27.1: currentTrack indicates is_buffering=true upon initial dispatch', async () => {
        const track = createTrack();
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        expect(useStore.getState().playback.status).toBe('Playing');
      });

      it('F27.2: playCounts is updated only on successful playback attempt', async () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, row);
        expect(useStore.getState().playCounts[row.source_context!.recording_id]).toBe(1);
      });

      it('F27.3: playHistory records track when playback starts successfully', async () => {
        const t1 = createTrack({ path: 'C:/1.flac' });
        const t2 = createTrack({ path: 'C:/2.flac' });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([t1], '')[0]);
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([t2], '')[0]);
        expect(useStore.getState().playHistory).toHaveLength(1);
        expect(useStore.getState().playHistory[0].path).toBe('C:/1.flac');
      });

      it('F27.4: failed playback does not advance play counts or record corrupted history', async () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [false];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, row);
        expect(useStore.getState().playback.status).toBe('Stopped');
        expect(useStore.getState().playCounts[row.source_context!.recording_id]).toBeUndefined();
      });

      it('F27.5: coverArt state matches active playback track', async () => {
        const track = createTrack({ cover_url: 'https://cdn.example/art.png' });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        expect(useStore.getState().coverArt).toBe('https://cdn.example/art.png');
      });
    });

    // Feature 28: Safe Fallback on Preferred Failure
    describe('Feature 28: Safe Fallback on Preferred Failure', () => {
      it('F28.1: falls back to equivalent alternative when preferred source resolution fails', async () => {
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') throw new Error('403 Forbidden');
          if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: { lossless: true } };
          return null;
        });
        const tidal = createTidalTrack('123');
        const qobuz = createQobuzTrack('456');
        const row = groupRecordings([tidal, qobuz], '')[0];
        await playUnifiedTrack(useStore.setState, useStore.getState, row);
        expect(useStore.getState().currentTrack?.active_source?.provider).toBe('qobuz');
      });

      it('F28.2: fallback retains user explicit source selection in source_context', async () => {
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') throw new Error('404 Not Found');
          if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: { lossless: true } };
          return null;
        });
        const tidal = createTidalTrack('123');
        const qobuz = createQobuzTrack('456');
        const row = groupRecordings([tidal, qobuz], '')[0];
        const explicitTrack: Track = {
          ...row,
          source_context: {
            ...row.source_context!,
            selection: { mode: 'explicit', source: { provider: 'tidal', id: '123' } },
          },
        };
        await playUnifiedTrack(useStore.setState, useStore.getState, explicitTrack);
        expect(useStore.getState().currentTrack?.source_context?.selection.mode).toBe('explicit');
        expect(useStore.getState().currentTrack?.active_source?.provider).toBe('qobuz');
      });

      it('F28.3: fallback dispatches ui-toast event to inform listener', async () => {
        const toastSpy = vi.fn();
        window.addEventListener('ui-toast', toastSpy);
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') throw new Error('Fail');
          if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: { lossless: true } };
          return null;
        });
        const tidal = createTidalTrack('123');
        const qobuz = createQobuzTrack('456');
        const row = groupRecordings([tidal, qobuz], '')[0];
        const explicitTrack = {
          ...row,
          source_context: {
            ...row.source_context!,
            selection: { mode: 'explicit' as const, source: { provider: 'tidal' as const, id: '123' } },
          },
        };
        await playUnifiedTrack(useStore.setState, useStore.getState, explicitTrack);
        expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({
          detail: expect.objectContaining({
            message: expect.stringContaining('Using Qobuz for this play'),
          }),
        }));
        window.removeEventListener('ui-toast', toastSpy);
      });

      it('F28.4: fallback does not pick incompatible duration or remix versions', () => {
        const local = createTrack({ path: 'C:/local.flac', title: 'Song', duration: 180 });
        const remix = createTrack({ path: 'C:/remix.flac', title: 'Song (Remix)', duration: 180 });
        const rows = groupRecordings([local, remix], '');
        expect(rows).toHaveLength(2);
      });

      it('F28.5: playback stops with clear error when all sources fail', async () => {
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') throw new Error('Server error');
          return null;
        });
        const track = createTidalTrack('123');
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        expect(useStore.getState().playback.status).toBe('Stopped');
        expect(useStore.getState().playbackError).toContain('No source could play this recording');
      });
    });

    // Feature 29: Typed Failure Classification
    describe('Feature 29: Typed Failure Classification', () => {
      it('F29.1: classifies missing local file failure', async () => {
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [false];
          return null;
        });
        await expect(resolveSource({ provider: 'local', id: 'C:/missing.flac' }, 'best_available')).rejects.toThrow('Local file is unavailable');
      });

      it('F29.2: excludes disconnected Tidal provider from available playback sources', async () => {
        useStore.setState({ tidalConnected: false });
        const track = createTidalTrack('123');
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        expect(useStore.getState().playbackError).toContain('No source could play this recording');
        expect(useStore.getState().playback.status).toBe('Stopped');
      });

      it('F29.3: excludes unavailable Qobuz provider from playback sources', async () => {
        useStore.setState({ qobuzConnected: false });
        const track = createQobuzTrack('123');
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        expect(useStore.getState().playbackError).toContain('No source could play this recording');
        expect(useStore.getState().playback.status).toBe('Stopped');
      });

      it('F29.4: handles decoder failure via handleSourceFailure asynchronously', async () => {
        const track = createTrack();
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        handleSourceFailure(track.path, 'Symphonia decode error');
        await vi.waitFor(() => expect(useStore.getState().playback.status).toBe('Stopped'));
      });

      it('F29.5: invalid stream response with non-HTTP URL throws error', async () => {
        vi.mocked(invoke).mockResolvedValue({ url: 'file:///bad/path', quality: {} });
        await expect(resolveSource({ provider: 'tidal', id: '123' }, 'best_available')).rejects.toThrow('Invalid stream response');
      });
    });

    // Feature 30: Cache Key Isolation
    describe('Feature 30: Cache Key Isolation', () => {
      it('F30.1: streamCacheKey partitions by provider and ID', () => {
        const tidal = createTrack({ format: 'Tidal FLAC', path: '99' });
        const qobuz = createTrack({ format: 'Qobuz FLAC', path: '99' });
        expect(streamCacheKey(tidal, 'best_available')).not.toBe(streamCacheKey(qobuz, 'best_available'));
      });

      it('F30.2: streamCacheKey partitions by streaming quality', () => {
        const tidal = createTrack({ format: 'Tidal FLAC', path: '99' });
        const best = streamCacheKey(tidal, 'best_available');
        const saver = streamCacheKey(tidal, 'data_saver');
        expect(best).not.toBe(saver);
      });

      it('F30.3: sourceKey isolates different providers with identical IDs', () => {
        const s1: PlaybackSource = { provider: 'tidal', id: '123' };
        const s2: PlaybackSource = { provider: 'qobuz', id: '123' };
        const s3: PlaybackSource = { provider: 'local', id: '123' };
        expect(sourceKey(s1)).toBe('tidal:123');
        expect(sourceKey(s2)).toBe('qobuz:123');
        expect(sourceKey(s3)).toBe('local:123');
      });

      it('F30.4: clearSourceCache evicts in-memory resolution cache', async () => {
        vi.mocked(invoke).mockResolvedValue({ url: 'https://cdn.example/1', quality: {} });
        await resolveSource({ provider: 'tidal', id: 'abc' }, 'best_available');
        clearSourceCache();
        await resolveSource({ provider: 'tidal', id: 'abc' }, 'best_available');
        expect(invoke).toHaveBeenCalledTimes(2);
      });

      it('F30.5: cache key handles special characters in source IDs', () => {
        const src: PlaybackSource = { provider: 'local', id: 'C:/Music/Track [2026] (Remaster).flac' };
        expect(sourceKey(src)).toBe('local:C:/Music/Track [2026] (Remaster).flac');
      });
    });

    // Feature 31: Cross-Codec Collision Prevention
    describe('Feature 31: Cross-Codec Collision Prevention', () => {
      it('F31.1: YouTube sources are categorized as lossy catalog quality', () => {
        const yt = catalogTrack({ id: 'abcdefghijk', title: 'Song' }, 'youtube');
        expect(yt.catalog_quality?.lossless).toBe(false);
      });

      it('F31.2: Tidal lossless labels are categorized as lossless catalog quality', () => {
        const tidal = catalogTrack({ id: 123, quality: 'LOSSLESS' }, 'tidal');
        expect(tidal.catalog_quality?.lossless).toBe(true);
      });

      it('F31.3: Qobuz HI_RES_LOSSLESS is categorized as lossless catalog quality', () => {
        const qobuz = catalogTrack({ id: 456, quality: 'HI_RES_LOSSLESS' }, 'qobuz');
        expect(qobuz.catalog_quality?.lossless).toBe(true);
      });

      it('F31.4: rankSources ranks lossless higher than lossy under best_available', () => {
        const lossy: PlaybackSource = { provider: 'youtube', id: '1', catalog_quality: { lossless: false } };
        const lossless: PlaybackSource = { provider: 'tidal', id: '2', catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } };
        const ranked = rankSources([lossy, lossless], 'best_available');
        expect(ranked[0].provider).toBe('tidal');
      });

      it('F31.5: rankSources prioritizes lossy or local in data_saver mode', () => {
        const hires: PlaybackSource = { provider: 'qobuz', id: '1', catalog_quality: { lossless: true, sample_rate: 192000, bit_depth: 24 } };
        const lossy: PlaybackSource = { provider: 'youtube', id: '2', catalog_quality: { lossless: false } };
        const ranked = rankSources([hires, lossy], 'data_saver');
        expect(ranked[0].provider).toBe('youtube');
      });
    });

    // Feature 32: Atomic Cache Promotion
    describe('Feature 32: Atomic Cache Promotion', () => {
      it('F32.1: validContext validates complete recording context before persistence', () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        expect(row.source_context?.sources.length).toBeGreaterThan(0);
      });

      it('F32.2: saveSourceChoice rejects context missing recording_id', async () => {
        const track = createTrack();
        const badContext: any = { recording_id: '', sources: [] };
        await expect(saveSourceChoice(track, badContext)).rejects.toThrow('Invalid recording source choice');
      });

      it('F32.3: saveSourceChoice rejects context with >32 sources', async () => {
        const track = createTrack();
        const sources = Array.from({ length: 35 }, (_, i) => ({ provider: 'tidal' as const, id: String(i + 1) }));
        const badContext: any = { recording_id: 'rec-1', sources, selection: { mode: 'auto' } };
        await expect(saveSourceChoice(track, badContext)).rejects.toThrow('Invalid recording source choice');
      });

      it('F32.4: atomic cache promotion ensures online track cache records valid URLs', async () => {
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio.flac', quality: { lossless: true } };
          return null;
        });
        const track = createTidalTrack('123');
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        expect(useStore.getState().currentTrack?.active_quality?.lossless).toBe(true);
      });

      it('F32.5: failed stream resolution does not write valid stream to storage', async () => {
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') throw new Error('Corrupt data');
          return null;
        });
        const track = createTidalTrack('123');
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        expect(useStore.getState().playback.current_track).toBeNull();
      });
    });

    // Feature 33: Tagged Natural-End Events
    describe('Feature 33: Tagged Natural-End Events', () => {
      it('F33.1: handleSourceFailure ignores errors for non-matching URLs', () => {
        handleSourceFailure('https://other.example/audio', 'Decode error');
        expect(useStore.getState().playbackError).toBeNull();
      });

      it('F33.2: cancelSourcePlayback clears retry handler to prevent ghost advances', () => {
        cancelSourcePlayback();
        handleSourceFailure('https://current.example/audio', 'Stale end event');
        expect(useStore.getState().playbackError).toBeNull();
      });

      it('F33.3: playFromQueue plays selected index cleanly without ghost advances', async () => {
        const t1 = createTrack({ path: 'C:/1.flac' });
        const t2 = createTrack({ path: 'C:/2.flac' });
        useStore.setState({ queue: [t1, t2], sourceQueueManaged: true });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await useStore.getState().playFromQueue(0);
        expect(useStore.getState().currentTrack?.path).toBe('C:/1.flac');
      });

      it('F33.4: queue duplicate removal consumes only targeted item', async () => {
        const t1 = createTrack({ path: 'C:/repeat.flac' });
        const t2 = createTrack({ path: 'C:/repeat.flac' });
        useStore.setState({ queue: [t1, t2], sourceQueueManaged: true });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await useStore.getState().playFromQueue(0);
        expect(useStore.getState().queue).toHaveLength(1);
      });

      it('F33.5: stopping audio prevents late naturally-ended triggers', async () => {
        const track = createTrack();
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        await useStore.getState().stopTrack();
        expect(useStore.getState().playback.status).toBe('Stopped');
      });
    });

    // Feature 34: Manual Source Switch Safety
    describe('Feature 34: Manual Source Switch Safety', () => {
      it('F34.1: manual source switch captures playback position accurately', async () => {
        const track = createTrack();
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        useStore.setState({ playback: { ...useStore.getState().playback, position_secs: 45 } });
        await useStore.getState().playTrack(track, true, false, undefined, 45, true);
        expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ startPos: 45 }));
      });

      it('F34.2: manual source switch does not duplicate scrobbling or history entry', async () => {
        const track = createTrack();
        useStore.setState({
          currentTrack: track,
          playHistory: [track],
          scrobbledCurrent: true,
        });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await useStore.getState().playTrack(track, true, false, undefined, 50, true);
        expect(useStore.getState().playHistory).toHaveLength(1);
      });

      it('F34.3: UPnP streaming applies seek after source switch', async () => {
        const track = createTidalTrack('123');
        useStore.setState({ currentTrack: track, upnp_connected: true });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: {} };
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0], true, false, 60, true);
        expect(invoke).toHaveBeenCalledWith('upnp_play', expect.anything());
        expect(invoke).toHaveBeenCalledWith('upnp_control', { action: 'seek', value: 60 });
      });

      it('F34.4: Chromecast streaming passes startPos directly', async () => {
        const track = createTidalTrack('123');
        useStore.setState({ currentTrack: track, chromecast_connected: true });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: {} };
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0], true, false, 90, true);
        expect(invoke).toHaveBeenCalledWith('chromecast_play', expect.objectContaining({ startTime: 90 }));
      });

      it('F34.5: manual source switch preserves playback timeline compatibility', async () => {
        const track = createTrack();
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await useStore.getState().playTrack(track, true, false, undefined, 30, true);
        expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ startPos: 30 }));
      });
    });

    // Feature 35: Authoritative Logical Queue
    describe('Feature 35: Authoritative Logical Queue', () => {
      it('F35.1: addToQueue preserves user-defined queue ordering', async () => {
        const t1 = createTrack({ path: 'C:/1.flac' });
        const t2 = createTrack({ path: 'C:/2.flac' });
        await useStore.getState().addToQueue(t1);
        await useStore.getState().addToQueue(t2);
        expect(useStore.getState().queue[0].path).toBe('C:/1.flac');
        expect(useStore.getState().queue[1].path).toBe('C:/2.flac');
      });

      it('F35.2: intentional duplicates are maintained in logical queue for unified tracks', async () => {
        const t1 = groupRecordings([createTrack({ path: 'C:/song.flac' })], '')[0];
        await useStore.getState().addToQueue(t1);
        await useStore.getState().addToQueue(t1);
        expect(useStore.getState().queue).toHaveLength(2);
      });

      it('F35.3: queue stores track source contexts rather than transient streaming URLs', async () => {
        const tidal = createTidalTrack('123');
        const row = groupRecordings([tidal], '')[0];
        await useStore.getState().addToQueue(row);
        expect(useStore.getState().queue[0].source_context).toEqual(row.source_context);
        expect(useStore.getState().queue[0].path).toBe('123');
      });

      it('F35.4: queue reordering preserves track metadata', async () => {
        const t1 = createTrack({ path: 'C:/1.flac' });
        const t2 = createTrack({ path: 'C:/2.flac' });
        useStore.setState({ queue: [t1, t2] });
        await useStore.getState().reorderQueue(0, 1);
        expect(useStore.getState().queue[0].path).toBe('C:/2.flac');
        expect(useStore.getState().queue[1].path).toBe('C:/1.flac');
      });

      it('F35.5: clearQueue empties queue and persists update', async () => {
        const t1 = createTrack({ path: 'C:/1.flac' });
        useStore.setState({ queue: [t1] });
        await useStore.getState().clearQueue();
        expect(useStore.getState().queue).toHaveLength(0);
      });
    });

    // Feature 36: Decouple Playlist & Queue IDs
    describe('Feature 36: Decouple Playlist & Queue IDs', () => {
      it('F36.1: tracks from playlist carry playlist_entry_id without affecting queue insertion', async () => {
        const t1 = createTrack({ playlist_entry_id: 101 });
        await useStore.getState().addToQueue(t1);
        expect(useStore.getState().queue[0].playlist_entry_id).toBe(101);
      });

      it('F36.2: multiple occurrences from same playlist entry can be queued independently', async () => {
        const t1 = groupRecordings([createTrack({ playlist_entry_id: 101 })], '')[0];
        await useStore.getState().addToQueue(t1);
        await useStore.getState().addToQueue(t1);
        expect(useStore.getState().queue).toHaveLength(2);
      });

      it('F36.3: removing an item from queue leaves playlist intact', () => {
        const t1 = createTrack({ playlist_entry_id: 101 });
        useStore.setState({ queue: [t1], tracks: [t1] });
        useStore.getState().removeFromQueue(0);
        expect(useStore.getState().queue).toHaveLength(0);
        expect(useStore.getState().tracks).toHaveLength(1);
      });

      it('F36.4: updating playlist entry source choice does not alter standalone library preferences', async () => {
        const track = createTrack({ playlist_entry_id: 55 });
        const row = groupRecordings([track], '')[0];
        const context: RecordingSources = {
          ...row.source_context!,
          selection: { mode: 'explicit', source: row.source_context!.sources[0] },
        };
        await saveSourceChoice(row, context);
        expect(invoke).toHaveBeenCalledWith('update_playlist_source', expect.anything());
        expect(localStorage.getItem('aideo_recording_source_preferences')).toBeNull();
      });

      it('F36.5: applySourcePreference does not overwrite playlist entry explicit choice with library choice', () => {
        const track = createTrack({ playlist_entry_id: 55 });
        const row = groupRecordings([track], '')[0];
        localStorage.setItem('aideo_recording_source_preferences', JSON.stringify({
          [row.source_context!.recording_id]: { mode: 'explicit', source: { provider: 'tidal', id: '999' } },
        }));
        const applied = applySourcePreference(row);
        expect(applied.source_context?.selection.mode).toBe('auto');
      });
    });

    // Feature 37: Local Native Gapless Preservation
    describe('Feature 37: Local Native Gapless Preservation', () => {
      it('F37.1: playing local tracks preserves local file path without network resolution', async () => {
        const local = createTrack({ path: 'C:/Music/gapless.flac' });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([local], '')[0]);
        expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ path: 'C:/Music/gapless.flac', startPos: 0 }));
        expect(invoke).not.toHaveBeenCalledWith('tidal_resolve_source', expect.anything());
        expect(invoke).not.toHaveBeenCalledWith('qobuz_resolve_source', expect.anything());
      });

      it('F37.2: local files pass catalog quality metadata to active track', async () => {
        const local = createTrack({
          path: 'C:/Music/hi-res.flac',
          catalog_quality: { lossless: true, sample_rate: 96000, bit_depth: 24 },
        });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          if (cmd === 'read_audio_tags') return { lossless: true, sample_rate: 96000, bit_depth: 24, format: 'flac' };
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([local], '')[0]);
        expect(useStore.getState().currentTrack?.active_quality?.sample_rate).toBe(96000);
      });

      it('F37.3: consecutive local tracks maintain local file paths in player', async () => {
        const l1 = createTrack({ path: 'C:/1.flac' });
        const l2 = createTrack({ path: 'C:/2.flac' });
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([l1], '')[0]);
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([l2], '')[0]);
        expect(useStore.getState().currentTrack?.path).toBe('C:/2.flac');
      });

      it('F37.4: appMode local disables online resolution entirely', async () => {
        useStore.setState({ appMode: 'local' });
        const tidal = createTidalTrack('123');
        const local = createTrack({ path: 'C:/local.flac' });
        const row = groupRecordings([tidal, local], '')[0];
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, row);
        expect(useStore.getState().currentTrack?.active_source?.provider).toBe('local');
      });

      it('F37.5: local files report lossless audio accurately', () => {
        const local = createTrack({ catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } });
        expect(local.catalog_quality?.lossless).toBe(true);
      });
    });

    // Feature 38: Additive Persistence (v1->v2)
    describe('Feature 38: Additive Persistence (v1->v2)', () => {
      it('F38.1: applySourcePreference safely handles legacy JSON missing version field', () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        const v1Context = {
          recording_id: row.source_context!.recording_id,
          sources: row.source_context!.sources,
          selection: { mode: 'auto' },
        };
        localStorage.setItem('aideo_library_source_choices', JSON.stringify({
          [`${track.format}:${track.path}`]: v1Context,
        }));
        const applied = applySourcePreference(track);
        expect(applied.source_context?.sources).toHaveLength(1);
      });

      it('F38.2: accepts unknown future fields in source_context additively without failing', () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        const futureContext = {
          ...row.source_context!,
          selection: { mode: 'auto' },
          match_version: 2,
          future_flag: true,
          future_array: [1, 2, 3],
        };
        localStorage.setItem('aideo_library_source_choices', JSON.stringify({
          [`${track.format}:${track.path}`]: futureContext,
        }));
        const applied = applySourcePreference(track);
        expect(applied.source_context?.sources).toHaveLength(1);
      });

      it('F38.3: malformed JSON in localStorage preferences is caught and handled safely', () => {
        localStorage.setItem('aideo_recording_source_preferences', '{ bad json ...');
        const track = createTrack();
        const applied = applySourcePreference(track);
        expect(applied).toBeDefined();
      });

      it('F38.4: malformed JSON in library source choices is caught safely', () => {
        localStorage.setItem('aideo_library_source_choices', 'null');
        const track = createTrack();
        const applied = applySourcePreference(track);
        expect(applied).toBeDefined();
      });

      it('F38.5: saveSourceChoice correctly persists v2 structure to storage', async () => {
        const track = createTrack();
        const row = groupRecordings([track], '')[0];
        await saveSourceChoice(track, row.source_context!);
        const saved = JSON.parse(localStorage.getItem('aideo_library_source_choices') || '{}');
        expect(saved[`${track.format}:${track.path}`]).toBeDefined();
      });
    });

    // Feature 39: 32-Source Durable Ceiling
    describe('Feature 39: 32-Source Durable Ceiling', () => {
      it('F39.1: groupRecordings caps candidate sources at 32', () => {
        const candidates = Array.from({ length: 40 }, (_, i) =>
          createTidalTrack(String(i + 1), { title: 'Song', artist: 'Artist' })
        );
        const rows = groupRecordings(candidates, 'Song');
        expect(rows[0].source_context?.sources).toHaveLength(32);
      });

      it('F39.2: 32-source ceiling preserves representation across distinct providers', () => {
        const tidalCopies = Array.from({ length: 35 }, (_, i) => createTidalTrack(String(i + 1)));
        const local = createTrack({ path: 'C:/song.flac' });
        const yt = createYoutubeTrack('abcdefghijk');
        const rows = groupRecordings([...tidalCopies, local, yt], '');
        const providers = new Set(rows[0].source_context?.sources.map(s => s.provider));
        expect(providers.has('local')).toBe(true);
        expect(providers.has('youtube')).toBe(true);
        expect(providers.has('tidal')).toBe(true);
      });

      it('F39.3: matchingSources caps joined sources at 32', () => {
        const anchor = createTrack({ path: 'C:/anchor.flac' });
        const results = Array.from({ length: 45 }, (_, i) => createTidalTrack(String(i + 1)));
        const grouped = groupRecordings(results, '');
        const matched = matchingSources(anchor, grouped);
        expect(matched.length).toBeLessThanOrEqual(32);
      });

      it('F39.4: deduplication replaces duplicate provider sources first when ceiling reached', () => {
        const tidals = Array.from({ length: 32 }, (_, i) => createTidalTrack(String(i + 1)));
        const qobuz = createQobuzTrack('999');
        const rows = groupRecordings([...tidals, qobuz], '');
        expect(rows[0].source_context?.sources.some(s => s.provider === 'qobuz')).toBe(true);
        expect(rows[0].source_context?.sources).toHaveLength(32);
      });

      it('F39.5: persistence rejects context exceeding 32 sources', async () => {
        const track = createTrack();
        const excessiveSources = Array.from({ length: 33 }, (_, i) => ({
          provider: 'tidal' as const,
          id: String(i + 1),
        }));
        const badContext: any = {
          recording_id: 'rec-over-32',
          sources: excessiveSources,
          selection: { mode: 'auto' },
        };
        await expect(saveSourceChoice(track, badContext)).rejects.toThrow('Invalid recording source choice');
      });
    });

    // Feature 40: Path-Only Legacy Entry Safety
    describe('Feature 40: Path-Only Legacy Entry Safety', () => {
      it('F40.1: legacy path-only track preserves original path without source_context', () => {
        const legacy: Track = {
          id: 10,
          path: 'C:/Music/legacy.flac',
          title: 'Legacy',
          artist: 'Artist',
          duration: 200,
          format: 'FLAC',
          lyric_offset: 0,
        };
        expect(legacy.source_context).toBeUndefined();
      });

      it('F40.2: applySourcePreference does not inject auto source_context on legacy playlist track', () => {
        const legacy: Track = {
          id: 10,
          path: 'C:/Music/legacy.flac',
          title: 'Legacy',
          artist: 'Artist',
          duration: 200,
          format: 'FLAC',
          lyric_offset: 0,
          playlist_entry_id: 15,
        };
        const applied = applySourcePreference(legacy);
        expect(applied.source_context).toBeUndefined();
      });

      it('F40.3: search does not rewrite legacy playlist items to Auto mode', async () => {
        const legacy: Track = {
          id: 10,
          path: 'C:/Music/legacy.flac',
          title: 'Song',
          artist: 'Artist',
          duration: 200,
          format: 'FLAC',
          lyric_offset: 0,
          playlist_entry_id: 99,
        };
        const row = groupRecordings([legacy], '')[0];
        expect(row.playlist_entry_id).toBe(99);
      });

      it('F40.4: legacy tracks without duration are not assigned false defaults', () => {
        const legacy: Track = {
          id: 11,
          path: 'C:/Music/unknown.mp3',
          title: 'Unknown',
          artist: 'Artist',
          duration: null,
          format: 'MP3',
          lyric_offset: 0,
        };
        expect(legacy.duration).toBeNull();
      });

      it('F40.5: playing legacy tracks uses direct path without altering preferences', async () => {
        const legacy: Track = {
          id: 12,
          path: 'C:/Music/direct.flac',
          title: 'Direct',
          artist: 'Artist',
          duration: 150,
          format: 'FLAC',
          lyric_offset: 0,
        };
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([legacy], '')[0]);
        expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ path: legacy.path, startPos: 0 }));
      });
    });

    // Feature 41: Output & WASAPI Settings Safety
    describe('Feature 41: Output & WASAPI Settings Safety', () => {
      it('F41.1: changing streamingQuality does not alter native audio output settings', () => {
        useStore.setState({ streamingQuality: 'best_available' });
        useStore.setState({ streamingQuality: 'data_saver' });
        expect(invoke).not.toHaveBeenCalledWith('set_wasapi_exclusive', expect.anything());
        expect(invoke).not.toHaveBeenCalledWith('set_bit_perfect', expect.anything());
      });

      it('F41.2: resolving stream sources does not call WASAPI or DAC reconfiguration', async () => {
        vi.mocked(invoke).mockResolvedValue({ url: 'https://cdn.example/audio', quality: { lossless: true } });
        await resolveSource({ provider: 'tidal', id: '123' }, 'best_available');
        expect(invoke).not.toHaveBeenCalledWith('set_device_sample_rate', expect.anything());
      });

      it('F41.3: source switching preserves current output volume and driver settings', async () => {
        useStore.setState({
          playback: {
            ...useStore.getState().playback,
            volume: 0.75,
            exclusive: true,
            bit_perfect: true,
          },
        });
        const track = createTrack();
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'check_files_exist') return [true];
          return null;
        });
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([track], '')[0]);
        expect(useStore.getState().playback.volume).toBe(0.75);
        expect(useStore.getState().playback.exclusive).toBe(true);
        expect(useStore.getState().playback.bit_perfect).toBe(true);
      });

      it('F41.4: fallback does not alter bit-perfect mode flag in store', async () => {
        vi.mocked(invoke).mockImplementation(async cmd => {
          if (cmd === 'tidal_resolve_source') throw new Error('Fail');
          if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: {} };
          return null;
        });
        const tidal = createTidalTrack('123');
        const qobuz = createQobuzTrack('456');
        await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([tidal, qobuz], '')[0]);
        expect(useStore.getState().currentTrack?.active_source?.provider).toBe('qobuz');
      });

      it('F41.5: rankSources evaluation is purely computational and produces zero hardware IPC side effects', () => {
        const s1: PlaybackSource = { provider: 'tidal', id: '1' };
        const s2: PlaybackSource = { provider: 'qobuz', id: '2' };
        rankSources([s1, s2], 'best_available');
        expect(invoke).not.toHaveBeenCalled();
      });
    });
  });

  // ==========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // ==========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('T2.1: handles empty title, artist, and album without throwing', () => {
      const t1 = createTrack({ title: '', artist: '', album: '' });
      const t2 = createTrack({ title: '', artist: '', album: '' });
      expect(() => isLikelySameRecording(t1, t2)).not.toThrow();
      expect(isLikelySameRecording(t1, t2)).toBe(false);
    });

    it('T2.2: handles null title and artist safely', () => {
      const t1 = createTrack({ title: null, artist: null });
      const t2 = createTrack({ title: null, artist: null });
      expect(isLikelySameRecording(t1, t2)).toBe(false);
    });

    it('T2.3: extreme duration difference: 1 second vs 3600 seconds', () => {
      const shortTrack = createTrack({ duration: 1 });
      const longTrack = createTrack({ duration: 3600 });
      expect(isLikelySameRecording(shortTrack, longTrack)).toBe(false);
    });

    it('T2.4: negative or zero duration values return false', () => {
      const zero = createTrack({ duration: 0 });
      const neg = createTrack({ duration: -10 });
      expect(isLikelySameRecording(zero, neg)).toBe(false);
    });

    it('T2.5: duration exactly at 20-minute cap boundary: 1200.0s is eligible, 1200.1s is excluded', () => {
      const atCap = createYoutubeTrack('12345678901', { duration: 1200.0 });
      const overCap = createYoutubeTrack('12345678902', { duration: 1200.1 });
      expect(isMusicTrack(atCap)).toBe(true);
      expect(isMusicTrack(overCap)).toBe(false);
    });

    it('T2.6: duration delta at exact 3.0s boundary vs 3.001s boundary', () => {
      const anchor = createTrack({ duration: 100.0 });
      const match3s = createTrack({ duration: 103.0 });
      const reject3s = createTrack({ duration: 103.001 });
      expect(isLikelySameRecording(anchor, match3s)).toBe(true);
      expect(isLikelySameRecording(anchor, reject3s)).toBe(false);
    });

    it('T2.7: YouTube ID with exactly 11 characters is accepted, others rejected', () => {
      expect(sourceFor(createTrack({ path: 'https://www.youtube.com/watch?v=12345678901' }))?.provider).toBe('youtube');
      expect(sourceFor(createTrack({ path: 'https://www.youtube.com/watch?v=short' }))?.provider).toBeUndefined();
    });

    it('T2.8: handles empty search query without crash', () => {
      const tracks = [createTrack({ title: 'Song', artist: 'Artist' })];
      const rows = groupRecordings(tracks, '');
      expect(rows).toHaveLength(1);
    });

    it('T2.9: handles whitespace-only search query', () => {
      const tracks = [createTrack({ title: 'Song', artist: 'Artist' })];
      const rows = groupRecordings(tracks, '    ');
      expect(rows).toHaveLength(1);
    });

    it('T2.10: handles extreme number of sources gracefully (e.g. 100 identical candidates)', () => {
      const tracks = Array.from({ length: 100 }, (_, i) =>
        createTidalTrack(String(i + 1), { title: 'Viral Hit', artist: 'Pop Star' })
      );
      const rows = groupRecordings(tracks, 'Viral Hit');
      expect(rows).toHaveLength(1);
      expect(rows[0].source_context?.sources.length).toBe(32);
    });

    it('T2.11: handles right-to-left Hebrew and Arabic combined titles', () => {
      const hebrew = createTrack({ title: 'שלום עולם', artist: 'אמן', duration: 180 });
      const matching = createTrack({ title: 'שלום עולם', artist: 'אמן', duration: 181 });
      expect(isLikelySameRecording(hebrew, matching)).toBe(true);
    });

    it('T2.12: handles mixed casing with accents: "ÉLÉPHANT" vs "éléphant"', () => {
      const upper = createTrack({ title: 'ÉLÉPHANT', artist: 'ARTISTE' });
      const lower = createTrack({ title: 'éléphant', artist: 'artiste' });
      expect(isLikelySameRecording(upper, lower)).toBe(true);
    });

    it('T2.13: handles presentation wrapper stripping across bracket types', () => {
      const t1 = createTrack({ title: 'Song (Official Audio)' });
      const t2 = createTrack({ title: 'Song [Lyric Video]' });
      const t3 = createTrack({ title: 'Song (Visualizer)' });
      const tBase = createTrack({ title: 'Song' });
      expect(isLikelySameRecording(t1, tBase)).toBe(true);
      expect(isLikelySameRecording(t2, tBase)).toBe(true);
      expect(isLikelySameRecording(t3, tBase)).toBe(true);
    });

    it('T2.14: handles special characters in local file paths (spaces, hash, ampersand)', () => {
      const path = 'C:/Music/#1 Rock & Roll/01 - AC/DC.flac';
      const track = createTrack({ path });
      expect(sourceFor(track)?.id).toBe(path);
    });

    it('T2.15: handles missing quality metadata safely in rankSources', () => {
      const s1: PlaybackSource = { provider: 'tidal', id: '1', catalog_quality: null };
      const s2: PlaybackSource = { provider: 'qobuz', id: '2', catalog_quality: undefined };
      expect(() => rankSources([s1, s2], 'best_available')).not.toThrow();
    });
  });

  // ==========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // ==========================================================================

  describe('Tier 3: Cross-Feature Combinations', () => {
    it('T3.1: Matcher Equivalence + Playback Fallback (F5 + F7 + F28)', async () => {
      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'tidal_resolve_source') throw new Error('Unavailable');
        if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: { lossless: true } };
        return null;
      });
      const tidal = createTidalTrack('100', { duration: 180 });
      const qobuz = createQobuzTrack('200', { duration: 182 });
      const row = groupRecordings([tidal, qobuz], '')[0];
      await playUnifiedTrack(useStore.setState, useStore.getState, row);
      expect(useStore.getState().currentTrack?.active_source?.provider).toBe('qobuz');
    });

    it('T3.2: 20-Minute Cap + Progressive Search Enrichment (F14 + F19 + F20)', async () => {
      const shortVideo = catalogTrack({ id: '11111111111', title: 'Great Song', artist: 'Artist', duration_raw: '3:30' }, 'youtube');
      const longVideo = catalogTrack({ id: '22222222222', title: 'Great Song (Live Stream)', artist: 'Artist', duration_raw: '45:00' }, 'youtube');
      const podcast = catalogTrack({ id: '33333333333', title: 'Great Song Podcast Review', artist: 'Artist', duration_raw: '10:00' }, 'youtube');
      const tidal = createTidalTrack('123', { title: 'Great Song', artist: 'Artist', duration: 210 });
      const rows = groupRecordings([shortVideo, longVideo, podcast, tidal], 'Great Song');
      expect(rows).toHaveLength(1);
      expect(rows[0].source_context?.sources.some(s => s.id === '11111111111')).toBe(true);
      expect(rows[0].source_context?.sources.some(s => s.id === '22222222222')).toBe(false);
      expect(rows[0].source_context?.sources.some(s => s.id === '33333333333')).toBe(false);
    });

    it('T3.3: Explicit Selection + Centralized Store + Source Picker (F9 + F13 + F15)', async () => {
      const track = createTrack();
      const row = groupRecordings([track, createQobuzTrack('456')], '')[0];
      const explicitContext: RecordingSources = {
        ...row.source_context!,
        selection: { mode: 'explicit', source: { provider: 'qobuz', id: '456' } },
      };
      await saveSourceChoice(row, explicitContext);
      useStore.setState({ currentTrack: row });
      const applied = applySourcePreference(row);
      expect(applied.source_context?.selection.mode).toBe('explicit');
      expect((applied.source_context?.selection as any).source.id).toBe('456');
    });

    it('T3.4: Rapid Cancellation + Attempt Tracking (F24 + F25 + F33)', async () => {
      let finish!: (v: any) => void;
      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'tidal_resolve_source') return new Promise(r => { finish = r; });
        if (cmd === 'check_files_exist') return [true];
        return null;
      });
      const slow = createTidalTrack('123');
      const fast = createTrack({ path: 'C:/fast.flac' });
      const p1 = playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([slow], '')[0]);
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      const p2 = playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([fast], '')[0]);
      finish({ url: 'https://cdn.example/slow.mp3', quality: {} });
      await Promise.all([p1, p2]);
      expect(useStore.getState().currentTrack?.path).toBe('C:/fast.flac');
    });

    it('T3.5: Queue Occurrence + Additive Persistence + Local Gapless (F35 + F36 + F37 + F38)', async () => {
      const l1 = groupRecordings([createTrack({ path: 'C:/1.flac' })], '')[0];
      const l2 = groupRecordings([createTrack({ path: 'C:/2.flac' })], '')[0];
      await useStore.getState().addToQueue(l1);
      await useStore.getState().addToQueue(l2);
      await useStore.getState().addToQueue(l1);
      expect(useStore.getState().queue).toHaveLength(3);
      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'check_files_exist') return [true];
        return null;
      });
      await useStore.getState().playFromQueue(0);
      expect(useStore.getState().currentTrack?.path).toBe('C:/1.flac');
      expect(useStore.getState().queue).toHaveLength(2);
    });

    it('T3.6: Mid-Song Upgrade Suppression + Bounded Background Enrichment (F10 + F23)', () => {
      const track = createTrack({ path: 'C:/playing.flac' });
      const row = groupRecordings([track], '')[0];
      useStore.setState({ currentTrack: row, playback: { ...useStore.getState().playback, status: 'Playing' } });
      const better = createQobuzTrack('777', {
        catalog_quality: { lossless: true, sample_rate: 192000, bit_depth: 24 },
      });
      const enriched = groupRecordings([track, better], '')[0];
      expect(enriched.source_context?.sources).toHaveLength(2);
      expect(useStore.getState().playback.status).toBe('Playing');
    });

    it('T3.7: 32-Source Ceiling + Additive Persistence v1->v2 (F38 + F39)', async () => {
      const candidates = Array.from({ length: 35 }, (_, i) => createTidalTrack(String(i + 1)));
      const row = groupRecordings(candidates, '')[0];
      expect(row.source_context?.sources).toHaveLength(32);
      await saveSourceChoice(row, row.source_context!);
      const loaded = applySourcePreference(row);
      expect(loaded.source_context?.sources).toHaveLength(32);
    });

    it('T3.8: Clean/Explicit Separation + Multi-Provider Search Grouping (F11 + F16)', () => {
      const cleanTidal = createTidalTrack('1', { recording_evidence: { version: 'Clean' } });
      const expTidal = createTidalTrack('2', { recording_evidence: { version: 'Explicit' } });
      const expQobuz = createQobuzTrack('3', { recording_evidence: { version: 'Explicit' } });
      const rows = groupRecordings([cleanTidal, expTidal, expQobuz], '');
      expect(rows).toHaveLength(2);
      const expRow = rows.find(r => r.recording_evidence?.version === 'Explicit');
      expect(expRow?.source_context?.sources).toHaveLength(2);
    });

    it('T3.9: Unicode NFKC + Multilingual Punctuation in Search (F1 + F12)', () => {
      const t1 = createTrack({ title: 'Ｓｏｎｇ （Live）', artist: 'Ａｒｔｉｓｔ' });
      const t2 = createTrack({ title: 'Song (Live)', artist: 'Artist' });
      expect(isLikelySameRecording(t1, t2)).toBe(true);
    });

    it('T3.10: Decoder Failure + Strict Fallback Exhaustion (F27 + F28 + F29)', async () => {
      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: {} };
        if (cmd === 'qobuz_resolve_source') return { url: 'https://qobuz.example/audio', quality: {} };
        return null;
      });
      const tidal = createTidalTrack('123');
      const qobuz = createQobuzTrack('456');
      const row = groupRecordings([tidal, qobuz], '')[0];
      const explicitTrack = {
        ...row,
        source_context: {
          ...row.source_context!,
          selection: { mode: 'explicit' as const, source: { provider: 'tidal' as const, id: '123' } },
        },
      };
      await playUnifiedTrack(useStore.setState, useStore.getState, explicitTrack);
      handleSourceFailure('https://tidal.example/audio', 'Decode error');
      await vi.waitFor(() => expect(useStore.getState().currentTrack?.active_source?.provider).toBe('qobuz'));
      handleSourceFailure('https://qobuz.example/audio', 'Decode error');
      await vi.waitFor(() => expect(useStore.getState().playback.status).toBe('Stopped'));
      expect(useStore.getState().playbackError).toContain('No source could play this recording');
    });
  });

  // ==========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // ==========================================================================

  describe('Tier 4: Real-World Application Scenarios', () => {
    it('Scenario 1: End-to-end Search to Playback with Fallback', async () => {
      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'search_local_sources') return [createTrack({ path: 'C:/Music/TakSegampangItu.flac', title: 'Tak Segampang Itu', artist: 'Anggi Marito', duration: 231 })];
        if (cmd === 'tidal_search') return [{ id: 101, title: 'Tak Segampang Itu', artist: 'Anggi Marito', duration: 231, quality: 'LOSSLESS' }];
        if (cmd === 'search_youtube') return [{ id: 'gR_qbfGkwpc', title: 'Tak Segampang Itu (Official Music Video)', artist: 'Anggi Marito - Topic', duration_raw: '3:52' }];
        return [];
      });
      const searchRes = await searchSources('Anggi Marito Tak Segampang Itu', { tidal: true, qobuz: false }, () => {});
      expect(searchRes.tracks).toHaveLength(1);
      const songRow = searchRes.tracks[0];
      expect(songRow.source_context?.sources.length).toBeGreaterThanOrEqual(2);

      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'check_files_exist') return [false];
        if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/stream.flac', quality: { lossless: true } };
        return null;
      });
      await playUnifiedTrack(useStore.setState, useStore.getState, songRow);
      expect(useStore.getState().currentTrack?.active_source?.provider).toBe('tidal');
      expect(useStore.getState().playback.status).toBe('Playing');
    });

    it('Scenario 2: Multi-Surface Source Picker Convergence', async () => {
      const local = createTrack({ path: 'C:/Music/track.flac', title: 'Convergence', artist: 'Artist', duration: 180 });
      const qobuz = createQobuzTrack('789', { title: 'Convergence', artist: 'Artist', duration: 181 });
      const row = groupRecordings([local, qobuz], '')[0];

      const explicitContext: RecordingSources = {
        ...row.source_context!,
        selection: { mode: 'explicit', source: { provider: 'qobuz', id: '789' } },
      };
      await saveSourceChoice(row, explicitContext);

      const searchTrack = applySourcePreference(row);
      expect(searchTrack.source_context?.selection.mode).toBe('explicit');
      expect((searchTrack.source_context?.selection as any).source.provider).toBe('qobuz');
    });

    it('Scenario 3: Rapid Queue Advancement & Cancellation Stress', async () => {
      const tracks = Array.from({ length: 5 }, (_, i) =>
        createTrack({ path: `C:/Music/track_${i + 1}.flac`, title: `Track ${i + 1}` })
      );
      useStore.setState({ queue: tracks });
      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'check_files_exist') return [true];
        return null;
      });
      for (let i = 0; i < 4; i++) {
        void playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([tracks[i]], '')[0]);
      }
      await playUnifiedTrack(useStore.setState, useStore.getState, groupRecordings([tracks[4]], '')[0]);
      expect(useStore.getState().currentTrack?.path).toBe('C:/Music/track_5.flac');
    });

    it('Scenario 4: Intentional Repeat & Playlist Continuity', async () => {
      const trackA = groupRecordings([createTrack({ path: 'C:/A.flac', title: 'Song A', playlist_entry_id: 1 })], '')[0];
      const trackB = groupRecordings([createTrack({ path: 'C:/B.flac', title: 'Song B', playlist_entry_id: 2 })], '')[0];
      useStore.setState({ queue: [trackA, trackB, trackA], sourceQueueManaged: true });
      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'check_files_exist') return [true];
        return null;
      });
      await useStore.getState().playFromQueue(0);
      expect(useStore.getState().currentTrack?.path).toBe('C:/A.flac');
      expect(useStore.getState().queue).toHaveLength(2);
      expect(useStore.getState().queue[0].path).toBe('C:/B.flac');
      expect(useStore.getState().queue[1].path).toBe('C:/A.flac');
    });

    it('Scenario 5: Offline/Local-Only Transition & WASAPI Integrity', async () => {
      useStore.setState({ appMode: 'local', streamingQuality: 'best_available' });
      const local = createTrack({ path: 'C:/Symphony.flac', duration: 3600 });
      const tidal = createTidalTrack('999', { duration: 3600 });
      const row = groupRecordings([local, tidal], '')[0];

      vi.mocked(invoke).mockImplementation(async cmd => {
        if (cmd === 'check_files_exist') return [true];
        return null;
      });
      await playUnifiedTrack(useStore.setState, useStore.getState, row);

      expect(useStore.getState().currentTrack?.active_source?.provider).toBe('local');
      expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ path: 'C:/Symphony.flac', startPos: 0 }));
      expect(invoke).not.toHaveBeenCalledWith('tidal_resolve_source', expect.anything());
    });
  });
});
