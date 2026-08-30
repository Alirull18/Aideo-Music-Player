import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import App from '../App';
import { useStore } from '../store';

// jsdom does not implement matchMedia; App reads prefers-color-scheme on mount
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// jsdom lacks ResizeObserver (used by library view virtualization)
if (!(window as any).ResizeObserver) {
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ tidalConnected: false } as any);
});

afterEach(() => {
  cleanup();
});

describe('Tidal session restoration on app boot', () => {
  function mockBackend(tidalLoggedIn: boolean) {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'tidal_login_poll_status') return tidalLoggedIn;
      if (cmd === 'check_update') return { available: false };
      if (/playlists|devices|queue|tracks|history|recap|library/i.test(cmd)) return [];
      return null;
    });
  }

  it('restores tidalConnected=true on startup without visiting Settings', async () => {
    mockBackend(true);

    render(<App />);

    await waitFor(() => {
      expect(useStore.getState().tidalConnected).toBe(true);
    });
    expect(invoke).toHaveBeenCalledWith('tidal_login_poll_status');
  });

  it('stays disconnected and does not crash when no session exists', async () => {
    mockBackend(false);

    render(<App />);

    // Give the bootstrap effect a tick to settle
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('tidal_login_poll_status');
    });
    expect(useStore.getState().tidalConnected).toBe(false);
  });
});
