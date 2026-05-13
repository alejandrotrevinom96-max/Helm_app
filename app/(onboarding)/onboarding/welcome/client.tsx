'use client';

// PR #74 — Sprint 7.2B Step 1: Welcome (client).
// Sets the tone for the rest of the wizard — friendly greeting,
// honest preview of the next 4 steps, single primary CTA.
//
// On click we mark step=welcome complete in onboarding_progress
// (also bumps the legacy users.onboardingStep) and route to
// /onboarding/project. The persistence call is awaited so a
// double-click on a flaky network doesn't fire two POSTs.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';

interface Props {
  userName: string;
}

const STEP_PREVIEWS = [
  {
    n: 1,
    icon: '📦',
    label: 'Your project',
    desc: 'Name + website. ~30 seconds.',
  },
  {
    n: 2,
    icon: '🎯',
    label: 'Brand context',
    desc: 'Niche + audience. The most important step — 2 minutes.',
  },
  {
    n: 3,
    icon: '🔍',
    label: 'Research scan',
    desc: 'Real pain points from Reddit + HN. Automatic.',
  },
  {
    n: 4,
    icon: '✨',
    label: 'Your first post',
    desc: 'Instagram carousel in YOUR voice. Opus 4.7.',
  },
];

export function WelcomeClient({ userName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/onboarding/wizard-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'welcome', completed: true }),
      });
    } catch {
      // Non-fatal — proceed to next step even if persistence fails.
      // The next step's POST will retry the chain.
    }
    router.push('/onboarding/project');
  };

  return (
    <div className="text-center">
      <div className="text-6xl mb-6" aria-hidden>
        👋
      </div>
      <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight leading-tight mb-3">
        Hey {userName}, welcome to Helm
      </h1>
      <p className="text-lg text-text-2 mb-10 max-w-xl mx-auto">
        Let&apos;s set up your AI marketing agency in{' '}
        <span className="text-text-1 font-medium">~5 minutes</span>. By the
        end you&apos;ll have your first carousel generated in your voice.
      </p>

      <div className="max-w-md mx-auto space-y-2 mb-10 text-left">
        {STEP_PREVIEWS.map((s) => (
          <GlassCard key={s.n} className="p-3 flex items-start gap-3">
            <span className="text-2xl shrink-0" aria-hidden>
              {s.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-0.5">
                Step {s.n}
              </div>
              <div className="font-medium text-sm text-text-1">{s.label}</div>
              <div className="text-xs text-text-3 mt-0.5">{s.desc}</div>
            </div>
          </GlassCard>
        ))}
      </div>

      <Button onClick={handleStart} disabled={busy} size="lg">
        {busy ? 'Starting…' : 'Get started →'}
      </Button>

      <p className="text-xs text-text-3 mt-4">
        You can skip steps. I&apos;d recommend NOT skipping Brand — it&apos;s
        what most impacts the quality of everything else.
      </p>
    </div>
  );
}
