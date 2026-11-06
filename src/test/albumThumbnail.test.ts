import { createElement } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { AlbumThumbnail, albumArtCandidates, artCandidates } from '../components/AlbumThumbnail';

const art = (name: string) => `data:image/png;base64,${name}`;

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});

describe('album artwork candidates', () => {
  it('never offers a page URL or an audio stream as an image source', () => {
    expect(artCandidates({ path: 'https://www.youtube.com/watch?v=abc' })).toEqual([]);
    expect(artCandidates({ stream_url: 'https://cdn.example/a.flac' })).toEqual([]);
    expect(artCandidates({ path: 'org.example.music:123' })).toEqual(['org.example.music:123']);
    expect(artCandidates({ cover_url: 'https://img.example/c.jpg', path: 'https://www.youtube.com/watch?v=abc' })).toEqual(['https://img.example/c.jpg']);
  });

  it('puts the sample track first, then the other tracks, without repeats', () => {
    const sample = { path: 'C:/Music/a/01.flac' };
    const others = [sample, { path: 'C:/Music/a/02.flac' }, { path: 'C:/Music/a/02.flac' }, { cover_url: 'https://img.example/c.jpg' }];
    expect(albumArtCandidates(sample, others)).toEqual(['C:/Music/a/01.flac', 'C:/Music/a/02.flac', 'https://img.example/c.jpg']);
  });

  it('stops after a bounded number of fallback tracks', () => {
    const tracks = Array.from({ length: 50 }, (_, i) => ({ path: `C:/Music/a/${i}.flac` }));
    expect(albumArtCandidates(tracks[0], tracks).length).toBeLessThanOrEqual(9);
  });
});

describe('AlbumThumbnail', () => {
  it('uses another track on the album when the first track has no embedded art', async () => {
    vi.mocked(invoke).mockImplementation(async (_command, args: any) => (args.path.endsWith('02.flac') ? art('second') : null));
    const sample = { path: 'C:/Music/fallback/01.flac' };
    const { container } = render(createElement(AlbumThumbnail, { sampleTrack: sample, tracks: [sample, { path: 'C:/Music/fallback/02.flac' }], title: 'Album' }));
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(art('second')));
    expect(vi.mocked(invoke).mock.calls.map(([, args]) => (args as any).path)).toEqual(['C:/Music/fallback/01.flac', 'C:/Music/fallback/02.flac']);
  });

  it('keeps going when one file fails to read', async () => {
    vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
      if (args.path.endsWith('01.flac')) throw new Error('file is locked');
      return art('recovered');
    });
    const sample = { path: 'C:/Music/locked/01.flac' };
    const { container } = render(createElement(AlbumThumbnail, { sampleTrack: sample, tracks: [sample, { path: 'C:/Music/locked/02.flac' }], title: 'Album' }));
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(art('recovered')));
  });

  it('never asks the backend to fetch a page URL as artwork, and sends no referrer', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const { container } = render(createElement(AlbumThumbnail, { sampleTrack: { path: 'https://www.youtube.com/watch?v=abc' }, title: 'Stream' }));
    const img = container.querySelector('img')!;
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it('draws a remote cover directly without a backend call', async () => {
    const { container } = render(createElement(AlbumThumbnail, { sampleTrack: { cover_url: 'https://img.example/remote-cover.jpg' }, title: 'Remote' }));
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('https://img.example/remote-cover.jpg'));
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });
});
