import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DownloadedView } from '../components/DownloadedView';
import { useStore } from '../store';
import * as tauriCore from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockTracks = [
  {
    id: 1,
    path: 'https://subsonic.local/stream/track1',
    path_hash: 'hash-track-1',
    title: 'Cached Subsonic Track',
    artist: 'Cloud Singer',
    album: 'Cloud Album',
    duration: 240,
    format: 'SUBSONIC',
    lyric_offset: 0,
  },
  {
    id: 2,
    path: 'C:\\Music\\local.flac',
    path_hash: 'hash-local-2',
    title: 'Local FLAC Track',
    artist: 'Local Artist',
    album: 'Local Album',
    duration: 180,
    format: 'FLAC',
    lyric_offset: 0,
  },
  {
    id: 3,
    path: 'C:\\Users\\User\\Music\\Aideo Downloads\\YouTube Artist - Offline Song.mp3',
    path_hash: 'hash-downloaded-3',
    title: 'Offline Song',
    artist: 'YouTube Artist',
    album: 'YouTube Album',
    duration: 210,
    format: 'MP3',
    lyric_offset: 0,
  }
];

describe('DownloadedView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      tracks: [...mockTracks],
      cachedCloudHashes: ['hash-track-1'],
    });

    (tauriCore.invoke as any).mockImplementation((cmd: string, args: any) => {
      if (cmd === 'get_library') {
        return Promise.resolve([...mockTracks]);
      }
      if (cmd === 'get_cache_size_info') {
        return Promise.resolve({
          total_bytes: 52428800, // 50 MB
          total_mb: 50.0,
          file_count: 12
        });
      }
      if (cmd === 'get_all_cached_cloud_hashes') {
        return Promise.resolve(['hash-track-1']);
      }
      if (cmd === 'open_cache_folder') {
        return Promise.resolve();
      }
      if (cmd === 'prune_cache_to_limit') {
        return Promise.resolve(args);
      }
      if (cmd === 'delete_cached_track') {
        return Promise.resolve();
      }
      return Promise.resolve();
    });
  });

  it('renders storage utilization, cached offline streams, and downloaded local tracks', async () => {
    render(<DownloadedView />);

    expect(screen.getByText('Downloaded & Offline Cache')).toBeDefined();
    
    await waitFor(() => {
      expect(screen.getByText(/12 cached audio files/i)).toBeDefined();
    });

    expect(screen.getByText('Cached Subsonic Track')).toBeDefined();
    expect(screen.getByText('Cloud Singer')).toBeDefined();
    // Local downloaded track from Aideo Downloads directory should be displayed
    expect(screen.getByText('Offline Song')).toBeDefined();
    expect(screen.getByText('YouTube Artist')).toBeDefined();
    // Local non-stream, non-download track should not be displayed in downloaded view
    expect(screen.queryByText('Local FLAC Track')).toBeNull();
  });

  it('filters downloaded and cached tracks based on search query', async () => {
    render(<DownloadedView />);

    expect(screen.getByText('Available Offline Tracks (2)')).toBeDefined();

    const searchInput = screen.getByPlaceholderText('Search downloaded tracks...');
    fireEvent.change(searchInput, { target: { value: 'Offline' } });

    expect(screen.getByText('Available Offline Tracks (1)')).toBeDefined();
    expect(screen.getByText('Offline Song')).toBeDefined();
  });

  it('triggers open folder when Open Folder button is clicked', async () => {
    render(<DownloadedView />);
    
    const openBtn = screen.getByText('Open Folder');
    fireEvent.click(openBtn);

    expect(tauriCore.invoke).toHaveBeenCalledWith('open_cache_folder');
  });

  it('triggers prune to 5GB when Prune button is clicked', async () => {
    render(<DownloadedView />);
    
    const pruneBtn = screen.getByText('Prune to 5GB');
    fireEvent.click(pruneBtn);

    expect(tauriCore.invoke).toHaveBeenCalledWith('prune_cache_to_limit', { maxMb: 5000 });
  });
});
