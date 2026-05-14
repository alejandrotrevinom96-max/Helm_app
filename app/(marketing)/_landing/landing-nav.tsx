'use client';

// PR #34 — Sprint 6.2: landing nav rebuild.
//
// Sticky top nav with backdrop blur. Transparent at top of page,
// fades to bg/80 + border once the user scrolls past 20px so it
// stays readable over content. The dual CTA (Sign in + Start free)
// matches the rest of the auth flow added in PR #33.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { FoundersBanner } from './founders-banner';

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-colors ${
        scrolled
          ? 'bg-bg/80 backdrop-blur-glass border-b border-border'
          : 'bg-transparent'
      }`}
    >
      {/* PR Sprint 7.19 — landing v3.1: scarcity banner stacked
          ABOVE the nav row inside the same fixed-top container.
          Both stick together; hero's top padding accounts for
          total height. */}
      <FoundersBanner />
      <div className="max-w-6xl mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <svg
            viewBox="0 0 24 24"
            className="w-7 h-7 text-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
          <span className="font-display text-xl font-medium">Helm</span>
        </Link>

        <div className="flex items-center gap-2 md:gap-5 text-sm">
          {/* PR Sprint 7.19 — landing v3.1: nav surfaces the
              same three destinations the production spec lists:
              Features, How it works, Roadmap. The "How it works"
              anchor maps to `#pillars` (the three-module section
              IS how Helm works). Roadmap got its own jump in v3.1
              because the brief uses "ship in public" as a trust
              signal that earns the click. */}
          <a
            href="#features"
            className="hidden md:inline-block text-text-2 hover:text-text-1 transition-colors"
          >
            Features
          </a>
          <a
            href="#pillars"
            className="hidden md:inline-block text-text-2 hover:text-text-1 transition-colors"
          >
            How it works
          </a>
          <a
            href="#roadmap"
            className="hidden md:inline-block text-text-2 hover:text-text-1 transition-colors"
          >
            Roadmap
          </a>
          <ThemeToggle />
          <Link
            href="/login"
            className="text-text-2 hover:text-text-1 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Start free →
          </Link>
        </div>
      </div>
    </nav>
  );
}
