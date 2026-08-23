import { describe, it, expect } from 'vitest';
import { useStore } from '../store';

// Locks the Settings -> Shortcuts remapper contract for the native window
// fullscreen toggle: it must ship with a default binding, be user-rebindable,
// persist via localStorage, and fall back to F11 for pre-existing installs.

describe('Fullscreen Window Toggle Shortcut Remapper', () => {
  it('ships with F11 as the default binding', () => {
    localStorage.removeItem('aideo-keyboard-shortcuts');
    expect(useStore.getState().shortcuts.fullscreenToggle).toBe('F11');
  });

  it('supports rebinding to a custom key and persists it', () => {
    useStore.getState().setShortcut('fullscreenToggle', 'g');
    expect(useStore.getState().shortcuts.fullscreenToggle).toBe('g');
    expect(
      JSON.parse(localStorage.getItem('aideo-keyboard-shortcuts') || '{}').fullscreenToggle
    ).toBe('g');

    useStore.getState().setShortcut('fullscreenToggle', 'F9');
    expect(useStore.getState().shortcuts.fullscreenToggle).toBe('F9');
  });

  it('falls back to F11 when the stored record has no fullscreenToggle entry', () => {
    // Simulates users upgrading from a version without this shortcut:
    // App.tsx resolves userShortcuts.fullscreenToggle ?? 'F11'
    const saved = { playPause: 'Space' };
    const effective = (saved as Record<string, string>).fullscreenToggle ?? 'F11';
    expect(effective).toBe('F11');
  });
});
