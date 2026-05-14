// PR #34 — Sprint 6.2: replaced the v1 "setup" steps card with a
// minimal pricing/CTA block.
// PR Sprint 7.19 — landing v3.1 (PRODUCTION): full rebuild per
// the production copy. New H2 anchors the $0/$39 split, body
// names the dual counter (claimed + left), CTA copy adapts to
// the live count ("Claim your spot. N left →"). Both numbers
// come from the same getSpotsCount() call at the page level so
// they always add up to 50.
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface Props {
  claimed: number;
  left: number;
}

function LandingCTA({ claimed, left }: Props) {
  return (
    <section
      id="pricing"
      className="py-14 md:py-20 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-3xl mx-auto text-center">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
          Pricing
        </div>
        <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light mb-4 leading-tight">
          $0 now. $39/mo later.
          <br className="hidden sm:block" />
          Free for life if you&apos;re in the first 50.
        </h2>
        <div className="text-base md:text-lg text-text-2 max-w-2xl mx-auto mb-3 leading-relaxed space-y-4">
          <p>
            We&apos;re in open beta. The first 50 founders who claim a
            spot lock in lifetime free access, even after we launch
            publicly at $39/mo.
          </p>
          <p className="text-text-1 font-medium">
            {claimed} of 50 spots already claimed.
          </p>
          <p>
            Built in public means your feedback shapes what ships next.
            That&apos;s worth more than a launch discount.
          </p>
        </div>

        <div className="mt-8">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-accent text-white rounded-xl text-base font-medium hover:opacity-90 transition-opacity shadow-editorial hover:shadow-editorial-lg"
          >
            Claim your spot. {left} left
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>

        <p className="text-xs italic text-text-3 mt-5">
          No credit card. If you cancel, you can export everything and
          walk away.
        </p>
      </div>
    </section>
  );
}

export { LandingCTA };
export const LandingSetup = LandingCTA;
