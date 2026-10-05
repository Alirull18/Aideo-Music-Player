import { useStore } from '../store';
import { toggleOsFullscreen } from './windowFullscreen';

export function handlePlayerShortcut(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  const target = e.target instanceof HTMLElement ? e.target : document.activeElement;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const state = useStore.getState();
  const userShortcuts = state.shortcuts || {};
  const keyName = (e.key === ' ' ? 'Space' : e.key).toLowerCase();
  const matches = (action: string, fallback: string) => keyName === (userShortcuts[action] ?? fallback).toLowerCase();
  if (e.repeat && !matches('volumeUp', 'ArrowUp') && !matches('volumeDown', 'ArrowDown')) return;
  if (state.view === 'fullscreen') {
    if (matches('dspBypass', 'b')) {
      e.preventDefault();
      state.toggleDspAB();
    }
    return;
  }

  if (matches('playPause', 'Space')) {
    e.preventDefault();
    if (state.playback.status === 'Playing') state.pauseTrack();
    else state.resumeTrack();
  } else if (matches('next', 'ArrowRight')) {
    e.preventDefault();
    state.playNext();
  } else if (matches('prev', 'ArrowLeft')) {
    e.preventDefault();
    state.playPrev();
  } else if (matches('volumeUp', 'ArrowUp')) {
    e.preventDefault();
    state.setVolume(Math.min(state.playback.volume + 0.05, 1));
  } else if (matches('volumeDown', 'ArrowDown')) {
    e.preventDefault();
    state.setVolume(Math.max(state.playback.volume - 0.05, 0));
  } else if (matches('dspBypass', 'b')) {
    e.preventDefault();
    state.toggleDspAB();
  } else if (matches('mute', 'm')) {
    e.preventDefault();
    state.toggleMute();
  } else if (matches('fullscreenToggle', 'F11')) {
    e.preventDefault();
    toggleOsFullscreen();
  }
}
