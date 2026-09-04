import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp } from 'lucide-react';
import { useStore } from '../store';

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

      if (target.scrollTop > 300) {
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

    const timer = setTimeout(() => {
      const appMain = document.querySelector('.app-main');
      if (!appMain) return;

      const candidates = appMain.querySelectorAll<HTMLElement>(
        '.library-wrap, .aideo-home-wrap, .settings-view-scrollable, .charts-page, .insights-view-wrap, .downloaded-view, .lastfm-dashboard'
      );

      for (const el of candidates) {
        if (el.offsetParent !== null && el.scrollTop > 300) {
          activeContainerRef.current = el;
          setVisible(true);
          break;
        }
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [view]);

  const scrollToTop = useCallback(() => {
    let target = activeContainerRef.current;
    if (!target || target.offsetParent === null) {
      const appMain = document.querySelector('.app-main');
      if (appMain) {
        const candidates = appMain.querySelectorAll<HTMLElement>(
          '.library-wrap, .aideo-home-wrap, .settings-view-scrollable, .charts-page, .insights-view-wrap, .downloaded-view, .lastfm-dashboard'
        );
        for (const el of candidates) {
          if (el.offsetParent !== null && el.scrollTop > 0) {
            target = el;
            break;
          }
        }
      }
    }

    if (target) {
      if (typeof target.scrollTo === 'function') {
        target.scrollTo({ top: 0, behavior: 'smooth' });
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
