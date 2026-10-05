import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri, invoke } from '@tauri-apps/api/core';
import { replayPendingBackupSettings } from './utils/localBackup';
import { replayPendingLibraryRelocations } from './utils/libraryRelocation';
import { logger } from "./utils/logger";

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    try {
      const errorObj = event.error || new Error(event.message);
      const loc = `${event.filename || "unknown"}:${event.lineno || 0}:${event.colno || 0}`;
      logger.crash(
        `Uncaught Frontend Exception: ${event.message} at ${loc}`,
        errorObj,
        undefined,
        { filename: event.filename, lineno: event.lineno, colno: event.colno }
      );
    } catch (_) {}
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason || "Unknown Rejection");
      logger.error("PROMISE", `Unhandled Promise Rejection: ${msg}`, reason);
    } catch (_) {}
  });
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
async function start() {
  try {
    if (isTauri()) {
      if (await invoke<boolean>('local_backup_reconciliation_pending')) localStorage.setItem('aideo_local_restore_sync', 'pending');
      await replayPendingBackupSettings();
      await replayPendingLibraryRelocations();
    }
    const { default: App } = await import('./App');
    root.render(<React.StrictMode><App /></React.StrictMode>);
  } catch (error) {
    root.render(<main style={{ padding: 32 }}><h1>Restore needs attention</h1><p role="alert">{String(error)}</p><button onClick={() => void start()}>Retry startup</button></main>);
  }
}
void start();

