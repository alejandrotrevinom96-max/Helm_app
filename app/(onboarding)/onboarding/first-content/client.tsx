'use client';

// PR #74 — Sprint 7.2B Step 5: First content (client).
//
// THE wow moment. Generates an Instagram carousel via the
// existing /api/ai/generate-structured endpoint with:
//   - platform: 'instagram'
//   - types: ['carousel']
//   - prompt: top pain-point angle from research, or fallback to
//     the founder's brand niche.
//
// On success: persist firstDraftId + flip markOnboardingComplete
// in one POST so the legacy users.onboardingStep flips to 99 +
// hasCompletedOnboarding=true. The dashboard layout's overlay
// wizard stops showing from this moment.
//
// On failure: surface the categorized error from the endpoint
// (which already speaks the same overloaded/timeout/json/unknown
// vocabulary as analyze-brand thanks to PR #72) and offer
// retry + "skip to library".
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';

interface StructuredSlide {
  text?: string;
  copy?: string;
  content?: string;
  body?: string;
}

interface StructuredDraft {
  hook?: string;
  caption?: string;
  title?: string;
  slides?: StructuredSlide[];
}

interface Draft {
  id: string;
  contentType: string;
  displayName: string;
  structuredContent: StructuredDraft;
}

interface Props {
  projectId: string;
  seedPrompt: string;
}

type Phase = 'generating' | 'done' | 'failed';

// PR #75 — Sprint 7.2C hotfix: error kinds shared with
// /api/ai/generate-structured (and /api/research/analyze-brand
// via PR #72). The endpoint now categorizes its failures so this
// screen can render specific, actionable copy instead of "Algo
// falló" — important for the wizard's WOW moment where a generic
// error loses the founder right at the finish line.
type ErrorKind =
  | 'overloaded'
  | 'rate_limit'
  | 'timeout'
  | 'json'
  | 'auth'
  | 'insufficient_context'
  | 'unknown';

interface CategorizedError {
  message: string;
  kind: ErrorKind;
  retry: boolean;
  hint: string;
}

const ERROR_DISPLAY: Record<
  ErrorKind,
  { icon: string; title: string; defaultHint: string }
> = {
  overloaded: {
    icon: '⏳',
    title: 'Anthropic está saturado',
    defaultHint:
      'Esto es temporal — esperá ~1 minuto y reintentá. Generalmente funciona al segundo intento.',
  },
  rate_limit: {
    icon: '🚦',
    title: 'Demasiadas requests muy rápido',
    defaultHint: 'Esperá ~30 segundos y dale otra vez.',
  },
  timeout: {
    icon: '⏱️',
    title: 'La generación tardó demasiado',
    defaultHint:
      'Probable que el contexto es muy denso. Reintentá — la red pudo ser el problema.',
  },
  json: {
    icon: '🔧',
    title: 'Opus devolvió output malformado',
    defaultHint:
      'Esto es transient — reintentá, casi siempre funciona al segundo.',
  },
  auth: {
    icon: '🔐',
    title: 'Problema técnico con el servicio AI',
    defaultHint:
      'No es algo que puedas resolver vos — contactanos por soporte.',
  },
  insufficient_context: {
    icon: '📝',
    title: 'Falta brand context',
    defaultHint:
      'Volvé al step de Brand y agregá niche + audience. Eso le da a Opus material para trabajar.',
  },
  unknown: {
    icon: '😞',
    title: 'Algo falló al generar',
    defaultHint:
      'Reintentá una vez más — si persiste, escribinos con el detalle.',
  },
};

