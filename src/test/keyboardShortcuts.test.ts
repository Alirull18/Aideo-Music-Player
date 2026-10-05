import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { AideoLabView } from '../components/AideoLabView';
import { AudioControlCenter } from '../components/AudioControlCenter';
import { handlePlayerShortcut } from '../utils/playerShortcuts';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ isFullscreen: async () => false }),
}));

const originalState = useStore.getState();
const messages: string[] = [];
const collectToast = (event: Event) => messages.push((event as CustomEvent).detail.message);

beforeEach(() => {
  localStorage.clear();
  messages.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useStore.setState({
    lowSpecMode: true,
    showControlCenter: true,
    devices: ['[System Default Device]'],
    dsp: { ...originalState.dsp, enabled: true },
    playback: { ...originalState.playback, bit_perfect: false },
    view: 'aideo_lab',
    shortcuts: originalState.shortcuts,
  });
  window.addEventListener('keydown', handlePlayerShortcut);
  window.addEventListener('ui-toast', collectToast);
});

afterEach(() => {
  cleanup();
  window.removeEventListener('ui-toast', collectToast);
  window.removeEventListener('keydown', handlePlayerShortcut);
  useStore.setState(originalState);
  vi.unstubAllGlobals();
});

describe('DSP shortcut ownership', () => {
  it('toggles once and sends one matching notification with both DSP panels mounted', async () => {
    render(createElement(AideoLabView));
    render(createElement(AudioControlCenter));
    await act(async () => { fireEvent.keyDown(window, { key: 'b' }); });
    expect(messages).toEqual(['DSP bypassed']);
    expect(useStore.getState().dsp.enabled).toBe(false);
    messages.length = 0;
    await act(async () => { fireEvent.keyDown(window, { key: 'b' }); });
    expect(messages).toEqual(['DSP enabled']);
    expect(useStore.getState().dsp.enabled).toBe(true);
  });

  it.each([
    { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true },
  ])('does not toggle DSP for an excluded key event: %j', async options => {
    await act(async () => { fireEvent.keyDown(window, { key: 'b', ...options }); });
    expect(useStore.getState().dsp.enabled).toBe(true);
    expect(messages).toEqual([]);
  });

  it('respects a handled event and contenteditable typing', async () => {
    const event = new KeyboardEvent('keydown', { key: 'b', cancelable: true });
    event.preventDefault();
    await act(async () => { window.dispatchEvent(event); });
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.append(editor);
    try {
      await act(async () => { fireEvent.keyDown(editor, { key: 'b' }); });
      expect(messages).toEqual([]);
      expect(useStore.getState().dsp.enabled).toBe(true);
    } finally { editor.remove(); }
  });

  it('uses the remapped bypass key in normal and theater views, including uppercase', async () => {
    useStore.setState({ shortcuts: { ...originalState.shortcuts, dspBypass: 'x' } });
    for (const view of ['aideo_lab', 'fullscreen'] as const) {
      useStore.setState({ view, dsp: { ...originalState.dsp, enabled: true } });
      await act(async () => { fireEvent.keyDown(window, { key: 'b' }); });
      expect(useStore.getState().dsp.enabled).toBe(true);
      await act(async () => { fireEvent.keyDown(window, { key: 'X' }); });
      expect(useStore.getState().dsp.enabled).toBe(false);
    }
    expect(messages).toEqual(['DSP bypassed', 'DSP bypassed']);
  });
});

describe('Player shortcut routing', () => {
  it.each([
    ['Space', 'pauseTrack'], ['ArrowRight', 'playNext'], ['ArrowLeft', 'playPrev'], ['m', 'toggleMute'],
  ] as const)('routes %s to exactly one %s action', (key, action) => {
    const handler = vi.fn();
    useStore.setState({ [action]: handler, playback: { ...originalState.playback, status: 'Playing' } });
    fireEvent.keyDown(window, { key: key === 'Space' ? ' ' : key });
    fireEvent.keyDown(window, { key: key === 'Space' ? ' ' : key, repeat: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('allows held volume keys and routes fullscreen to the native command', async () => {
    const setVolume = vi.fn();
    useStore.setState({ setVolume, playback: { ...originalState.playback, volume: 0.5 } });
    fireEvent.keyDown(window, { key: 'ArrowUp', repeat: true });
    fireEvent.keyDown(window, { key: 'ArrowDown', repeat: true });
    expect(setVolume.mock.calls).toEqual([[0.55], [0.45]]);
    vi.mocked(invoke).mockClear();
    await act(async () => { fireEvent.keyDown(window, { key: 'F11' }); });
    expect(invoke).toHaveBeenCalledWith('enter_borderless_fullscreen', { fullscreen: true });
  });
});
