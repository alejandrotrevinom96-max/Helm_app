'use client';

// PR Sprint 7.19 Round 1 — Next.js 15 global-error boundary.
//
// Last line of defense for client-side React errors. Anything
// that propagates past page-level error.tsx boundaries lands
// here. We forward to Sentry with full context and render a
// minimal recovery UI.
//
// Org: helm-mk · Project: javascript-nextjs

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          background: '#0c0907',
          color: '#f5f0e8',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          margin: 0,
        }}
      >
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            Something broke.
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              opacity: 0.7,
              marginBottom: '1.5rem',
            }}
          >
            We&apos;ve been notified and are looking into it. Try
            reloading the page — most issues clear up on retry.
          </p>
          {error.digest && (
            <p
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                fontSize: '0.75rem',
                opacity: 0.4,
                marginBottom: '1.5rem',
              }}
            >
              ref: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: '#c44520',
              color: '#ffffff',
              border: 'none',
              padding: '0.625rem 1.25rem',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
