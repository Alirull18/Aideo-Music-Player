import { createElement } from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { LibraryHealthPanel } from '../components/LibraryHealthPanel';
const state = vi.hoisted(() => ({ tracks: [], setCoverArtModalTrack: vi.fn(), setTagEditorTrack: vi.fn() }));
vi.mock('../store', () => ({ useStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }) }));
beforeEach(() => { vi.mocked(invoke).mockReset(); });
afterEach(cleanup);
it('filters a complete report and opens the existing tag editor', async () => {
  const track = { path: 'C:\\fixture\\song.mp3' };
  vi.mocked(invoke).mockImplementation(async command => command === 'get_track_by_path' ? track : { scan_id: 'test', checked: 1, total: 1, cancelled: false, invalidated: false, issues: [{ kind: 'incomplete_tags', paths: [track.path], detail: 'Missing album' }, { kind: 'unavailable_root', paths: ['Z:\\fixture'], detail: 'Offline folder' }] });
  render(createElement(LibraryHealthPanel));
  fireEvent.click(screen.getByRole('button', { name: 'Check library' }));
  await screen.findByText('Missing album');
  expect(screen.getByRole('button', { name: 'Locate moved folder' })).toBeEnabled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'incomplete_tags' } });
  expect(screen.queryByText('Offline folder')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
  await waitFor(() => expect(state.setTagEditorTrack).toHaveBeenCalledWith(track));
});
it('hides findings invalidated during a scan', async () => {
  vi.mocked(invoke).mockResolvedValue({ checked: 1, total: 1, cancelled: false, invalidated: true, issues: [{ kind: 'missing_file', paths: ['fixture'], detail: 'Old result' }] });
  render(createElement(LibraryHealthPanel)); fireEvent.click(screen.getByRole('button', { name: 'Check library' }));
  await screen.findByText('The library changed. Scan again to refresh these results.');
  expect(screen.queryByText('Old result')).toBeNull();
});
it('cancels the active native scan and withholds partial findings', async () => {
  let complete: (value: unknown) => void = () => {};
  vi.mocked(invoke).mockImplementation(command => command === 'scan_library_health' ? new Promise(resolve => { complete = resolve; }) : Promise.resolve(undefined));
  render(createElement(LibraryHealthPanel)); fireEvent.click(screen.getByRole('button', { name: 'Check library' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('scan_library_health', expect.anything()));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
  expect(invoke).toHaveBeenCalledWith('cancel_library_health', expect.objectContaining({ scanId: expect.any(String) }));
  complete({ cancelled: true, invalidated: false, issues: [{ kind: 'missing_file', paths: ['fixture'], detail: 'Partial result' }] });
  await screen.findByText('Scan cancelled. Run it again for a complete report.');
  expect(screen.queryByText('Partial result')).toBeNull();
});
