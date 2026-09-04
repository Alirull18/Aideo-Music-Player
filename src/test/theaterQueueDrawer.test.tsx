import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TheaterQueueDrawer } from '../components/theater/TheaterQueueDrawer';
import { useStore } from '../store';

describe('TheaterQueueDrawer', () => {
  beforeEach(() => {
    useStore.setState({
      queue: [
        {
          id: 101,
          path: 'C:/music/track1.flac',
          title: 'Upcoming Song 1',
          artist: 'Artist A',
          album: 'Album A',
          duration: 200,
          format: 'FLAC 96kHz',
          lyric_offset: 0,
        },
        {
          id: 102,
          path: 'C:/music/track2.flac',
          title: 'Upcoming Song 2',
          artist: 'Artist B',
          album: 'Album B',
          duration: 180,
          format: 'FLAC 44.1kHz',
          lyric_offset: 0,
        },
      ],
      currentTrack: {
        id: 100,
        path: 'C:/music/now.flac',
        title: 'Now Playing Song',
        artist: 'Current Artist',
        album: 'Current Album',
        duration: 240,
        format: 'FLAC 96kHz',
        lyric_offset: 0,
      },
      playback: {
        ...useStore.getState().playback,
        current_track: 'C:/music/now.flac',
        position_secs: 60,
        status: 'Playing',
      },
    });
  });

  it('renders currently playing track and upcoming queue items', () => {
    render(<TheaterQueueDrawer isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Now Playing Song')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Song 1')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Song 2')).toBeInTheDocument();
    expect(screen.getByText(/Up Next \(2\)/)).toBeInTheDocument();
  });

  it('triggers playFromQueue on track click', () => {
    const playFromQueueSpy = vi.fn();
    useStore.setState({ playFromQueue: playFromQueueSpy });

    render(<TheaterQueueDrawer isOpen={true} onClose={vi.fn()} />);
    const trackItem = screen.getByText('Upcoming Song 1');
    fireEvent.click(trackItem);

    expect(playFromQueueSpy).toHaveBeenCalledWith(0);
  });

  it('triggers clearQueue when clear button is clicked', () => {
    const clearQueueSpy = vi.fn();
    useStore.setState({ clearQueue: clearQueueSpy });

    render(<TheaterQueueDrawer isOpen={true} onClose={vi.fn()} />);
    const clearBtn = screen.getByTitle('Clear all upcoming tracks');
    fireEvent.click(clearBtn);

    expect(clearQueueSpy).toHaveBeenCalled();
  });

  it('renders empty queue message when queue has no items', () => {
    useStore.setState({ queue: [] });
    render(<TheaterQueueDrawer isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Queue is empty/i)).toBeInTheDocument();
  });
});
