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
    label: 'Tu proyecto',
    desc: 'Nombre + website. ~30 segundos.',
  },
  {
    n: 2,
    icon: '🎯',
    label: 'Brand context',
    desc: 'Nicho + audiencia. Lo más importante — 2 minutos.',
  },
  {
    n: 3,
    icon: '🔍',
    label: 'Research scan',
    desc: 'Pain points reales de Reddit + HN. Automático.',
  },
  {
    n: 4,
    icon: '✨',
    label: 'Tu primer post',
    desc: 'Carrusel de Instagram en TU voice. Opus 4.7.',
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
        Hey {userName}, bienvenido a Helm
      </h1>
      <p className="text-lg text-text-2 mb-10 max-w-xl mx-auto">
        Vamos a setupear tu agencia de marketing AI en{' '}
        <span className="text-text-1 font-medium">~5 minutos</span>. Al final
        vas a tener tu primer carrusel generado en tu voice.
      </p>

      <div className="max-w-md mx-auto space-y-2 mb-10 text-left">
        {STEP_PREVIEWS.map((s) => (
          <GlassCard key={s.n} className="p-3 flex items-start gap-3">
            <span className="text-2xl shrink-0" aria-hidden>
              {s.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-0.5">
                Paso {s.n}
              </div>
              <div className="font-medium text-sm text-text-1">{s.label}</div>
              <div className="text-xs text-text-3 mt-0.5">{s.desc}</div>
            </div>
          </GlassCard>
        ))}
      </div>

      <Button onClick={handleStart} disabled={busy} size="lg">
        {busy ? 'Empezando…' : 'Empezar →'}
      </Button>

      <p className="text-xs text-text-3 mt-4">
        Podés saltar pasos. Recomiendo NO saltar Brand — es el que más
        impacta la quality de todo lo demás.
      </p>
    </div>
  );
}
