import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { AideoPageDesign } from '../store/types';
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
    const designs: AideoPageDesign[] = ['classic', 'bento', 'audiophile', 'cinematic'];
    const { setAideoPageDesign } = useStore.getState();

    designs.forEach((design) => {
      setAideoPageDesign(design);
      expect(useStore.getState().aideoPageDesign).toBe(design);
      expect(localStorage.getItem('aideo-page-design')).toBe(design);
    });
  });

  it('should persist user choice across safe storage helpers', () => {
    const { setAideoPageDesign } = useStore.getState();

    setAideoPageDesign('bento');
    expect(safeGetStorage('aideo-page-design')).toBe('bento');

    setAideoPageDesign('audiophile');
    expect(safeGetStorage('aideo-page-design')).toBe('audiophile');

    setAideoPageDesign('cinematic');
    expect(safeGetStorage('aideo-page-design')).toBe('cinematic');

    setAideoPageDesign('classic');
    expect(safeGetStorage('aideo-page-design')).toBe('classic');
  });

  it('should correctly restore to classic layout on reset', () => {
    const { setAideoPageDesign } = useStore.getState();

    setAideoPageDesign('cinematic');
    expect(useStore.getState().aideoPageDesign).toBe('cinematic');

    // Emulate appearance reset
    setAideoPageDesign('classic');
    expect(useStore.getState().aideoPageDesign).toBe('classic');
    expect(localStorage.getItem('aideo-page-design')).toBe('classic');
  });
});
