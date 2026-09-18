import { baseName } from '../utils';
import type { Track } from '../store/types';

let osTrackNotificationTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Checks if the application window currently has user focus.
 * When the window is focused, the user is actively viewing the player,
 * so desktop notifications and chime sounds should normally be suppressed.
 */
export async function isAppWindowFocused(): Promise<boolean> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      if (win && typeof win.isFocused === 'function') {
        return await win.isFocused();
      }
    } catch {
      // Fall through to DOM check if Tauri call fails
    }
  }
  return typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : false;
}

/**
 * Cancels any pending debounced track notification.
 */
export function cancelOsTrackNotification(): void {
  if (osTrackNotificationTimer) {
    clearTimeout(osTrackNotificationTimer);
    osTrackNotificationTimer = null;
  }
}

export interface OsTrackNotificationOptions {
  enabled?: boolean;
  backgroundOnly?: boolean;
  debounceMs?: number;
}

/**
 * Schedules an OS desktop track notification with debouncing and focus awareness.
 * - Debounces by default (800ms) so rapidly skipping songs doesn't spam notifications and sounds.
 * - Suppresses notifications if backgroundOnly is true and the app window is in focus.
 */
export function scheduleOsTrackNotification(
  track: Track,
  options: OsTrackNotificationOptions = {}
): void {
  const enabled = options.enabled !== false;
  if (!enabled) {
    cancelOsTrackNotification();
    return;
  }

  const backgroundOnly = options.backgroundOnly !== false;
  const debounceMs = options.debounceMs ?? 800;

  cancelOsTrackNotification();

  osTrackNotificationTimer = setTimeout(async () => {
    osTrackNotificationTimer = null;
    try {
      if (backgroundOnly) {
        const focused = await isAppWindowFocused();
        if (focused) {
          // App is currently focused in foreground: suppress desktop notification
          return;
        }
      }

      const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
      let granted = await isPermissionGranted();
      if (!granted) {
        granted = (await requestPermission()) === 'granted';
      }
      if (granted) {
        sendNotification({
          title: track.title || baseName(track.path),
          body: track.artist || 'Unknown Artist',
          icon: track.cover_url || undefined,
        });
      }
    } catch (e) {
      console.error('Track notification failed:', e);
    }
  }, debounceMs);
}
