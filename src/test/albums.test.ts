import { describe, it, expect } from 'vitest';
import { Track } from '../store/types';
import { buildAlbumKey } from '../utils/albumUtils';

// Helper logic matching AlbumsView grouping logic
function groupTracksIntoAlbums(tracks: any[]) {
  const map = new Map<string, { title: string; artist: string; tracks: any[]; totalDuration: number }>();

  tracks.forEach((t) => {
    const albumTitle = t.album?.trim() || 'Unknown Album';
    const albumArtist = t.album_artist?.trim() || t.albumArtist?.trim();
    const trackArtist = t.artist?.trim() || 'Unknown Artist';
    
    const effectiveArtist = albumArtist || trackArtist;
    const key = albumArtist 
      ? `${albumArtist.toLowerCase()}:::${albumTitle.toLowerCase()}`
      : `album:::${albumTitle.toLowerCase()}`;

    if (!map.has(key)) {
      map.set(key, {
        title: albumTitle,
        artist: effectiveArtist,
        tracks: [t],
        totalDuration: t.duration || 0,
      });
    } else {
      const group = map.get(key)!;
      group.tracks.push(t);
      group.totalDuration += t.duration || 0;

      if (!albumArtist && group.artist !== 'Various Artists' && group.artist !== trackArtist) {
        const firstArtistMain = group.artist.split(/ feat\.| ft\.|,/i)[0].trim().toLowerCase();
        const currArtistMain = trackArtist.split(/ feat\.| ft\.|,/i)[0].trim().toLowerCase();
        if (firstArtistMain !== currArtistMain) {
          group.artist = 'Various Artists';
        }
      }
    }
  });

  return Array.from(map.values());
}

