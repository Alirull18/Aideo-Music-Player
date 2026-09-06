import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp } from 'lucide-react';
import { useStore } from '../store';

const SCROLL_THRESHOLD = 200;

const CANDIDATE_SELECTORS = [
  '[data-scroll-container="true"]',
  '.library-wrap',
  '.aideo-home-wrap',
  '.settings-view-scrollable',
  '.charts-page',
  '.insights-view-wrap',
  '.downloaded-view',
  '.lastfm-dashboard',
  '.aideo-lab-wrap',
  '.albums-page-wrap',
].join(', ');

function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  let curr: HTMLElement | null = el;
  while (curr) {
    if (curr.style && curr.style.display === 'none') {
      return false;
    }
    curr = curr.parentElement;
  }
  if (typeof el.offsetParent !== 'undefined' && el.offsetParent !== null) {
    return true;
  }
  if (typeof el.getClientRects === 'function') {
    const rects = el.getClientRects();
    if (rects.length > 0) return true;
  }
  return true;
}

function findScrollContainer(appMain: Element | null): HTMLElement | null {
  if (!appMain) return null;

  // 1. Check known candidates that are currently visible and scrolled past threshold
  const candidates = Array.from(appMain.querySelectorAll<HTMLElement>(CANDIDATE_SELECTORS));
  for (const el of candidates) {
    if (isElementVisible(el) && el.scrollTop > SCROLL_THRESHOLD) {
      return el;
    }
  }

  // 2. Check known candidates that are visible and have scrollTop > 0
  for (const el of candidates) {
    if (isElementVisible(el) && el.scrollTop > 0) {
      return el;
    }
  }

  // 3. Fallback: check any visible candidate
  for (const el of candidates) {
    if (isElementVisible(el)) {
      return el;
    }
  }

  // 4. Broader fallback: any scrollable element inside app-main
  const allElements = Array.from(appMain.querySelectorAll<HTMLElement>('div, section, main'));
  for (const el of allElements) {
    if (!isElementVisible(el)) continue;
    if (el.clientHeight < 200 || el.scrollHeight <= el.clientHeight + 50) continue;
    if (el.classList.contains('lyrics-scroll') || el.closest('.modal-overlay') || el.closest('.debug-logs-modal')) continue;
    if (el.scrollTop > 0) {
      return el;
    }
  }

  return null;
}

export function ScrollToTopButton() {
  const view = useStore((s) => s.view);
  const [visible, setVisible] = useState(false);
  const activeContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      // Ignore scroll events originating outside the main content area
      const appMain = document.querySelector('.app-main');
      if (!appMain || !appMain.contains(target)) return;

      // Filter out small scroll containers (e.g., modals, dropdowns, mini lyrics, logs)
      if (
        target.clientHeight < 200 ||
        target.scrollHeight <= target.clientHeight + 50 ||
        target.classList.contains('lyrics-scroll') ||
        target.closest('.modal-overlay') ||
        target.closest('.debug-logs-modal')
      ) {
        return;
      }

      if (target.scrollTop > SCROLL_THRESHOLD) {
        activeContainerRef.current = target;
        setVisible(true);
      } else if (activeContainerRef.current === target || !activeContainerRef.current) {
        setVisible(false);
      }
    };

    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, []);

  // When changing view tabs, reset visibility and probe for any preserved scroll position
  useEffect(() => {
    setVisible(false);
    activeContainerRef.current = null;

    const checkScroll = () => {
      const appMain = document.querySelector('.app-main');
      if (!appMain) return;

      const target = findScrollContainer(appMain);
      if (target && target.scrollTop > SCROLL_THRESHOLD) {
        activeContainerRef.current = target;
        setVisible(true);
      }
    };

    const timer1 = setTimeout(checkScroll, 80);
    const timer2 = setTimeout(checkScroll, 240);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [view]);

  const scrollToTop = useCallback(() => {
    let target = activeContainerRef.current;
    if (!target || !target.isConnected || !isElementVisible(target)) {
      const appMain = document.querySelector('.app-main');
      target = findScrollContainer(appMain);
    }

    if (target) {
      const lowSpecMode = useStore.getState().lowSpecMode;
      if (typeof target.scrollTo === 'function') {
        target.scrollTo({ top: 0, behavior: lowSpecMode ? 'auto' : 'smooth' });
      } else {
        target.scrollTop = 0;
      }
    }
  }, []);

  // Exclude fullscreen and nowplaying views
  if (view === 'fullscreen' || view === 'nowplaying') {
    return null;
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          onClick={scrollToTop}
          className="scroll-to-top-btn"
          aria-label="Scroll to top"
          title="Scroll to top"
          data-testid="scroll-to-top-btn"
          initial={{ opacity: 0, scale: 0.75, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.75, y: 8 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <ChevronUp size={20} strokeWidth={2.5} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
