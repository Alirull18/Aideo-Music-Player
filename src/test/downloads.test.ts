import { createElement, Fragment } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { DownloadChooser, DownloadManager, DownloadProgress } from '../components/DownloadManager';
import { TrackContextMenu } from '../components/TrackContextMenu';
import { DownloadedView } from '../components/DownloadedView';
import { useStore } from '../store';
import { collectDownloadSources, useDownloadStore, type DownloadJob, type DownloadOption } from '../store/downloadStore';
import type { PlaybackSource, Track } from '../store/types';
import { searchSources, type SourceSearch } from '../utils/unifiedSources';

vi.mock('../utils/unifiedSources', async importOriginal => ({ ...await importOriginal<typeof import('../utils/unifiedSources')>(), searchSources: vi.fn() }));

const track: Track = { id: -1, path: '123', title: 'Song', artist: 'Artist', album: 'Album', duration: 180, format: 'Tidal FLAC', lyric_offset: 0 };
const alternative: PlaybackSource = { provider: 'qobuz', id: '456', metadata: { title: 'Song', artist: 'Artist', album: 'Other Album', duration: 180 } };
const sourceContext = { recording_id: 'recording', sources: [alternative], selection: { mode: 'auto' as const } };
const selectedTrack = { ...track, source_context: sourceContext };
const option: DownloadOption = { id: '6', label: 'FLAC · 16-bit · 44.1 kHz', extension: 'flac', quality: { lossless: true, codec: 'audio/flac', bit_depth: 16, sample_rate: 44100 } };
const job = (changes: Partial<DownloadJob> = {}): DownloadJob => ({ id: 'download-1', revision: 1, source: alternative, option, path: 'C:\\Music\\Artist - Song.flac', status: 'downloading', downloaded: 1024, total: 2048, percent: 50, error: null, saved: false, ...changes });
const emptySearch: SourceSearch = { tracks: [], pending: [], errors: {} };
const handlers = new Map<string, (event: { payload: DownloadJob }) => void>();

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); handlers.clear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  useDownloadStore.setState({ track: null, jobs: [], paths: [], hidden: [] });
  useStore.setState({ view: 'library', appMode: 'hybrid', tidalConnected: true, qobuzConnected: true, qobuzExperimentalEnabled: true, sourceRegistry: {}, currentTrack: track, loadLibrary: vi.fn().mockResolvedValue(undefined) });
  vi.mocked(searchSources).mockImplementation(async (_query, _enabled, update) => { update(emptySearch); return emptySearch; });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'get_download_folder') return { folder: 'C:\\Music', configured: true };
    if (command === 'get_track_download_options') return [option];
    if (command === 'get_track_download_jobs' || command === 'get_downloaded_file_paths') return [];
    if (command === 'set_download_folder') return (args as { folder: string }).folder;
    if (command === 'start_track_download') return job();
    return null;
  });
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    handlers.set(String(event), handler as (event: { payload: DownloadJob }) => void);
    return () => { handlers.delete(String(event)); };
  });
});

