import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Terminal, X, RefreshCw, Copy, Check, FolderOpen, 
  Download, Trash2, Search, Filter, 
  Activity, Cpu, HardDrive, Volume2
} from 'lucide-react';
import { logger, LogEntry, SystemDiagnosticInfo } from '../utils/logger';

interface DebugLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DebugLogsModal: React.FC<DebugLogsModalProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sysInfo, setSysInfo] = useState<SystemDiagnosticInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const scrollBottomRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchLogsAndInfo = async () => {
    try {
      const [recent, info] = await Promise.all([
        logger.getRecentLogs(300),
        logger.getSystemInfo(),
      ]);
      setLogs(recent);
      if (info) setSysInfo(info);
    } catch (e) {
      console.error('Failed to refresh debug logs:', e);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchLogsAndInfo().finally(() => setLoading(false));

    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogsAndInfo();
    }, 2000);

    return () => clearInterval(interval);
  }, [isOpen, autoRefresh]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      if (filterLevel !== 'ALL' && entry.level.toUpperCase() !== filterLevel) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTag = entry.tag.toLowerCase().includes(q);
        const matchesMsg = entry.message.toLowerCase().includes(q);
        const matchesDetails = entry.details?.toLowerCase().includes(q);
        if (!matchesTag && !matchesMsg && !matchesDetails) return false;
      }
      return true;
    });
  }, [logs, filterLevel, searchQuery]);

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: logs.length, ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 };
    for (const log of logs) {
      const lvl = log.level.toUpperCase();
      if (lvl.includes('ERR') || lvl.includes('CRASH')) counts.ERROR++;
      else if (lvl.includes('WARN')) counts.WARN++;
      else if (lvl.includes('INFO')) counts.INFO++;
      else if (lvl.includes('DEBUG') || lvl.includes('TRACE')) counts.DEBUG++;
    }
    return counts;
  }, [logs]);

  const handleCopyLogs = async () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level.padEnd(5)}] [${l.tag.padEnd(9)}] ${l.message}${l.details ? `\n  Details: ${l.details}` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const handleExportReport = async () => {
    try {
      const report = await logger.exportDebugReport();
      const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `aideo-debug-report-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export report:', e);
    }
  };

  const handleClearLogs = async () => {
    if (window.confirm('Are you sure you want to clear the logs and in-memory buffer?')) {
      await logger.clearLogs();
      setLogs([]);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await logger.openLogsFolder();
    } catch (e) {
      console.error('Failed to open logs folder:', e);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(12px)',
            padding: '24px',
            boxSizing: 'border-box',
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 15 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            style={{
              width: '1000px',
              maxWidth: '96vw',
              height: '85vh',
              maxHeight: '900px',
              background: '#0d1117',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 16,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              color: '#f0f6fc',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                background: '#161b22',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'rgba(139, 92, 246, 0.2)',
                    color: '#a78bfa',
                    border: '1px solid rgba(139, 92, 246, 0.3)',
                  }}
                >
                  <Terminal size={18} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Aideo Diagnostics & Terminal Logs</span>
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.1)', color: '#8b949e', fontWeight: 500 }}>
                      v{sysInfo?.app_version || '0.9.6'}
                    </span>
                  </h2>
                  <p style={{ margin: 0, fontSize: 11, color: '#8b949e' }}>
                    Full real-time system observability, IPC traces, audio engine status, and crash logs
                  </p>
                </div>
              </div>

              <button
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8b949e',
                  cursor: 'pointer',
                  padding: 6,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#ffffff';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#8b949e';
                  e.currentTarget.style.background = 'none';
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick System Specs Ribbon */}
            {sysInfo && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '8px 20px',
                  background: 'rgba(22, 27, 34, 0.7)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: 11,
                  color: '#8b949e',
                  overflowX: 'auto',
                  flexWrap: 'nowrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                  <HardDrive size={13} style={{ color: '#58a6ff' }} />
                  <span>OS: <strong style={{ color: '#c9d1d9' }}>{sysInfo.os_version} ({sysInfo.arch})</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                  <Cpu size={13} style={{ color: '#bc8cff' }} />
                  <span>CPUs: <strong style={{ color: '#c9d1d9' }}>{sysInfo.cpu_count} cores</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                  <Volume2 size={13} style={{ color: '#7ee787' }} />
                  <span>Audio Engine: <strong style={{ color: '#c9d1d9' }}>{sysInfo.active_audio_backend}</strong></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                  <Activity size={13} style={{ color: '#f0883e' }} />
                  <span>PID: <strong style={{ color: '#c9d1d9' }}>{sysInfo.process_id}</strong></span>
                </div>
              </div>
            )}

            {/* Filter & Controls Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                gap: 12,
                flexWrap: 'wrap',
                background: '#0d1117',
              }}
            >
              {/* Level Buttons */}
              <div style={{ display: 'flex', gap: 4, background: '#161b22', padding: 3, borderRadius: 8, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                {[
                  { id: 'ALL', label: 'All', count: levelCounts.ALL, color: '#c9d1d9' },
                  { id: 'ERROR', label: 'Errors', count: levelCounts.ERROR, color: '#f85149' },
                  { id: 'WARN', label: 'Warns', count: levelCounts.WARN, color: '#d29922' },
                  { id: 'INFO', label: 'Info', count: levelCounts.INFO, color: '#3fb950' },
                  { id: 'DEBUG', label: 'Debug', count: levelCounts.DEBUG, color: '#58a6ff' },
                ].map((btn) => (
                  <button
                    key={btn.id}
                    onClick={() => setFilterLevel(btn.id)}
                    style={{
                      background: filterLevel === btn.id ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                      border: 'none',
                      color: filterLevel === btn.id ? '#ffffff' : '#8b949e',
                      padding: '4px 10px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.15s',
                    }}
                  >
                    <span>{btn.label}</span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 5px',
                        borderRadius: 10,
                        background: filterLevel === btn.id ? btn.color : 'rgba(255, 255, 255, 0.06)',
                        color: filterLevel === btn.id ? '#0d1117' : btn.color,
                        fontWeight: 700,
                      }}
                    >
                      {btn.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Search box */}
              <div style={{ display: 'flex', alignItems: 'center', background: '#161b22', borderRadius: 8, padding: '4px 10px', border: '1px solid rgba(255, 255, 255, 0.08)', flex: '1 1 200px', maxWidth: 300 }}>
                <Search size={13} style={{ color: '#8b949e', marginRight: 6 }} />
                <input
                  type="text"
                  placeholder="Filter by tag (AUDIO, WASAPI...) or text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    color: '#c9d1d9',
                    fontSize: 11,
                    width: '100%',
                  }}
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 0 }}>
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
                  style={{
                    background: autoRefresh ? 'rgba(63, 185, 80, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                    color: autoRefresh ? '#3fb950' : '#8b949e',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontWeight: 600,
                  }}
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                  <span>{autoRefresh ? 'Live (2s)' : 'Paused'}</span>
                </button>

                <button
                  onClick={handleCopyLogs}
                  title="Copy filtered logs to clipboard"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#c9d1d9',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {copied ? <Check size={12} style={{ color: '#3fb950' }} /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>

                <button
                  onClick={handleExportReport}
                  title="Export full diagnostic report (.txt)"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#c9d1d9',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Download size={12} />
                  <span>Export Report</span>
                </button>

                <button
                  onClick={handleOpenFolder}
                  title="Open log directory in Explorer"
                  style={{
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#c9d1d9',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <FolderOpen size={12} />
                  <span>Open Folder</span>
                </button>

                <button
                  onClick={handleClearLogs}
                  title="Clear logs"
                  style={{
                    background: 'rgba(248, 81, 73, 0.1)',
                    color: '#f85149',
                    border: '1px solid rgba(248, 81, 73, 0.2)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Trash2 size={12} />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {/* Log Output Console */}
            <div
              ref={logContainerRef}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px 16px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "JetBrains Mono", monospace',
                fontSize: 11.5,
                lineHeight: 1.6,
                background: '#090d13',
              }}
            >
              {filteredLogs.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e', gap: 8 }}>
                  <Filter size={24} style={{ opacity: 0.5 }} />
                  <span>No log entries match the current filter.</span>
                </div>
              ) : (
                filteredLogs.map((entry, idx) => {
                  const lvl = entry.level.toUpperCase();
                  const isErr = lvl.includes('ERR') || lvl.includes('CRASH');
                  const isWarn = lvl.includes('WARN');
                  const isDebug = lvl.includes('DEBUG') || lvl.includes('TRACE');
                  
                  const levelColor = isErr ? '#f85149' : isWarn ? '#d29922' : isDebug ? '#58a6ff' : '#3fb950';
                  const levelBg = isErr ? 'rgba(248, 81, 73, 0.15)' : isWarn ? 'rgba(210, 153, 34, 0.15)' : isDebug ? 'rgba(88, 166, 255, 0.15)' : 'rgba(63, 185, 80, 0.15)';

                  const isExpanded = expandedRow === idx;

                  return (
                    <div
                      key={idx}
                      onClick={() => entry.details && setExpandedRow(isExpanded ? null : idx)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '3px 6px',
                        borderRadius: 4,
                        marginBottom: 2,
                        background: isExpanded ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                        cursor: entry.details ? 'pointer' : 'default',
                        borderLeft: isErr ? '2px solid #f85149' : isWarn ? '2px solid #d29922' : '2px solid transparent',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        {/* Timestamp */}
                        <span style={{ color: '#8b949e', whiteSpace: 'nowrap', userSelect: 'none', minWidth: 150 }}>
                          {entry.timestamp}
                        </span>

                        {/* Level badge */}
                        <span
                          style={{
                            padding: '1px 5px',
                            borderRadius: 3,
                            fontSize: 10,
                            fontWeight: 700,
                            color: levelColor,
                            background: levelBg,
                            minWidth: 42,
                            textAlign: 'center',
                            userSelect: 'none',
                          }}
                        >
                          {entry.level}
                        </span>

                        {/* Tag */}
                        <span
                          style={{
                            color: '#79c0ff',
                            fontWeight: 600,
                            minWidth: 80,
                            userSelect: 'none',
                          }}
                        >
                          [{entry.tag}]
                        </span>

                        {/* Message */}
                        <span
                          style={{
                            color: isErr ? '#ff7b72' : isWarn ? '#e3b341' : '#c9d1d9',
                            flex: 1,
                            wordBreak: 'break-word',
                          }}
                        >
                          {entry.message}
                        </span>

                        {entry.details && (
                          <span style={{ fontSize: 10, color: '#8b949e', userSelect: 'none', textDecoration: 'underline' }}>
                            {isExpanded ? 'Hide' : 'Details'}
                          </span>
                        )}
                      </div>

                      {/* Expanded details */}
                      {isExpanded && entry.details && (
                        <pre
                          style={{
                            marginTop: 6,
                            marginLeft: 158,
                            padding: '8px 12px',
                            background: '#040d1a',
                            border: '1px solid rgba(88, 166, 255, 0.2)',
                            borderRadius: 6,
                            color: '#79c0ff',
                            fontSize: 10.5,
                            lineHeight: 1.4,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            maxHeight: 200,
                            overflowY: 'auto',
                          }}
                        >
                          {entry.details}
                        </pre>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={scrollBottomRef} />
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 20px',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                background: '#161b22',
                fontSize: 11,
                color: '#8b949e',
              }}
            >
              <span>Showing {filteredLogs.length} of {logs.length} captured log events</span>
              <span>Shortcut: <kbd style={{ padding: '2px 5px', borderRadius: 4, background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9' }}>Ctrl</kbd> + <kbd style={{ padding: '2px 5px', borderRadius: 4, background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9' }}>Shift</kbd> + <kbd style={{ padding: '2px 5px', borderRadius: 4, background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9' }}>D</kbd></span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
