import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { PlayerBarDesign } from '../store/types';
import { safeGetStorage } from '../utils/storage';

describe('Player Bar Design & Layout Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().setPlayerBarDesign('classic');
  });

  it('should default to classic studio layout when no custom setting is stored', () => {
    const state = useStore.getState();
    expect(state.playerBarDesign).toBe('classic');
  });

  it('should switch between all 5 modern and popular player bar designs', () => {
    const designs: PlayerBarDesign[] = ['classic', 'floating', 'waveform', 'minimal', 'vinyl'];
    const { setPlayerBarDesign } = useStore.getState();

    designs.forEach((design) => {
      setPlayerBarDesign(design);
      expect(useStore.getState().playerBarDesign).toBe(design);
      expect(localStorage.getItem('aideo-playerbar-design')).toBe(design);
    });
  });

  it('should persist user choice across safe storage helpers', () => {
    const { setPlayerBarDesign } = useStore.getState();

    setPlayerBarDesign('floating');
    expect(safeGetStorage('aideo-playerbar-design')).toBe('floating');

    setPlayerBarDesign('waveform');
    expect(safeGetStorage('aideo-playerbar-design')).toBe('waveform');

    setPlayerBarDesign('vinyl');
    expect(safeGetStorage('aideo-playerbar-design')).toBe('vinyl');

    setPlayerBarDesign('minimal');
    expect(safeGetStorage('aideo-playerbar-design')).toBe('minimal');
  });

  it('should correctly restore to classic layout on reset', () => {
    const { setPlayerBarDesign, setPlayerBarTransparent } = useStore.getState();

    setPlayerBarDesign('vinyl');
    setPlayerBarTransparent(true);
    expect(useStore.getState().playerBarDesign).toBe('vinyl');
    expect(useStore.getState().playerBarTransparent).toBe(true);

    // Emulate appearance reset
    setPlayerBarDesign('classic');
    setPlayerBarTransparent(false);
    expect(useStore.getState().playerBarDesign).toBe('classic');
    expect(useStore.getState().playerBarTransparent).toBe(false);
    expect(localStorage.getItem('aideo-playerbar-design')).toBe('classic');
    expect(localStorage.getItem('aideo-playerbar-transparent')).toBe('false');
  });

  it('should manage and persist playerBarTransparent state', () => {
    const { setPlayerBarTransparent, togglePlayerBarTransparent } = useStore.getState();

    setPlayerBarTransparent(true);
    expect(useStore.getState().playerBarTransparent).toBe(true);
    expect(localStorage.getItem('aideo-playerbar-transparent')).toBe('true');
    expect(safeGetStorage('aideo-playerbar-transparent')).toBe('true');

    togglePlayerBarTransparent();
    expect(useStore.getState().playerBarTransparent).toBe(false);
    expect(localStorage.getItem('aideo-playerbar-transparent')).toBe('false');

    togglePlayerBarTransparent();
    expect(useStore.getState().playerBarTransparent).toBe(true);
    expect(localStorage.getItem('aideo-playerbar-transparent')).toBe('true');
  });
});
