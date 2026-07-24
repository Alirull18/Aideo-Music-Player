import { useState, useEffect, useCallback } from 'react';

interface UseVirtualListOptions {
  itemHeight: number;
  overscan?: number;
  scrollContainer?: HTMLElement | null;
}

export function useVirtualList<T>(
  items: T[],
  options: UseVirtualListOptions
) {
  const { itemHeight, overscan = 8, scrollContainer } = options;
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [node, setNode] = useState<HTMLElement | null>(null);

  const containerRef = useCallback((element: HTMLElement | null) => {
    setNode(element);
  }, []);

  useEffect(() => {
    const targetContainer = scrollContainer !== undefined ? scrollContainer : node;
    if (!targetContainer) return;

    setContainerHeight(targetContainer.clientHeight);
    setScrollTop(targetContainer.scrollTop);

    const handleScroll = () => {
      setScrollTop(targetContainer.scrollTop);
    };

    const handleResize = () => {
      setContainerHeight(targetContainer.clientHeight);
    };

    targetContainer.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      setContainerHeight(targetContainer.clientHeight);
    });
    resizeObserver.observe(targetContainer);

    return () => {
      targetContainer.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [scrollContainer, node]);

  const totalHeight = items.length * itemHeight;
  
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * itemHeight;
  const bottomSpacerHeight = (items.length - endIndex) * itemHeight;

  return {
    containerRef,
    visibleItems,
    startIndex,
    endIndex,
    totalHeight,
    topSpacerHeight,
    bottomSpacerHeight,
  };
}

