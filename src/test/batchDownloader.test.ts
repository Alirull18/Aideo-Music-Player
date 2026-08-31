import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Batch Downloader & Tagger Store Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      batchDownloadProgress: null,
    });
  });

  it('initializes with null batchDownloadProgress', () => {
    const state = useStore.getState();
    expect(state.batchDownloadProgress).toBeNull();
  });

  it('triggers download_playlist_batch IPC command with correct arguments', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce(3); // 3 tracks downloaded

    const items = [
      { url: 'https://youtube.com/watch?v=123', title: 'Track One', artist: 'Artist A', album: 'Album X' },
      { url: 'https://youtube.com/watch?v=456', title: 'Track Two', artist: 'Artist A', album: 'Album X' },
      { url: 'https://youtube.com/watch?v=789', title: 'Track Three', artist: 'Artist A', album: 'Album X' },
    ];

    const result = await useStore.getState().downloadBatchPlaylist(items, 'Album X');

    expect(result).toBe(3);
    expect(mockInvoke).toHaveBeenCalledWith('download_playlist_batch', {
      items,
      quality: 'high',
      playlistName: 'Album X',
    });
  });

  it('handles empty items safely without invoking backend', async () => {
    const mockInvoke = vi.mocked(invoke);
    const result = await useStore.getState().downloadBatchPlaylist([]);
    expect(result).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('handles errors gracefully and updates error state in batchDownloadProgress', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockRejectedValueOnce(new Error('Network failure'));

    const items = [
      { url: 'https://youtube.com/watch?v=123', title: 'Track One', artist: 'Artist A' }
    ];

    const result = await useStore.getState().downloadBatchPlaylist(items, 'Test');
    expect(result).toBe(0);
    const progress = useStore.getState().batchDownloadProgress;
    expect(progress?.is_done).toBe(true);
    expect(progress?.error).toContain('Network failure');
  });
});
