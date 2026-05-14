'use client';

// PR #74 — Sprint 7.2B Step 3: Brand (client).
//
// Three short questions — niche, audience, tone — written directly
// into the canonical BrandBible shape via /api/onboarding/save-brand-context.
// The save endpoint does the heavy lifting of slotting these into
// identity / audience.primary.description / vocabulary.brandPhrases
// instead of overwriting the bible's top-level keys (the plan's
// original mistake — see PR comment in the save endpoint).
//
// Background analysis: after saving, we fire /api/research/analyze-brand
// fire-and-forget so by the time the founder hits the dashboard
// post-onboarding, the deep analysis is cached. The PR #72 hotfix
// added idempotency to that endpoint, so a second click here can't
// double-bill Opus.
//
// "Skip" is intentional: brand is THE most impactful step. We tell
// the founder that, and let them skip anyway — but persist the skip
// to onboarding_progress.skippedSteps so we can nudge them later.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Sparkles } from 'lucide-react';

interface Props {
  initialNiche: string;
  initialAudience: string;
  initialTone: string;
  // PR Sprint 7.19 — present when the founder hits the brand
  // step via the "+ Add project" sidebar modal, NOT during the
  // first-time onboarding wizard. When set, the brand step
  // targets THIS project for the bible save (instead of the
  // user's primaryProjectId from onboarding_progress) and the
  // continue button hands off to /marketing/library scoped to
  // the new project rather than to the next wizard step.
  projectId?: string | null;
  mode?: 'wizard' | 'new_project';
}

