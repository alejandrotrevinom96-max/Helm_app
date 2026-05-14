// PR Sprint 7.19 — landing v3.1 (PRODUCTION).
//
// Simplified hero — single CTA, no URL preview state machine.
//
// Pre-fix (PR #34 — Sprint 6.2): the hero ran a 3-state preview
// flow (URL input → loading → preview card → "See full bible"
// signup) plus a description fallback. The preview-bible API
// and its UI machinery stay in the repo and may be revived as
// a /demo route in a future sprint, but the production landing
// brief is explicit about "Single CTA across the page:
// `Start free →`" — every conversion path now points at /signup
// without an intermediate AI demo step.
//
// The bolded "5 minutes a day" in the subhead is the
// quantification the landing brief hands the reader as a
// concrete promise. It's also the highest-impact element on the
// page per the brief's measurement section, so we keep the
// emphasis even though the rest of the page has had its em-
// dashes pruned to read more conversational.
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function LandingHero() {
  return (
    <section className="pt-36 md:pt-40 pb-12 md:pb-16 px-4 md:px-8 max-w-5xl mx-auto relative">
      {/* Subtle accent halo behind the hero — kept from the PR
          #34 build because it gives the page an editorial feel
          without leaning on imagery. */}
      <div
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-accent-glow blur-[140px] opacity-20 -z-10 pointer-events-none"
      />

      <div className="text-center">
        {/* H1 — landing-copy v3.1: "Marketing software for
            founders who'd rather ship." The brief explicitly
            kills the "Marketing OS" framing from PR #82 (too
            jargony) and names the buyer ("founders") + the
            anti-pattern ("ship vs. context-switch") directly. */}
        <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-light tracking-tight leading-[1.05] mb-6">
          Marketing software for founders who&apos;d rather ship.
        </h1>

        {/* Subhead — the "5 minutes a day" bold is intentional
            (per brief). It anchors the time investment claim. */}
        <p className="text-lg md:text-xl text-text-2 max-w-2xl mx-auto mb-10 leading-relaxed">
          One workspace replaces 7 tabs. Drafts that read like you wrote
          them. Audience research worth using. A plan for what to ship
          next. All of it in about{' '}
          <strong className="text-text-1 font-medium">
            5 minutes a day
          </strong>
          .
        </p>

        {/* Single CTA — Start free → */}
        <div className="flex flex-col items-center gap-3">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-accent text-white rounded-xl text-base font-medium hover:opacity-90 transition-opacity shadow-editorial hover:shadow-editorial-lg"
          >
            Start free
            <ArrowRight className="w-5 h-5" />
          </Link>

          {/* Microcopy under CTA — per spec word-for-word. */}
          <p className="text-xs text-text-3 max-w-md">
            No credit card. Takes 30 seconds. First 50 founders get $0/mo
            for life.
          </p>

          {/* Secondary text link — "Watch the 60-second demo".
              Targets a /demo route that doesn't exist yet; placeholder
              `#` for now so the link is visible but inert. When the
              demo lands, swap href. */}
          <a
            href="#"
            className="text-xs text-text-3 hover:text-text-1 transition-colors underline-offset-4 hover:underline mt-2"
          >
            Watch the 60-second demo →
          </a>
        </div>
      </div>
    </section>
  );
}
