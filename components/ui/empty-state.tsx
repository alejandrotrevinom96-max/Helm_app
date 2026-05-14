// PR Sprint 7.19 Round 2 — Polish primitive: EmptyState.
//
// Shown when a list / view has no data yet. The brief from the
// 7.5→9 plan said: "'No tienes posts aún' no basta — debe
// sugerir la siguiente acción." This component enforces that:
// every empty state ships with a clear next step.
//
// Usage:
//   <EmptyState
//     icon={<DocIcon />}
//     title="No posts generated yet"
//     description="Helm writes social posts tailored to your brand. Start with a single post or generate a batch for the week."
//     action={{ label: 'Generate first post', href: '/marketing/generate' }}
//   />
//
// Variants:
//   - With action button (link or onClick)
//   - With secondary action below the primary
//   - Compact mode for sidebars / narrow columns

import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface ActionLink {
  label: string;
  href: string;
  onClick?: never;
}
interface ActionButton {
  label: string;
  onClick: () => void;
  href?: never;
}
type Action = ActionLink | ActionButton;

export interface EmptyStateProps {
  /** Optional icon — a 24-32px SVG works best. */
  icon?: ReactNode;
  title: string;
  /** Concise body — one sentence. Avoid walls of text. */
  description?: string;
  /** Primary call to action. Renders as a Link if `href` is set,
   * otherwise as a button with `onClick`. */
  action?: Action;
  /** Optional second action, rendered as a quieter link below
   * the primary. */
  secondaryAction?: Action;
  /** Compact mode — tighter padding for narrow columns. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-6 px-4' : 'py-12 px-6',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'mb-4 flex items-center justify-center rounded-full text-text-3',
            compact ? 'w-10 h-10' : 'w-12 h-12',
          )}
          style={{ background: 'var(--surface-1)' }}
        >
          {icon}
        </div>
      )}
      <h3
        className={cn(
          'font-display text-text-1',
          compact ? 'text-base' : 'text-lg',
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'mt-1 text-text-3 max-w-sm',
            compact ? 'text-xs' : 'text-sm',
          )}
        >
          {description}
        </p>
      )}
      {action && (
        <div className="mt-5 flex flex-col items-center gap-2">
          {renderAction(action, 'primary')}
          {secondaryAction && renderAction(secondaryAction, 'secondary')}
        </div>
      )}
    </div>
  );
}

function renderAction(action: Action, variant: 'primary' | 'secondary') {
  const className =
    variant === 'primary'
      ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-[image:var(--accent-grad)] text-white font-medium text-sm h-10 px-5 shadow-editorial hover:shadow-editorial-lg hover:-translate-y-0.5 transition-all'
      : 'text-xs text-text-3 hover:text-text-1 underline-offset-4 hover:underline transition-colors';
  if ('href' in action && action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={'onClick' in action ? action.onClick : undefined}
      className={className}
    >
      {action.label}
    </button>
  );
}
