import Link from 'next/link';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export function LandingNav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-glass bg-bg/70 border-b border-border">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2.5">
          {/* Compass icon — same family as the sidebar's CompassIcon (PR #14)
              so logged-in users see continuity from landing → app */}
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

        <div className="flex items-center gap-2 sm:gap-4">
          <a
            href="#features"
            className="hidden md:inline text-sm text-text-2 hover:text-text-1"
          >
            Features
          </a>
          <a
            href="#how"
            className="hidden md:inline text-sm text-text-2 hover:text-text-1"
          >
            How it works
          </a>
          <a
            href="#pricing"
            className="hidden md:inline text-sm text-text-2 hover:text-text-1"
          >
            Pricing
          </a>
          <ThemeToggle />
          <Link
            href="/login"
            className="bg-[image:var(--accent-grad)] text-white px-4 py-2 rounded-lg text-sm font-medium transition-transform hover:-translate-y-0.5"
          >
            Get early access →
          </Link>
        </div>
      </div>
    </nav>
  );
}
