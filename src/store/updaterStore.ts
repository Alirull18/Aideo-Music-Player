import { create } from 'zustand';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface DownloadProgress {
  percentage: number;
  downloadedBytes: number;
  totalBytes: number;
}

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdaterState {
  status: UpdaterStatus;
  update: Update | null;
  error: string | null;
  downloadProgress: DownloadProgress;
  modalOpen: boolean;

  checkForUpdates: (manual?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissModal: () => void;
  openModal: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: 'idle',
  update: null,
  error: null,
  downloadProgress: { percentage: 0, downloadedBytes: 0, totalBytes: 0 },
  modalOpen: false,

  checkForUpdates: async (manual = false) => {
    set({ status: 'checking', error: null });
    try {
      const update = await check();
      if (update?.available) {
        set({
          update,
          status: 'available',
          modalOpen: true,
          error: null,
        });
      } else {
        set({
          update: null,
          status: 'up-to-date',
          modalOpen: false,
        });
      }
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.warn('Update check error:', errorMessage);
      set({
        status: 'error',
        error: errorMessage,
        ...(manual ? { modalOpen: false } : {}),
      });
    }
  },

  installUpdate: async () => {
    const { update, status } = get();
    if (!update || status === 'downloading') return;

    set({
      status: 'downloading',
      error: null,
      downloadProgress: { percentage: 0, downloadedBytes: 0, totalBytes: 0 },
    });

    try {
      let total = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          set({
            downloadProgress: { percentage: 0, downloadedBytes: 0, totalBytes: total },
          });
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const percentage =
            total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
          set({
            downloadProgress: { percentage, downloadedBytes: downloaded, totalBytes: total },
          });
        } else if (event.event === 'Finished') {
          set({
            status: 'downloaded',
            downloadProgress: { percentage: 100, downloadedBytes: downloaded, totalBytes: total },
          });
        }
      });

      try {
        await relaunch();
      } catch (_) {
        // Ignored: process may terminate during self-update
      }
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.error('Update installation failed:', errorMessage);
      set({
        status: 'error',
        error: errorMessage,
      });
    }
  },

  dismissModal: () => {
    set({ modalOpen: false });
  },

  openModal: () => {
    if (get().update) {
      set({ modalOpen: true });
    }
  },
}));
