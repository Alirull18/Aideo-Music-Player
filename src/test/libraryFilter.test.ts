import { describe, it, expect } from 'vitest';

const isStreamTrack = (path: string, format?: string | null) => {
  return path.startsWith('http://') || path.startsWith('https://') || format === 'YouTube Direct' || format === 'Tidal FLAC' || format === 'Qobuz FLAC' || format === 'SUBSONIC' || format === 'JELLYFIN';
};

const isLosslessTrack = (t: any) => {
  const f = (t.format || '').toLowerCase();
  return f.includes('flac') || f.includes('wav') || f.includes('alac') || f.includes('dsf') || f.includes('dff') || f.includes('dsd');
};

type QuickFilterType = 'all' | 'loved' | 'lossless' | 'local' | 'streams';

function filterLibraryTracks(
  tracks: any[],
  activeFilter: QuickFilterType,
  searchQuery: string = ''
) {
  return tracks.filter((t: any) => {
    // 1. Quick Filter Chip
    if (activeFilter === 'loved' && t.loved !== 1) return false;
    if (activeFilter === 'lossless' && !isLosslessTrack(t)) return false;
    if (activeFilter === 'local' && isStreamTrack(t.path, t.format)) return false;
    if (activeFilter === 'streams' && !isStreamTrack(t.path, t.format)) return false;

    // 2. Search Query
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.title?.toLowerCase().includes(q) ||
      t.artist?.toLowerCase().includes(q) ||
      t.path.toLowerCase().includes(q)
    );
  });
}

describe('Library Quick Filter Logic', () => {
  const mockTracks = [
    { id: 1, path: 'C:\\Music\\song1.flac', title: 'Moonlight Sonata', artist: 'Beethoven', format: 'FLAC', loved: 1 },
    { id: 2, path: 'C:\\Music\\song2.mp3', title: 'Clair de Lune', artist: 'Debussy', format: 'MP3', loved: 0 },
    { id: 3, path: 'C:\\Music\\song3.dsf', title: 'Symphony No. 5', artist: 'Beethoven', format: 'DSD', loved: 1 },
    { id: 4, path: 'https://youtube.com/watch?v=abc', title: 'Chill Lo-Fi', artist: 'Lofi Girl', format: 'YouTube Direct', loved: 1 },
    { id: 5, path: 'https://subsonic.local/stream/123', title: 'Cloud Beats', artist: 'Subsonic Artist', format: 'SUBSONIC', loved: 0 },
  ];

  it('should return all tracks when activeFilter is "all"', () => {
    const result = filterLibraryTracks(mockTracks, 'all');
    expect(result).toHaveLength(5);
  });

  it('should filter only loved tracks when activeFilter is "loved"', () => {
    const result = filterLibraryTracks(mockTracks, 'loved');
    expect(result).toHaveLength(3);
    expect(result.every(t => t.loved === 1)).toBe(true);
  });

  it('should filter only lossless/DSD tracks when activeFilter is "lossless"', () => {
    const result = filterLibraryTracks(mockTracks, 'lossless');
    expect(result).toHaveLength(2);
    expect(result.map(t => t.format)).toEqual(['FLAC', 'DSD']);
  });

  it('should filter only local offline tracks when activeFilter is "local"', () => {
    const result = filterLibraryTracks(mockTracks, 'local');
    expect(result).toHaveLength(3);
    expect(result.every(t => !isStreamTrack(t.path, t.format))).toBe(true);
  });

  it('should filter only web/cloud streams when activeFilter is "streams"', () => {
    const result = filterLibraryTracks(mockTracks, 'streams');
    expect(result).toHaveLength(2);
    expect(result.every(t => isStreamTrack(t.path, t.format))).toBe(true);
  });

  it('should compose activeFilter with search queries properly', () => {
    const result = filterLibraryTracks(mockTracks, 'loved', 'beethoven');
    expect(result).toHaveLength(2);
    expect(result.map(t => t.title)).toEqual(['Moonlight Sonata', 'Symphony No. 5']);
  });

  it('should return empty array when no tracks match activeFilter + search query', () => {
    const result = filterLibraryTracks(mockTracks, 'lossless', 'lofi');
    expect(result).toHaveLength(0);
  });
});
