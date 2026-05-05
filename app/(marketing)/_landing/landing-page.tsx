import { LandingNav } from './landing-nav';
import { LandingHero } from './landing-hero';
import { LandingProblem } from './landing-problem';
import { LandingWorkspace } from './landing-workspace';
import { LandingSetup } from './landing-setup';
import { LandingFooter } from './landing-footer';

// Public marketing page rendered at "/" when the visitor isn't logged in.
// Logged-in routing happens in app/(marketing)/page.tsx via redirect.
// We keep all visual sections in this folder so the (marketing) route
// group stays self-contained.
export function LandingPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <LandingNav />
      <main>
        <LandingHero />
        <LandingProblem />
        <LandingWorkspace />
        <LandingSetup />
        <LandingFooter />
      </main>
    </div>
  );
}
