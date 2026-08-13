import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { safeGetStorage, safeSetStorage } from '../utils/storage';

describe('Option & State Persistence (Issue #26)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should persist and update lyrics translation toggle state', () => {
    const { setShowTranslation } = useStore.getState();

    setShowTranslation(false);
    expect(useStore.getState().showTranslation).toBe(false);
    expect(localStorage.getItem('aideo-show-translation')).toBe('false');

    setShowTranslation(true);
    expect(useStore.getState().showTranslation).toBe(true);
    expect(localStorage.getItem('aideo-show-translation')).toBe('true');
  });

  it('should persist and update lyrics romaji toggle state', () => {
    const { setShowRomaji } = useStore.getState();

    setShowRomaji(false);
    expect(useStore.getState().showRomaji).toBe(false);
    expect(localStorage.getItem('aideo-show-romaji')).toBe('false');

    setShowRomaji(true);
    expect(useStore.getState().showRomaji).toBe(true);
    expect(localStorage.getItem('aideo-show-romaji')).toBe('true');
  });

  it('should persist volume to storage when setVolume is called', async () => {
    const { setVolume } = useStore.getState();

    await setVolume(0.65);
    expect(useStore.getState().playback.volume).toBe(0.65);
    expect(localStorage.getItem('aideo_volume')).toBe('0.65');

    await setVolume(1.8);
    expect(useStore.getState().playback.volume).toBe(1.0);
    expect(localStorage.getItem('aideo_volume')).toBe('1');
  });

  it('should persist navigation view in localStorage upon setView', () => {
    const { setView } = useStore.getState();

    setView('albums');
    expect(useStore.getState().view).toBe('albums');
    expect(localStorage.getItem('aideo-last-view')).toBe('albums');

    setView('aideo_lab');
    expect(useStore.getState().view).toBe('aideo_lab');
    expect(localStorage.getItem('aideo-last-view')).toBe('aideo_lab');
  });

  it('should save and retrieve library viewMode and albumSortBy keys', () => {
    safeSetStorage('aideo-library-view-mode', 'albums');
    expect(safeGetStorage('aideo-library-view-mode')).toBe('albums');

    safeSetStorage('aideo-album-sort-by', 'artist');
    expect(safeGetStorage('aideo-album-sort-by')).toBe('artist');

    safeSetStorage('aideo-album-sort-by', 'count');
    expect(safeGetStorage('aideo-album-sort-by')).toBe('count');

    safeSetStorage('aideo-album-sort-by', 'recent');
    expect(safeGetStorage('aideo-album-sort-by')).toBe('recent');
  });
});
