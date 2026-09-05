import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { VisualizerMode, VisualizerDecayRate } from '../store/types';
import { createUISlice } from '../store/uiSlice';
import { safeGetStorage } from '../utils/storage';

describe('Visualizer Store & Persistence Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store state to initial
    useStore.setState({
      visualizerMode: 'bars',
      visualizerDecayRate: 'balanced',
      visualizerExpanded: false,
    });
  });

  it('should have default visualizer settings when initialized without storage', () => {
    const state = useStore.getState();
    expect(state.visualizerMode).toBe('bars');
    expect(state.visualizerDecayRate).toBe('balanced');
    expect(state.visualizerExpanded).toBe(false);
  });

  it('should switch visualizer modes and persist to localStorage', () => {
    const modes: VisualizerMode[] = ['bars', 'mirror', 'wave', 'circle', 'dots', 'baseline'];
    const { setVisualizerMode } = useStore.getState();

    modes.forEach((mode) => {
      setVisualizerMode(mode);
      expect(useStore.getState().visualizerMode).toBe(mode);
      expect(localStorage.getItem('aideo_visualizer_mode')).toBe(mode);
      expect(safeGetStorage('aideo_visualizer_mode')).toBe(mode);
    });
  });

  it('should switch visualizer decay rates and persist to localStorage', () => {
    const rates: VisualizerDecayRate[] = ['snappy', 'balanced', 'silky'];
    const { setVisualizerDecayRate } = useStore.getState();

    rates.forEach((rate) => {
      setVisualizerDecayRate(rate);
      expect(useStore.getState().visualizerDecayRate).toBe(rate);
      expect(localStorage.getItem('aideo_visualizer_decay')).toBe(rate);
      expect(safeGetStorage('aideo_visualizer_decay')).toBe(rate);
    });
  });

  it('should toggle and persist visualizer expanded state', () => {
    const { setVisualizerExpanded } = useStore.getState();

    setVisualizerExpanded(true);
    expect(useStore.getState().visualizerExpanded).toBe(true);
    expect(localStorage.getItem('aideo_visualizer_expanded')).toBe('true');
    expect(safeGetStorage('aideo_visualizer_expanded')).toBe('true');

    setVisualizerExpanded(false);
    expect(useStore.getState().visualizerExpanded).toBe(false);
    expect(localStorage.getItem('aideo_visualizer_expanded')).toBe('false');
    expect(safeGetStorage('aideo_visualizer_expanded')).toBe('false');
  });

  it('should initialize correctly from saved storage and fallback appropriately', () => {
    // 1. Valid saved mode, decay, and expanded
    localStorage.setItem('aideo_visualizer_mode', 'circle');
    localStorage.setItem('aideo_visualizer_decay', 'snappy');
    localStorage.setItem('aideo_visualizer_expanded', 'true');

    let slice = createUISlice(() => {}, () => ({} as any), {} as any);
    expect(slice.visualizerMode).toBe('circle');
    expect(slice.visualizerDecayRate).toBe('snappy');
    expect(slice.visualizerExpanded).toBe(true);

    // 2. Legacy 'baseline' mode should fallback to 'bars'
    localStorage.setItem('aideo_visualizer_mode', 'baseline');
    slice = createUISlice(() => {}, () => ({} as any), {} as any);
    expect(slice.visualizerMode).toBe('bars');

    // 3. Unknown or invalid values fallback to defaults
    localStorage.setItem('aideo_visualizer_mode', 'unknown_mode');
    localStorage.setItem('aideo_visualizer_decay', 'invalid_decay');
    localStorage.setItem('aideo_visualizer_expanded', 'maybe');
    slice = createUISlice(() => {}, () => ({} as any), {} as any);
    expect(slice.visualizerMode).toBe('bars');
    expect(slice.visualizerDecayRate).toBe('balanced');
    expect(slice.visualizerExpanded).toBe(false);
  });
});
