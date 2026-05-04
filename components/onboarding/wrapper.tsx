'use client';

import { useState } from 'react';
import { OnboardingWizard } from './wizard';

interface Props {
  initialStep: number;
  hasGitHubToken: boolean;
  hasBrandContext: boolean;
  hasAnyProject: boolean;
}

// Client wrapper so the server-rendered layout can mount the wizard
// conditionally and let the client own its open/closed state.
export function OnboardingClientWrapper(props: Props) {
  const [show, setShow] = useState(true);
  if (!show) return null;
  return <OnboardingWizard {...props} onComplete={() => setShow(false)} />;
}
