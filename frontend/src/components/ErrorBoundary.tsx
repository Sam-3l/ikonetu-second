import React, { Component, type ErrorInfo, type ReactNode } from 'react';

// ════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// Catches render errors so one broken widget doesn't crash
// the entire dashboard. Shows a recovery UI instead.
// ════════════════════════════════════════════════════════════

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  context?: string; // e.g. "Founder Dashboard" — shown in error message
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production, send to an error tracking service (Sentry, etc.)
    console.error(`[ErrorBoundary] ${this.props.context || 'Component'} crashed:`, error, info);
  }

  reset = () => this.setState({ hasError: false, error: undefined });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 200, padding: 32,
        }}>
          <div style={{
            background: '#fff', border: '1px solid #FECACA', borderRadius: 12,
            padding: 28, maxWidth: 480, width: '100%', textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0A0A0A', margin: '0 0 8px' }}>
              Something went wrong{this.props.context ? ` in ${this.props.context}` : ''}
            </h3>
            <p style={{ fontSize: 13, color: '#888', margin: '0 0 20px', lineHeight: 1.6 }}>
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={this.reset}
                style={{
                  background: '#0A0A0A', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '9px 20px', fontSize: 13,
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: 'none', color: '#888', border: '1px solid #E0DED8',
                  borderRadius: 8, padding: '9px 20px', fontSize: 13, cursor: 'pointer',
                }}
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ── Section boundary — wraps a single widget/card ────────────
// Use this for individual charts, tables, or data sections
// so one broken widget doesn't kill the whole page.

export function SectionBoundary({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ErrorBoundary
      context={label}
      fallback={
        <div style={{
          background: '#F8F7F4', border: '1px solid #E8E6E0', borderRadius: 10,
          padding: '20px 24px', color: '#888', fontSize: 13, textAlign: 'center',
        }}>
          {label || 'This section'} failed to load.{' '}
          <button
            onClick={() => window.location.reload()}
            style={{ background: 'none', border: 'none', color: '#C9900C', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            Reload
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
