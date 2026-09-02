import { invoke } from '@tauri-apps/api/core';

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRASH';

export interface LogEntry {
  timestamp: string;
  level: string;
  tag: string;
  message: string;
  details?: string | null;
}

export interface SystemDiagnosticInfo {
  app_name: string;
  app_version: string;
  os_name: string;
  os_version: string;
  arch: string;
  cpu_count: number;
  process_id: number;
  log_dir: string;
  log_file: string;
  total_logs_in_memory: number;
  active_audio_backend: string;
  timestamp: string;
}

export interface FrontendCrashReport {
  message: string;
  stack?: string;
  component_stack?: string;
  url?: string;
  view?: string;
  breadcrumbs?: string[];
  extra?: Record<string, any>;
}

interface Breadcrumb {
  timestamp: string;
  category: string;
  message: string;
  data?: any;
}

const MAX_BREADCRUMBS = 100;
const breadcrumbs: Breadcrumb[] = [];

function getIsoTimestamp(): string {
  const now = new Date();
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

export function addBreadcrumb(category: string, message: string, data?: any): void {
  const entry: Breadcrumb = {
    timestamp: getIsoTimestamp(),
    category,
    message,
    data,
  };
  if (breadcrumbs.length >= MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
  breadcrumbs.push(entry);
}

export function getBreadcrumbs(): string[] {
  return breadcrumbs.map(
    (b) => `[${b.timestamp}] [${b.category}] ${b.message}${b.data ? ` | ${JSON.stringify(b.data)}` : ''}`
  );
}

const CONSOLE_STYLES: Record<LogLevel, string> = {
  TRACE: 'color: #94a3b8; font-weight: normal;',
  DEBUG: 'color: #38bdf8; font-weight: bold;',
  INFO: 'color: #4ade80; font-weight: bold;',
  WARN: 'color: #facc15; font-weight: bold;',
  ERROR: 'color: #f87171; font-weight: bold;',
  CRASH: 'color: #ffffff; background: #dc2626; font-weight: bold; padding: 2px 4px; border-radius: 3px;',
};

export async function sendLog(
  level: LogLevel,
  tag: string,
  message: string,
  details?: any
): Promise<void> {
  const ts = getIsoTimestamp();
  const detailsStr = details
    ? typeof details === 'string'
      ? details
      : details instanceof Error
      ? `${details.message}\n${details.stack || ''}`
      : JSON.stringify(details, null, 2)
    : undefined;

  // 1. DevTools Console Styling
  const style = CONSOLE_STYLES[level] || CONSOLE_STYLES.INFO;
  const prefix = `[${ts}] [${level.padEnd(5)}] [${tag.padEnd(9)}]`;
  if (level === 'ERROR' || level === 'CRASH') {
    console.error(`%c${prefix}`, style, message, detailsStr || '');
  } else if (level === 'WARN') {
    console.warn(`%c${prefix}`, style, message, detailsStr || '');
  } else if (level === 'DEBUG') {
    console.debug(`%c${prefix}`, style, message, detailsStr || '');
  } else {
    console.log(`%c${prefix}`, style, message, detailsStr || '');
  }

  // 2. Add to breadcrumbs (for debug/info/action tracking)
  if (level === 'WARN' || level === 'ERROR' || level === 'CRASH' || tag === 'NAV' || tag === 'PLAYER') {
    addBreadcrumb(tag, `[${level}] ${message}`, detailsStr);
  }

  // 3. Dispatch to Rust backend
  try {
    await invoke('log_message', {
      level,
      tag,
      message,
      details: detailsStr,
    });
  } catch (_) {
    // Silently ignore IPC failure during early init / web environment
  }
}

export const logger = {
  trace: (tag: string, msg: string, details?: any) => sendLog('TRACE', tag, msg, details),
  debug: (tag: string, msg: string, details?: any) => sendLog('DEBUG', tag, msg, details),
  info: (tag: string, msg: string, details?: any) => sendLog('INFO', tag, msg, details),
  warn: (tag: string, msg: string, details?: any) => sendLog('WARN', tag, msg, details),
  error: (tag: string, msg: string, details?: any) => sendLog('ERROR', tag, msg, details),
  
  crash: async (message: string, error?: any, componentStack?: string, extra?: Record<string, any>): Promise<string | null> => {
    const stack = error instanceof Error ? error.stack : typeof error === 'string' ? error : undefined;
    const url = typeof window !== 'undefined' ? window.location.href : undefined;
    const crumbs = getBreadcrumbs();

    console.error('%c[AIDEO FRONTEND CRASH]', CONSOLE_STYLES.CRASH, message, { error, componentStack, crumbs });

    try {
      const report: FrontendCrashReport = {
        message,
        stack,
        component_stack: componentStack,
        url,
        breadcrumbs: crumbs,
        extra,
      };
      const crashPath = await invoke<string>('log_crash', { report });
      return crashPath;
    } catch (e) {
      console.error('Failed to dispatch crash report to backend:', e);
    }
    return null;
  },

  addBreadcrumb,
  getBreadcrumbs,

  getSystemInfo: async (): Promise<SystemDiagnosticInfo | null> => {
    try {
      return await invoke<SystemDiagnosticInfo>('get_debug_system_info');
    } catch (e) {
      console.error('Failed to get system info:', e);
    }
    return null;
  },

  getRecentLogs: async (limit = 200): Promise<LogEntry[]> => {
    try {
      return (await invoke<LogEntry[]>('get_recent_logs', { limit })) || [];
    } catch (e) {
      console.error('Failed to get recent logs:', e);
    }
    return [];
  },

  openLogsFolder: async (): Promise<void> => {
    try {
      await invoke('open_logs_folder');
    } catch (e) {
      console.error('Failed to open logs folder:', e);
      throw e;
    }
  },

  exportDebugReport: async (): Promise<string> => {
    try {
      return (await invoke<string>('export_debug_report')) || 'Debug report empty.';
    } catch (e) {
      console.error('Failed to export debug report:', e);
      throw e;
    }
  },

  clearLogs: async (): Promise<void> => {
    try {
      breadcrumbs.length = 0;
      await invoke('clear_log_files');
    } catch (e) {
      console.error('Failed to clear log files:', e);
      throw e;
    }
  },
};
