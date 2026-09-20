import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AlbumsView, ALBUM_VIEW_MODES, ALBUM_DESIGNS, formatAudioResolution, formatChannels, extractAlbumYear } from '../components/AlbumsView';
import { useStore } from '../store';
import { Track } from '../store/types';

describe('Album View Modes & Full-Page Layout Experiences (Anti-UI-Slop Edition)', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ albumViewMode: 'classic' });
  });

  it('exposes all 3 bespoke album view modes in ALBUM_VIEW_MODES (and ALBUM_DESIGNS)', () => {
    const ids = ALBUM_VIEW_MODES.map(d => d.id);
    expect(ids).toEqual(['classic', 'compact', 'editorial']);

    const legacyIds = ALBUM_DESIGNS.map(d => d.id);
    expect(legacyIds).toEqual(['classic', 'compact', 'editorial']);
  });

  it('initializes albumViewMode to classic by default and persists updates to localStorage', () => {
    expect(useStore.getState().albumViewMode).toBe('classic');

    useStore.getState().setAlbumViewMode('compact');
    expect(useStore.getState().albumViewMode).toBe('compact');
    expect(localStorage.getItem('aideo-album-view-mode')).toBe('compact');

    useStore.getState().setAlbumViewMode('editorial');
    expect(useStore.getState().albumViewMode).toBe('editorial');
    expect(localStorage.getItem('aideo-album-view-mode')).toBe('editorial');
  });

  const sampleTracks: Track[] = [
    {
      id: 1,
      path: 'C:/Music/Pink Floyd/1973 - The Dark Side of the Moon/01 - Speak to Me.flac',
      title: 'Speak to Me',
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
      duration: 90,
      format: 'FLAC',
      loved: 0,
      disliked: 0,
      lyric_offset: 0,
      catalog_quality: {
        lossless: true,
        sample_rate: 96000,
        bit_depth: 24,
      },
    },
    {
      id: 2,
      path: 'C:/Music/Dua Lipa/2020 - Future Nostalgia/01 - Future Nostalgia.mp3',
      title: 'Future Nostalgia',
      artist: 'Dua Lipa',
      album: 'Future Nostalgia',
      duration: 180,
      format: 'MP3',
      loved: 0,
      disliked: 0,
      lyric_offset: 0,
      catalog_quality: {
        lossless: false,
        sample_rate: 44100,
        bit_depth: 16,
      },
    }
  ];

  it('renders Mode 1: Classic Wall with virtualized grid and tactile cards', () => {
    const { container } = render(
      <AlbumsView tracks={sampleTracks} albumViewMode="classic" />
    );

    const gridWrap = container.querySelector('.albums-grid-wrap');
    expect(gridWrap).toHaveClass('album-view-classic');

    const albumCards = container.querySelectorAll('.album-card-classic');
    expect(albumCards.length).toBeGreaterThan(0);

    // Formats and virtual row
    expect(container.querySelector('.classic-format-chip')).toBeInTheDocument();
    expect(container.querySelector('.album-virtual-row')).toBeInTheDocument();
  });

  it('renders Mode 2: Compact Table with sortable columns and expandable inline accordion', () => {
    const { container } = render(
      <AlbumsView tracks={sampleTracks} albumViewMode="compact" />
    );

    // Table container and rows
    expect(container.querySelector('.compact-table-container')).toBeInTheDocument();
    const rows = container.querySelectorAll('.compact-table-row');
    expect(rows.length).toBe(2);

    // Initial state: accordion drawer is closed
    expect(container.querySelector('.compact-accordion-drawer')).not.toBeInTheDocument();

    // Click on the first row to expand accordion
    fireEvent.click(rows[0]!);

    // Accordion drawer is now visible with interactive tracklist
    const drawer = container.querySelector('.compact-accordion-drawer');
    expect(drawer).toBeInTheDocument();
    expect(drawer?.querySelector('.compact-track-list')).toBeInTheDocument();
    expect(drawer?.querySelectorAll('.compact-track-item').length).toBe(1);

    // Click again to collapse
    fireEvent.click(rows[0]!);
    expect(container.querySelector('.compact-accordion-drawer')).not.toBeInTheDocument();
  });

  it('sorts compact table when column headers are clicked', () => {
    const { container } = render(
      <AlbumsView tracks={sampleTracks} albumViewMode="compact" />
    );

    const yearHeader = container.querySelector('.compact-th-sortable:nth-of-type(3)');
    expect(yearHeader).toBeInTheDocument();

    // Click Year header to sort
    fireEvent.click(yearHeader!);

    const titles = Array.from(container.querySelectorAll('.compact-album-title')).map(el => el.textContent?.trim());
    // Descending year: Future Nostalgia (2020) should come before Dark Side of the Moon (1973)
    expect(titles[0]).toBe('Future Nostalgia');
  });

  it('renders Mode 3: Editorial Magazine with Hero Spotlight, curated shelves, and editorial catalog', () => {
    const { container } = render(
      <AlbumsView tracks={sampleTracks} albumViewMode="editorial" />
    );

    // Editorial Magazine container
    expect(container.querySelector('.editorial-magazine-container')).toBeInTheDocument();

    // Hero Spotlight
    expect(container.querySelector('.studio-hero-spotlight')).toBeInTheDocument();
    expect(container.querySelector('.hero-badge-spotlight')).toHaveTextContent('Editorial Spotlight');
    expect(container.querySelector('.hero-title')).toHaveTextContent('The Dark Side of the Moon');

    // Curated Shelves: Audiophile & Hi-Res Masters (Pink Floyd is FLAC)
    expect(container.querySelector('.studio-shelf-section')).toBeInTheDocument();
    expect(container.querySelector('.studio-shelf-title')).toHaveTextContent('Audiophile & Hi-Res Masters');

    // Editorial Catalog Grid
    expect(container.querySelector('.editorial-catalog-grid')).toBeInTheDocument();
    const editorialCards = container.querySelectorAll('.editorial-card');
    expect(editorialCards.length).toBe(2);
  });

  it('renders Gatefold Inspection Drawer with technical telemetry when album is selected', () => {
    const { container } = render(
      <AlbumsView tracks={sampleTracks} albumViewMode="classic" />
    );

    // Cards: [0] = Future Nostalgia (Dua Lipa, MP3), [1] = The Dark Side of the Moon (Pink Floyd, 24/96 FLAC)
    const albumCards = container.querySelectorAll('.album-card-classic');
    expect(albumCards.length).toBe(2);
    // Click Pink Floyd card
    fireEvent.click(albumCards[1]!);

    // Gatefold drawer opened
    const drawer = container.querySelector('.gatefold-drawer');
    expect(drawer).toBeInTheDocument();
    expect(container.textContent).toContain('GATEFOLD AUDIOPHILE ARCHIVE');

    // Telemetry items
    const labels = Array.from(container.querySelectorAll('.gatefold-telemetry-label')).map(el => el.textContent);
    expect(labels).toContain('Format');
    expect(labels).toContain('Quality');
    expect(labels).toContain('Year');
    expect(labels).toContain('Tracks');
    expect(labels).toContain('Duration');
    expect(labels).toContain('Channels');

    // Quality check: Pink Floyd has 24-bit 96kHz -> 24-bit Hi-Res Lossless
    expect(container.textContent).toContain('24-bit Hi-Res Lossless');
    expect(container.textContent).toContain('2.0 Stereo');

    // Track table inside drawer
    expect(container.querySelector('.track-table')).toBeInTheDocument();
  });

  it('extractAlbumYear accurately finds the consensus mode year for compilation tracks', () => {
    const compilationAlbum = {
      title: 'Decade Hits Compilation',
      sampleTrack: { path: 'C:/Music/Comp/01.flac' },
      tracks: [
        { year: 1999 },
        { year: 2024 },
        { year: 2024 },
        { year: 2024 },
        { year: 2023 }
      ]
    };
    expect(extractAlbumYear(compilationAlbum)).toBe(2024);
  });

  it('formatAudioResolution and formatChannels produce accurate audiophile labels', () => {
    expect(formatAudioResolution({ sample_rate: 96000, bit_depth: 24 })).toBe('24-bit / 96kHz');
    expect(formatAudioResolution({ sample_rate: 44100, bit_depth: 16 })).toBe('16-bit / 44.1kHz');
    expect(formatAudioResolution({ format: 'dsf' })).toBe('1-bit / DSD');
    expect(formatAudioResolution({ format: 'flac' })).toBe('16-bit / 44.1kHz');
    expect(formatAudioResolution({ format: 'mp3' })).toBeNull();

    expect(formatChannels({ channels: 1 })).toBe('1.0 Mono');
    expect(formatChannels({ channels: 2 })).toBe('2.0 Stereo');
    expect(formatChannels({ channels: 6 })).toBe('6.0 Surround');
    expect(formatChannels({})).toBe('2.0 Stereo');
  });
});
