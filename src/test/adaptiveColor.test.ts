import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { extractDominantColor } from '../store/types';

describe('Adaptive Color Palette & Global Theme Synchronization', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      accentColor: '#8b5cf6',
      miniPlayerMode: false,
      view: 'library',
      coverArt: null,
    });
  });

  it('should update accentColor in store when a track sets a new color', () => {
    useStore.setState({ accentColor: '#10b981' });
    expect(useStore.getState().accentColor).toBe('#10b981');

    useStore.setState({ accentColor: 'rgb(236, 72, 153)' });
    expect(useStore.getState().accentColor).toBe('rgb(236, 72, 153)');
  });

  it('should maintain independent accentColor regardless of active view mode', () => {
    // Mode 1: Mini Player
    useStore.setState({ miniPlayerMode: true, accentColor: '#3b82f6' });
    expect(useStore.getState().miniPlayerMode).toBe(true);
    expect(useStore.getState().accentColor).toBe('#3b82f6');

    // Song change while in Mini Player
    useStore.setState({ accentColor: '#f59e0b' });
    expect(useStore.getState().accentColor).toBe('#f59e0b');

    // Mode 2: Library View
    useStore.setState({ miniPlayerMode: false, view: 'library', accentColor: '#ec4899' });
    expect(useStore.getState().view).toBe('library');
    expect(useStore.getState().accentColor).toBe('#ec4899');

    // Song change while in Library View
    useStore.setState({ accentColor: '#06b6d4' });
    expect(useStore.getState().accentColor).toBe('#06b6d4');
  });

  it('extractDominantColor should fallback safely for invalid or null inputs', async () => {
    const res = await extractDominantColor('');
    expect(res).toBe('#8b5cf6');
  });
});
