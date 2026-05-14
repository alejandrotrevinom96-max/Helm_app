'use client';

// PR #74 — Sprint 7.2B Step 4: Research scan (client).
//
// Three-phase orchestration:
//   1. POST /api/research/auto-configure — Opus picks keywords +
//      competitors + sources for this brand. ~10-15s.
//   2. POST /api/research/scan — pulls Reddit + HN + IndieHackers
//      findings filtered by the keywords. ~15-30s.
//   3. POST /api/research/extract-pain-points — Haiku synthesizes
//      the findings into themed pain points. ~10-15s.
//   4. GET /api/research/insights — reads the saved insight row.
//
// Total: ~45-90s. We show step-by-step progress so the founder
// knows we're not stuck. After 90s of total elapsed we surface a
// "tarda mucho — skip y seguir" escape hatch (the plan said 60s
// but reality bumps higher on a cold scan).
//
// Each phase is its own try/catch so a partial failure (e.g.
// Reddit timeout) doesn't kill the whole flow — we degrade
// gracefully into the next phase.
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';

type Phase =
  | 'configuring'
  | 'scanning'
  | 'extracting'
  | 'done'
  | 'failed';

interface PainPoint {
  theme?: string;
  frequency?: number;
  sampleQuote?: string;
  platform?: string;
  actionableAngle?: string;
}

interface Props {
  projectId: string;
}

const PHASE_COPY: Record<Phase, { title: string; subtitle: string }> = {
  configuring: {
    title: 'Configuring research sources',
    subtitle: 'Picking subreddits, keywords + competitors…',
  },
  scanning: {
    title: 'Scanning Reddit + Hacker News + IndieHackers',
    subtitle: "Looking for what your audience REALLY says…",
  },
  extracting: {
    title: 'Extracting real pain points',
    subtitle: 'Grouping repeated complaints into actionable themes…',
  },
  done: { title: '', subtitle: '' },
  failed: { title: '', subtitle: '' },
};

export function ResearchClient({ projectId }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('configuring');
  const [painPoints, setPainPoints] = useState<PainPoint[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Guard against React Strict Mode double-mount in dev firing the
  // chain twice. Real production runs land once but the dev
  // experience would burn duplicate Opus calls otherwise.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === 'done' || phase === 'failed') return;
    const i = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(i);
  }, [phase]);

  const runChain = async () => {
    try {
      // Phase 1 — auto-configure. Failure here is NOT fatal — we
      // can still try to scan with whatever existing keywords the
      // project has. Just log + continue.
      setPhase('configuring');
      try {
        await fetch('/api/research/auto-configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        });
      } catch (e) {
        console.warn('[onboarding/research] auto-configure failed:', e);
      }

      // Phase 2 — scan.
      setPhase('scanning');
      const scanRes = await fetch('/api/research/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (!scanRes.ok) {
        const data = (await scanRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? 'Scan failed');
      }

      // Phase 3 — extract pain points. If this fails we still
      // continue — the findings exist, just no themed summary yet.
      setPhase('extracting');
      try {
        await fetch('/api/research/extract-pain-points', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        });
      } catch (e) {
        console.warn('[onboarding/research] extract failed:', e);
      }

      // Read the latest insight row regardless of which phases
      // succeeded — it may have existed from a prior run.
      const insRes = await fetch(
        `/api/research/insights?projectId=${projectId}`,
        { cache: 'no-store' },
      );
      const insData = (await insRes.json()) as {
        insight?: { painPoints?: PainPoint[] } | null;
      };
      const pp = Array.isArray(insData.insight?.painPoints)
        ? (insData.insight!.painPoints as PainPoint[])
        : [];
      setPainPoints(pp);

      // Persist progress regardless of how many points we got. An
      // empty array still means "research ran".
      await fetch('/api/onboarding/wizard-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'research', completed: true }),
      });

      setPhase('done');
    } catch (e) {
      console.error('[onboarding/research] chain failed:', e);
      setError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  };

  const handleSkip = async () => {
    try {
      await fetch('/api/onboarding/wizard-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'research', skipped: true }),
      });
    } catch {
      /* non-fatal */
    }
    router.push('/onboarding/first-content');
  };

  const handleContinue = () => {
    router.push('/onboarding/first-content');
  };

  // ── PHASE: DONE ───────────────────────────────────────────────
  if (phase === 'done') {
    const visible = painPoints.slice(0, 5);
    return (
      <div>
        <div className="text-center mb-8">
          <div className="text-5xl mb-3" aria-hidden>
            🎯
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-light tracking-tight mb-2">
            {visible.length > 0
              ? `Found ${painPoints.length} real pain point${painPoints.length === 1 ? '' : 's'}`
              : 'Research ready'}
          </h1>
          <p className="text-text-2">
            {visible.length > 0
              ? 'This is what your audience is saying on Reddit, Hacker News, and IndieHackers.'
              : "We didn't find themed pain points this time — you can run more scans from /research later."}
          </p>
        </div>

        {visible.length > 0 && (
          <div className="space-y-2 mb-8">
            {visible.map((p, idx) => (
              <GlassCard key={idx} className="p-4">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <div className="font-medium text-sm text-text-1">
                    {p.theme ?? 'Pain point'}
                  </div>
                  {typeof p.frequency === 'number' && (
                    <div className="text-[10px] font-mono text-text-3 shrink-0">
                      {p.frequency}× mentions
                    </div>
                  )}
                </div>
                {p.actionableAngle && (
                  <p className="text-xs text-text-2 italic">
                    {p.actionableAngle}
                  </p>
                )}
                {p.platform && (
                  <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mt-1.5">
                    {p.platform}
                  </div>
                )}
              </GlassCard>
            ))}
          </div>
        )}

        <div className="text-center">
          <Button onClick={handleContinue} size="lg">
            Generate my first post →
          </Button>
        </div>
      </div>
    );
  }

  // ── PHASE: FAILED ─────────────────────────────────────────────
  if (phase === 'failed') {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-3" aria-hidden>
          😞
        </div>
        <h1 className="font-display text-2xl font-light mb-2">
          Research scan failed
        </h1>
        <p className="text-text-3 mb-2 max-w-md mx-auto">
          {error ?? 'Could not complete the scan.'}
        </p>
        <p className="text-text-3 text-sm mb-6 max-w-md mx-auto">
          No worries — you can run research later from{' '}
          <span className="font-mono">/research</span>. Let&apos;s move to the
          first post; initial drafts work without specific pain points.
        </p>
        <Button onClick={handleSkip}>Continue to first post →</Button>
      </div>
    );
  }

  // ── PHASE: IN-PROGRESS ────────────────────────────────────────
  const copy = PHASE_COPY[phase];
  return (
    <div className="text-center py-12">
      <div className="text-5xl mb-4 animate-pulse" aria-hidden>
        🔍
      </div>
      <h1 className="font-display text-2xl font-light mb-2">{copy.title}</h1>
      <p className="text-text-3 mb-6">{copy.subtitle}</p>
      <div className="text-xs font-mono text-text-3">{elapsed}s</div>

      {elapsed > 90 && (
        <button
          type="button"
          onClick={handleSkip}
          className="mt-6 text-xs text-text-3 underline hover:text-text-1"
        >
          Taking too long — skip and continue
        </button>
      )}
    </div>
  );
}
