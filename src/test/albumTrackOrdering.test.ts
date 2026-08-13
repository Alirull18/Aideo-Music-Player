import { describe, it, expect } from 'vitest';
import { 
  getDiscNumber, 
  getTrackNumber, 
  sortAlbumTracks, 
  groupTracksByDisc 
} from '../utils/albumUtils';
import { Track } from '../store/types';

describe('Album Track Ordering & Multi-Disc Support (Issue #31)', () => {
  it('correctly sorts tracks with explicit track_number and disc_number tags', () => {
    const rawTracks: Partial<Track>[] = [
      { id: 1, title: 'CD2 Track 2', disc_number: 2, track_number: 2, duration: 180 },
      { id: 2, title: 'CD1 Track 2', disc_number: 1, track_number: 2, duration: 200 },
      { id: 3, title: 'CD2 Track 1', disc_number: 2, track_number: 1, duration: 210 },
      { id: 4, title: 'CD1 Track 1', disc_number: 1, track_number: 1, duration: 190 },
      { id: 5, title: 'CD1 Track 3', disc_number: 1, track_number: 3, duration: 240 },
    ];

    const sorted = sortAlbumTracks(rawTracks);
    expect(sorted.map((t) => t.title)).toEqual([
      'CD1 Track 1',
      'CD1 Track 2',
      'CD1 Track 3',
      'CD2 Track 1',
      'CD2 Track 2',
    ]);
  });

  it('correctly extracts track and disc numbers from file paths when tags are missing', () => {
    const rawTracks: Partial<Track>[] = [
      { id: 1, path: 'C:/Music/Album/CD2/02 - Second.flac', title: 'Second', duration: 180 },
      { id: 2, path: 'C:/Music/Album/CD1/02 - Beta.flac', title: 'Beta', duration: 200 },
      { id: 3, path: 'C:/Music/Album/CD2/01 - First.flac', title: 'First', duration: 210 },
      { id: 4, path: 'C:/Music/Album/CD1/01 - Alpha.flac', title: 'Alpha', duration: 190 },
    ];

    const sorted = sortAlbumTracks(rawTracks);
    expect(sorted.map((t) => t.title)).toEqual([
      'Alpha',
      'Beta',
      'First',
      'Second',
    ]);

    expect(getDiscNumber(rawTracks[0])).toBe(2);
    expect(getTrackNumber(rawTracks[0])).toBe(2);
    expect(getDiscNumber(rawTracks[3])).toBe(1);
    expect(getTrackNumber(rawTracks[3])).toBe(1);
  });

  it('correctly extracts disc-track prefixed filenames (e.g. 1-01, 2-03)', () => {
    const rawTracks: Partial<Track>[] = [
      { id: 1, path: 'C:/Music/2-02 - Song B.mp3', title: 'Song B' },
      { id: 2, path: 'C:/Music/1-01 - Song A.mp3', title: 'Song A' },
      { id: 3, path: 'C:/Music/2-01 - Song C.mp3', title: 'Song C' },
    ];

    const sorted = sortAlbumTracks(rawTracks);
    expect(sorted.map((t) => t.title)).toEqual([
      'Song A',
      'Song C',
      'Song B',
    ]);
  });

  it('correctly groups tracks into distinct disc sections for multi-disc albums', () => {
    const rawTracks: Partial<Track>[] = [
      { id: 1, title: 'Track 1-2', disc_number: 1, track_number: 2 },
      { id: 2, title: 'Track 2-1', disc_number: 2, track_number: 1 },
      { id: 3, title: 'Track 1-1', disc_number: 1, track_number: 1 },
      { id: 4, title: 'Track 2-2', disc_number: 2, track_number: 2 },
    ];

    const groups = groupTracksByDisc(rawTracks);
    expect(groups.length).toBe(2);
    expect(groups[0].disc).toBe(1);
    expect(groups[0].tracks.map((t) => t.title)).toEqual(['Track 1-1', 'Track 1-2']);
    expect(groups[1].disc).toBe(2);
    expect(groups[1].tracks.map((t) => t.title)).toEqual(['Track 2-1', 'Track 2-2']);
  });

  it('handles single-disc albums with natural number sorting', () => {
    const rawTracks: Partial<Track>[] = [
      { id: 1, title: 'Track 10', track_number: 10 },
      { id: 2, title: 'Track 2', track_number: 2 },
      { id: 3, title: 'Track 1', track_number: 1 },
      { id: 4, title: 'Track 15', track_number: 15 },
      { id: 5, title: 'Track 3', track_number: 3 },
    ];

    const sorted = sortAlbumTracks(rawTracks);
    expect(sorted.map((t) => t.track_number)).toEqual([1, 2, 3, 10, 15]);
  });

  it('safely falls back to title sorting if no track number is present anywhere', () => {
    const rawTracks: Partial<Track>[] = [
      { id: 1, title: 'Zebra' },
      { id: 2, title: 'Apple' },
      { id: 3, title: 'Mango' },
    ];

    const sorted = sortAlbumTracks(rawTracks);
    expect(sorted.map((t) => t.title)).toEqual(['Apple', 'Mango', 'Zebra']);
  });
});
