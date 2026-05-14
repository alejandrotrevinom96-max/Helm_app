// PR Sprint 7.19 — landing v3.1 (PRODUCTION).
//
// Final-footer CTA. Sits between the FAQ and the footer proper,
// catching the visitor who scrolled all the way without
// clicking. Same button, different microcopy from the mid-page
// CTA (mid: "claimed", final: "remaining") so the language
// adapts to where they are on the page.

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function FinalCTA({ left }: { left: number }) {
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
          {left} of 50 lifetime spots remaining.
        </p>
      </div>
    </section>
  );
}
