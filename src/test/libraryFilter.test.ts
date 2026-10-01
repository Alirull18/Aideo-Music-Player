import { describe, it, expect } from 'vitest';
import { isStreamTrack, isLosslessTrack, parseDuration } from '../utils';
import { buildAlbumKey } from '../utils/albumUtils';
import { extractPrimaryArtist } from '../utils/unifiedSources';

describe('Library track classification and canonical metadata', () => {
  it.each([
    ['mms://station/live', null],
    ['rtsp://station/live', 'RADIO'],
    ['aideo://track/123', null],
    ['123', 'Tidal FLAC'],
    ['dQw4w9WgXcQ', null],
    ['https://server/stream', 'FLAC'],
  ])('classifies %s as a stream', (path, format) => {
    expect(isStreamTrack(path, format)).toBe(true);
  });

  it('keeps local files out of streams even for eleven-character file paths', () => {
    expect(isStreamTrack('song01.flac', 'FLAC')).toBe(false);
    expect(isStreamTrack('abcdefghijk', 'FLAC')).toBe(false);
    expect(isStreamTrack(null, 'RADIO')).toBe(false);
  });

  it('handles missing format metadata without losing lossless classifications', () => {
    expect(isLosslessTrack(null)).toBe(false);
    expect(isLosslessTrack({ format: null })).toBe(false);
    expect(isLosslessTrack({ format: 'Tidal FLAC' })).toBe(true);
    expect(isLosslessTrack({ format: 'DSD' })).toBe(true);
    expect(isLosslessTrack({ format: 'MP3' })).toBe(false);
  });

  it.each([undefined, null, '', 'bogus', 'Infinity', '-5', '-1:30', '1::20', '1:2:3:4'])('returns zero for invalid duration %s', raw => {
    expect(parseDuration(raw)).toBe(0);
  });

  it('parses duration units while leaving discovery fallback to its caller', () => {
    expect(parseDuration('3:45')).toBe(225);
    expect(parseDuration('1:02:30')).toBe(3750);
    expect(parseDuration(' 90.5 ')).toBe(90.5);
    expect(parseDuration('0')).toBe(0);
  });

  it('groups albums with the same normalized primary artist and collaboration syntax', () => {
    const album = 'Shared Album';
    expect(buildAlbumKey({ album, artist: 'Calvin Harris + Dua Lipa - Topic' }))
      .toBe(buildAlbumKey({ album, artist: 'CALVIN HARRIS feat. Dua Lipa' }));
    expect(buildAlbumKey({ album, artist: 'Calvin Harris; Dua Lipa' }))
      .toBe(buildAlbumKey({ album, artist: 'Calvin Harris' }));
    expect(extractPrimaryArtist('Foxes')).toBe('foxes');
    expect(extractPrimaryArtist('The xx')).toBe('the xx');
    expect(buildAlbumKey({ album, artist: null })).toBe('unknown artist:::shared album');
    expect(buildAlbumKey({ album, artist: 'A', album_artist: 'Album Owner' })).toBe('album owner:::shared album');
  });
});
