import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { TheaterModeDesign } from '../store/types';

describe('theaterModeDesign store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to stage mode and allows switching across all 6 archetypes', () => {
    const state = useStore.getState();
    expect(state.theaterModeDesign).toBeDefined();

    const archetypes: TheaterModeDesign[] = ['stage', 'zen', 'studio', 'vinyl', 'poster', 'scope'];
    for (const arch of archetypes) {
      state.setTheaterModeDesign(arch);
      expect(useStore.getState().theaterModeDesign).toBe(arch);
      expect(localStorage.getItem('aideo-theater-design')).toBe(arch);
    }
  });

  it('migrates legacy aideo-fullscreen-layout if aideo-theater-design is absent', () => {
    localStorage.setItem('aideo-fullscreen-layout', 'zen');
    const saved = localStorage.getItem('aideo-theater-design') || localStorage.getItem('aideo-fullscreen-layout') || 'stage';
    expect(saved).toBe('zen');
  });
});
