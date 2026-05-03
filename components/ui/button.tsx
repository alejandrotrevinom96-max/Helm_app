import { cn } from '@/lib/utils';
import { type ButtonHTMLAttributes, forwardRef } from 'react';

const variants = {
  // bg uses background-image (the linear-gradient lives in --accent-grad).
  primary:
    'bg-[image:var(--accent-grad)] text-white shadow-editorial hover:shadow-editorial-lg hover:-translate-y-0.5',
  secondary: 'glass text-text-1 hover:border-border-bright',
  ghost: 'text-text-2 hover:text-text-1 hover:bg-surface-1',
  outline:
    'border border-border text-text-1 hover:border-accent hover:text-accent',
};

const sizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-5 text-sm',
  lg: 'h-12 px-7 text-base',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = 'Button';
