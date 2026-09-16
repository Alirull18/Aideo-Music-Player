import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { SourceMenu } from '../components/SourceMenu';
import { UnifiedSearchResults } from '../components/UnifiedSearchResults';
import { AideoView } from '../components/AideoView';
import { useStore, type Track } from '../store';

const track: Track = { id: 1, path: '123', title: 'Song', artist: 'Artist', duration: 180, format: 'Tidal FLAC', lyric_offset: 0,
  playlist_entry_id: 12, source_context: { recording_id: 'recording', sources: [{ provider: 'tidal', id: '123' }, { provider: 'qobuz', id: '456' }], selection: { mode: 'auto' } } };
const localTrack: Track = { id: 2, path: 'C:/Music/song.flac', title: 'Song', artist: 'Artist', album: 'Album', duration: 180, format: 'FLAC', lyric_offset: 0 };
const youtubeTrack: Track = { id: -1, path: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Song (Official Audio)', artist: 'Artist', duration: 181, format: 'YouTube Direct', lyric_offset: 0 };

const sourceSearchResult = (cmd: string) => {
  if (cmd === 'search_local_sources') return [localTrack];
  if (cmd === 'search_youtube') return [{ id: 'abcdefghijk', url: youtubeTrack.path, title: youtubeTrack.title, artist: youtubeTrack.artist, duration: youtubeTrack.duration }];
  if (cmd === 'tidal_search') return [{ id: '123', title: 'Song', artist: 'Artist', album: 'Album', duration: 180, quality: 'LOSSLESS', recording_evidence: { isrc: 'USAAA2600001', upc: '0123456789012' } }];
  if (cmd === 'qobuz_search') return [{ id: '456', title: 'Song', artist: 'Artist', album: 'Album', duration: 180, quality: 'LOSSLESS', recording_evidence: { isrc: 'USAAA2600001', upc: '0123456789012' } }];
  return null;
};

describe('Unified source controls', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset().mockImplementation(async cmd => String(cmd).includes('search') ? [] : null);
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    useStore.setState({ tracks: [track], queue: [], currentTrack: null, tidalConnected: true, qobuzConnected: true, qobuzExperimentalEnabled: true });
  });
  afterEach(cleanup);

  it('saves an explicit source by entry ID and supports returning to Auto', async () => {
    render(createElement(SourceMenu, { track }));
    fireEvent.click(screen.getByRole('button', { name: 'Other sources' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Qobuz' })).toBeEnabled());
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Qobuz' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(invoke).toHaveBeenCalledWith('update_playlist_source', expect.objectContaining({ entryId: 12, sourceContext: expect.objectContaining({ selection: { mode: 'explicit', source: { provider: 'qobuz', id: '456' } } }) }));
    cleanup();
    render(createElement(SourceMenu, { track: useStore.getState().tracks[0] }));
    fireEvent.click(screen.getByRole('button', { name: 'Other sources' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Auto/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Auto/ }));
    await waitFor(() => expect(useStore.getState().tracks[0].source_context?.selection.mode).toBe('auto'));
  });

  it('switches the playing recording to the selected source at the current position', async () => {
    const current = { ...track, active_source: track.source_context!.sources[0] };
    const play = vi.spyOn(useStore.getState(), 'playTrack').mockResolvedValue(undefined);
    useStore.setState({
      currentTrack: current,
      playback: { ...useStore.getState().playback, status: 'Playing', position_secs: 83 },
    });

    render(createElement(SourceMenu, { track: current }));
    fireEvent.click(screen.getByRole('button', { name: 'Other sources' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Qobuz' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Qobuz' }));

    await waitFor(() => expect(play).toHaveBeenCalledWith(
      expect.objectContaining({ source_context: expect.objectContaining({ selection: { mode: 'explicit', source: { provider: 'qobuz', id: '456' } } }) }),
      true,
      false,
      undefined,
      83,
      true,
    ));
    play.mockRestore();
  });

  it('does not restart an old track if playback changes while the source choice is saving', async () => {
    let finishSave!: () => void;
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'update_playlist_source') return new Promise<void>(resolve => { finishSave = resolve; });
      return sourceSearchResult(String(cmd));
    });
    const current = { ...track, active_source: track.source_context!.sources[0] };
    const play = vi.spyOn(useStore.getState(), 'playTrack').mockResolvedValue(undefined);
    useStore.setState({ currentTrack: current, playback: { ...useStore.getState().playback, status: 'Playing', position_secs: 83 } });

    render(createElement(SourceMenu, { track: current }));
    fireEvent.click(screen.getByRole('button', { name: 'Other sources' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Qobuz' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Qobuz' }));
    await waitFor(() => expect(finishSave).toBeTypeOf('function'));
    useStore.setState({ currentTrack: localTrack, playback: { ...useStore.getState().playback, position_secs: 91 } });
    finishSave();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(play).not.toHaveBeenCalled();
    play.mockRestore();
  });

  it('keeps the dialog open with an actionable error when persistence fails', async () => {
    vi.mocked(invoke).mockImplementation(async cmd => {
      if (cmd === 'update_playlist_source') throw new Error('Database unavailable');
      return [];
    });
    render(createElement(SourceMenu, { track }));
    fireEvent.click(screen.getByRole('button', { name: 'Other sources' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Qobuz' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Qobuz' }));
    expect(await screen.findByText(/Could not save source choice/)).toBeVisible();
    expect(useStore.getState().tracks[0].source_context?.selection.mode).toBe('auto');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['local file', localTrack, /^Tidal$/],
    ['web stream', youtubeTrack, /^Local file/],
  ])('discovers other sources when opened from a %s', async (_name, sourceTrack, expectedSource) => {
    vi.mocked(invoke).mockImplementation(async cmd => sourceSearchResult(String(cmd)));
    useStore.setState({ tracks: [sourceTrack], appMode: 'hybrid' });
    render(createElement(SourceMenu, { track: sourceTrack }));
    fireEvent.click(screen.getByRole('button', { name: 'Other sources' }));
    await waitFor(() => expect(screen.getByRole('button', { name: expectedSource })).toBeEnabled());
  });

  it('shows completed results alongside pending and failed sources', () => {
    const play = vi.spyOn(useStore.getState(), 'playTrack').mockResolvedValue(undefined);
    render(createElement(UnifiedSearchResults, { result: { tracks: [track], pending: ['youtube'], errors: { local: 'Offline' } } }));
    expect(screen.getByText('Searching youtube...')).toBeVisible();
    expect(screen.getByText(/Could not search local/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Play Song by Artist' }));
    expect(play).toHaveBeenCalledWith(track);
    play.mockRestore();
  });

  it('connects the classic All sources search to unified provider results', async () => {
    vi.mocked(invoke).mockImplementation(async cmd => sourceSearchResult(String(cmd)));
    useStore.setState({
      tracks: [localTrack],
      aideoPageDesign: 'classic',
      appMode: 'hybrid',
      tidalConnected: true,
      qobuzConnected: true,
      qobuzExperimentalEnabled: true,
    });

    render(createElement(AideoView));
    fireEvent.click(screen.getByText('Source filter: All sources'));
    expect(screen.getByRole('button', { name: 'All sources' })).toBeVisible();
    const input = screen.getByPlaceholderText('Search songs, artists, or paste a link...');
    fireEvent.change(input, { target: { value: 'Song Artist' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByRole('region', { name: 'Unified search results' })).toBeVisible();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('search_local_sources', { query: 'Song Artist' }));
    expect(invoke).toHaveBeenCalledWith('search_youtube', { query: 'Song Artist' });
    expect(invoke).toHaveBeenCalledWith('tidal_search', { query: 'Song Artist' });
    expect(invoke).toHaveBeenCalledWith('qobuz_search', { query: 'Song Artist' });
  });
});
