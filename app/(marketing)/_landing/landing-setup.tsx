// PR #34 — Sprint 6.2: replaced the v1 "setup" steps card with a
// minimal pricing/CTA block. We don't have prices yet — the honest
// answer is "free until launch", which doubles as a soft scarcity
// signal for the first-20-founders pitch.
//
// PR #38 — Sprint 6.4: trust line dropped the "Connect Meta to
// auto-post" promise (blocked behind App Review). New trust line
// reflects the actual shipping path: "1 tap to share anywhere".
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

function LandingCTA() {
  return (
    <section
      id="pricing"
      className="py-24 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-3xl mx-auto text-center">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
          Pricing
        </div>
        {/* PR #82 — Sprint 7.7: pricing copy refresh for v3.0
            positioning. Same "free for first 20" scarcity anchor;
            the disclaimer now names what the founder is paying
            with (feedback) instead of waving at a pricing TBD. CTA
            label kept as "Claim your spot →" per the v3.0 plan. */}
        <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light mb-4">
          Free for the first 20 founders.
        </h2>
        <p className="text-base md:text-lg text-text-2 max-w-xl mx-auto mb-10 leading-relaxed">
          Helm is currently free during open beta for the first 20
          founders. We&apos;re shipping in public — your feedback shapes
          the roadmap.
        </p>

        <Link
          href="/signup"
          className="inline-flex items-center gap-2 px-8 py-3.5 bg-accent text-white rounded-xl text-base font-medium hover:opacity-90 transition-opacity shadow-editorial hover:shadow-editorial-lg"
        >
          Claim your spot
          <ArrowRight className="w-5 h-5" />
        </Link>

        <p className="text-xs text-text-3 mt-5">
          No credit card. Sign up takes 30 seconds.
        </p>
      </div>
    </section>
  );
}

export { LandingCTA };
export const LandingSetup = LandingCTA;
