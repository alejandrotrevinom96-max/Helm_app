// PR Sprint 7.19 Round 2 — Polish primitive: ErrorState.
//
// Recovery UI for failed fetches. The plan called out: "Cada
// fetch con estado de error + retry. Hoy muchos componentes
// solo muestran un spinner infinito." This component is the
// universal fallback.
//
// Usage:
//   {error && (
//     <ErrorState
//       title="Couldn't load posts"
//       description={error.message}
//       onRetry={refetch}
//     />
//   )}
//
// The retry button shows its own loading state via `retrying`.

'use client';

import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface ErrorStateProps {
  /** Headline — keep terse. */
  title?: string;
  /** Optional body. The actual error message is fine but trim
   * before passing if it's a multi-line stack trace. */
  description?: string;
  /** Click handler for the retry button. Can be async; the
   * button shows a spinner state while the promise pending. */
  onRetry?: () => void | Promise<void>;
  /** Custom retry label. Default "Try again". */
  retryLabel?: string;
  /** Compact = tighter padding, smaller text. */
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
  compact = false,
  className,
}: ErrorStateProps) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center rounded-xl border border-danger/30',
        compact ? 'py-4 px-3' : 'py-8 px-6',
        className,
      )}
      style={{ background: 'rgba(232, 89, 63, 0.04)' }}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full text-danger mb-3',
          compact ? 'w-8 h-8' : 'w-10 h-10',
        )}
        style={{ background: 'rgba(232, 89, 63, 0.1)' }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={compact ? 'w-4 h-4' : 'w-5 h-5'}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h3
        className={cn(
          'font-medium text-text-1',
          compact ? 'text-sm' : 'text-base',
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'mt-1 text-text-3 max-w-md',
            compact ? 'text-[11px]' : 'text-xs',
          )}
        >
          {description}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className={cn(
            'mt-4 inline-flex items-center gap-2 rounded-lg border border-border-bright text-text-1',
            'hover:border-accent hover:text-accent disabled:opacity-50 transition-colors',
            compact ? 'h-7 px-3 text-xs' : 'h-9 px-4 text-sm',
          )}
        >
          {retrying ? (
            <>
              <Spinner small={compact} />
              Retrying…
            </>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={compact ? 'w-3 h-3' : 'w-4 h-4'}
                aria-hidden="true"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {retryLabel}
            </>
          )}
        </button>
      )}
    </div>
  );
}

function Spinner({ small }: { small?: boolean }) {
  return (
    <svg
      className={cn('animate-spin', small ? 'w-3 h-3' : 'w-4 h-4')}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
