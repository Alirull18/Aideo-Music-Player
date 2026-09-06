import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import App from '../App';
import { useUpdaterStore } from '../store/updaterStore';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));

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

describe('official tauri updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpdaterStore.setState({
      status: 'idle',
      update: null,
      error: null,
      downloadProgress: { percentage: 0, downloadedBytes: 0, totalBytes: 0 },
      modalOpen: false,
    });

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (/playlists|devices|queue|tracks|history|recap|library/i.test(command)) return [];
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('checks for updates, displays available version, and performs download & install with relaunch', async () => {
    const mockDownloadAndInstall = vi.fn().mockImplementation(async (onEvent) => {
      if (onEvent) {
        onEvent({ event: 'Started', data: { contentLength: 50 * 1024 * 1024 } });
        onEvent({ event: 'Progress', data: { chunkLength: 25 * 1024 * 1024 } });
        onEvent({ event: 'Finished' });
      }
    });

    const mockUpdate = {
      available: true,
      currentVersion: '0.9.8',
      version: '0.9.9',
      date: '2026-09-06',
      body: 'New gapless playback features and stability improvements',
      downloadAndInstall: mockDownloadAndInstall,
      close: vi.fn().mockResolvedValue(undefined),
      download: vi.fn(),
      install: vi.fn(),
      rawJson: {},
    } as any;

    vi.mocked(check).mockResolvedValue(mockUpdate);

    render(<App />);

    // Wait for the popup modal with version 0.9.9 to be visible
    expect(await screen.findByText(/Version 0.9.9/i)).toBeInTheDocument();
    expect(screen.getByText(/New gapless playback features/i)).toBeInTheDocument();

    // Click Install Update Now
    const installBtn = screen.getByRole('button', { name: /install update now/i });
    fireEvent.click(installBtn);

    await waitFor(() => {
      expect(mockDownloadAndInstall).toHaveBeenCalledTimes(1);
      expect(relaunch).toHaveBeenCalled();
    });
  });

  it('gracefully handles up-to-date response', async () => {
    vi.mocked(check).mockResolvedValue(null);

    await useUpdaterStore.getState().checkForUpdates();

    expect(useUpdaterStore.getState().status).toBe('up-to-date');
    expect(useUpdaterStore.getState().update).toBeNull();
    expect(useUpdaterStore.getState().modalOpen).toBe(false);
  });
});
