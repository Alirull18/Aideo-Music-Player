import { describe, it, expect } from 'vitest';
import { foldSearchText, simplifyPunctuation, matchesSearchQuery } from '../utils/searchParser';
import { groupRecordings } from '../utils/unifiedSources';
import type { Track } from '../store/types';

describe('Artist Search Text Normalization', () => {
  it('folds diacritics and accents to plain ASCII lowercase', () => {
    expect(foldSearchText('Beyoncé')).toBe('beyonce');
    expect(foldSearchText('Mötley Crüe')).toBe('motley crue');
    expect(foldSearchText('Sigur Rós')).toBe('sigur ros');
    expect(foldSearchText('Björk')).toBe('bjork');
    expect(foldSearchText('Blue Öyster Cult')).toBe('blue oyster cult');
  });

  it('simplifies punctuation for tolerant artist matching', () => {
    expect(simplifyPunctuation('AC/DC')).toBe('ac dc');
    expect(simplifyPunctuation("Guns N' Roses")).toBe('guns n roses');
    expect(simplifyPunctuation('Simon & Garfunkel')).toBe('simon garfunkel');
    expect(simplifyPunctuation('Panic! At The Disco')).toBe('panic at the disco');
  });
});

describe('Artist Matching in matchesSearchQuery', () => {
  const tracks = [
    {
      id: 1,
      title: 'Halo',
      artist: 'Beyoncé',
      album: 'I Am... Sasha Fierce',
      format: 'FLAC',
      path: 'C:\\Music\\Halo.flac'
    },
    {
      id: 2,
      title: 'Back in Black',
      artist: 'AC/DC',
      album: 'Back in Black',
      format: 'MP3',
      path: 'C:\\Music\\Back in Black.mp3'
    },
    {
      id: 3,
      title: 'Under Pressure',
      artist: 'Queen & David Bowie',
      album_artist: 'Queen',
      album: 'Hot Space',
      format: 'FLAC',
      path: 'C:\\Music\\Under Pressure.flac'
    },
    {
      id: 4,
      title: 'Get Lucky',
      artist: 'Daft Punk feat. Pharrell Williams',
      album: 'Random Access Memories',
      format: 'FLAC',
      path: 'C:\\Music\\Get Lucky.flac'
    },
    {
      id: 5,
      title: 'Soundtrack Anthem',
      artist: 'Various Artists',
      album_artist: 'Hans Zimmer',
      album: 'Epic Movie OST',
      format: 'FLAC',
      path: 'C:\\Music\\Soundtrack.flac'
    }
  ];

  it('matches artist with accents when searched without accents', () => {
    expect(matchesSearchQuery(tracks[0], 'beyonce')).toBe(true);
    expect(matchesSearchQuery(tracks[0], 'artist:beyonce')).toBe(true);
    expect(matchesSearchQuery(tracks[0], 'artist: beyonce')).toBe(true);
  });

  it('matches artist with punctuation variations', () => {
    expect(matchesSearchQuery(tracks[1], 'ac dc')).toBe(true);
    expect(matchesSearchQuery(tracks[1], 'ac/dc')).toBe(true);
    expect(matchesSearchQuery(tracks[1], 'artist:"ac dc"')).toBe(true);
  });

  it('matches track when queried artist is in album_artist', () => {
    expect(matchesSearchQuery(tracks[2], 'artist:queen')).toBe(true);
    expect(matchesSearchQuery(tracks[4], 'artist:"hans zimmer"')).toBe(true);
    expect(matchesSearchQuery(tracks[4], 'hans zimmer')).toBe(true);
  });

  it('matches collaborations and featured artists', () => {
    expect(matchesSearchQuery(tracks[2], 'David Bowie')).toBe(true);
    expect(matchesSearchQuery(tracks[3], 'Pharrell')).toBe(true);
    expect(matchesSearchQuery(tracks[3], 'artist:"Daft Punk"')).toBe(true);
  });
});

describe('Unified Search Relevance Ranking for Artists', () => {
  const trackA: Track = {
    id: 101,
    path: '101',
    title: 'Yellow',
    artist: 'Coldplay',
    album: 'Parachutes',
    format: 'Tidal FLAC',
    lyric_offset: 0,
    duration: 269
  };

  const trackB: Track = {
    id: 102,
    path: '102',
    title: 'Coldplay',
    artist: 'Tribute Band',
    album: 'Tribute Hits',
    format: 'Tidal FLAC',
    lyric_offset: 0,
    duration: 210
  };

  it('prioritizes tracks by the artist over tracks that merely have the artist name in their title', () => {
    const grouped = groupRecordings([trackB, trackA], 'Coldplay');
    expect(grouped).toHaveLength(2);
    // Track by Coldplay should be ranked first ahead of Tribute Band's song titled "Coldplay"
    expect(grouped[0].artist).toBe('Coldplay');
    expect(grouped[0].title).toBe('Yellow');
    expect(grouped[1].artist).toBe('Tribute Band');
  });
});