export function BrandClient({
  initialNiche,
  initialAudience,
  initialTone,
  projectId = null,
  mode = 'wizard',
}: Props) {
  const router = useRouter();
  const [niche, setNiche] = useState(initialNiche);
  const [audience, setAudience] = useState(initialAudience);
  const [tone, setTone] = useState(initialTone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNewProject = mode === 'new_project' && !!projectId;

  const handleContinue = async () => {
    if (!niche.trim() || !audience.trim() || busy) return;
    setBusy(true);
    setError(null);

    try {
      // 1. Save into BrandBible shape (handles merge-vs-seed).
      //    In the new-project flow we pass `projectId` explicitly
      //    so the endpoint scopes the bible to THIS project; in
      //    the normal wizard flow we let the endpoint resolve via
      //    onboarding_progress.primaryProjectId.
      const saveRes = await fetch('/api/onboarding/save-brand-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          niche: niche.trim(),
          audience: audience.trim(),
          tone: tone.trim() || null,
          ...(isNewProject ? { projectId } : {}),
        }),
      });
      const saveData = (await saveRes.json()) as {
        success?: boolean;
        projectId?: string;
        error?: string;
      };
      if (!saveRes.ok || !saveData.success) {
        setError(saveData.error ?? 'Could not save brand context');
        setBusy(false);
        return;
      }

      // 2. Mark step complete + persist verbatim answers for
      // recovery + bump legacy onboardingStep.
      //
      // For the new-project flow we DO NOT call this — the user
      // is already onboarded (hasCompletedOnboarding=true). Re-
      // running the wizard state machine could push their global
      // currentStep backwards from 'completed' to 'brand' and
      // re-trigger overlay UI elsewhere.
      if (!isNewProject) {
        await fetch('/api/onboarding/wizard-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            step: 'brand',
            completed: true,
            brandAnswers: {
              niche: niche.trim(),
              audience: audience.trim(),
              tone: tone.trim(),
            },
          }),
        });
      }

      // 3. Fire-and-forget deep analysis. Idempotency in PR #72
      // makes this safe even if the user double-submits the form.
      // We don't await — research step doesn't need the analysis
      // to start.
      if (saveData.projectId) {
        void fetch('/api/research/analyze-brand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: saveData.projectId }),
        }).catch(() => {
          /* fire-and-forget — research step works without this */
        });
      }

      // Hand-off:
      //   - normal wizard → continue to step 4 (research)
      //   - new-project flow → drop the founder directly into the
      //     new project's library so they can start generating
      //     content. Skipping research+first-content keeps the
      //     "I'm setting up a NEW project" path short — they
      //     already know how Helm works.
      if (isNewProject) {
        router.push('/marketing/library');
      } else {
        router.push('/onboarding/research');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setBusy(false);
    }
  };

  const handleSkip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!isNewProject) {
        await fetch('/api/onboarding/wizard-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: 'brand', skipped: true }),
        });
      }
    } catch {
      /* non-fatal */
    }
    // Same hand-off logic as continue.
    router.push(isNewProject ? '/marketing/library' : '/onboarding/research');
  };

  return (
    <div>
      <h1 className="font-display text-3xl md:text-4xl font-light tracking-tight mb-2">
        {isNewProject ? 'Set up your new project' : 'Brand context'}
      </h1>
      <p className="text-text-2 mb-3">
        {isNewProject
          ? 'Each project gets its own brand bible. Three quick questions and Helm scopes everything (drafts, research, voice) to this project.'
          : 'Helm needs to understand your niche to generate specific content (not generic).'}
      </p>
      <div className="mb-8 p-3 bg-accent/10 border border-accent/30 rounded-lg flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <p className="text-sm text-accent">
          This step is what most impacts the quality of EVERYTHING Helm
          generates. Worth the 2 minutes.
        </p>
      </div>

      <GlassCard className="p-6 space-y-5">
        <div>
          <label
            htmlFor="brand-niche"
            className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block"
          >
            What does your product do? (as specific as possible) *
          </label>
          <textarea
            id="brand-niche"
            value={niche}
            onChange={(e) => setNiche(e.target.value.slice(0, 500))}
            placeholder="e.g. AI travel planning for Mexican women 28-42 in life transitions (grief, divorce, burnout)"
            rows={2}
            disabled={busy}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent resize-none"
          />
          <p className="text-xs text-text-3 mt-1">
            &quot;Travel app&quot; is too generic. Specificity is where the ideas
            live.
          </p>
        </div>

        <div>
          <label
            htmlFor="brand-audience"
            className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block"
          >
            Who is your primary audience? *
          </label>
          <textarea
            id="brand-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value.slice(0, 500))}
            placeholder="e.g. Mexican women 28-42 coming out of grief / divorce / burnout, upper-middle-class professionals in CDMX/MTY"
            rows={2}
            disabled={busy}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent resize-none"
          />
        </div>

        <div>
          <label
            htmlFor="brand-tone"
            className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2 block"
          >
            Brand voice / tone (optional)
          </label>
          <textarea
            id="brand-tone"
            value={tone}
            onChange={(e) => setTone(e.target.value.slice(0, 1000))}
            placeholder="e.g. Direct, empathetic, no utilitarian American tech tone. Natural Mexican Spanish, not neutral."
            rows={3}
            disabled={busy}
            className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent resize-none"
          />
        </div>
      </GlassCard>

      {error && (
        <div className="mt-4 p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-3 flex-wrap">
        {/* On the new-project flow the founder has no "step 2" to
            go back to — they came from the sidebar modal. We
            collapse the Back link rather than send them to a
            confusing /onboarding/project page. */}
        {isNewProject ? (
          <a
            href="/marketing/library"
            className="text-sm text-text-3 hover:text-text-1"
          >
            ← Cancel
          </a>
        ) : (
          <a
            href="/onboarding/project"
            className="text-sm text-text-3 hover:text-text-1"
          >
            ← Back
          </a>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy}
            className="text-sm text-text-3 hover:text-text-1 px-2"
          >
            Skip for now
          </button>
          <Button
            onClick={handleContinue}
            disabled={!niche.trim() || !audience.trim() || busy}
          >
            {busy
              ? 'Saving…'
              : isNewProject
                ? 'Save and go to library →'
                : 'Continue →'}
          </Button>
        </div>
      </div>
    </div>
  );
}
