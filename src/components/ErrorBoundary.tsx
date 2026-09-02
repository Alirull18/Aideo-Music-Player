import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, Check, FolderOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { logger } from '../utils/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  name?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    componentStack: null,
    copied: false,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const compStack = errorInfo.componentStack || '';
    this.setState({ componentStack: compStack });
    
    // Log crash to backend terminal and disk crash dump
    logger.crash(
      `[React ErrorBoundary${this.props.name ? ` (${this.props.name})` : ''}] ${error.message}`,
      error,
      compStack,
      { boundaryName: this.props.name || 'Anonymous Boundary' }
    ).catch(() => {});
  }

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null, componentStack: null, copied: false, showDetails: false });
  };

  private handleCopy = async () => {
    const info = [
      `Component: ${this.props.name || 'Root App'}`,
      `Error: ${this.state.error?.name || 'Error'}: ${this.state.error?.message || 'Unknown error'}`,
      `Stack:\n${this.state.error?.stack || 'No stack'}`,
      `Component Stack:\n${this.state.componentStack || 'No component stack'}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n\n');

    try {
      await navigator.clipboard.writeText(info);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (_) {}
  };

  private handleOpenLogs = async () => {
    try {
      await logger.openLogsFolder();
    } catch (e) {
      console.error('Failed to open logs folder:', e);
    }
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function' && this.state.error) {
        return this.props.fallback(this.state.error, this.handleReset);
      }
      if (this.props.fallback && typeof this.props.fallback !== 'function') {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 24px',
            minHeight: '260px',
            height: '100%',
            width: '100%',
            background: 'rgba(12, 12, 20, 0.92)',
            backdropFilter: 'blur(16px)',
            borderRadius: 'var(--radius, 16px)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'var(--text, #f0f0ff)',
            textAlign: 'center',
            gap: 16,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.25)',
            }}
          >
            <AlertTriangle size={28} />
          </div>

          <div style={{ maxWidth: 520 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: '#f87171' }}>
              {this.props.name ? `${this.props.name} encountered an error` : 'Application View Error'}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-dim, #7b8ba8)', margin: 0, wordBreak: 'break-word', lineHeight: 1.5 }}>
              {this.state.error?.message || 'An unexpected rendering error occurred. Crash log saved to disk.'}
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={this.handleReset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.12)',
                background: 'var(--accent, #8b5cf6)',
                color: '#ffffff',
                cursor: 'pointer',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              <RefreshCw size={13} />
              <span>Reload View</span>
            </button>

            <button
              onClick={this.handleCopy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--text, #f0f0ff)',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {this.state.copied ? <Check size={13} style={{ color: '#4ade80' }} /> : <Copy size={13} />}
              <span>{this.state.copied ? 'Copied' : 'Copy Diagnostics'}</span>
            </button>

            <button
              onClick={this.handleOpenLogs}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: 'var(--text, #f0f0ff)',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <FolderOpen size={13} />
              <span>Open Logs Folder</span>
            </button>
          </div>

          {/* Collapsible Details */}
          <div style={{ width: '100%', maxWidth: 580, marginTop: 4 }}>
            <button
              onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-dim, #7b8ba8)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
              }}
            >
              <span>{this.state.showDetails ? 'Hide Technical Details' : 'Show Technical Details'}</span>
              {this.state.showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {this.state.showDetails && (
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: 'rgba(0, 0, 0, 0.5)',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  fontSize: 10,
                  lineHeight: 1.4,
                  textAlign: 'left',
                  maxHeight: 160,
                  overflowY: 'auto',
                  color: '#e2e8f0',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {this.state.error?.stack || this.state.componentStack || 'No stack trace available.'}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
