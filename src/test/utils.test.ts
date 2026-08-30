import { describe, it, expect } from 'vitest';
import { fmt, baseName, pathsEqual, isSupportedMusicLink, buildResolvedLinkQuery } from '../utils';

describe('Utility Functions', () => {
  describe('fmt', () => {
    it('should format seconds correctly', () => {
      expect(fmt(0)).toBe('0:00');
      expect(fmt(5)).toBe('0:05');
      expect(fmt(65)).toBe('1:05');
      expect(fmt(null)).toBe('0:00');
      expect(fmt(NaN)).toBe('0:00');
      expect(fmt(-10)).toBe('0:00');
    });
  });

  describe('baseName', () => {
    it('should extract baseName correctly', () => {
      expect(baseName('C:\\music\\song.mp3')).toBe('song.mp3');
      expect(baseName('/home/user/music/song.flac')).toBe('song.flac');
      expect(baseName(null)).toBe('—');
    });
  });

  describe('pathsEqual', () => {
    it('should return false if either path is empty', () => {
      expect(pathsEqual('', 'path')).toBe(false);
      expect(pathsEqual('path', null)).toBe(false);
    });

    it('should match case insensitively and normalize backslashes', () => {
      expect(pathsEqual('C:\\music\\Song.mp3', 'c:/music/song.mp3')).toBe(true);
      expect(pathsEqual('C:\\music\\Song.mp3', 'C:\\music\\other.mp3')).toBe(false);
    });
  });

  describe('isSupportedMusicLink', () => {
    it('should accept supported streaming URLs', () => {
      expect(isSupportedMusicLink('https://open.spotify.com/track/4Km5HrUvYTaSUfiSGPJeQR')).toBe(true);
      expect(isSupportedMusicLink('https://open.spotify.com/album/1A2B3C')).toBe(true);
      expect(isSupportedMusicLink('https://spotify.link/xY9zAbC')).toBe(true);
      expect(isSupportedMusicLink('https://music.apple.com/us/song/never-gonna-give-you-up/1170679038')).toBe(true);
      expect(isSupportedMusicLink('https://www.deezer.com/track/3135556')).toBe(true);
      expect(isSupportedMusicLink('  https://deezer.com/fr/album/302127 ')).toBe(true);
    });

    it('should reject non-link or unsupported input', () => {
      expect(isSupportedMusicLink('just some text')).toBe(false);
      expect(isSupportedMusicLink('https://youtube.com/watch?v=abc')).toBe(false);
      expect(isSupportedMusicLink('http://open.spotify.com.evil.io/track/abc')).toBe(false);
      expect(isSupportedMusicLink('')).toBe(false);
    });
  });

  describe('buildResolvedLinkQuery', () => {
    it('should join title and artist', () => {
      expect(buildResolvedLinkQuery({ title: 'Believe', artist: 'Cher' })).toBe('Believe Cher');
      expect(buildResolvedLinkQuery({ title: 'Believe', artist: null })).toBe('Believe');
    });

    it('should return empty for missing metadata', () => {
      expect(buildResolvedLinkQuery(null)).toBe('');
      expect(buildResolvedLinkQuery(undefined)).toBe('');
      expect(buildResolvedLinkQuery({ title: '' })).toBe('');
    });
  });
});
