import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStore } from '../store';
import { LibraryDesign } from '../store/types';
import { safeGetStorage } from '../utils/storage';
import { useVirtualList } from '../utils/useVirtualList';

describe('Library Design Archetypes Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.getState().setLibraryDesign('classic');
  });

  it('should default to classic layout when no custom setting is stored', () => {
    const state = useStore.getState();
    expect(state.libraryDesign).toBe('classic');
  });

  it('should switch between all 6 library design archetypes', () => {
    const designs: LibraryDesign[] = ['classic', 'studio', 'editorial', 'crate', 'ambient', 'brutalist'];
    const { setLibraryDesign } = useStore.getState();

    designs.forEach((design) => {
      setLibraryDesign(design);
      expect(useStore.getState().libraryDesign).toBe(design);
      expect(localStorage.getItem('aideo-library-design')).toBe(design);
      expect(safeGetStorage('aideo-library-design')).toBe(design);
    });
  });

  it('should persist user choice across safe storage helpers', () => {
    const { setLibraryDesign } = useStore.getState();

    setLibraryDesign('studio');
    expect(safeGetStorage('aideo-library-design')).toBe('studio');

    setLibraryDesign('editorial');
    expect(safeGetStorage('aideo-library-design')).toBe('editorial');

    setLibraryDesign('crate');
    expect(safeGetStorage('aideo-library-design')).toBe('crate');

    setLibraryDesign('ambient');
    expect(safeGetStorage('aideo-library-design')).toBe('ambient');

    setLibraryDesign('brutalist');
    expect(safeGetStorage('aideo-library-design')).toBe('brutalist');
  });

  it('handles 10,000+ tracks efficiently across all 6 design archetypes without DOM bloat', () => {
    const tenThousandTracks = Array.from({ length: 12500 }, (_, idx) => ({
      path: `C:/Music/Track_${idx}.flac`,
      title: `Track ${idx}`,
      artist: `Artist ${idx % 500}`,
      album: `Album ${idx % 200}`,
      duration: 210,
      format: 'flac',
    }));

    const archetypeHeights: Record<LibraryDesign, number> = {
      classic: 52,
      studio: 38,
      editorial: 68,
      crate: 42,
      ambient: 56,
      brutalist: 40,
    };

    const designs: LibraryDesign[] = ['classic', 'studio', 'editorial', 'crate', 'ambient', 'brutalist'];

    designs.forEach((design) => {
      const itemHeight = archetypeHeights[design];
      const { result } = renderHook(() =>
        useVirtualList(tenThousandTracks, {
          itemHeight,
          overscan: 12,
        })
      );

      // Total virtual height must equal count * height
      expect(result.current.totalHeight).toBe(12500 * itemHeight);

      // Only a tiny slice (~20-40 rows) is rendered, NEVER all 12,500
      expect(result.current.visibleItems.length).toBeLessThan(60);
      expect(result.current.visibleItems.length).toBeGreaterThan(10);

      // Initial top spacer is 0 and bottom spacer accounts for the rest
      expect(result.current.topSpacerHeight).toBe(0);
      expect(result.current.bottomSpacerHeight).toBe(
        (12500 - result.current.endIndex) * itemHeight
      );
    });
  });

  it('virtualizes 2,000+ artists in Crate Digger sidebar to prevent DOM freeze', () => {
    const twoThousandArtists = Array.from({ length: 2400 }, (_, idx) => ({
      artist: `Artist ${idx}`,
      count: 5,
    }));

    const { result } = renderHook(() =>
      useVirtualList(twoThousandArtists, {
        itemHeight: 34,
        overscan: 8,
      })
    );

    expect(result.current.totalHeight).toBe(2400 * 34);
    // At default 600px height: ceil(600/34) = 18 + overscan(8) = 26 items
    expect(result.current.visibleItems.length).toBeLessThan(40);
    expect(result.current.topSpacerHeight).toBe(0);
    expect(result.current.bottomSpacerHeight).toBe((2400 - result.current.endIndex) * 34);
  });
});
