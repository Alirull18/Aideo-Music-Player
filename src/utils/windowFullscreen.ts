import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Toggles the OS-level window fullscreen state (NOT the in-app theater mode).
// Mirrors the idiom used by FullscreenView: prefer the Rust command, fall back
// to the Tauri window API. Returns the resulting fullscreen state.
export async function toggleOsFullscreen(): Promise<boolean> {
  const appWindow = getCurrentWindow();
  let isFullscreen = false;
  try {
    isFullscreen = await appWindow.isFullscreen();
  } catch (err) {
    console.error('Failed to query fullscreen state:', err);
    return false;
  }

  const next = !isFullscreen;
  try {
    await invoke('enter_borderless_fullscreen', { fullscreen: next });
  } catch {
    try {
      await appWindow.setFullscreen(next);
    } catch (err) {
      console.error('Failed to toggle native fullscreen:', err);
      return isFullscreen;
    }
  }
  return next;
}
