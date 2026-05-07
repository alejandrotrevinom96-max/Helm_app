import Link from 'next/link';

// PR #34 — Sprint 6.2: footer simplified.
//
// Pre-PR-34 the footer doubled as a "Stop switching / Start shipping"
// CTA section. PR #34 introduced a dedicated CTA block (LandingCTA in
// landing-setup.tsx) so this is just the footer chrome now — logo,
// links, attribution.
export function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-10 md:py-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5 text-accent"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
            <span className="font-display text-base font-medium">Helm</span>
          </div>
          <p className="text-xs text-text-3">
            Marketing suite for indie founders.
          </p>
        </div>

        <div className="flex flex-wrap gap-4 md:gap-6 text-sm text-text-3">
          <a href="#pillars" className="hover:text-text-1 transition-colors">
            Features
          </a>
          <a
            href="#how-it-works"
            className="hover:text-text-1 transition-colors"
          >
            How it works
          </a>
          {/* PR #29 — required by Meta App Review (Privacy Policy +
              Terms of Service URLs surfaced from a public page). */}
          <Link href="/privacy" className="hover:text-text-1 transition-colors">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-text-1 transition-colors">
            Terms
          </Link>
          <Link href="/login" className="hover:text-text-1 transition-colors">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
