import { cn } from '@/lib/utils';
import { type HTMLAttributes, forwardRef } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  hover?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, Props>(
  ({ className, elevated, hover, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        elevated ? 'glass-elevated' : 'glass',
        'rounded-2xl',
        hover && 'transition-all hover:-translate-y-0.5 hover:shadow-editorial-lg',
        className
      )}
      {...props}
    />
  )
);
GlassCard.displayName = 'GlassCard';
