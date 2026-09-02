import { describe, it, expect } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useVirtualList } from '../utils/useVirtualList';

describe('useVirtualList Hook & Stability', () => {
  it('calculates visible items and spacers correctly for initial default size', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    const { result } = renderHook(() => useVirtualList(items, { itemHeight: 50 }));

    expect(result.current.totalHeight).toBe(5000);
    expect(result.current.startIndex).toBe(0);
    // containerHeight defaults to 600 -> ceil(600/50) = 12 + overscan(8) = 20
    expect(result.current.endIndex).toBe(20);
    expect(result.current.visibleItems.length).toBe(20);
    expect(result.current.topSpacerHeight).toBe(0);
    expect(result.current.bottomSpacerHeight).toBe(80 * 50);
  });

  it('renders a component using RefObject scrollContainer without infinite re-renders', () => {
    const items = Array.from({ length: 50 }, (_, i) => `Song ${i}`);

    function VirtualTestComponent() {
      const scrollRef = useRef<HTMLDivElement | null>(null);
      const { visibleItems, topSpacerHeight, bottomSpacerHeight } = useVirtualList(items, {
        itemHeight: 40,
        scrollContainer: scrollRef,
      });

      return (
        <div ref={scrollRef} data-testid="scroll-container" style={{ height: 400, overflowY: 'auto' }}>
          {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
          {visibleItems.map(item => (
            <div key={item} data-testid="list-item">
              {item}
            </div>
          ))}
          {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
        </div>
      );
    }

    render(<VirtualTestComponent />);

    const container = screen.getByTestId('scroll-container');
    expect(container).toBeInTheDocument();

    const renderedItems = screen.getAllByTestId('list-item');
    expect(renderedItems.length).toBeGreaterThan(0);
    expect(renderedItems.length).toBeLessThanOrEqual(50);
    expect(renderedItems[0]).toHaveTextContent('Song 0');
  });

  it('renders a component using containerRef callback without infinite re-renders', () => {
    const items = Array.from({ length: 30 }, (_, i) => `Track ${i}`);

    function QueueTestComponent() {
      const { containerRef, visibleItems } = useVirtualList(items, {
        itemHeight: 60,
      });

      return (
        <div ref={containerRef} data-testid="queue-container" style={{ height: 300, overflowY: 'auto' }}>
          {visibleItems.map(item => (
            <div key={item} data-testid="queue-item">
              {item}
            </div>
          ))}
        </div>
      );
    }

    render(<QueueTestComponent />);

    const container = screen.getByTestId('queue-container');
    expect(container).toBeInTheDocument();

    const renderedItems = screen.getAllByTestId('queue-item');
    expect(renderedItems.length).toBeGreaterThan(0);
    expect(renderedItems[0]).toHaveTextContent('Track 0');
  });
});
