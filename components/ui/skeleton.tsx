// PR Sprint 7.19 Round 2 — Polish primitive: skeletons.
//
// Replace spinners with skeletons that match the final layout's
// shape. The brief from the 7.5→9 plan: "Loading skeletons que
// matcheen layout final. Se siente 2x más rápido sin tocar
// latencia."
//
// `<Skeleton>` is the building block (unchanged from the
// original — same className interface). The new exports
// (CardSkeleton, ListSkeleton, MetricGridSkeleton, etc.) are
// pre-composed shapes for the most common loading layouts.

import { cn } from '@/lib/utils';

/** Single pulsing bar. Set width/height via className. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse bg-surface-1 rounded', className)}
    />
  );
}

// ============================================================
// Composed shapes
// ============================================================

/**
 * Single card skeleton — title bar + 3 body lines.
 * Matches the editorial glass cards used in Marketing / Compass.
 */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'glass rounded-xl p-4 border border-border space-y-3',
        className,
      )}
    >
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-4/6" />
    </div>
  );
}

/**
 * Grid of N card skeletons. Used while a list / library loads.
 */
export function CardGridSkeleton({
  count = 6,
  columns = 3,
  className,
}: {
  count?: number;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  const colsClass =
    columns === 1
      ? 'grid-cols-1'
      : columns === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : columns === 3
          ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
  return (
    <div className={cn('grid gap-3', colsClass, className)}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Row-style list skeleton — avatar/icon + 2 lines of text.
 * Used for inbox lists, recent activity, scheduled posts.
 */
export function ListSkeleton({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'glass rounded-xl overflow-hidden border border-border',
        className,
      )}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'px-4 py-3 flex items-center gap-3',
            i > 0 ? 'border-t border-border' : '',
          )}
        >
          <Skeleton className="w-8 h-8 rounded-md shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <Skeleton className="w-12 h-3 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Grid of stat tiles — used on /admin overview and the future
 * /analytics dashboard.
 */
export function MetricGridSkeleton({
  count = 4,
  columns = 4,
}: {
  count?: number;
  columns?: 2 | 3 | 4;
}) {
  const colsClass =
    columns === 2
      ? 'grid-cols-2'
      : columns === 3
        ? 'grid-cols-2 md:grid-cols-3'
        : 'grid-cols-2 md:grid-cols-4';
  return (
    <div className={cn('grid gap-3', colsClass)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="glass rounded-xl p-4 border border-border space-y-2"
        >
          <Skeleton className="h-2 w-1/2" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-2 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * Two-column layout skeleton — for /admin/inbox-style pages.
 */
export function TwoColumnSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] gap-0 h-full">
      <ListSkeleton rows={6} className="rounded-none border-y-0 border-l-0" />
      <div className="p-6 space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
        <div className="space-y-2 mt-6">
          <Skeleton className="h-12 w-2/3 rounded-2xl" />
          <Skeleton className="h-12 w-1/2 rounded-2xl ml-auto" />
          <Skeleton className="h-12 w-2/3 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
