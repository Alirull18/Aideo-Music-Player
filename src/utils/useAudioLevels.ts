import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface AudioLevels {
  peak_dbfs: number | null;
  headroom_db: number | null;
  silent: boolean;
}

const listeners = new Set<(levels: AudioLevels | null) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let requests: Promise<unknown> = Promise.resolve();

function request(enabled: boolean): Promise<AudioLevels | null> {
  const next = requests.then(() => invoke<AudioLevels | null>('get_audio_levels', { enabled }));
  requests = next.catch(() => null);
  return next;
}

async function poll(session: number) {
  let levels: AudioLevels | null = null;
  try {
    const value = await request(true);
    if (value && typeof value.silent === 'boolean'
      && (value.peak_dbfs === null || Number.isFinite(value.peak_dbfs))
      && (value.headroom_db === null || Number.isFinite(value.headroom_db))) {
      levels = value;
    }
  } catch { /* The next poll retries; unavailable readings replace stale data. */ }
  if (session !== generation || listeners.size === 0) return;
  listeners.forEach(listener => listener(levels));
  timer = setTimeout(() => { void poll(session); }, 250);
}

export function useAudioLevels(open: boolean): AudioLevels | null {
  const [levels, setLevels] = useState<AudioLevels | null>(null);
  useEffect(() => {
    setLevels(null);
    if (!open) return;
    listeners.add(setLevels);
    if (listeners.size === 1) void poll(++generation);
    return () => {
      listeners.delete(setLevels);
      if (listeners.size === 0) {
        ++generation;
        clearTimeout(timer);
        void request(false).catch(() => null);
      }
    };
  }, [open]);
  return open ? levels : null;
}
