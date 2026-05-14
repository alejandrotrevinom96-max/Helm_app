'use client';

import { useState } from 'react';
import { OnboardingWizard } from './wizard';

interface Props {
  initialStep: number;
  hasGitHubToken: boolean;
  hasBrandContext: boolean;
  hasAnyProject: boolean;
}

// PR #33 legacy — overlay-style wizard rendered INSIDE the
// dashboard layout for users who haven't completed onboarding.
// Pre-PR-74 this was the only onboarding surface. After PR #74
// the canonical experience moved to the full-page 5-step wizard
// under app/(onboarding)/onboarding/*.
//
// PR Sprint 7.19 follow-up — the middleware redirects every
// incomplete user to /onboarding/welcome BEFORE the dashboard
// layout renders, so in practice this overlay almost never
// surfaces anymore. It stays as defense-in-depth for two cases
// the middleware redirect doesn't catch:
//
//   1. Users on the legacy `onboardingStep < 99` track who
//      already have hasCompletedOnboarding=true (the two
//      counters drifted out of sync before the wizard-state
//      route reconciled both). Middleware lets them through;
//      the overlay catches them.
//   2. The brief moment between signup confirmation and the
//      first middleware-driven redirect — the dashboard
//      layout's project-count guard still works as a
//      backstop.
//
// Client wrapper so the server-rendered layout can mount the
// wizard conditionally and let the client own its open/closed
// state.
export function OnboardingClientWrapper(props: Props) {
  const [show, setShow] = useState(true);
  if (!show) return null;
  return <OnboardingWizard {...props} onComplete={() => setShow(false)} />;
}
