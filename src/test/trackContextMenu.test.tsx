import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { TrackContextMenu } from '../components/TrackContextMenu';
import { useStore } from '../store';
import { Track } from '../store/types';

describe('TrackContextMenu', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const localTrack: Track = {
    id: 1,
    path: 'C:\\Music\\test_song.flac',
    title: 'Test Local Song',
    artist: 'Local Artist',
    album: 'Local Album',
    duration: 180,
    format: 'FLAC',
    lyric_offset: 0,
  };

  const streamingTrack = {
    id: -1,
    url: 'https://tidal.com/track/99999',
    title: 'Test Stream Song',
    artist: 'Stream Artist',
    duration_raw: '3:30',
  };

  const anchor = { x: 100, y: 100 };

  it('renders local track actions properly and executes store actions', () => {
    const onClose = vi.fn();
    const playNextSpy = vi.spyOn(useStore.getState(), 'playNextInQueue').mockImplementation(async () => true);
    const addToQueueSpy = vi.spyOn(useStore.getState(), 'addToQueue').mockImplementation(async () => {});
    const setPlaylistModalTrackSpy = vi.spyOn(useStore.getState(), 'setPlaylistModalTrack').mockImplementation(() => {});

    render(
      <TrackContextMenu
        track={localTrack}
        anchor={anchor}
        onClose={onClose}
      />
    );

    // Should display local track options
    expect(screen.getByText('Play Next')).toBeInTheDocument();
    expect(screen.getByText('Add to Queue')).toBeInTheDocument();
    expect(screen.getByText('Manage Cover Art')).toBeInTheDocument();
    expect(screen.getByText('Edit Audio Tags')).toBeInTheDocument();
    expect(screen.getByText('Other Audio Sources')).toBeInTheDocument();
    expect(screen.getByText('Add to Playlist...')).toBeInTheDocument();
    expect(screen.getByText('Delete Song')).toBeInTheDocument();

    // Should NOT show streaming-specific save song
    expect(screen.queryByText('Save Song')).not.toBeInTheDocument();

    // Test clicking Add to Playlist
    fireEvent.click(screen.getByText('Add to Playlist...'));
    expect(setPlaylistModalTrackSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test Local Song' }));
    expect(onClose).toHaveBeenCalled();

    // Test clicking Play Next
    fireEvent.click(screen.getByText('Play Next'));
    expect(playNextSpy).toHaveBeenCalled();

    // Test clicking Add to Queue
    fireEvent.click(screen.getByText('Add to Queue'));
    expect(addToQueueSpy).toHaveBeenCalled();
  });

  it('renders streaming track actions properly and excludes local-only actions', () => {
    const onClose = vi.fn();
    const toggleLoveSpy = vi.spyOn(useStore.getState(), 'toggleLoveTrack').mockResolvedValue(true);

    render(
      <TrackContextMenu
        track={streamingTrack}
        anchor={anchor}
        onClose={onClose}
      />
    );

    // Should display streaming safe options
    expect(screen.getByText('Play Next')).toBeInTheDocument();
    expect(screen.getByText('Add to Queue')).toBeInTheDocument();
    expect(screen.getByText('Other Audio Sources')).toBeInTheDocument();
    expect(screen.getByText('Add to Playlist...')).toBeInTheDocument();
    expect(screen.getByText('Save Song')).toBeInTheDocument();

    // Should NOT show local-only actions
    expect(screen.queryByText('Manage Cover Art')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit Audio Tags')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Song')).not.toBeInTheDocument();

    // Click Save Song
    fireEvent.click(screen.getByText('Save Song'));
    expect(toggleLoveSpy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape key and on backdrop click', () => {
    const onClose = vi.fn();

    render(
      <TrackContextMenu
        track={localTrack}
        anchor={anchor}
        onClose={onClose}
      />
    );

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Click backdrop
    const backdrop = document.querySelector('.track-action-menu-backdrop');
    expect(backdrop).toBeInTheDocument();
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(2);
    }
  });
});
