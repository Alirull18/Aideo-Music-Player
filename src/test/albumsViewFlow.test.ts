import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { AlbumsView } from '../components/AlbumsView';
import { useStore, type Track } from '../store';

const initialState = useStore.getState();
const track = (id: number, title: string, album = 'Night Drive'): Track => ({
  id, path: `C:/Music/${album}/${String(id).padStart(2, '0')}.flac`, title, artist: 'Kora', album, duration: 200 + id,
  format: 'FLAC', lyric_offset: 0,
});
const tracks = [track(1, 'Opening'), track(2, 'Second Wind'), track(3, 'Closer', 'Other Album')];

describe('Albums view flow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    useStore.setState({ ...initialState, tracks, playlists: [] });
  });

  afterEach(() => {
    cleanup();
    useStore.setState(initialState, true);
  });

  it('shows each album as a cover with title, artist and counts, all as real controls', async () => {
    render(createElement(AlbumsView));
    const open = await screen.findByRole('button', { name: 'Open Night Drive by Kora' });
    expect(open).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play Night Drive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Love Night Drive' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/2 tracks/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Options for Night Drive' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the drawer from the cover, lists tracks, and closes on Escape', async () => {
    render(createElement(AlbumsView));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Night Drive by Kora' }));
    const drawer = await screen.findByRole('dialog', { name: 'Night Drive by Kora' });
    expect(within(drawer).getByRole('heading', { name: 'Night Drive' })).toBeInTheDocument();
    expect(within(drawer).getByText('Opening')).toBeInTheDocument();
    expect(within(drawer).getByText('Second Wind')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Night Drive by Kora' })).not.toBeInTheDocument());
  });

  it('plays a track from the drawer with the keyboard', async () => {
    const playTrack = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ playTrack } as any);
    render(createElement(AlbumsView));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Night Drive by Kora' }));
    const row = (await screen.findByText('Second Wind')).closest('tr')!;
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    await waitFor(() => expect(playTrack).toHaveBeenCalled());
  });

  it('opens the options menu, closes it on Escape, then on an outside press', async () => {
    render(createElement(AlbumsView));
    const trigger = await screen.findByRole('button', { name: 'Options for Night Drive' });
    fireEvent.click(trigger);
    expect(await screen.findByRole('menu', { name: 'Night Drive actions' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: /Delete album/ })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    fireEvent.click(trigger);
    await screen.findByRole('menu');
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('filters to loved albums and explains an empty result', async () => {
    render(createElement(AlbumsView));
    fireEvent.click(await screen.findByRole('button', { name: 'Love Night Drive' }));
    expect(screen.getByRole('button', { name: 'Remove Night Drive from loved albums' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Loved/ }));
    expect(await screen.findByRole('button', { name: 'Open Night Drive by Kora' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Other Album by Kora' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Night Drive from loved albums' }));
    expect(await screen.findByRole('status')).toHaveTextContent('No loved albums bookmarked yet');
  });
});
