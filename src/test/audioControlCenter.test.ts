import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { AideoLabView } from '../components/AideoLabView';
import { AudioControlCenter } from '../components/AudioControlCenter';
import { handlePlayerShortcut } from '../utils/playerShortcuts';

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
    showControlCenter: false,
    devices: ['[System Default Device]'],
    dsp: { ...originalState.dsp, enabled: true },
    playback: { ...originalState.playback, bit_perfect: false },
    view: 'library',
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

describe('Audio Control Center button', () => {
  it('toggles the panel instead of changing the page', () => {
    expect(useStore.getState().showControlCenter).toBe(false);
    useStore.getState().toggleControlCenter();
    expect(useStore.getState().showControlCenter).toBe(true);
    expect(useStore.getState().view).toBe('library');
    useStore.getState().toggleControlCenter();
    expect(useStore.getState().showControlCenter).toBe(false);
  });

  it('renders nothing while closed and opens on the Hardware & Pipeline tab', async () => {
    const { container } = render(createElement(AudioControlCenter));
    expect(container).toBeEmptyDOMElement();
    act(() => useStore.getState().toggleControlCenter());
    const hardware = await screen.findByRole('button', { name: 'Hardware & Pipeline' });
    expect(hardware).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DSP & 10-Band EQ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Telemetry & Utilities' })).toBeInTheDocument();
  });
});

describe('DSP shortcut ownership', () => {
  it('toggles once and sends one notification with both DSP panels mounted', async () => {
    useStore.setState({ showControlCenter: true, view: 'aideo_lab' });
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
});

describe('Bit-perfect lock in the panel', () => {
  it('disables speed controls in Bit-Perfect mode and enables them when it is off', () => {
    useStore.setState({ showControlCenter: true, playback: { ...originalState.playback, bit_perfect: true } });
    render(createElement(AudioControlCenter));
    fireEvent.click(screen.getByRole('button', { name: 'Telemetry & Utilities' }));
    expect(screen.getByRole('slider', { name: 'Playback speed' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1.25x' })).toBeDisabled();

    act(() => useStore.setState({ playback: { ...useStore.getState().playback, bit_perfect: false } }));
    expect(screen.getByRole('slider', { name: 'Playback speed' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '1.25x' })).toBeEnabled();
  });
});
