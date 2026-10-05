import { useStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { useDownloadStore, activeDownload } from '../store/downloadStore';
import type { Track, Playlist } from '../store/types';
import { applySourcePreference } from './unifiedSources';
import { invalidateRecommendationPreferences } from './recommendations';

let priorMarker: string | null = null;
let running = false;
export async function quiesceLibrary(): Promise<void> {
  const state = useStore.getState();
  if (running || state.syncing || state.scanStatus === 'Scanning...' || useDownloadStore.getState().jobs.some(activeDownload)) throw new Error('Wait for library scanning, downloads and cloud sync to finish.');
  priorMarker = localStorage.getItem('aideo_local_restore_sync');
  localStorage.setItem('aideo_local_restore_sync', 'restoring');
  running = true;
  try {
    await state.stopTrack();
    await state.recordPlaybackTransition(null);
    const status = await invoke<{ status: string }>('get_playback_status');
    if (status?.status !== 'Stopped') throw new Error('Stop playback before changing library data.');
  } catch (error) { finishLibraryMaintenance(false); throw error; }
}
export function finishLibraryMaintenance(committed: boolean): void {
  if (!running) return;
  if (committed) localStorage.setItem('aideo_local_restore_sync', 'pending');
  else if (priorMarker === null) localStorage.removeItem('aideo_local_restore_sync');
  else localStorage.setItem('aideo_local_restore_sync', priorMarker);
  running = false;
  window.dispatchEvent(new Event('library-maintenance-finished'));
}
export async function refreshRestoredLibrary(): Promise<void> {
  localStorage.setItem('aideo_local_restore_sync', 'pending');
  const [library, favorites, playlists] = await Promise.all([
    invoke<Track[]>('get_library'), invoke<Track[]>('get_unified_favorites'), invoke<Playlist[]>('get_playlists'),
  ]);
  useStore.setState({ tracks: [...library, ...favorites].map(applySourcePreference), playlists });
  const queue = useStore.getState().queue.filter(track => !track.is_autoplay && !track.is_generated_mix);
  useStore.setState({ queue, autoplaySessionHistory: [] });
  localStorage.setItem('aideo_queue', JSON.stringify(queue));
  await useStore.getState().syncBackendQueue();
  await invoke('sync_watch_folders', { dirs: useStore.getState().scanDirs });
  invalidateRecommendationPreferences();
}
