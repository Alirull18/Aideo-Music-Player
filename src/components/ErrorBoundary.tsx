import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  name?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? ` (${this.props.name})` : ''}] Uncaught error:`, error, errorInfo);
  }

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
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
            minHeight: '220px',
            height: '100%',
            width: '100%',
            background: 'rgba(12, 12, 20, 0.85)',
            backdropFilter: 'blur(16px)',
            borderRadius: 'var(--radius, 16px)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: 'var(--text, #f0f0ff)',
            textAlign: 'center',
            gap: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#ef4444',
            }}
          >
            <AlertTriangle size={26} />
          </div>

          <div style={{ maxWidth: 460 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: '#f87171' }}>
              {this.props.name ? `${this.props.name} encountered an error` : 'Something went wrong rendering this view'}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-dim, #7b8ba8)', margin: 0, wordBreak: 'break-word' }}>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
          </div>

          <button
            onClick={this.handleReset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              fontSize: 13,
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
            <RefreshCw size={14} />
            <span>Reload View</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
