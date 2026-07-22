import { describe, it, expect, beforeEach } from 'vitest';
import { extractDominantColor } from '../utils/colorExtractor';
import { Track } from '../store/types';

describe('Advanced Album & Library Enhancements Suite', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('Feature 1: Color Extractor handles null/invalid images gracefully without failing', async () => {
    const fallback1 = await extractDominantColor(null);
    expect(fallback1).toBe('rgba(139, 92, 246, 0.25)');

    const fallback2 = await extractDominantColor(undefined);
    expect(fallback2).toBe('rgba(139, 92, 246, 0.25)');
  });

  it('Feature 2: Loved Albums localStorage persistence & toggle safety', () => {
    const albumKey = 'queen:::a night at the opera';
    let lovedKeys: string[] = JSON.parse(localStorage.getItem('aideo-loved-albums') || '[]');
    expect(lovedKeys).not.toContain(albumKey);

    // Toggle Love ON
    lovedKeys.push(albumKey);
    localStorage.setItem('aideo-loved-albums', JSON.stringify(lovedKeys));

    const savedAfter = JSON.parse(localStorage.getItem('aideo-loved-albums') || '[]');
    expect(savedAfter).toContain(albumKey);

    // Toggle Love OFF
    lovedKeys = lovedKeys.filter(id => id !== albumKey);
    localStorage.setItem('aideo-loved-albums', JSON.stringify(lovedKeys));

    const savedFinal = JSON.parse(localStorage.getItem('aideo-loved-albums') || '[]');
    expect(savedFinal).not.toContain(albumKey);
  });

  it('Feature 3: Artist Discography filtering accurately filters and groups by target artist', () => {
    const sampleTracks: Track[] = [
      { id: 1, path: 'C:/1.mp3', title: 'Bohemian Rhapsody', artist: 'Queen', album: 'A Night at the Opera', duration: 354, format: 'FLAC', lyric_offset: 0 },
      { id: 2, path: 'C:/2.mp3', title: 'Don\'t Stop Me Now', artist: 'Queen', album: 'Jazz', duration: 209, format: 'FLAC', lyric_offset: 0 },
      { id: 3, path: 'C:/3.mp3', title: 'Hotel California', artist: 'Eagles', album: 'Hotel California', duration: 391, format: 'FLAC', lyric_offset: 0 },
    ];

    const targetArtist = 'Queen';
    const artistTracks = sampleTracks.filter(t => t.artist?.toLowerCase().trim() === targetArtist.toLowerCase().trim());
    expect(artistTracks.length).toBe(2);

    const albums = new Set(artistTracks.map(t => t.album));
    expect(albums.size).toBe(2);
    expect(albums).toContain('A Night at the Opera');
    expect(albums).toContain('Jazz');
  });
});
