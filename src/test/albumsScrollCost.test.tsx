import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useStore, type Track } from '../store';

let thumbRenders = 0;
vi.mock('../components/AlbumThumbnail', () => ({
  AlbumThumbnail: () => { thumbRenders++; return null; },
}));
import { AlbumsView } from '../components/AlbumsView';

const initialState = useStore.getState();
const tracks: Track[] = Array.from({ length: 74 }, (_, i) => ({
  id: i + 1, path: `C:/Music/Album ${i}/01.flac`, title: `Song ${i}`, artist: 'Kora', album: `Album ${i}`,
  duration: 200, format: 'FLAC', lyric_offset: 0,
}));
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('Albums wall render cost', () => {
  let holder: HTMLDivElement;

  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    useStore.setState({ ...initialState, tracks, playlists: [] });
    thumbRenders = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    holder = document.createElement('div');
    holder.style.overflowY = 'auto';
    Object.defineProperty(holder, 'clientHeight', { configurable: true, value: 800 });
    Object.defineProperty(holder, 'clientWidth', { configurable: true, value: 1000 });
    document.body.appendChild(holder);
  });

  afterEach(() => {
    cleanup();
    holder.remove();
    vi.unstubAllGlobals();
    useStore.setState(initialState, true);
  });

  const scrollTo = (top: number) => act(async () => {
    holder.scrollTop = top;
    holder.dispatchEvent(new Event('scroll'));
    await tick();
  });

  it('does not re-render any card while scrolling inside the same row', async () => {
    render(createElement(AlbumsView), { container: holder });
    await act(async () => {});
    const before = thumbRenders;
    for (let top = 3; top <= 90; top += 3) await scrollTo(top);
    expect(thumbRenders - before).toBe(0);
  });

  it('mounts new rows when the scroll crosses a row, without redrawing the rows that stay', async () => {
    const { container } = render(createElement(AlbumsView), { container: holder });
    await act(async () => {});
    const mounted = container.querySelectorAll('.album-card').length;
    const before = thumbRenders;
    await scrollTo(1500);
    expect(container.querySelector('.album-title')?.textContent).not.toBe('Album 0');
    expect(thumbRenders - before).toBeLessThanOrEqual(mounted);
  });

  it('re-renders only the card whose menu opened', async () => {
    render(createElement(AlbumsView), { container: holder });
    await act(async () => {});
    const before = thumbRenders;
    fireEvent.click(screen.getAllByRole('button', { name: /^Options for/ })[0]);
    await screen.findByRole('menu');
    expect(thumbRenders - before).toBeLessThanOrEqual(1);
  });
});
