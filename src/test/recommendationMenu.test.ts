import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { TrackContextMenu } from '../components/TrackContextMenu';
import { useStore, type Track } from '../store';
import type { ToastDetail } from '../utils/toast';

const song: Track = { id: 1, path: 'C:/Music/song.flac', title: 'Song', artist: 'Artist', duration: 180, format: 'FLAC', lyric_offset: 0, loved: 1 };
let toasts: ToastDetail[];
const receiveToast = (event: Event) => { toasts.push((event as CustomEvent<ToastDetail>).detail); };
beforeEach(() => {
  localStorage.clear();
  toasts = [];
  window.addEventListener('ui-toast', receiveToast);
  vi.mocked(invoke).mockReset().mockImplementation(async command => command === 'get_playlists' ? [] : null);
  useStore.setState({ tracks: [{ ...song }], queue: [], currentTrack: null, currentPlaylist: null, playlists: [], sourceQueueManaged: false });
});
afterEach(() => { cleanup(); window.removeEventListener('ui-toast', receiveToast); });
const openMenu = (track = song) => {
  const close = vi.fn();
  render(createElement(TrackContextMenu, { track, anchor: { x: 10, y: 10 }, onClose: close }));
  return close;
};

it('saves Not interested and Undo restores the former favorite', async () => {
  const close = openMenu();
  fireEvent.click(screen.getByRole('button', { name: 'Not interested' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(useStore.getState().tracks[0]).toMatchObject({ disliked: 1, loved: 0 });
  expect(toasts[0]).toMatchObject({ message: 'Removed from your recommendations', action: { label: 'Undo' } });
  act(() => toasts[0].action!.onClick());
  await waitFor(() => expect(useStore.getState().tracks[0]).toMatchObject({ disliked: 0, loved: 1 }));
  expect(invoke).toHaveBeenCalledWith('set_recommendation_interest', expect.objectContaining({ interested: false }));
  expect(invoke).toHaveBeenCalledWith('set_recommendation_interest', expect.objectContaining({ interested: true }));
});

it('allows recommendations again without inventing a favorite', async () => {
  const disliked = { ...song, disliked: 1, loved: 0 };
  useStore.setState({ tracks: [disliked] });
  const close = openMenu(disliked);
  fireEvent.click(screen.getByRole('button', { name: 'Allow recommendations again' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(useStore.getState().tracks[0]).toMatchObject({ disliked: 0, loved: 0 });
  expect(toasts[0]).toMatchObject({ message: 'Recommendations allowed again' });
  expect(toasts[0].action).toBeUndefined();
});

it('disables feedback while saving and keeps the menu open after a truthful error', async () => {
  let fail!: (error: Error) => void;
  vi.mocked(invoke).mockImplementation(async command => command === 'set_recommendation_interest'
    ? new Promise((_resolve, reject) => { fail = reject; }) : null);
  const close = openMenu();
  const button = screen.getByRole('button', { name: 'Not interested' });
  fireEvent.click(button);
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'set_recommendation_interest')).toHaveLength(1);
  await act(async () => fail(new Error('disk full')));
  await waitFor(() => expect(button).toBeEnabled());
  expect(close).not.toHaveBeenCalled();
  expect(useStore.getState().tracks[0]).toMatchObject({ loved: 1 });
  expect(useStore.getState().tracks[0].disliked).not.toBe(1);
  expect(toasts).toEqual([expect.objectContaining({ type: 'error', message: 'Could not save preference: Error: disk full' })]);
});

it('an old Undo cannot overwrite feedback saved later', async () => {
  openMenu();
  fireEvent.click(screen.getByRole('button', { name: 'Not interested' }));
  await waitFor(() => expect(toasts[0]?.action).toBeDefined());
  const undo = toasts[0].action!.onClick;
  await act(async () => {
    await useStore.getState().setRecommendationInterest(song, true);
    await useStore.getState().setRecommendationInterest(song, false);
  });
  const calls = vi.mocked(invoke).mock.calls.length;
  act(() => undo());
  expect(vi.mocked(invoke).mock.calls).toHaveLength(calls);
  expect(useStore.getState().tracks[0]).toMatchObject({ disliked: 1, loved: 0 });
});
