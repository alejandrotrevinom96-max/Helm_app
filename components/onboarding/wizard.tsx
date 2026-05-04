'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';

interface Props {
  initialStep: number;
  onComplete: () => void;
  hasGitHubToken: boolean;
  hasBrandContext: boolean;
  hasAnyProject: boolean;
}

const STEPS = [
  {
    id: 1,
    title: 'Connect GitHub',
    subtitle: 'Helm auto-detects your projects from your repos',
    body: 'We scan package.json files to identify your stack — Vercel, Supabase, etc. No code is read.',
    cta: 'Connect GitHub',
    skipText: "I'll add tokens manually",
  },
  {
    id: 2,
    title: 'Map your stack',
    subtitle: 'Match detected projects to Vercel & Supabase',
    body: 'Helm needs read-only tokens for each platform you use. We never write to your accounts.',
    cta: 'Open Integrations →',
    skipText: 'Skip for now',
  },
  {
    id: 3,
    title: 'Set brand context',
    subtitle: 'Helm writes posts that sound like you',
    body: 'Paste your URL, we extract voice/tone/audience. Or write it manually.',
    cta: 'Open Marketing →',
    skipText: 'Skip for now',
  },
  {
    id: 4,
    title: 'Take your first action',
    subtitle: "You're all set. What do you want to do first?",
    body: 'Generate a post, scan community pain points, or create a validation page.',
    cta: 'Generate first post',
    skipText: "I'll explore on my own",
  },
];

export function OnboardingWizard({
  initialStep,
  onComplete,
  hasGitHubToken,
  hasBrandContext,
  hasAnyProject,
}: Props) {
  const [step, setStep] = useState(Math.max(initialStep, 1));
  const [busy, setBusy] = useState(false);
  const current = STEPS.find((s) => s.id === step);

  if (!current) return null;

  const persist = async (newStep: number, skip = false) => {
    try {
      await fetch('/api/onboarding/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: newStep, skip }),
      });
    } catch {
      // Don't block UX on a persistence failure — wizard already advanced.
    }
  };

  const advance = async (newStep: number) => {
    setBusy(true);
    await persist(newStep);
    setBusy(false);
    if (newStep > 4) {
      onComplete();
    } else {
      setStep(newStep);
    }
  };

  const skipAll = async () => {
    setBusy(true);
    await persist(99, true);
    setBusy(false);
    onComplete();
  };

  // CTA for each step routes to the page where the action lives. Step 4
  // marks the wizard complete (99) before navigating so it won't reappear.
  const handleCTA = async () => {
    if (step === 1) {
      window.location.href = '/integrations?connect=github';
      return;
    }
    if (step === 2) {
      await persist(Math.max(initialStep, 2));
      window.location.href = '/integrations';
      return;
    }
    if (step === 3) {
      await persist(Math.max(initialStep, 3));
      window.location.href = '/marketing';
      return;
    }
    if (step === 4) {
      await persist(99, true);
      window.location.href = '/marketing';
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      role="dialog"
      aria-labelledby="onboarding-title"
      aria-modal="true"
    >
      <GlassCard elevated className="max-w-lg w-full p-6 sm:p-8">
        <div className="flex items-center gap-1.5 mb-6">
          {STEPS.map((s) => (
            <div
              key={s.id}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s.id <= step ? 'bg-accent' : 'bg-border'
              }`}
            />
          ))}
        </div>

        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          Step {step} of 4
        </div>

        <h2
          id="onboarding-title"
          className="font-display text-2xl sm:text-3xl font-light mb-2 leading-tight"
        >
          {current.title}
        </h2>
        <p className="text-text-2 mb-3 text-sm">{current.subtitle}</p>
        <p className="text-text-3 mb-6 text-sm leading-relaxed">{current.body}</p>

        {step === 1 && hasGitHubToken && (
          <div className="text-xs text-success mb-4">✓ GitHub already connected</div>
        )}
        {step === 2 && hasAnyProject && (
          <div className="text-xs text-success mb-4">✓ Projects detected</div>
        )}
        {step === 3 && hasBrandContext && (
          <div className="text-xs text-success mb-4">✓ Brand context configured</div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <button
            onClick={() => (step === 1 ? skipAll() : advance(step + 1))}
            disabled={busy}
            className="text-text-3 hover:text-text-1 text-xs disabled:opacity-50"
          >
            {step === 1 ? 'Skip onboarding' : current.skipText}
          </button>

          <div className="flex gap-2">
            {step > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(step - 1)}
                disabled={busy}
              >
                ← Back
              </Button>
            )}
            <Button onClick={handleCTA} disabled={busy}>
              {current.cta}
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
