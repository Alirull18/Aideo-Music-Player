import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import UpdatePopup from '../components/UpdatePopup';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

const idleProgress = { percentage: 0, downloadedBytes: 0, totalBytes: 0 };

function renderPopup(overrides: Partial<React.ComponentProps<typeof UpdatePopup>> = {}) {
  const props = {
    version: '0.9.9',
    body: 'Gapless playback and stability fixes',
    status: 'available' as const,
    error: null,
    downloadProgress: idleProgress,
    onInstall: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<UpdatePopup {...props} />);
  return props;
}

describe('UpdatePopup accessibility', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('is a named, described, non-modal dialog', () => {
    renderPopup();
    const dialog = screen.getByRole('dialog', { name: 'Update Available' });
    // It appears on its own and does not block the app, so it must not trap focus or hide the page from screen readers.
    expect(dialog).toHaveAttribute('aria-modal', 'false');
    expect(dialog).toHaveAccessibleDescription(/Version 0\.9\.9.*Gapless playback and stability fixes/s);
  });

  it('falls back to a default description when the release has no notes', () => {
    renderPopup({ body: '' });
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/ready to install/i);
  });

  it('gives the icon-only close button a name and dismisses', () => {
    const props = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notification' }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses with Escape when focus is inside the popup', () => {
    const props = renderPopup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('installs and opens the manual download page', () => {
    const props = renderPopup();
    fireEvent.click(screen.getByRole('button', { name: /install update now/i }));
    expect(props.onInstall).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /download manually from github/i }));
    expect(openUrl).toHaveBeenCalledWith('https://github.com/Alirull18/Aideo-Music-Player/releases/latest');
  });

  it('exposes download progress as a progressbar with its value', () => {
    renderPopup({
      status: 'downloading',
      downloadProgress: { percentage: 42, downloadedBytes: 21 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 },
    });
    const bar = screen.getByRole('progressbar', { name: 'Downloading update' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuetext', '42% (21.0 MB of 50.0 MB)');
    expect(screen.getByRole('button', { name: /downloading & installing/i })).toBeDisabled();
  });

  it('keeps the progressbar value valid when the size is unknown', () => {
    renderPopup({ status: 'downloading', downloadProgress: { percentage: 7, downloadedBytes: 0, totalBytes: 0 } });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '7');
    expect(bar).toHaveAttribute('aria-valuetext', '7%');
  });

  it('announces a failed update as an alert and offers retry or dismiss', () => {
    const props = renderPopup({ error: 'signature mismatch' });
    expect(screen.getByRole('dialog', { name: 'Update Failed' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('signature mismatch');
    expect(screen.queryByRole('button', { name: /install update now/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });
});
