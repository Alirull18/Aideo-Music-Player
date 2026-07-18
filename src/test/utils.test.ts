import { describe, it, expect } from 'vitest';
import { fmt, baseName, pathsEqual } from '../utils';

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
});
