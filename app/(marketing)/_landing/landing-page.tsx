import { LandingNav } from './landing-nav';
import { LandingHero } from './landing-hero';
import { LandingProblemStatement } from './landing-problem-statement';
import { LandingProblem } from './landing-problem';
import { LandingPublishingPlatforms } from './landing-publishing-platforms';
import { MidPageCTA } from './mid-cta';
import { LandingPersonas } from './landing-personas';
import { LandingFeatures } from './landing-features';
import { LandingIntegrations } from './landing-integrations';
import { LandingRoadmap } from './landing-roadmap';
import { FounderStory } from './founder-story';
import { LandingSetup } from './landing-setup';
import { LandingFAQ } from './landing-faq';
import { FinalCTA } from './final-cta';
import { LandingFooter } from './landing-footer';
import { getSpotsCount } from './spots-count';

// Public marketing page rendered at "/" when the visitor isn't logged in.
// Logged-in routing happens in app/(marketing)/page.tsx via redirect.
//
// PR #82 — Sprint 7.7: v3.0 positioning rebuild (Marketing OS).
// PR Sprint 7.19 — landing v3.1 (PRODUCTION):
//   - Hero: "Marketing software for founders who'd rather ship."
//   - ICP: 3 personas (solo founders, indie hackers, bootstrap
//     SaaS) instead of 5.
//   - Pricing: $0 now / $39 later anchor + dual counter (claimed
//     / left) sourced from the live users table via getSpotsCount.
//   - New sections: founders banner (top), mid-page CTA, founder
//     story, final-footer CTA.
//   - Single CTA across the page: `Start free →`.
//
// Section order (matches the production copy spec):
//   1.  Header (LandingNav with founders-banner stacked on top)
//   2.  Hero
//   3.  "7 tabs" problem statement
//   4.  Bridge + 3 modules (Marketing / Research / Compass)
//   5.  Publishing platforms grid
//   6.  Mid-page CTA
//   7.  Personas (3)
//   8.  Features (6 in 2 groups: Create / Decide)
//   9.  Integrations
//   10. Roadmap
//   11. Founder story
//   12. Pricing
//   13. FAQ
//   14. Final CTA
//   15. Footer
//
// Async server component — pulls the lifetime-spots count once
// per request and threads `claimed` + `left` to the components
// that render the counter so the two numbers always add up to 50.
export async function LandingPage() {
  const { claimed, left } = await getSpotsCount();

  return (
    <div className="min-h-screen relative overflow-hidden">
      <LandingNav />
      <main>
        <LandingHero />
        <LandingProblemStatement />
        <LandingProblem />
        <LandingPublishingPlatforms />
        <MidPageCTA claimed={claimed} />
        <LandingPersonas />
        <LandingFeatures />
        <LandingIntegrations />
        <LandingRoadmap />
        <FounderStory />
        <LandingSetup claimed={claimed} left={left} />
        <LandingFAQ />
        <FinalCTA left={left} />
        <LandingFooter />
      </main>
    </div>
  );
}
