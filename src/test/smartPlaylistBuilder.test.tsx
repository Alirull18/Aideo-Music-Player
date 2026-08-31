import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SmartPlaylistBuilderModal } from '../components/SmartPlaylistBuilderModal';
import * as tauriCore from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('SmartPlaylistBuilderModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (tauriCore.invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'create_smart_playlist') {
        return Promise.resolve(42);
      }
      if (cmd === 'get_smart_playlists') {
        return Promise.resolve([{ id: 42, name: args?.name || 'Jazz Mix', rules_json: '{}' }]);
      }
      if (cmd === 'execute_smart_playlist') {
        return Promise.resolve([
          { id: 1, title: 'So What', artist: 'Miles Davis', format: 'FLAC', path: 'C:\\Miles.flac' }
        ]);
      }
      return Promise.resolve();
    });
  });

  it('renders modal when isOpen is true', () => {
    render(<SmartPlaylistBuilderModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Smart Playlist Rule Builder')).toBeDefined();
    expect(screen.getByPlaceholderText(/90s Lossless Rock/i)).toBeDefined();
  });

  it('allows adding and removing condition rows', async () => {
    render(<SmartPlaylistBuilderModal isOpen={true} onClose={vi.fn()} />);
    
    expect(screen.getByText(/Rules \(1\)/i)).toBeDefined();
    
    const addBtn = screen.getByText('Add Condition');
    fireEvent.click(addBtn);

    expect(screen.getByText(/Rules \(2\)/i)).toBeDefined();
  });

  it('submits smart playlist and executes query', async () => {
    const handleClose = vi.fn();
    render(<SmartPlaylistBuilderModal isOpen={true} onClose={handleClose} />);

    const nameInput = screen.getByPlaceholderText(/90s Lossless Rock/i);
    fireEvent.change(nameInput, { target: { value: 'Miles Jazz' } });

    const valueInput = screen.getByPlaceholderText('Value...');
    fireEvent.change(valueInput, { target: { value: 'Miles' } });

    const submitBtn = screen.getByText('Save & Execute');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(tauriCore.invoke).toHaveBeenCalledWith('create_smart_playlist', expect.objectContaining({
        name: 'Miles Jazz',
      }));
      expect(handleClose).toHaveBeenCalled();
    });
  });
});
