import { describe, it, expect } from 'vitest';
import { romanizeKorean, romanizeKana, romanizeText, hasKoreanChars, hasJapaneseChars } from '../utils/romanizer';

describe('Romanizer Utility Suite', () => {
  describe('1. Korean Hangul Romanization', () => {
    it('romanizes individual Hangul syllables', () => {
      expect(romanizeKorean('가')).toBe('ga');
      expect(romanizeKorean('나')).toBe('na');
      expect(romanizeKorean('다')).toBe('da');
      expect(romanizeKorean('라')).toBe('ra');
    });

    it('romanizes compound syllables with batchim', () => {
      expect(romanizeKorean('사랑')).toBe('sarang');
      expect(romanizeKorean('너를 사랑해')).toBe('neoreul saranghae');
      expect(romanizeKorean('아이돌')).toBe('aidol');
      expect(romanizeKorean('방탄소년단')).toBe('bangtansonyeondan');
    });

    it('preserves spaces, punctuation, and English characters', () => {
      expect(romanizeKorean('Hello 너를 사랑해! 123')).toBe('Hello neoreul saranghae! 123');
    });
  });

  describe('2. Japanese Kana Romanization', () => {
    it('romanizes basic Hiragana', () => {
      expect(romanizeKana('ありがとう')).toBe('arigatou');
      expect(romanizeKana('さようなら')).toBe('sayounara');
    });

    it('romanizes basic Katakana', () => {
      expect(romanizeKana('アイドル')).toBe('aidoru');
      expect(romanizeKana('ピアノ')).toBe('piano');
    });

    it('handles digraphs and yoon (kya, sho, cha)', () => {
      expect(romanizeKana('きょう')).toBe('kyou');
      expect(romanizeKana('とうきょう')).toBe('toukyou');
      expect(romanizeKana('チョコレート')).toBe('chokore-to');
    });
  });

  describe('3. Language Detection & Auto Romanizer', () => {
    it('detects Korean characters accurately', () => {
      expect(hasKoreanChars('안녕하세요')).toBe(true);
      expect(hasKoreanChars('Hello World')).toBe(false);
      expect(hasKoreanChars('こんにちは')).toBe(false);
    });

    it('detects Japanese characters accurately', () => {
      expect(hasJapaneseChars('こんにちは')).toBe(true);
      expect(hasJapaneseChars('アイドル')).toBe(true);
      expect(hasJapaneseChars('東京')).toBe(true);
      expect(hasJapaneseChars('Hello World')).toBe(false);
    });

    it('automatically applies appropriate romanizer in romanizeText', () => {
      expect(romanizeText('너를 사랑해')).toBe('neoreul saranghae');
      expect(romanizeText('アイドル')).toBe('aidoru');
      expect(romanizeText('Hello world')).toBe('Hello world');
    });
  });
});
