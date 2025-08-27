import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class CallErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Call Component Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div style={{
            padding: 20,
            textAlign: 'center',
            background: 'var(--card)',
            borderRadius: 8,
            border: '1px solid var(--border)',
            margin: 20
          }}>
            <h3 style={{ color: 'var(--danger)', marginTop: 0 }}>
              Call Component Error
            </h3>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>
              Something went wrong loading the call interface.
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              style={{
                padding: '8px 16px',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              Try Again
            </button>
            {this.state.error && (
              <details style={{ marginTop: 12, textAlign: 'left', fontSize: 12 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
                  Error Details
                </summary>
                <pre style={{ 
                  background: 'var(--bg)', 
                  padding: 8, 
                  borderRadius: 4, 
                  overflow: 'auto',
                  color: 'var(--danger)'
                }}>
                  {this.state.error.stack || this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        )
      );
    }

    return this.props.children;
  }
}
