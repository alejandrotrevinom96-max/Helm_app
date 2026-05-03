'use client';

import { useEffect, useState, useTransition } from 'react';
import { setTheme } from '@/app/(actions)/theme';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme') as Theme | null;
    if (current === 'light' || current === 'dark') setLocal(current);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setLocal(next);
    document.documentElement.setAttribute('data-theme', next);
    startTransition(() => {
      void setTheme(next);
    });
  };

  // Render a static placeholder until we know the actual theme to avoid the
  // wrong-position flash on first paint.
  const knobOffset = mounted && theme === 'dark' ? 'translateX(26px)' : 'translateX(2px)';

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      className="relative w-12 h-6 rounded-full bg-surface-1 border border-border hover:border-border-bright transition-colors disabled:opacity-50"
    >
      <span
        className="absolute top-0.5 w-5 h-5 rounded-full bg-accent shadow-md transition-transform duration-300"
        style={{ transform: knobOffset }}
      />
      <span className="absolute left-1.5 top-0.5 text-[10px] opacity-50 leading-5 select-none">
        ☀
      </span>
      <span className="absolute right-1.5 top-0.5 text-[10px] opacity-50 leading-5 select-none">
        ☾
      </span>
    </button>
  );
}
