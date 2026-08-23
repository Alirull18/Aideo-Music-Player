import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsFullscreen = vi.fn();
const mockSetFullscreen = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: mockIsFullscreen,
    setFullscreen: mockSetFullscreen,
  }),
}));

import { toggleOsFullscreen } from '../utils/windowFullscreen';

describe('toggleOsFullscreen (native window fullscreen shortcut)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enters native fullscreen when currently windowed', async () => {
    mockIsFullscreen.mockResolvedValue(false);
    const { invoke } = await import('@tauri-apps/api/core');

    const result = await toggleOsFullscreen();

    expect(result).toBe(true);
    expect(invoke).toHaveBeenCalledWith('enter_borderless_fullscreen', { fullscreen: true });
    expect(mockSetFullscreen).not.toHaveBeenCalled();
  });

  it('exits native fullscreen when currently fullscreen', async () => {
    mockIsFullscreen.mockResolvedValue(true);
    const { invoke } = await import('@tauri-apps/api/core');

    const result = await toggleOsFullscreen();

    expect(result).toBe(false);
    expect(invoke).toHaveBeenCalledWith('enter_borderless_fullscreen', { fullscreen: false });
  });

  it('falls back to the Tauri window API when the backend command fails', async () => {
    mockIsFullscreen.mockResolvedValue(false);
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockRejectedValueOnce('command unavailable');

    const result = await toggleOsFullscreen();

    expect(result).toBe(true);
    expect(mockSetFullscreen).toHaveBeenCalledWith(true);
  });

  it('reports unchanged state when every mechanism fails', async () => {
    mockIsFullscreen.mockResolvedValue(false);
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockRejectedValue('command unavailable');
    mockSetFullscreen.mockRejectedValue('api unavailable');

    const result = await toggleOsFullscreen();

    expect(result).toBe(false);
  });
});
