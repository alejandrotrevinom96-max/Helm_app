import { cn } from '@/lib/utils';

export function Badge({
  children,
  variant = 'default',
  className,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'accent' | 'success';
  className?: string;
}) {
  const styles = {
    default: 'bg-surface-1 text-text-2 border-border',
    accent: 'bg-accent-soft text-accent border-accent/20',
    success: 'bg-success-soft text-success border-success/20',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full',
        'text-[10px] font-mono uppercase tracking-[0.15em]',
        'border',
        styles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