export function FirstContentClient({ projectId, seedPrompt }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('generating');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // PR #75 — Sprint 7.2C hotfix: structured error so the fail UI
  // can branch on kind (overloaded vs timeout vs insufficient
  // context). Null when no error has happened yet.
  const [error, setError] = useState<CategorizedError | null>(null);
  // Same Strict-Mode guard pattern as the research step. Without
  // it, dev double-mount fires the generation twice and burns a
  // duplicate Opus call.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'generating') return;
    const i = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(i);
  }, [phase]);

  const generate = async () => {
    setPhase('generating');
    setError(null);
    setElapsed(0);
    try {
      const res = await fetch('/api/ai/generate-structured', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          platform: 'instagram',
          types: ['carousel'],
          prompt: seedPrompt.slice(0, 1000),
        }),
      });
      // PR #75 — Sprint 7.2C hotfix: the endpoint now returns
      // errorKind + hint + retry at the top level when zero drafts
      // succeeded. Per-draft errors also carry errorKind for the
      // partial-failure path, which we don't hit here (we only ask
      // for one type) but the type stays compatible.
      const data = (await res.json()) as {
        success?: boolean;
        drafts?: Array<
          Draft & {
            errorKind?: ErrorKind;
            errorHint?: string;
            errorRetry?: boolean;
            error?: string;
            structuredContent?: StructuredDraft | null;
          }
        >;
        error?: string;
        errorKind?: ErrorKind;
        hint?: string;
        retry?: boolean;
      };
      // Total failure: endpoint returns success=false with the
      // categorized kind. Old behavior was success=true even when
      // every draft failed — see the route's PR #75 comment.
      if (!res.ok || !data.success) {
        const kind: ErrorKind = data.errorKind ?? 'unknown';
        setError({
          kind,
          message: data.error ?? 'No pudimos generar el post',
          retry: data.retry ?? true,
          hint:
            data.hint ?? ERROR_DISPLAY[kind].defaultHint,
        });
        setPhase('failed');
        return;
      }
      // Defensive: success=true but the first draft has no
      // structured content (shouldn't happen post-7.2C, but guard
      // anyway so old responses still degrade cleanly).
      if (
        !data.drafts?.[0] ||
        data.drafts[0].structuredContent == null
      ) {
        const perDraft = data.drafts?.[0];
        const kind: ErrorKind = perDraft?.errorKind ?? 'unknown';
        setError({
          kind,
          message: perDraft?.error ?? 'Draft no se generó',
          retry: perDraft?.errorRetry ?? true,
          hint:
            perDraft?.errorHint ?? ERROR_DISPLAY[kind].defaultHint,
        });
        setPhase('failed');
        return;
      }

      const firstDraft = data.drafts[0];
      // The extended draft shape carries optional error fields; strip
      // them when storing — the rendering path only cares about
      // structuredContent at this point.
      setDraft({
        id: firstDraft.id,
        contentType: firstDraft.contentType,
        displayName: firstDraft.displayName,
        structuredContent: firstDraft.structuredContent as StructuredDraft,
      });

      // Persist + mark whole wizard complete in one POST. Bumps
      // users.onboardingStep=99 + hasCompletedOnboarding=true so
      // the dashboard layout overlay (PR #74 legacy wizard) stops
      // showing.
      await fetch('/api/onboarding/wizard-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'first-content',
          completed: true,
          firstDraftId: firstDraft.id,
          markOnboardingComplete: true,
        }),
      });

      setPhase('done');
    } catch (e) {
      // Network errors don't come from Anthropic so they don't get
      // a categorized kind from the helper — bucket them as
      // 'unknown' with the actual message preserved.
      const message = e instanceof Error ? e.message : 'Network error';
      setError({
        kind: 'unknown',
        message,
        retry: true,
        hint: ERROR_DISPLAY.unknown.defaultHint,
      });
      setPhase('failed');
    }
  };

  const skipToLibrary = async () => {
    try {
      await fetch('/api/onboarding/wizard-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'first-content',
          skipped: true,
          markOnboardingComplete: true,
        }),
      });
    } catch {
      /* non-fatal */
    }
    router.push('/marketing/library');
  };

  // ── PHASE: GENERATING ─────────────────────────────────────────
  if (phase === 'generating') {
    return (
      <div className="text-center py-12">
        <div className="text-5xl mb-4 animate-pulse" aria-hidden>
          ✨
        </div>
        <h1 className="font-display text-2xl font-light mb-2">
          Generando tu primer post
        </h1>
        <p className="text-text-3 mb-2">
          Opus 4.7 con tu brand context + pain points reales.
        </p>
        <p className="text-xs text-text-3 mt-1">
          {elapsed < 12
            ? 'Cargando contexto…'
            : elapsed < 25
              ? 'Generando carousel slides…'
              : elapsed < 40
                ? 'Refinando voice…'
                : 'Casi listo…'}
        </p>
        <div className="text-xs font-mono text-text-3 mt-3">{elapsed}s</div>
      </div>
    );
  }

  // ── PHASE: FAILED ─────────────────────────────────────────────
  if (phase === 'failed') {
    const kind = error?.kind ?? 'unknown';
    const display = ERROR_DISPLAY[kind];
    const isInsufficient = kind === 'insufficient_context';
    return (
      <div className="text-center py-8">
        <div className="text-5xl mb-3" aria-hidden>
          {display.icon}
        </div>
        <h1 className="font-display text-2xl font-light mb-2">
          {display.title}
        </h1>
        {error?.message && (
          <p className="text-text-3 text-xs mb-2 max-w-md mx-auto font-mono">
            {error.message.slice(0, 200)}
          </p>
        )}
        <p className="text-text-2 text-sm mb-6 max-w-md mx-auto">
          {error?.hint ?? display.defaultHint}
        </p>

        {/* PR #75 — Sprint 7.2C hotfix: insufficient_context gets a
            distinct CTA back to the brand step (the gap is upstream,
            not in the generation pass) plus a one-line "why this
            matters" reminder. */}
        {isInsufficient && (
          <div className="max-w-md mx-auto mb-6 p-4 bg-bg-elev/40 rounded-lg border border-border text-sm text-text-2">
            <strong className="text-text-1">Tip:</strong> el step de Brand
            toma ~2 minutos pero impacta TODO lo que Helm genere después.
            Vale la pena.
          </div>
        )}

        <div className="flex gap-3 justify-center flex-wrap">
          {error?.retry && (
            <Button onClick={() => void generate()}>Reintentar</Button>
          )}
          {isInsufficient ? (
            <button
              type="button"
              onClick={() => router.push('/onboarding/brand')}
              className="px-4 py-2 border border-border rounded-lg text-sm hover:border-border-bright"
            >
              Volver al step de Brand →
            </button>
          ) : (
            <button
              type="button"
              onClick={skipToLibrary}
              className="px-4 py-2 border border-border rounded-lg text-sm hover:border-border-bright"
            >
              Saltar a Marketing →
            </button>
          )}
        </div>

        <p className="text-xs text-text-3 mt-6">
          Tu onboarding está casi completo. Podés generar contenido más tarde
          desde /marketing/generate.
        </p>
      </div>
    );
  }

  // ── PHASE: DONE ───────────────────────────────────────────────
  const sc = draft?.structuredContent ?? {};
  const headline = sc.hook ?? sc.caption ?? sc.title ?? 'Tu post';
  const slides = Array.isArray(sc.slides) ? sc.slides : [];
  const previewSlides = slides.slice(0, 3);

  return (
    <div>
      <div className="text-center mb-8">
        <div className="text-5xl mb-3" aria-hidden>
          🎉
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-light tracking-tight mb-2">
          Tu primer post está listo
        </h1>
        <p className="text-text-2">
          Generado en TU voice, basado en pain point real de tu audiencia.
        </p>
      </div>

      <GlassCard
        elevated
        className="p-6 mb-8 border border-accent/40"
      >
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          Instagram carousel · Draft preview
        </div>
        <h3 className="font-display text-xl font-light mb-3">{headline}</h3>
        {previewSlides.length > 0 ? (
          <div className="space-y-2">
            {previewSlides.map((s, i) => (
              <div
                key={i}
                className="text-sm p-3 bg-bg-elev/40 rounded border border-border"
              >
                <strong className="text-text-3 text-[10px] font-mono uppercase tracking-[0.15em] mr-2">
                  Slide {i + 1}
                </strong>
                {s.text ?? s.copy ?? s.content ?? s.body ?? ''}
              </div>
            ))}
            {slides.length > 3 && (
              <p className="text-xs text-text-3 italic">
                + {slides.length - 3} slide{slides.length - 3 === 1 ? '' : 's'}{' '}
                más
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-3 italic">
            (Estructura completa visible en Library.)
          </p>
        )}
      </GlassCard>

      <div className="flex items-center justify-center gap-3 flex-wrap mb-12">
        <Button onClick={() => router.push('/marketing/library')} size="lg">
          Ver en mi Library →
        </Button>
        <button
          type="button"
          onClick={() => void generate()}
          className="px-4 py-3 border border-border rounded-lg text-sm hover:border-border-bright"
        >
          Regenerar
        </button>
      </div>

      <GlassCard className="p-6">
        <h3 className="font-display text-lg font-light mb-3">
          🎉 Onboarding completo
        </h3>
        <p className="text-sm text-text-3 mb-4">
          Próximos pasos sugeridos:
        </p>
        <ul className="text-sm space-y-2">
          <li className="flex items-start gap-2">
            <span aria-hidden>📅</span>
            <span>
              Schedule tu primer post desde{' '}
              <a
                href="/marketing/library"
                className="text-accent hover:underline"
              >
                /marketing/library
              </a>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>🧭</span>
            <span>
              Run un Compass scan en{' '}
              <a href="/compass" className="text-accent hover:underline">
                /compass
              </a>{' '}
              para estrategia semanal
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>📊</span>
            <span>
              Explorá más pain points en{' '}
              <a href="/research" className="text-accent hover:underline">
                /research
              </a>
            </span>
          </li>
        </ul>
      </GlassCard>
    </div>
  );
}
