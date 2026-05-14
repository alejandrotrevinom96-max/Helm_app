// PR Sprint 7.19 — landing v3.1 (PRODUCTION).
//
// Mid-page CTA between the "Where you publish" section and the
// "Who it's for" personas. Job-to-be-done: re-anchor the
// conversion intent after the visitor has just read the proof
// (platforms supported) and before they self-identify into a
// persona.
//
// Single button, single tagline. Counter pulled from the page-
// level getSpotsCount() so the same number stays consistent
// across the hero microcopy, mid-CTA, pricing, and final CTA.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function MidPageCTA({ claimed }: { claimed: number }) {
  return (
    <section className="py-14 md:py-20 px-4 md:px-8 border-t border-border">
      <div className="max-w-3xl mx-auto text-center">
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 px-8 py-3.5 bg-accent text-white rounded-xl text-base font-medium hover:opacity-90 transition-opacity shadow-editorial hover:shadow-editorial-lg"
        >
          Start free
          <ArrowRight className="w-5 h-5" />
        </Link>
        <p className="text-xs italic text-text-3 mt-4">
          {claimed} of 50 lifetime spots claimed.
        </p>
      </div>
    </section>
  );
}
