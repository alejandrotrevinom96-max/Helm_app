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
// PR Sprint onboarding-wow — Cambio B + C.
//
// StepIndicator + Autogenerate button only render in the
// `new_project` flow (the "+ Add project" sidebar modal hands
// the founder here with a brand-new project + URL). The
// original first-time wizard flow keeps the existing
// research → first-content path; we don't disrupt that yet.
import { StepIndicator } from '@/components/onboarding/step-indicator';

// PR Sprint onboarding-wow polish — Cambio A. Collapses the
// numeric BrandVoice sliders (0..10 on five axes — formal /
// serious / bold / innovative / approachable) into a comma-
// separated tone descriptor the founder can read and edit.
// Each axis only contributes a word when the score crosses
// its threshold (<= 3 or >= 7); middling scores are dropped
// to avoid noise like "moderately formal, moderately serious".
function synthesizeTone(
  voice:
    | {
        formal?: number;
        serious?: number;
        bold?: number;
        innovative?: number;
        approachable?: number;
      }
    | null
    | undefined,
): string {
  if (!voice) return '';
  const parts: string[] = [];
  const formal = voice.formal ?? 5;
  const serious = voice.serious ?? 5;
  const bold = voice.bold ?? 5;
  const innovative = voice.innovative ?? 5;
  const approachable = voice.approachable ?? 5;
  // formal: 0=super casual, 10=corporate formal
  if (formal <= 3) parts.push('casual');
  else if (formal >= 7) parts.push('formal');
  // serious: 0=playful, 10=dead serious
  if (serious <= 3) parts.push('playful');
  else if (serious >= 7) parts.push('serious');
  // bold: 0=reserved, 10=bold/confident
  if (bold <= 3) parts.push('reserved');
  else if (bold >= 7) parts.push('bold');
  // innovative: 0=traditional, 10=cutting edge
  if (innovative <= 3) parts.push('traditional');
  else if (innovative >= 7) parts.push('innovative');
  // approachable: 0=exclusive, 10=welcoming
  if (approachable <= 3) parts.push('exclusive');
  else if (approachable >= 7) parts.push('approachable');
  return parts.join(', ');
}

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
  // PR Sprint onboarding-wow — Cambio B.
  //
  // Autogenerate state tracks the one-shot scrape → generate →
  // persist flow that the "✨ Autogenerate from your website"
  // button triggers. Status surfaces to the founder via the
  // progress text below the button:
  //   idle      → button enabled, ready to click
  //   running   → "Scraping your site…" / "Synthesizing voice…"
  //   ready     → fields populated, founder reviews + Continues
  //   failed    → fall back to manual entry, surface the error
  const [autogenState, setAutogenState] = useState<
    'idle' | 'running' | 'ready' | 'failed'
  >('idle');
  const [autogenStage, setAutogenStage] = useState<string>('');

  // Cambio B handler — fires /api/brand-bible/quickstart, which
  // does scrape + Opus + persist server-side. Populates the 3
  // visible form fields with derived values so the founder sees
  // "campos llenos" (per QA step 3 of the spec). Failure falls
  // back to the manual form.
  const handleAutogenerate = async () => {
    if (!isNewProject || !projectId || autogenState === 'running') return;
    setAutogenState('running');
    setAutogenStage('Scraping your website…');
    setError(null);
    try {
      // Stage text is cosmetic; Opus dominates the wait so we
      // bump it once after a short delay so the founder doesn't
      // think it froze on "Scraping".
      const stageTimer = setTimeout(() => {
        setAutogenStage('Synthesizing voice + brand bible…');
      }, 3000);
      const res = await fetch('/api/brand-bible/quickstart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      clearTimeout(stageTimer);
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        brandBible?: {
          identity?: { tagline?: string | null; mission?: string | null };
          archetype?: { primary?: string | null };
          audience?: { primary?: { description?: string } };
          pillars?: Array<{ name: string }>;
          voice?: {
            formal?: number;
            serious?: number;
            bold?: number;
            innovative?: number;
            approachable?: number;
          };
        };
        error?: string;
      };
      if (!res.ok || !data.success || !data.brandBible) {
        setError(data.error ?? 'Autogenerate failed');
        setAutogenState('failed');
        return;
      }
      // PR Sprint onboarding-wow polish — Cambio A. Map the
      // persisted bible into the 3 visible form fields so the
      // founder sees "campos llenos" before clicking Continue.
      // The bible itself was already saved server-side, so even
      // if the founder edits these and re-saves, the rich bible
      // (with valueProp + primaryPain) is what /onboarding/wow
      // reads downstream.
      //
      // Pre-fix mapping was off:
      //   - niche joined ALL pillars (e.g. "Pillar1, Pillar2,
      //     Pillar3") — overflowed the textarea and read like
      //     a tag soup. Now: prefer identity.tagline (a single
      //     concise sentence) → fall back to the first pillar.
      //   - tone surfaced archetype.primary (e.g. "Magician") —
      //     a one-word archetype isn't what the founder needs
      //     in the tone box. Now: synthesize the voice sliders
      //     into a comma-separated descriptor (e.g. "casual,
      //     playful, bold, innovative, approachable") that
      //     reads as natural tone copy and is editable.
      const bb = data.brandBible;
      const niche =
        (bb.identity?.tagline ?? '').trim() ||
        (bb.pillars?.[0]?.name ?? '').trim() ||
        (bb.identity?.mission ?? '').trim();
      setNiche(niche.slice(0, 500));
      setAudience(
        (bb.audience?.primary?.description ?? '').slice(0, 500),
      );
      setTone(synthesizeTone(bb.voice).slice(0, 1000));
      setAutogenState('ready');
      setAutogenStage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setAutogenState('failed');
    }
  };

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
      //   - new-project flow → /onboarding/wow (Cambio D) for the
      //     3-draft wow moment, then on to Library. Pre-Sprint
      //     onboarding-wow this went straight to /marketing/library;
      //     we insert the wow step so the founder sees Helm
      //     producing real on-brand drafts before they touch the
      //     general dashboard.
      if (isNewProject) {
        router.push(`/onboarding/wow?projectId=${encodeURIComponent(projectId)}`);
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
    // Same hand-off logic as continue — wizard skip still goes to
    // /research, new-project skip still gets the wow moment so
    // the founder leaves onboarding having seen Helm work.
    router.push(
      isNewProject
        ? `/onboarding/wow?projectId=${encodeURIComponent(projectId!)}`
        : '/onboarding/research',
    );
  };

  return (
    <div>
      {/* PR Sprint onboarding-wow — Cambio C. StepIndicator only
          surfaces in the new-project flow (1=project, 2=brand,
          3=wow). The original first-time wizard keeps the legacy
          research → first-content path; surfacing a 3-step
          indicator there would mislead the founder about what's
          ahead. */}
      {isNewProject && <StepIndicator current={2} total={3} />}

      <h1 className="font-display text-3xl md:text-4xl font-light tracking-tight mb-2">
        {isNewProject ? 'Set up your new project' : 'Brand context'}
      </h1>
      <p className="text-text-2 mb-3">
        {isNewProject
          ? 'Each project gets its own brand bible. Helm can autogenerate it from your website or you can fill the fields manually.'
          : 'Helm needs to understand your niche to generate specific content (not generic).'}
      </p>
      {/* PR Sprint onboarding-wow — the orange "this step is THE
          most impactful" banner is suppressed in the new-project
          flow per QA spec ("sin banner naranja"). It still
          renders for the legacy first-time wizard so that
          surface keeps its existing nudge. */}
      {!isNewProject && (
        <div className="mb-8 p-3 bg-accent/10 border border-accent/30 rounded-lg flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <p className="text-sm text-accent">
            This step is what most impacts the quality of EVERYTHING Helm
            generates. Worth the 2 minutes.
          </p>
        </div>
      )}

      {/* PR Sprint onboarding-wow — Cambio B. "✨ Autogenerate
          from your website" button. Available only in the
          new-project flow because that flow guarantees a fresh
          project with a URL. Calls /api/brand-bible/quickstart
          (server-side scrape + Opus + persist). Success populates
          the 3 form fields below so the founder can review +
          edit before clicking Continue. */}
      {isNewProject && (
        <div className="mb-6">
          <Button
            onClick={() => void handleAutogenerate()}
            disabled={busy || autogenState === 'running'}
            className="w-full justify-center"
          >
            {autogenState === 'running'
              ? '⏳ Working…'
              : autogenState === 'ready'
                ? '✓ Autogenerated — review below'
                : '✨ Autogenerate from your website'}
          </Button>
          {autogenState === 'running' && autogenStage && (
            <p className="text-xs text-text-3 mt-2 text-center">
              {autogenStage}
            </p>
          )}
          {autogenState === 'ready' && (
            <p className="text-xs text-text-2 mt-2 text-center">
              Edit anything below if it doesn&apos;t match. Then continue.
            </p>
          )}
          {autogenState === 'failed' && (
            <p className="text-xs text-danger mt-2 text-center">
              Autogenerate hiccuped — fill the fields manually below.
            </p>
          )}
        </div>
      )}

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
            {busy ? 'Saving…' : 'Continue →'}
          </Button>
        </div>
      </div>
    </div>
  );
}
