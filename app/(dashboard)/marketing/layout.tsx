import { AmbientBackground } from '@/components/ui/ambient-background';
import { MarketingSubNav } from './sub-nav';

// Shell layout for /marketing/* — owns the page padding, h1, subtitle,
// and sub-tab nav. Each child page (generate / calendar / library)
// renders inside the {children} slot below.
//
// PR Sprint 7.25 Phase 6 — wrapped in <AmbientBackground accentTint=
// "orange">, page header pivoted to the editorial 88px Instrument
// Serif italic + orange "live · marketing OS" eyebrow used across
// the redesigned platform pages. Because this layout is shared by
// Generate / Calendar / Library, all three pages inherit the new
// ambient frame in one place. Their inner content (generate
// pipeline, calendar grid, library cards) is untouched.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AmbientBackground accentTint="orange">
      <div className="platform-main platform-main-wide">
        <header className="platform-page-head platform-reveal-1">
          <span className="platform-eyebrow platform-eyebrow-orange">
            live · marketing OS
          </span>
          <h1>
            Marketing<span className="accent-fire-grad">.</span>
          </h1>
          <p className="sub">
            Generate brand-aware posts, schedule them, track what works.
          </p>
        </header>

        <MarketingSubNav />

        <div style={{ marginTop: '20px' }}>{children}</div>
      </div>
    </AmbientBackground>
  );
}
