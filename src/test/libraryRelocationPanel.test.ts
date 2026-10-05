import { createElement } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { LibraryRelocationPanel } from '../components/LibraryRelocationPanel';
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => 'D:\\Moved'), save: vi.fn(async () => 'C:\\fixture\\rollback.json') }));
vi.mock('../store', () => ({ useStore: { getState: vi.fn(() => ({})), setState: vi.fn() } }));
afterEach(cleanup);
it('shows conflicts and unresolved paths without offering apply', async () => {
  vi.mocked(invoke).mockResolvedValue({ old_root: 'C:\\Music', new_root: 'D:\\Moved', fingerprint: 'preview', mappings: [{ old_path: 'old', new_path: 'new' }], unresolved: ['Missing track'], conflicts: ['Target already belongs to another recording'], roots: [] });
  render(createElement(LibraryRelocationPanel, { oldRoot: 'C:\\Music', onClose: vi.fn(), onQuiesce: vi.fn(), onCommitted: vi.fn(), onFinished: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose replacement folder' }));
  await screen.findByText('Target already belongs to another recording');
  expect(screen.getByRole('button', { name: 'Save rollback and apply confirmed matches' })).toBeDisabled();
  expect(screen.getByText('Missing track')).toBeVisible();
});
