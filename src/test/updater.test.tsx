import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import App from '../App';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('automatic updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'check_update') {
        return {
          available: true,
          version: '0.9.8',
          download_url: 'https://github.com/Alirull18/Aideo-Music-Player/releases/download/v0.9.8/Aideo.exe',
          sha256_url: 'https://github.com/Alirull18/Aideo-Music-Player/releases/download/v0.9.8/Aideo.exe.sha256',
          body: 'Update notes',
        };
      }
      if (/playlists|devices|queue|tracks|history|recap|library/i.test(command)) return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('passes the checksum URL to Rust instead of fetching it in the webview', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /install update now/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('download_and_install', {
        url: 'https://github.com/Alirull18/Aideo-Music-Player/releases/download/v0.9.8/Aideo.exe',
        sha256Url: 'https://github.com/Alirull18/Aideo-Music-Player/releases/download/v0.9.8/Aideo.exe.sha256',
      });
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
