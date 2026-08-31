import { useState, useEffect, useCallback, useRef } from 'react';

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

  const lastScrollTopRef = useRef(0);
  const lastHeightRef = useRef(600);

  const containerRef = useCallback((element: HTMLElement | null) => {
    setNode(element);
  }, []);

  useEffect(() => {
    const targetContainer = scrollContainer || node;
    if (!targetContainer) return;

    const initialHeight = targetContainer.clientHeight || 600;
    const initialScroll = targetContainer.scrollTop || 0;

    lastHeightRef.current = initialHeight;
    lastScrollTopRef.current = initialScroll;
    setContainerHeight(initialHeight);
    setScrollTop(initialScroll);

    let rafId: number | null = null;

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const currentScroll = targetContainer.scrollTop;
        if (Math.abs(lastScrollTopRef.current - currentScroll) >= 1) {
          lastScrollTopRef.current = currentScroll;
          setScrollTop(currentScroll);
        }
      });
    };

    const handleResize = () => {
      const currentHeight = targetContainer.clientHeight || 600;
      if (Math.abs(lastHeightRef.current - currentHeight) >= 4) {
        lastHeightRef.current = currentHeight;
        setContainerHeight(currentHeight);
      }
    };

    targetContainer.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(targetContainer);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      targetContainer.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) resizeObserver.disconnect();
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

