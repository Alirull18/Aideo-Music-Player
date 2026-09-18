import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useStore, type Track } from '../store';
import { catalogTrack, groupRecordings, applySourcePreference, saveSourceChoice, clearSourceCache, rankSources, isLikelySameRecording } from '../utils/unifiedSources';
import { cancelSourcePlayback } from '../store/sourcePlayback';
import { UnifiedSearchResults } from '../components/UnifiedSearchResults';
import { AideoView } from '../components/AideoView';

const youtube = { id: 'abcdefghijk', title: 'Song (Official Audio)', artist: 'Artist - Topic', duration_raw: '3:01', url: 'https://www.youtube.com/watch?v=abcdefghijk' };
const tidal: Track = { id: 1, path: '123', title: 'Song', artist: 'Artist', album: 'Album', duration: 180, format: 'Tidal FLAC', lyric_offset: 0,
  recording_evidence: { isrc: 'USAAA2600001', upc: '0123456789012' }, catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } };

describe('Song-first search', () => {
  beforeEach(() => {
    localStorage.clear(); clearSourceCache(); cancelSourcePlayback();
    vi.mocked(invoke).mockReset().mockImplementation(async cmd => String(cmd).includes('search') ? [] : null);
    vi.mocked(listen).mockResolvedValue(() => {});
    useStore.setState({ tracks: [], queue: [], currentTrack: null, currentPlaylist: null, sourceQueueManaged: false,
      appMode: 'hybrid', tidalConnected: true, qobuzConnected: false, qobuzExperimentalEnabled: false,
      streamingQuality: 'best_available', chromecast_connected: false, upnp_connected: false,
      preferredSource: 'auto',
      playHistory: [], playCounts: {}, recordPlaybackTransition: vi.fn().mockResolvedValue(undefined),
      autoFetchLyricsOnline: vi.fn().mockResolvedValue(undefined), updateDiscordPresence: vi.fn(),
      playback: { ...useStore.getState().playback, status: 'Stopped', is_buffering: false, position_secs: 0 },
    });
  });
  afterEach(() => { cancelSourcePlayback(); cleanup(); vi.restoreAllMocks(); });

  it('reads real YouTube durations and groups a strong metadata match', () => {
    const web = catalogTrack(youtube, 'youtube');
    expect(web.duration).toBe(181);
    const rows = groupRecordings([web, tidal], 'Song');
    expect(rows).toHaveLength(1);
    expect(rows[0].source_context?.sources.map(s => s.provider).sort()).toEqual(['tidal', 'youtube']);
    expect(rows[0].source_context?.sources.find(s => s.provider === 'youtube')).toMatchObject({
      metadata: { title: youtube.title, artist: youtube.artist, album: null, duration: 181 },
    });
    expect(groupRecordings([tidal, web], 'Song')[0].source_context?.recording_id).toBe(rows[0].source_context?.recording_id);
  });

  it('switches displayed and system tags both ways while preserving the recording and playlist entry', async () => {
    vi.mocked(invoke).mockImplementation(async cmd => cmd === 'tidal_resolve_source'
      ? { url: 'https://tidal.example/audio', quality: { lossless: true } } : null);
    const row = { ...groupRecordings([{ ...tidal, cover_url: 'https://example.com/tidal.jpg' }, catalogTrack(youtube, 'youtube')], '')[0], playlist_entry_id: 7 };
    for (const provider of ['youtube', 'tidal', 'youtube'] as const) {
      const source = row.source_context!.sources.find(s => s.provider === provider)!;
      const previous = useStore.getState().currentTrack || row;
      await useStore.getState().playTrack({ ...previous, source_context: {
        ...row.source_context!, selection: { mode: 'explicit', source },
      } }, true, false, undefined, 43, true);
      const expected = provider === 'youtube'
        ? { title: youtube.title, artist: youtube.artist, album: null, duration: 181, cover_url: null }
        : { title: tidal.title, artist: tidal.artist, album: tidal.album, duration: tidal.duration, cover_url: 'https://example.com/tidal.jpg' };
      expect(useStore.getState().currentTrack).toMatchObject({ ...expected, path: row.path, playlist_entry_id: 7 });
      expect(useStore.getState().coverArt).toBe(expected.cover_url);
      expect(invoke).toHaveBeenLastCalledWith('update_media_metadata', {
        title: expected.title, artist: expected.artist, album: expected.album, duration: expected.duration, coverUrl: expected.cover_url,
      });
      expect(JSON.parse(localStorage.getItem('aideo_current_track')!)).toMatchObject(expected);
    }
  });

  it.each(['0:00', '3:99', '-1:30', 'Infinity', 'live'])('does not invent a duration from %s', duration_raw => {
    expect(catalogTrack({ ...youtube, duration_raw }, 'youtube').duration).toBeNull();
  });

  it('keeps different performances separate while grouping catalog editions of a song', () => {
    for (const extra of [{ title: 'Song (Live)' }, { title: 'Song (Remastered 2026)' }, { artist: 'Cover Artist' },
      { recording_evidence: { version: 'Live' } }]) {
      expect(groupRecordings([tidal, { ...tidal, path: '456', ...extra }], '')).toHaveLength(2);
    }
    const other = { ...tidal, path: '456', album: 'Other release', recording_evidence: { isrc: 'USAAA2600002', upc: '0123456789013' } };
    expect(groupRecordings([catalogTrack(youtube, 'youtube'), tidal, other], '')).toHaveLength(1);
    expect(isLikelySameRecording(tidal, other)).toBe(false);
  });

  it('retains a discovered alternative when playing the original search row again', async () => {
    const original = groupRecordings([catalogTrack(youtube, 'youtube')], '')[0];
    const alternative = { provider: 'tidal' as const, id: '123' };
    const context = { ...original.source_context!, sources: [...original.source_context!.sources, alternative], selection: { mode: 'explicit' as const, source: alternative } };
    await saveSourceChoice(original, context);
    expect(applySourcePreference(original).source_context).toEqual(context);
  });

  it('does not overwrite another playlist entry when remembering a source choice', async () => {
    const original = groupRecordings([tidal], '')[0];
    const local = { provider: 'local' as const, id: 'C:/Music/song.flac' };
    const context = { ...original.source_context!, sources: [...original.source_context!.sources, local], selection: { mode: 'explicit' as const, source: local } };
    await saveSourceChoice({ ...original, playlist_entry_id: 1 }, context);
    expect(applySourcePreference({ ...original, playlist_entry_id: 2 }).source_context?.selection.mode).toBe('auto');
  });

  it('queues a song, reports success, and supports playing next', async () => {
    const track = groupRecordings([tidal], '')[0];
    render(createElement(UnifiedSearchResults, { result: { tracks: [track], pending: [], errors: {} } }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    await waitFor(() => expect(useStore.getState().queue).toHaveLength(1));
    expect(await screen.findByText(/Added to queue/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Play next' }));
    await waitFor(() => expect(useStore.getState().queue).toHaveLength(2));
    expect(await screen.findByText(/Playing next/)).toBeVisible();
  });

  it('reports a queue failure instead of silently ignoring the click', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error('Backend unavailable'));
    render(createElement(UnifiedSearchResults, { result: { tracks: groupRecordings([tidal], ''), pending: [], errors: {} } }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
    expect(await screen.findByText(/Could not add to queue/)).toBeVisible();
    expect(useStore.getState().queue).toHaveLength(0);
  });

  it.each(['classic', 'command', 'editorial', 'stage'] as const)('keeps source filters usable after a %s search', async aideoPageDesign => {
    useStore.setState({ aideoPageDesign });
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') return [{ ...tidal, id: '123' }];
      if (cmd === 'search_youtube') return [youtube];
      return String(cmd).includes('search') ? [] : null;
    });
    render(createElement(AideoView));
    const input = screen.getByRole('textbox', { name: aideoPageDesign === 'classic' ? '' : 'Search songs and sources' });
    fireEvent.change(input, { target: { value: 'Song' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByRole('region', { name: 'Unified search results' });
    fireEvent.click(screen.getByText('Source filter: All sources'));
    fireEvent.click(screen.getByRole('button', { name: 'Webstream' }));
    expect(await screen.findByRole('button', { name: 'Play Song by Artist' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tidal' }));
    expect(await screen.findByRole('button', { name: 'Play Song by Artist' })).toBeVisible();
    expect(invoke).toHaveBeenCalledWith('tidal_search', { query: 'Song' });
  });

  it.each(['Playing', 'Paused'] as const)('enriches source alternatives in the background without interrupting playing audio while %s', async status => {
    let finishSearch!: (tracks: unknown[]) => void;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') return new Promise(resolve => { finishSearch = resolve; });
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } };
      return String(cmd).includes('search') ? [] : null;
    });
    const track = groupRecordings([catalogTrack(youtube, 'youtube')], '')[0];
    await useStore.getState().playTrack(track);
    await waitFor(() => expect(finishSearch).toBeTypeOf('function'));
    useStore.setState({ playback: { ...useStore.getState().playback, status, is_buffering: false, position_secs: 43 }, queue: [tidal] });
    finishSearch([{ ...tidal, id: '123' }]);

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(invoke).not.toHaveBeenCalledWith('play_track', expect.objectContaining({ path: 'https://tidal.example/audio' }));
    expect(useStore.getState().playback.status).toBe(status);
    expect(useStore.getState().recordPlaybackTransition).toHaveBeenCalledTimes(1);
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('youtube');

    const enrichedSources = useStore.getState().currentTrack?.source_context?.sources || [];
    expect(enrichedSources.some(s => s.provider === 'tidal' && s.id === '123')).toBe(true);
  });

  it('cancels a background upgrade after stopping', async () => {
    let finishSearch!: (tracks: unknown[]) => void;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') return new Promise(resolve => { finishSearch = resolve; });
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } };
      return String(cmd).includes('search') ? [] : null;
    });
    await useStore.getState().playTrack(groupRecordings([catalogTrack(youtube, 'youtube')], '')[0]);
    await waitFor(() => expect(finishSearch).toBeTypeOf('function'));
    await useStore.getState().stopTrack();
    finishSearch([{ ...tidal, id: '123' }]);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(invoke).not.toHaveBeenCalledWith('play_track', expect.objectContaining({ path: 'https://tidal.example/audio' }));
    expect(useStore.getState().playback.status).toBe('Stopped');
  });

  it('falls back to a newly discovered copy when the initial copy fails', async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === 'tidal_search') return [{ ...tidal, id: '123' }];
      if (cmd === 'play_track' && args.path.includes('youtube')) throw new Error('Video unavailable');
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: { lossless: true } };
      return String(cmd).includes('search') ? [] : null;
    });
    await useStore.getState().playTrack(groupRecordings([catalogTrack(youtube, 'youtube')], '')[0]);
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('tidal');
    expect(useStore.getState().playbackError).toBeNull();
  });

  it('does not override a manual source choice made during the background lookup', async () => {
    let finishSearch!: (tracks: unknown[]) => void;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_search') return new Promise(resolve => { finishSearch = resolve; });
      if (cmd === 'tidal_resolve_source') return { url: 'https://tidal.example/audio', quality: { lossless: true } };
      return String(cmd).includes('search') ? [] : null;
    });
    await useStore.getState().playTrack(groupRecordings([catalogTrack(youtube, 'youtube')], '')[0]);
    const current = useStore.getState().currentTrack!;
    useStore.setState({ currentTrack: { ...current, source_context: { ...current.source_context!, selection: { mode: 'explicit', source: current.active_source! } } },
      playback: { ...useStore.getState().playback, is_buffering: false } });
    finishSearch([{ ...tidal, id: '123' }]);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(invoke).not.toHaveBeenCalledWith('play_track', expect.objectContaining({ path: 'https://tidal.example/audio' }));
    expect(useStore.getState().currentTrack?.source_context?.selection.mode).toBe('explicit');
  });

  it('starts an available copy without waiting for a slow known source', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'tidal_resolve_source') return new Promise(resolve => { finish = resolve; });
      return String(cmd).includes('search') ? [] : null;
    });
    const song = groupRecordings([catalogTrack(youtube, 'youtube'), tidal], '')[0];
    const pending = useStore.getState().playTrack(song);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('play_track', expect.objectContaining({ path: youtube.url })), { timeout: 2000 });
    await pending;
    cancelSourcePlayback();
    finish({ url: 'https://tidal.example/audio', quality: { lossless: true } });
  });

  it('uses connected sources only and skips background discovery in Data saver', async () => {
    useStore.setState({ tidalConnected: false, streamingQuality: 'data_saver' });
    await useStore.getState().playTrack(groupRecordings([catalogTrack(youtube, 'youtube'), tidal], '')[0]);
    expect(useStore.getState().currentTrack?.active_source?.provider).toBe('youtube');
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === 'tidal_resolve_source' || cmd === 'tidal_search')).toBe(false);
  });

  it('persists source preference and uses it only to break quality ties', () => {
    const sources = ['tidal', 'qobuz'].map(provider => ({ provider: provider as 'tidal' | 'qobuz', id: '123', catalog_quality: { lossless: true, sample_rate: 44100, bit_depth: 16 } }));
    useStore.getState().setPreferredSource('tidal');
    expect(localStorage.getItem('aideo_preferred_source')).toBe('tidal');
    expect(rankSources(sources, 'best_available', 'tidal')[0].provider).toBe('tidal');
    expect(rankSources(sources, 'best_available', 'qobuz')[0].provider).toBe('qobuz');
    sources[1].catalog_quality.sample_rate = 96000;
    expect(rankSources(sources, 'best_available', 'tidal')[0].provider).toBe('qobuz');
  });
});
