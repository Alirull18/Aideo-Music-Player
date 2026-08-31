import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlbumsView } from '../components/AlbumsView';
import { Track } from '../store/types';

describe('AlbumsView 2D Grid Virtualization', () => {
  it('renders correctly with empty album list', () => {
    render(<AlbumsView tracks={[]} />);
    expect(screen.getByText(/No albums found/i)).toBeInTheDocument();
  });

  it('renders a list of albums into virtualized row structure for large libraries', () => {
    const tracks: Track[] = [];
    for (let i = 1; i <= 60; i++) {
      tracks.push({
        id: i,
        path: `C:/Music/Artist ${i}/Album ${i}/01 - Song.flac`,
        title: `Song ${i}`,
        artist: `Artist ${i}`,
        album: `Album ${i}`,
        duration: 200,
        format: 'FLAC',
        loved: 0,
        disliked: 0,
        lyric_offset: 0,
      });
    }

    const { container } = render(<AlbumsView tracks={tracks} />);
    
    // Check that the grid wrapper is present
    const gridWrap = container.querySelector('.albums-grid-wrap');
    expect(gridWrap).toBeInTheDocument();

    // Check that the virtualized rows are rendered
    const virtualRows = container.querySelectorAll('.album-virtual-row');
    expect(virtualRows.length).toBeGreaterThan(0);
    expect(virtualRows.length).toBeLessThanOrEqual(60);
  });
});
