import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ScrollToTopButton } from '../components/ScrollToTopButton';
import { useStore } from '../store';

describe('ScrollToTopButton', () => {
  beforeEach(() => {
    useStore.setState({ view: 'library' });
    document.body.innerHTML = '';
  });

  it('is initially hidden when scroll is at the top', () => {
    render(
      <div>
        <main className="app-main">
          <div className="library-wrap" style={{ height: 600 }}>Content</div>
        </main>
        <ScrollToTopButton />
      </div>
    );

    expect(screen.queryByTestId('scroll-to-top-btn')).toBeNull();
  });

  it('appears when user scrolls down past 300px', () => {
    render(
      <div>
        <main className="app-main">
          <div className="library-wrap" style={{ height: 600 }}>Content</div>
        </main>
        <ScrollToTopButton />
      </div>
    );

    const scrollContainer = document.querySelector('.library-wrap') as HTMLElement;
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 350, writable: true, configurable: true });

    act(() => {
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(screen.getByTestId('scroll-to-top-btn')).toBeInTheDocument();
  });

  it('hides when scrolling back up below 300px', async () => {
    render(
      <div>
        <main className="app-main">
          <div className="library-wrap" style={{ height: 600 }}>Content</div>
        </main>
        <ScrollToTopButton />
      </div>
    );

    const scrollContainer = document.querySelector('.library-wrap') as HTMLElement;
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 450, writable: true, configurable: true });

    act(() => {
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(screen.getByTestId('scroll-to-top-btn')).toBeInTheDocument();

    // Scroll back to top
    act(() => {
      scrollContainer.scrollTop = 100;
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('scroll-to-top-btn')).toBeNull();
    });
  });

  it('smoothly scrolls the container to top when clicked', () => {
    render(
      <div>
        <main className="app-main">
          <div className="library-wrap" style={{ height: 600 }}>Content</div>
        </main>
        <ScrollToTopButton />
      </div>
    );

    const scrollContainer = document.querySelector('.library-wrap') as HTMLElement;
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 500, writable: true, configurable: true });

    const scrollToMock = vi.fn();
    scrollContainer.scrollTo = scrollToMock;

    act(() => {
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    const button = screen.getByTestId('scroll-to-top-btn');
    fireEvent.click(button);

    expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('never renders on fullscreen or nowplaying views even when scrolled', () => {
    useStore.setState({ view: 'fullscreen' });

    render(
      <div>
        <main className="app-main">
          <div className="library-wrap" style={{ height: 600 }}>Content</div>
        </main>
        <ScrollToTopButton />
      </div>
    );

    const scrollContainer = document.querySelector('.library-wrap') as HTMLElement;
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 500, writable: true, configurable: true });

    act(() => {
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(screen.queryByTestId('scroll-to-top-btn')).toBeNull();

    // Now test nowplaying view
    act(() => {
      useStore.setState({ view: 'nowplaying' });
    });
    expect(screen.queryByTestId('scroll-to-top-btn')).toBeNull();
  });

  it('ignores tiny scroll containers or modals', () => {
    render(
      <div>
        <main className="app-main">
          <div className="modal-overlay">
            <div className="modal-body" style={{ height: 150 }}>Modal content</div>
          </div>
        </main>
        <ScrollToTopButton />
      </div>
    );

    const modalBody = document.querySelector('.modal-body') as HTMLElement;
    Object.defineProperty(modalBody, 'clientHeight', { value: 150, configurable: true });
    Object.defineProperty(modalBody, 'scrollHeight', { value: 800, configurable: true });
    Object.defineProperty(modalBody, 'scrollTop', { value: 400, writable: true, configurable: true });

    act(() => {
      modalBody.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(screen.queryByTestId('scroll-to-top-btn')).toBeNull();
  });
});