describe('Albums View Edge Cases & Crash Prevention (What-If Study Cases)', () => {
  it('What-If Scenario 1: Malformed tracks with null/undefined fields', () => {
    const malformedTracks: Track[] = [
      { id: 1, path: 'C:/m1.mp3', title: null, artist: null, album: null, duration: null, format: null, lyric_offset: 0 },
      { id: 2, path: 'C:/m2.mp3', title: undefined as any, artist: undefined as any, album: undefined as any, duration: undefined as any, format: null, lyric_offset: 0 },
    ];

    expect(() => {
      const result = groupTracksIntoAlbums(malformedTracks);
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Unknown Album');
      expect(result[0].artist).toBe('Unknown Artist');
      expect(result[0].tracks.length).toBe(2);
      expect(result[0].totalDuration).toBe(0);
    }).not.toThrow();
  });

  it('What-If Scenario 2: Empty tracks array', () => {
    expect(() => {
      const result = groupTracksIntoAlbums([]);
      expect(result.length).toBe(0);
    }).not.toThrow();
  });

  it('What-If Scenario 3: Special characters, emojis, and Unicode in album titles', () => {
    const specialTracks: Track[] = [
      { id: 10, path: 'C:/1.mp3', title: 'Song A', artist: 'Artist / <Script> & Co.', album: 'Album 🔥 "Special" \\ Test', duration: 180, format: 'FLAC', lyric_offset: 0 },
      { id: 11, path: 'C:/2.mp3', title: 'Song B', artist: 'Artist / <script> & CO.', album: 'album 🔥 "special" \\ test', duration: 200, format: 'FLAC', lyric_offset: 0 },
    ];

    const result = groupTracksIntoAlbums(specialTracks);
    expect(result.length).toBe(1);
    expect(result[0].tracks.length).toBe(2);
    expect(result[0].totalDuration).toBe(380);
  });

  it('What-If Scenario 4: Large scale library grouping performance (1,000+ tracks)', () => {
    const largeTrackList: Track[] = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      path: `C:/music/track_${i}.flac`,
      title: `Track ${i}`,
      artist: `Artist ${i % 20}`, // 20 distinct artists
      album: `Album ${i % 50}`,   // 50 distinct albums
      duration: 210,
      format: 'FLAC',
      lyric_offset: 0
    }));

    const startTime = performance.now();
    const result = groupTracksIntoAlbums(largeTrackList);
    const endTime = performance.now();

    expect(result.length).toBeGreaterThan(0);
    expect(endTime - startTime).toBeLessThan(50); // Must group 1,000 tracks in under 50ms
  });

  it('What-If Scenario 5: Featured artists and compilation tracks do not split album into duplicates', () => {
    const featuredTracks: any[] = [
      { id: 1, path: 'C:/1.mp3', title: 'Track 1', artist: 'Daft Punk', album: 'Random Access Memories', duration: 200 },
      { id: 2, path: 'C:/2.mp3', title: 'Track 2', artist: 'Daft Punk ft. Pharrell Williams', album: 'Random Access Memories', duration: 240 },
      { id: 3, path: 'C:/3.mp3', title: 'Track 3', artist: 'Daft Punk feat. Panda Bear', album: 'Random Access Memories', duration: 220 },
    ];

    const result = groupTracksIntoAlbums(featuredTracks);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Random Access Memories');
    expect(result[0].tracks.length).toBe(3);
  });

  it('Issue #29: Sorts albums by "Recently Added" using max track id descending', () => {
    const tracks: any[] = [
      { id: 1, path: 'C:/1.mp3', title: 'Old Song 1', artist: 'Artist A', album: 'Old Album 1' },
      { id: 2, path: 'C:/2.mp3', title: 'Old Song 2', artist: 'Artist A', album: 'Old Album 1' },
      { id: 100, path: 'C:/3.mp3', title: 'Brand New Single', artist: 'Artist B', album: 'Latest Album' },
      { id: 50, path: 'C:/4.mp3', title: 'Mid Song', artist: 'Artist C', album: 'Mid Album' },
    ];

    const albums = groupTracksIntoAlbums(tracks);
    
    // Sort by recent
    const sorted = [...albums].sort((a, b) => {
      const maxIdA = Math.max(...a.tracks.map((t: any) => (typeof t.id === 'number' ? t.id : (Number(t.id) || 0))), 0);
      const maxIdB = Math.max(...b.tracks.map((t: any) => (typeof t.id === 'number' ? t.id : (Number(t.id) || 0))), 0);
      return maxIdB - maxIdA;
    });

    expect(sorted.map(a => a.title)).toEqual(['Latest Album', 'Mid Album', 'Old Album 1']);
  });

  it('Correctly groups Compilation / Various Artists albums and isolates distinct artist albums with same title', () => {
    const compilationTracks: any[] = [
      { id: 1, path: 'C:/Music/Soundtracks/Cyberpunk/01.flac', title: 'Track 1', artist: 'Artist A', album: 'Cyberpunk OST', compilation: 1 },
      { id: 2, path: 'C:/Music/Soundtracks/Cyberpunk/02.flac', title: 'Track 2', artist: 'Artist B', album: 'Cyberpunk OST', compilation: 1 },
      { id: 3, path: 'C:/Music/ArtistX/Greatest Hits/01.flac', title: 'Song X', artist: 'Artist X', album: 'Greatest Hits' },
      { id: 4, path: 'C:/Music/ArtistY/Greatest Hits/01.flac', title: 'Song Y', artist: 'Artist Y', album: 'Greatest Hits' },
    ];

    const map = new Map<string, any>();
    compilationTracks.forEach((t) => {
      const key = buildAlbumKey(t);
      if (!map.has(key)) {
        map.set(key, { key, title: t.album, tracks: [t] });
      } else {
        map.get(key).tracks.push(t);
      }
    });

    const results = Array.from(map.values());
    // Cyberpunk OST (2 tracks), Artist X Greatest Hits (1 track), Artist Y Greatest Hits (1 track) = 3 distinct albums
    expect(results.length).toBe(3);
    const ostAlbum = results.find(a => a.title === 'Cyberpunk OST');
    expect(ostAlbum?.tracks.length).toBe(2);
  });

  it('Isolates different artists in the SAME directory with identical or empty album names', () => {
    const flatFolderTracks: any[] = [
      { id: 1, path: 'C:/Music/Downloads/track1.mp3', title: 'Shape of You', artist: 'Ed Sheeran', album: 'Singles' },
      { id: 2, path: 'C:/Music/Downloads/track2.mp3', title: 'Anti-Hero', artist: 'Taylor Swift', album: 'Singles' },
      { id: 3, path: 'C:/Music/Downloads/track3.mp3', title: 'Yellow', artist: 'Coldplay', album: 'Singles' },
      { id: 4, path: 'C:/Music/Downloads/track4.mp3', title: 'Random Song 1', artist: 'Artist A', album: '' },
      { id: 5, path: 'C:/Music/Downloads/track5.mp3', title: 'Random Song 2', artist: 'Artist B', album: null },
    ];

    const keys = flatFolderTracks.map(t => buildAlbumKey(t));
    const uniqueKeys = new Set(keys);
    
    // Each distinct artist must get their own unique album key even in the same folder
    expect(uniqueKeys.size).toBe(5);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).not.toBe(keys[2]);
    expect(keys[3]).not.toBe(keys[4]);
  });

  it('Groups multi-disc tracks by the same artist across CD subfolders into one album', () => {
    const multiDiscTracks: any[] = [
      { id: 1, path: 'C:/Music/Pink Floyd/The Wall/CD 1/01 In the Flesh.flac', title: 'In the Flesh?', artist: 'Pink Floyd', album: 'The Wall', disc_number: 1 },
      { id: 2, path: 'C:/Music/Pink Floyd/The Wall/CD 2/01 Hey You.flac', title: 'Hey You', artist: 'Pink Floyd', album: 'The Wall', disc_number: 2 },
    ];

    const key1 = buildAlbumKey(multiDiscTracks[0]);
    const key2 = buildAlbumKey(multiDiscTracks[1]);
    expect(key1).toBe(key2);
  });
});