describe('track downloads', () => {
  it('retries a recovered job with the same ID and a newer revision', async () => {
    const interrupted = job({ status: 'recoverable', revision: 10 });
    useDownloadStore.getState().upsert(interrupted);
    vi.mocked(invoke).mockResolvedValue(job({ revision: 11, status: 'preparing' }));
    render(createElement(DownloadProgress, { job: interrupted }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(useDownloadStore.getState().jobs[0].status).toBe('preparing'));
    useDownloadStore.getState().upsert(job({ revision: 9, status: 'failed' }));
    expect(useDownloadStore.getState().jobs[0].revision).toBe(11);
    expect(useDownloadStore.getState().hidden).not.toContain(interrupted.id);
  });

  it('discards recovery records only after native cleanup succeeds', async () => {
    const interrupted = job({ status: 'recoverable' });
    useDownloadStore.getState().upsert(interrupted);
    vi.mocked(invoke).mockRejectedValueOnce('Cannot discard partial download');
    render(createElement(DownloadProgress, { job: interrupted }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await screen.findByRole('alert');
    expect(useDownloadStore.getState().jobs).toHaveLength(1);
    vi.mocked(invoke).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(useDownloadStore.getState().jobs).toHaveLength(0));
    expect(invoke).toHaveBeenCalledWith('discard_track_download', { jobId: interrupted.id });
  });

  it('offers Download Song for local tracks without a provider callback', () => {
    const local = { ...track, path: 'C:\\Music\\song.flac', format: 'FLAC' };
    const close = vi.fn();
    render(createElement(TrackContextMenu, { track: local, anchor: { x: 10, y: 10 }, onClose: close }));
    fireEvent.click(screen.getByRole('button', { name: 'Download Song' }));
    expect(close).toHaveBeenCalledOnce();
    expect(useDownloadStore.getState().track).toEqual(local);
  });

  it('keeps possible matches visible alongside confident matches without mutating the recording', () => {
    const candidate: PlaybackSource = { ...alternative, id: '789', metadata: { ...alternative.metadata!, duration: 245 }, match_assessment: 'equivalent' };
    const unrelated = { ...track, title: 'Different Song', path: '999', source_context: { ...sourceContext, sources: [{ ...alternative, id: '999' }] } };
    const result = { ...track, source_context: { ...sourceContext, sources: [alternative], display_candidates: [candidate] } };
    const before = JSON.stringify(selectedTrack);
    const copies = collectDownloadSources(selectedTrack, [result, unrelated]);
    expect(copies.find(copy => copy.id === '456')?.match_assessment).toBe('equivalent');
    expect(copies.find(copy => copy.id === '789')?.match_assessment).toBe('candidate');
    expect(copies.some(copy => copy.id === '999')).toBe(false);
    expect(JSON.stringify(selectedTrack)).toBe(before);
  });

  it('shows known copies while other providers are pending or fail', async () => {
    vi.mocked(searchSources).mockImplementation(async (_query, _enabled, update) => {
      const result = { ...emptySearch, pending: ['youtube'], errors: { tidal: 'Service unavailable' } };
      update(result); return result;
    });
    render(createElement(DownloadChooser, { track: selectedTrack }));
    expect(screen.getByRole('button', { name: /Qobuz/ })).toBeEnabled();
    expect(await screen.findByText('Checking youtube…')).toBeInTheDocument();
    expect(screen.getByText(/Couldn’t check tidal/)).toBeInTheDocument();
    expect(searchSources).toHaveBeenCalledWith(expect.any(String), { tidal: true, qobuz: true, youtube: true }, expect.any(Function));
  });

  it('downloads the chosen source and quality without changing playback or source preferences', async () => {
    const second = { ...option, id: '5', label: 'MP3', extension: 'mp3' };
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'get_download_folder') return { folder: 'C:\\Music', configured: true };
      if (command === 'get_track_download_options') return [option, second];
      if (command === 'start_track_download') return job({ option: second });
      return [];
    });
    useDownloadStore.getState().open(selectedTrack);
    const playback = useStore.getState().playback;
    render(createElement(DownloadManager));
    fireEvent.click(screen.getByRole('button', { name: /Qobuz/ }));
    const quality = await screen.findByRole('combobox', { name: 'Download quality' });
    fireEvent.change(quality, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('start_track_download', { source: expect.objectContaining({ provider: 'qobuz', id: '456' }), option: second, folder: 'C:\\Music', collision: 'ask' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('complementary', { name: 'Download notifications' })).toBeInTheDocument();
    expect(useStore.getState().currentTrack).toEqual(track);
    expect(useStore.getState().playback).toEqual(playback);
    expect(selectedTrack.source_context.selection).toEqual({ mode: 'auto' });
  });

  it('asks for the first destination and remembers the selected folder', async () => {
    vi.mocked(open).mockResolvedValue('D:\\Songs');
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'get_download_folder') return { folder: 'C:\\Downloads', configured: false };
      if (command === 'get_track_download_options') return [option];
      if (command === 'set_download_folder') return (args as { folder: string }).folder;
      if (command === 'start_track_download') return job();
      return [];
    });
    render(createElement(DownloadChooser, { track: selectedTrack }));
    fireEvent.click(screen.getByRole('button', { name: /Qobuz/ }));
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_download_folder', { folder: 'D:\\Songs' }));
    expect(invoke).toHaveBeenCalledWith('start_track_download', expect.objectContaining({ folder: 'D:\\Songs' }));
  });

  it('requires an explicit collision choice before keeping both files', async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'get_download_folder') return { folder: 'C:\\Music', configured: true };
      if (command === 'get_track_download_options') return [option];
      if (command === 'start_track_download') {
        if ((args as { collision: string }).collision === 'ask') throw 'FILE_EXISTS';
        return job();
      }
      return [];
    });
    render(createElement(DownloadChooser, { track: selectedTrack }));
    fireEvent.click(screen.getByRole('button', { name: /Qobuz/ }));
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep both' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('start_track_download', expect.objectContaining({ collision: 'keep_both' })));
  });

  it('ignores quality responses for a source that is no longer selected', async () => {
    let finishOld!: (options: DownloadOption[]) => void;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'get_download_folder') return { folder: 'C:\\Music', configured: true };
      if (command === 'get_track_download_options') {
        if ((args as { source: PlaybackSource }).source.provider === 'qobuz') return new Promise<DownloadOption[]>(resolve => { finishOld = resolve; });
        return [{ ...option, id: 'LOSSLESS', label: 'Tidal lossless' }];
      }
      return [];
    });
    render(createElement(DownloadChooser, { track: selectedTrack }));
    fireEvent.click(screen.getByRole('button', { name: /Qobuz/ }));
    await waitFor(() => expect(finishOld).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /Tidal/ }));
    await screen.findByRole('option', { name: 'Tidal lossless' });
    await act(async () => finishOld([option]));
    expect(screen.getByRole('combobox')).toHaveValue('LOSSLESS');
    expect(screen.queryByRole('option', { name: option.label })).not.toBeInTheDocument();
  });

  it('rechecks qualities when the same source is selected again after a failure', async () => {
    let attempts = 0;
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'get_download_folder') return { folder: 'C:\\Music', configured: true };
      if (command === 'get_track_download_options') {
        if (++attempts === 1) throw 'Temporary provider failure';
        return [option];
      }
      return [];
    });
    render(createElement(DownloadChooser, { track: selectedTrack }));
    fireEvent.click(screen.getByRole('button', { name: /Qobuz/ }));
    await screen.findByText('Temporary provider failure');
    fireEvent.click(screen.getByRole('button', { name: /Qobuz/ }));
    await screen.findByRole('option', { name: option.label });
    expect(attempts).toBe(2);
    expect(screen.queryByText('Temporary provider failure')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
  });

  it('shows exported files from a custom folder without a cache removal action', async () => {
    const exported = { ...track, id: 10, path: 'D:\\Songs\\Artist - Song.flac', format: 'FLAC' };
    useDownloadStore.setState({ paths: [exported.path] });
    useStore.setState({ tracks: [exported], cachedCloudHashes: [], fetchCachedCloudHashes: vi.fn().mockResolvedValue(undefined) });
    render(createElement(DownloadedView));
    await screen.findByText('Song');
    expect(screen.getByTitle('Play Track')).toBeInTheDocument();
    expect(screen.queryByTitle('Remove from Cache')).not.toBeInTheDocument();
  });

  it('uses the same cancellation command from both progress surfaces', async () => {
    render(createElement(Fragment, null, createElement(DownloadProgress, { job: job(), notification: true }), createElement(DownloadProgress, { job: job() })));
    const cancel = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(cancel[0]); fireEvent.click(cancel[1]);
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'cancel_track_download')).toEqual([
      ['cancel_track_download', { jobId: 'download-1' }], ['cancel_track_download', { jobId: 'download-1' }],
    ]));
  });

  it('shows indeterminate progress and byte count when total size is unknown', () => {
    render(createElement(DownloadProgress, { job: job({ downloaded: 2 * 1024 * 1024, total: null, percent: null }) }));
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    expect(screen.getByText('Downloading · 2.0 MB')).toBeInTheDocument();
  });

  it('retains completed progress when an older command response arrives', () => {
    useDownloadStore.getState().upsert(job({ revision: 5, status: 'completed', percent: 100 }));
    useDownloadStore.getState().upsert(job({ revision: 0, status: 'preparing', percent: null }));
    expect(useDownloadStore.getState().jobs[0].status).toBe('completed');
    expect(useDownloadStore.getState().jobs[0].percent).toBe(100);
  });

  it('shows completed downloads with a full bar on both progress surfaces', () => {
    render(createElement(Fragment, null,
      createElement(DownloadProgress, { job: job({ status: 'completed', saved: true, percent: null }), notification: true }),
      createElement(DownloadProgress, { job: job({ status: 'completed', saved: true, percent: null }) }),
    ));
    expect(screen.getAllByRole('status').map(status => status.textContent)).toEqual(['Completed · 100%', 'Completed · 100%']);
    for (const progress of screen.getAllByRole('progressbar')) expect(progress).toHaveAttribute('value', '100');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('shows completion after finalization and keeps it visible until dismissed', async () => {
    useDownloadStore.setState({ jobs: [job()] });
    render(createElement(DownloadManager));
    await waitFor(() => expect(handlers.has('track-download-progress')).toBe(true));
    act(() => handlers.get('track-download-progress')!({ payload: job({ revision: 2, status: 'finalizing', percent: 100 }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Saving file and adding to library…');
    expect(screen.queryByText('Downloads completed')).not.toBeInTheDocument();
    act(() => handlers.get('track-download-progress')!({ payload: job({ revision: 3, status: 'completed', saved: true, percent: 100 }) }));
    expect(screen.getByRole('status')).toHaveTextContent('Completed · 100%');
    expect(screen.getByText('Downloads completed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss download notification' }));
    expect(screen.queryByRole('complementary', { name: 'Download notifications' })).not.toBeInTheDocument();
    expect(useDownloadStore.getState().jobs[0].status).toBe('completed');
  });

  it('shows completion in the minimized notification without hiding failed downloads', () => {
    useDownloadStore.setState({ jobs: [job({ status: 'completed', saved: true, percent: 100 })] });
    render(createElement(DownloadManager));
    fireEvent.click(screen.getByRole('button', { name: 'Minimize download notifications' }));
    expect(screen.getByText('Downloads completed')).toBeInTheDocument();
    act(() => useDownloadStore.getState().upsert(job({ id: 'download-2', status: 'failed' })));
    expect(screen.queryByText('Downloads completed')).not.toBeInTheDocument();
    expect(screen.getByText('Downloads')).toBeInTheDocument();
  });

  it('minimizes the notification without stopping downloads and opens the full Downloaded view', async () => {
    useDownloadStore.setState({ jobs: [job(), job({ id: 'download-2' })] });
    render(createElement(DownloadManager));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('2 downloads in progress')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize download notifications' }));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(useDownloadStore.getState().jobs).toHaveLength(2);
    expect(invoke).not.toHaveBeenCalledWith('cancel_track_download', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Expand download notifications' }));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View all' }));
    expect(useStore.getState().view).toBe('downloaded');
    expect(screen.queryByRole('complementary', { name: 'Download notifications' })).not.toBeInTheDocument();
  });

  it('refreshes the library only after the backend reports completed finalization', async () => {
    render(createElement(DownloadManager));
    await waitFor(() => expect(handlers.has('track-download-progress')).toBe(true));
    act(() => handlers.get('track-download-progress')!({ payload: job({ status: 'finalizing' }) }));
    expect(useStore.getState().loadLibrary).not.toHaveBeenCalled();
    act(() => handlers.get('track-download-progress')!({ payload: job({ revision: 2, status: 'completed', saved: true, percent: 100 }) }));
    await waitFor(() => expect(useStore.getState().loadLibrary).toHaveBeenCalledOnce());
  });
});
