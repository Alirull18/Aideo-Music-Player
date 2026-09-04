import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { logger } from '../utils/logger';
import { DebugLogsModal } from '../components/DebugLogsModal';
import { ErrorBoundary } from '../components/ErrorBoundary';

// Mock invoke from Tauri
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, _args?: any) => {
    if (cmd === 'get_recent_logs') {
      return [
        { timestamp: '2026-09-02 07:18:00.000', level: 'INFO', tag: 'AUDIO', message: 'Initialized CPAL audio host' },
        { timestamp: '2026-09-02 07:18:01.000', level: 'DEBUG', tag: 'WASAPI', message: 'Stream buffer size: 1024 frames' },
        { timestamp: '2026-09-02 07:18:02.000', level: 'WARN', tag: 'SCANNER', message: 'Missing album tag in file.flac' },
        { timestamp: '2026-09-02 07:18:03.000', level: 'ERROR', tag: 'DATABASE', message: 'Failed to open lock on table', details: 'DatabaseLocked error' },
      ];
    }
    if (cmd === 'get_debug_system_info') {
      return {
        app_name: 'Aideo Music Player',
        app_version: '0.9.7',
        os_name: 'windows',
        os_version: 'windows (windows)',
        arch: 'x86_64',
        cpu_count: 8,
        process_id: 12345,
        log_dir: 'C:/Users/Alirul/AppData/Roaming/com.alirul.music-player/logs',
        log_file: 'C:/Users/Alirul/AppData/Roaming/com.alirul.music-player/logs/aideo.log',
        total_logs_in_memory: 4,
        active_audio_backend: 'CPAL/WASAPI',
        timestamp: '2026-09-02 07:18:00.000',
      };
    }
    if (cmd === 'export_debug_report') {
      return '=== AIDEO DIAGNOSTIC REPORT ===\nVersion: 0.9.7\nOS: Windows\n';
    }
    if (cmd === 'log_crash') {
      return 'C:/Users/Alirul/AppData/Roaming/com.alirul.music-player/logs/crash-frontend-test.log';
    }
    return null;
  }),
}));

describe('Frontend Logger & Diagnostics Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records breadcrumbs properly in memory', () => {
    logger.addBreadcrumb('NAV', 'Navigated to LibraryView');
    logger.addBreadcrumb('PLAYER', 'Playback started: Bohemian Rhapsody');

    const crumbs = logger.getBreadcrumbs();
    expect(crumbs.length).toBeGreaterThanOrEqual(2);
    expect(crumbs.some(c => c.includes('[NAV]') && c.includes('Navigated to LibraryView'))).toBe(true);
    expect(crumbs.some(c => c.includes('[PLAYER]') && c.includes('Bohemian Rhapsody'))).toBe(true);
  });

  it('forwards log messages to console and backend', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await logger.info('AUDIO', 'Playback volume set to 80%');
    await logger.warn('SCANNER', 'Slow disk read');
    await logger.error('DB', 'Table lock contention');

    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('retrieves system diagnostics and recent logs', async () => {
    const info = await logger.getSystemInfo();
    expect(info).not.toBeNull();
    expect(info?.app_version).toBe('0.9.7');
    expect(info?.cpu_count).toBe(8);

    const logs = await logger.getRecentLogs();
    expect(logs.length).toBe(4);
    expect(logs[0].tag).toBe('AUDIO');
    expect(logs[3].level).toBe('ERROR');
  });
});

describe('DebugLogsModal Component', () => {
  it('renders modal with system info, level filters, and log list', async () => {
    const onClose = vi.fn();
    render(<DebugLogsModal isOpen={true} onClose={onClose} />);

    expect(screen.getByText('Aideo Diagnostics & Terminal Logs')).toBeInTheDocument();

    // Wait for async log fetching
    await waitFor(() => {
      expect(screen.getByText('Initialized CPAL audio host')).toBeInTheDocument();
      expect(screen.getByText('Stream buffer size: 1024 frames')).toBeInTheDocument();
      expect(screen.getByText('Missing album tag in file.flac')).toBeInTheDocument();
      expect(screen.getByText('Failed to open lock on table')).toBeInTheDocument();
    });

    // Test Level Filter
    fireEvent.click(screen.getByText('Errors'));
    expect(screen.getByText('Failed to open lock on table')).toBeInTheDocument();
    expect(screen.queryByText('Initialized CPAL audio host')).not.toBeInTheDocument();

    // Reset to All
    fireEvent.click(screen.getByText('All'));
    expect(screen.getByText('Initialized CPAL audio host')).toBeInTheDocument();

    // Test Search input
    const searchInput = screen.getByPlaceholderText(/Filter by tag/i);
    fireEvent.change(searchInput, { target: { value: 'WASAPI' } });
    expect(screen.getByText('Stream buffer size: 1024 frames')).toBeInTheDocument();
    expect(screen.queryByText('Initialized CPAL audio host')).not.toBeInTheDocument();
  });

  it('expands details row when clicked', async () => {
    render(<DebugLogsModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to open lock on table')).toBeInTheDocument();
    });

    // Click details
    const detailsTrigger = screen.getByText('Details');
    fireEvent.click(detailsTrigger);

    expect(screen.getByText('DatabaseLocked error')).toBeInTheDocument();
  });
});

describe('Enhanced ErrorBoundary with Diagnostics', () => {
  it('shows diagnostics actions on catch', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function BrokenComponent(): React.ReactNode {
      throw new Error('Test DSP Crashed');
    }

    render(
      <ErrorBoundary name="AudioEngineView">
        <BrokenComponent />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('AudioEngineView encountered an error')).toBeInTheDocument();
    expect(screen.getByText('Copy Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Open Logs Folder')).toBeInTheDocument();
    expect(screen.getByText('Show Technical Details')).toBeInTheDocument();

    // Click Show Technical Details
    fireEvent.click(screen.getByText('Show Technical Details'));
    expect(screen.getByText('Hide Technical Details')).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});
