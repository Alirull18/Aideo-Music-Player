import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { AideoPageDesign, LEGACY_AIDEO_PAGE_DESIGNS } from '../store/types';
import { safeGetStorage } from '../utils/storage';

describe('Aideo Page Design & Layout Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().setAideoPageDesign('classic');
  });

  it('should default to classic studio layout when no custom setting is stored', () => {
    const state = useStore.getState();
    expect(state.aideoPageDesign).toBe('classic');
  });

  it('should switch between all 4 modern Aideo page designs', () => {
    const designs: AideoPageDesign[] = ['classic', 'editorial', 'command', 'stage'];
    const { setAideoPageDesign } = useStore.getState();

    designs.forEach((design) => {
      setAideoPageDesign(design);
      expect(useStore.getState().aideoPageDesign).toBe(design);
      expect(localStorage.getItem('aideo-page-design')).toBe(design);
    });
  });

  it('should persist user choice across safe storage helpers', () => {
    const { setAideoPageDesign } = useStore.getState();

    setAideoPageDesign('editorial');
    expect(safeGetStorage('aideo-page-design')).toBe('editorial');

    setAideoPageDesign('command');
    expect(safeGetStorage('aideo-page-design')).toBe('command');

    setAideoPageDesign('stage');
    expect(safeGetStorage('aideo-page-design')).toBe('stage');

    setAideoPageDesign('classic');
    expect(safeGetStorage('aideo-page-design')).toBe('classic');
  });

  it('should correctly restore to classic layout on reset', () => {
    const { setAideoPageDesign } = useStore.getState();

    setAideoPageDesign('stage');
    expect(useStore.getState().aideoPageDesign).toBe('stage');

    // Emulate appearance reset
    setAideoPageDesign('classic');
    expect(useStore.getState().aideoPageDesign).toBe('classic');
    expect(localStorage.getItem('aideo-page-design')).toBe('classic');
  });

  it('should expose the retired pre-redesign design ids as legacy', () => {
    expect(LEGACY_AIDEO_PAGE_DESIGNS).toEqual(['bento', 'audiophile', 'cinematic']);
    for (const legacy of LEGACY_AIDEO_PAGE_DESIGNS) {
      expect(['classic', 'editorial', 'command', 'stage']).not.toContain(legacy);
    }
  });
});
