import { describe, it, expect } from 'vitest';

interface SearchResultItem {
  id: string;
  title: string;
  artist: string;
  format?: string;
  path?: string;
  recommendation_source?: string;
}

function resolveSmartSearchResults(
  query: string,
  localTracks: any[],
  remoteResults: any[]
): SearchResultItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // 1. Local Library matches (Prioritized Lossless / Local)
  const localMatches: SearchResultItem[] = localTracks
    .filter(t => {
      return (
        (t.title || '').toLowerCase().includes(q) ||
        (t.artist || '').toLowerCase().includes(q) ||
        (t.album || '').toLowerCase().includes(q)
      );
    })
    .slice(0, 2)
    .map(t => ({
      id: `local-${t.id || t.path}`,
      title: t.title || 'Untitled',
      artist: t.artist || 'Unknown Artist',
      path: t.path,
      format: t.format || 'LOCAL',
      recommendation_source: 'Local Library'
    }));

  // 2. Remote Streaming results
  const remoteMatches: SearchResultItem[] = remoteResults.map(r => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    path: r.url,
    format: r.format || 'STREAM',
    recommendation_source: 'Web Stream'
  }));

  return [...localMatches, ...remoteMatches];
}

describe('Smart Search & Auto-Fallback Logic', () => {
  const mockLocalTracks = [
    { id: 1, title: 'Hotel California', artist: 'Eagles', album: 'Hotel California', format: 'FLAC', path: 'C:\\Music\\Eagles - Hotel California.flac' },
    { id: 2, title: 'Take It Easy', artist: 'Eagles', album: 'Eagles', format: 'FLAC', path: 'C:\\Music\\Eagles - Take It Easy.flac' },
    { id: 3, title: 'Stairway to Heaven', artist: 'Led Zeppelin', album: 'Led Zeppelin IV', format: 'WAV', path: 'C:\\Music\\Led Zeppelin - Stairway.wav' },
  ];

  const mockRemoteResults = [
    { id: 'yt-1', title: 'Hotel California (Live On MTV 1994)', artist: 'Eagles', url: 'https://youtube.com/watch?v=123' },
    { id: 'yt-2', title: 'Hotel California (Remastered 2013)', artist: 'Eagles', url: 'https://youtube.com/watch?v=456' },
  ];

  it('prioritizes local lossless FLAC matches at the top of results', () => {
    const results = resolveSmartSearchResults('Hotel California', mockLocalTracks, mockRemoteResults);

    expect(results).toHaveLength(3);
    // First result must be the local lossless FLAC file
    expect(results[0].recommendation_source).toBe('Local Library');
    expect(results[0].format).toBe('FLAC');
    expect(results[0].path).toBe('C:\\Music\\Eagles - Hotel California.flac');

    // Followed by remote stream options
    expect(results[1].recommendation_source).toBe('Web Stream');
  });

  it('returns empty array when query is blank', () => {
    const results = resolveSmartSearchResults('', mockLocalTracks, mockRemoteResults);
    expect(results).toEqual([]);
  });

  it('returns only remote streams if no local track matches', () => {
    const results = resolveSmartSearchResults('Daft Punk', mockLocalTracks, [
      { id: 'yt-3', title: 'Get Lucky', artist: 'Daft Punk', url: 'https://youtube.com/watch?v=789' }
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Get Lucky');
    expect(results[0].recommendation_source).toBe('Web Stream');
  });
});
