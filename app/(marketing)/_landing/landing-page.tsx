import { LandingNav } from './landing-nav';
import { LandingHero } from './landing-hero';
import { LandingProblemStatement } from './landing-problem-statement';
import { LandingProblem } from './landing-problem';
import { LandingPublishingPlatforms } from './landing-publishing-platforms';
import { LandingPersonas } from './landing-personas';
import { LandingFeatures } from './landing-features';
import { LandingIntegrations } from './landing-integrations';
import { LandingRoadmap } from './landing-roadmap';
import { LandingSetup } from './landing-setup';
import { LandingFAQ } from './landing-faq';
import { LandingFooter } from './landing-footer';

// Public marketing page rendered at "/" when the visitor isn't logged in.
// Logged-in routing happens in app/(marketing)/page.tsx via redirect.
//
// PR #82 — Sprint 7.7: v3.0 positioning rebuild. New section order:
//   1.  Hero (preview-bible URL flow preserved)
//   2.  Problem statement ("7 tabs")
//   3.  3 pillars (Marketing / Research / Compass)
//   4.  Publishing platforms grid
//   5.  Personas (who it's for)
//   6.  Features grid (12 cards)
//   7.  Integrations (data + publishing)
//   8.  Roadmap (current / v3.0 / v3.5)
//   9.  Pricing CTA
//   10. FAQ
//   11. Footer (4 column)
//
// `landing-workspace.tsx` (the legacy "How it works" steps) is no
// longer rendered. The file stays on disk so a revert can be done
// with one import line; tree-shaking removes it from the bundle.
export function LandingPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <LandingNav />
      <main>
        <LandingHero />
        <LandingProblemStatement />
        <LandingProblem />
        <LandingPublishingPlatforms />
        <LandingPersonas />
        <LandingFeatures />
        <LandingIntegrations />
        <LandingRoadmap />
        <LandingSetup />
        <LandingFAQ />
        <LandingFooter />
      </main>
    </div>
  );
}
