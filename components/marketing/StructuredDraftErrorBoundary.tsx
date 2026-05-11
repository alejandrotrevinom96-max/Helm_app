'use client';

// PR #61 — Sprint 7.0.4.1 (hotfix BUG #24): error boundary so a
// single bad draft can't take down the whole panel.
//
// Pre-this-PR, an exception thrown while rendering ANY sub-view
// would unmount the entire React subtree and surface as
// "Application error: a client-side exception has occurred" with
// no actionable info. With the boundary in place we render a
// per-card error banner including the actual error message, so
// the next bug report has something to grep for.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Label for the card so the founder knows which draft choked. */
  label?: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class StructuredDraftErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console so the dev tools + Vercel logs catch
    // it. Don't ship to error-tracking from here — that'd duplicate
    // whatever client-side reporting the app already has.
    console.error(
      `[StructuredDraftErrorBoundary] render failed${
        this.props.label ? ` (${this.props.label})` : ''
      }:`,
      error,
      info.componentStack,
    );
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    const msg = this.state.error?.message ?? 'Unknown render error';
    return (
      <div className="p-4 border border-danger/30 bg-danger/10 rounded-lg">
        <div className="text-sm text-danger font-medium mb-1">
          Failed to render this draft.
        </div>
        <div className="text-xs text-danger/80 font-mono break-all mb-3">
          {msg}
        </div>
        <button
          type="button"
          onClick={this.reset}
          className="text-xs font-mono text-danger underline hover:opacity-80"
        >
          Retry render
        </button>
      </div>
    );
  }
}
