import { describe, it, expect } from 'vitest';
import { parseSearchQuery, matchesSearchQuery } from '../utils/searchParser';

describe('Scoped Search Query Parser', () => {
  it('parses unquoted and quoted scoped queries correctly', () => {
    const q1 = 'artist:"Daft Punk" format:flac alive';
    const c1 = parseSearchQuery(q1);
    expect(c1.artist).toBe('daft punk');
    expect(c1.format).toBe('flac');
    expect(c1.freeText).toEqual(['alive']);

    const q2 = 'album:"Random Access Memories" loved:true';
    const c2 = parseSearchQuery(q2);
    expect(c2.album).toBe('random access memories');
    expect(c2.loved).toBe(true);

    const q3 = 'format:dsf Bohemian Rhapsody';
    const c3 = parseSearchQuery(q3);
    expect(c3.format).toBe('dsf');
    expect(c3.freeText).toEqual(['bohemian', 'rhapsody']);
  });

  it('matches track by scoped criteria', () => {
    const track = {
      title: 'Get Lucky',
      artist: 'Daft Punk feat. Pharrell Williams',
      album: 'Random Access Memories',
      format: 'FLAC',
      path: 'C:\\Music\\Daft Punk\\Get Lucky.flac',
      loved: 1
    };

    expect(matchesSearchQuery(track, 'artist:Daft')).toBe(true);
    expect(matchesSearchQuery(track, 'artist:Radiohead')).toBe(false);
    expect(matchesSearchQuery(track, 'format:flac')).toBe(true);
    expect(matchesSearchQuery(track, 'format:mp3')).toBe(false);
    expect(matchesSearchQuery(track, 'album:"Random Access"')).toBe(true);
    expect(matchesSearchQuery(track, 'loved:true')).toBe(true);
    expect(matchesSearchQuery(track, 'loved:false')).toBe(false);
    expect(matchesSearchQuery(track, 'Lucky Pharrell')).toBe(true);
    expect(matchesSearchQuery(track, 'Lucky Adele')).toBe(false);
  });

  it('handles empty and whitespace-only queries seamlessly', () => {
    const track = {
      title: 'Aerodynamic',
      artist: 'Daft Punk',
      album: 'Discovery',
      format: 'MP3',
      path: 'C:\\Music\\Aerodynamic.mp3',
      loved: 0
    };

    expect(matchesSearchQuery(track, '')).toBe(true);
    expect(matchesSearchQuery(track, '   ')).toBe(true);
  });

  it('preserves URLs as free text instead of swallowing them as scoped keys', () => {
    const q = parseSearchQuery('http://stream.example.com/play');
    expect(q.freeText).toContain('http://stream.example.com/play');
    expect(q.artist).toBeUndefined();
    expect(q.format).toBeUndefined();

    // A URL token should behave like normal free text when matched against a path
    const track = {
      title: 'Mix',
      artist: 'DJ',
      album: '',
      format: 'URL',
      path: 'http://stream.example.com/play',
      loved: 0
    };
    expect(matchesSearchQuery(track, 'http://stream.example.com/play')).toBe(true);
    expect(matchesSearchQuery(track, 'http://other.example.com/x')).toBe(false);
  });

  it('does not treat words merely ending in alias keys as scoped filters', () => {
    const q = parseSearchQuery('bar:something');
    expect(q.artist).toBeUndefined();
    expect(q.freeText).toContain('bar:something');

    const q2 = parseSearchQuery('mental:health');
    expect(q2.album).toBeUndefined();
    expect(q2.freeText).toContain('mental:health');
  });

  it('still recognizes genuine aliases at word boundaries', () => {
    const q = parseSearchQuery('ar:daft al:discovery');
    expect(q.artist).toBe('daft');
    expect(q.album).toBe('discovery');
  });
});

describe('Multi-Select Logic', () => {
  const tracks = [
    { path: 'C:\\Music\\1.mp3' },
    { path: 'C:\\Music\\2.mp3' },
    { path: 'C:\\Music\\3.mp3' },
    { path: 'C:\\Music\\4.mp3' },
    { path: 'C:\\Music\\5.mp3' },
  ];

  it('simulates Ctrl+Click toggle selection', () => {
    let selected: string[] = [];

    // Select item 0
    selected = [...selected, tracks[0].path];
    expect(selected).toEqual(['C:\\Music\\1.mp3']);

    // Toggle item 2
    selected = [...selected, tracks[2].path];
    expect(selected).toEqual(['C:\\Music\\1.mp3', 'C:\\Music\\3.mp3']);

    // Unselect item 0
    selected = selected.filter(p => p !== tracks[0].path);
    expect(selected).toEqual(['C:\\Music\\3.mp3']);
  });

  it('simulates Shift+Click range selection', () => {
    const lastIdx = 1;
    const currentIdx = 4;
    const start = Math.min(lastIdx, currentIdx);
    const end = Math.max(lastIdx, currentIdx);

    const range = tracks.slice(start, end + 1).map(t => t.path);
    expect(range).toEqual([
      'C:\\Music\\2.mp3',
      'C:\\Music\\3.mp3',
      'C:\\Music\\4.mp3',
      'C:\\Music\\5.mp3'
    ]);
  });
});
