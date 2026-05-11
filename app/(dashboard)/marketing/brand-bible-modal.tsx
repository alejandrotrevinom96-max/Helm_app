'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';
import type { BrandBible } from '@/lib/types/brand';
import type { BrandProject } from './brand-bible-card';
import { QuoteVault } from './quote-vault';
import { AutoGenerateSection } from './auto-generate-section';
import { ImageValidationSection } from './image-validation-section';

// PR #26 — Sprint 3 added 'auto' for multi-source auto-generated bible.
// PR #27 — Sprint 4 added 'validate' for the post-bible image
// validation loop. The pre-existing 'discover' mode (single URL →
// /api/brand/discover) stays — it's faster but only does one page.
type Mode =
  | 'overview'
  | 'discover'
  | 'refine'
  | 'quotes'
  | 'auto'
  | 'validate';

interface RefineQuestion {
  id: string;
  field: string;
  question: string;
  type: 'single_select' | 'multi_select' | 'text' | 'longtext' | 'slider';
  options?: Array<{ value: string; label: string; description?: string }>;
  helper?: string;
}

export function BrandBibleModal({
  project,
  onClose,
  startInDiscover = false,
}: {
  project: BrandProject;
  onClose: () => void;
  startInDiscover?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(
    startInDiscover ? 'discover' : 'overview'
  );
  const [discoverUrl, setDiscoverUrl] = useState(project.brandUrl ?? '');
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<RefineQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [bible, setBible] = useState<BrandBible | null>(project.brandContext);

  // Esc closes the modal — keeps the dialog dismissible without us trapping
  // focus, which would interfere with form fields inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const runDiscovery = async () => {
    if (!discoverUrl.trim()) {
      setDiscoverError('Please enter a URL');
      return;
    }
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const res = await fetch('/api/brand/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, url: discoverUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDiscoverError(data.error ?? 'Discovery failed');
        return;
      }
      setBible(data.bible);

      // Auto-load refine questions so the user flows straight from
      // discovery into filling in the gaps the AI couldn't infer.
      const refineRes = await fetch(
        `/api/brand/refine?projectId=${project.id}`
      );
      const refineData = await refineRes.json();
      setQuestions(refineData.questions ?? []);
      if ((refineData.questions ?? []).length > 0) {
        setMode('refine');
      } else {
        setMode('overview');
      }
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscovering(false);
    }
  };

  const loadRefineQuestions = async () => {
    setRefineError(null);
    try {
      const res = await fetch(`/api/brand/refine?projectId=${project.id}`);
      const data = await res.json();
      if (!res.ok) {
        setRefineError(data.error ?? 'Could not load questions');
        return;
      }
      setQuestions(data.questions ?? []);
      setAnswers({});
      setMode('refine');
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : String(e));
    }
  };

  const submitRefinement = async () => {
    setRefining(true);
    setRefineError(null);
    try {
      const res = await fetch('/api/brand/refine', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, answers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRefineError(data.error ?? 'Could not save');
        return;
      }
      setBible(data.bible);
      // Reload page so the marketing card picks up the fresh bible.
      window.location.reload();
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefining(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 overflow-auto backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Brand bible"
    >
      <GlassCard
        elevated
        className="max-w-3xl w-full p-6 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-6 gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
              Brand bible · {mode}
            </div>
            <h2 className="font-display text-2xl font-light">
              {mode === 'discover' && 'Discover your brand'}
              {mode === 'refine' && 'Refine your brand'}
              {mode === 'quotes' && 'Quote vault'}
              {mode === 'auto' && 'Auto-generate brand bible'}
              {mode === 'validate' && 'Validate visually'}
              {mode === 'overview' && (bible?.identity?.name || 'Brand bible')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-3 hover:text-text-1 text-xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {mode === 'overview' && (
          <OverviewMode
            bible={bible}
            onDiscover={() => setMode('discover')}
            onAuto={() => setMode('auto')}
            onValidate={() => setMode('validate')}
            onRefine={loadRefineQuestions}
            onQuotes={() => setMode('quotes')}
            onClose={onClose}
          />
        )}

        {mode === 'auto' && (
          <div>
            <button
              onClick={() => setMode('overview')}
              className="text-xs text-accent mb-4 hover:underline"
            >
              ← Back to overview
            </button>
            <AutoGenerateSection
              projectId={project.id}
              projectName={project.name}
              onApplied={() => {
                // Bible was just merged on the server — easiest to do a
                // hard reload so the marketing card + downstream readers
                // pick up the fresh brand_context jsonb.
                window.location.reload();
              }}
            />
          </div>
        )}

        {mode === 'validate' && (
          <div>
            <button
              onClick={() => setMode('overview')}
              className="text-xs text-accent mb-4 hover:underline"
            >
              ← Back to overview
            </button>
            <ImageValidationSection
              projectId={project.id}
              enabled={!!bible?.archetype?.primary}
            />
          </div>
        )}

        {mode === 'discover' && (
          <DiscoverMode
            url={discoverUrl}
            onUrlChange={setDiscoverUrl}
            discovering={discovering}
            error={discoverError}
            onCancel={() => setMode('overview')}
            onRun={runDiscovery}
          />
        )}

        {mode === 'refine' && (
          <RefineMode
            questions={questions}
            answers={answers}
            onAnswerChange={setAnswers}
            refining={refining}
            error={refineError}
            onSkip={() => setMode('overview')}
            onSubmit={submitRefinement}
          />
        )}

        {mode === 'quotes' && (
          <div>
            <button
              onClick={() => setMode('overview')}
              className="text-xs text-accent mb-4 hover:underline"
            >
              ← Back to overview
            </button>
            <QuoteVault projectId={project.id} />
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function OverviewMode({
  bible,
  onDiscover,
  onAuto,
  onValidate,
  onRefine,
  onQuotes,
  onClose,
}: {
  bible: BrandBible | null;
  onDiscover: () => void;
  onAuto: () => void;
  onValidate: () => void;
  onRefine: () => void;
  onQuotes: () => void;
  onClose: () => void;
}) {
  if (!bible || !bible.meta) {
    return (
      <div className="text-center py-8 space-y-4">
        <p className="text-text-2">
          No brand bible yet. Let&apos;s create one.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* PR #26: 'Auto-generate' is the new headline path — multi-
              source aware, builds toward the Helm v2.0 wedge. The
              single-URL Discover stays as a fast fallback. */}
          <Button onClick={onAuto}>✨ Auto-generate from website</Button>
          <Button variant="ghost" onClick={onDiscover}>
            Quick discovery (single URL)
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="space-y-3">
          <Section label="Identity">
            <p>{bible.identity?.tagline || '—'}</p>
            {bible.identity?.mission && (
              <p className="text-text-3 italic mt-1">
                &ldquo;{bible.identity.mission}&rdquo;
              </p>
            )}
          </Section>
          <Section label="Archetype">
            <p className="capitalize">{bible.archetype?.primary ?? '—'}</p>
            {bible.archetype?.rationale && (
              <p className="text-text-3 mt-1">{bible.archetype.rationale}</p>
            )}
          </Section>
          <Section label="Pillars">
            <div className="flex flex-wrap gap-1">
              {(bible.pillars ?? []).map((p, i) => (
                <span
                  key={i}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-accent-soft text-accent"
                  title={p.description}
                >
                  {p.name}
                </span>
              ))}
              {(bible.pillars ?? []).length === 0 && <span>—</span>}
            </div>
          </Section>
        </div>
        <div className="space-y-3">
          <Section label="Audience">
            <p>{bible.audience?.primary?.description ?? '—'}</p>
          </Section>
          <Section label="Top pain points">
            {(bible.audience?.primary?.painPoints ?? []).length === 0 ? (
              <p>—</p>
            ) : (
              <ul className="space-y-1">
                {bible.audience.primary.painPoints
                  .slice(0, 3)
                  .map((p, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-accent">•</span>
                      <span>{p.pain}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Section>
          <Section label="Never">
            {(bible.nonNegotiables ?? []).length === 0 ? (
              <p>—</p>
            ) : (
              <ul className="space-y-1">
                {bible.nonNegotiables.slice(0, 3).map((n, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-danger">×</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {/* PR #55 — Sprint 6.9: tooltips on every action button so a
          first-time founder can hover and learn what each does
          without having to click. `title` is the cheapest
          accessible affordance; matches the existing pattern on
          the pillar list at line 328. */}
      <div className="flex flex-wrap gap-2 pt-4 border-t border-border">
        <Button
          size="sm"
          onClick={onAuto}
          title="Regenerate the entire brand bible with AI from your existing URL + sources."
        >
          ✨ Auto-generate
        </Button>
        {/* PR #27 — only useful once an archetype is set, otherwise the
            POST endpoint refuses with 400. Hiding the button when the
            bible is sparse keeps the affordance honest. */}
        {bible?.archetype?.primary && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onValidate}
            title="Generate 12 images to check whether the visual direction matches your archetype."
          >
            🖼 Validate visually
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDiscover}
          title="Run a quick research pass on your URL to surface anything the bible is missing."
        >
          Quick discovery
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefine}
          title="Ask AI to fill in any sections of the brand bible that are still empty or thin."
        >
          Refine remaining gaps
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onQuotes}
          title="Manage the founder quotes that seed every generation and feed the voice fingerprint."
        >
          Quote vault →
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function DiscoverMode({
  url,
  onUrlChange,
  discovering,
  error,
  onCancel,
  onRun,
}: {
  url: string;
  onUrlChange: (s: string) => void;
  discovering: boolean;
  error: string | null;
  onCancel: () => void;
  onRun: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-2">
        Helm will analyze your URL across multiple pages (home, about, pricing,
        blog) and produce a complete brand bible. Takes 30-60 seconds.
      </p>

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
          Brand URL
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://your-product.com"
          className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          disabled={discovering}
        />
      </div>

      {error && <div className="text-sm text-danger">⚠ {error}</div>}

      {discovering && (
        <div className="py-4">
          <p className="text-sm text-text-2 mb-3 italic">
            Scraping pages, then analyzing with Claude Opus…
          </p>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={discovering}>
          Cancel
        </Button>
        <Button onClick={onRun} disabled={discovering || !url.trim()}>
          {discovering ? 'Discovering…' : 'Run discovery'}
        </Button>
      </div>
    </div>
  );
}

function RefineMode({
  questions,
  answers,
  onAnswerChange,
  refining,
  error,
  onSkip,
  onSubmit,
}: {
  questions: RefineQuestion[];
  answers: Record<string, unknown>;
  onAnswerChange: (a: Record<string, unknown>) => void;
  refining: boolean;
  error: string | null;
  onSkip: () => void;
  onSubmit: () => void;
}) {
  if (questions.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-text-2 mb-4">Your brand bible is complete!</p>
        <Button onClick={onSkip}>Done</Button>
      </div>
    );
  }

  const setAnswer = (id: string, value: unknown) => {
    onAnswerChange({ ...answers, [id]: value });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-2">
        Help us fill in what we couldn&apos;t infer from your URL.{' '}
        {questions.length} question{questions.length === 1 ? '' : 's'}.
      </p>

      {questions.map((q, i) => (
        <div key={q.id} className="border-b border-border pb-4 last:border-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
            Question {i + 1} of {questions.length}
          </div>
          <h4 className="font-medium mb-2 text-sm">{q.question}</h4>
          {q.helper && (
            <p className="text-xs text-text-3 mb-3">{q.helper}</p>
          )}

          {q.type === 'single_select' && q.options && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {q.options.map((opt) => {
                const selected = answers[q.id] === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAnswer(q.id, opt.value)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      selected
                        ? 'border-accent bg-accent-soft'
                        : 'border-border hover:border-text-3'
                    }`}
                  >
                    <div className="text-sm font-medium">{opt.label}</div>
                    {opt.description && (
                      <div className="text-[10px] text-text-3 mt-1">
                        {opt.description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {q.type === 'multi_select' && q.options && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {q.options.map((opt) => {
                const current = (answers[q.id] as string[] | undefined) ?? [];
                const selected = current.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      const next = selected
                        ? current.filter((v) => v !== opt.value)
                        : [...current, opt.value];
                      setAnswer(q.id, next);
                    }}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      selected
                        ? 'border-accent bg-accent-soft'
                        : 'border-border hover:border-text-3'
                    }`}
                  >
                    <div className="text-sm font-medium flex items-center gap-2">
                      <span>{selected ? '✓' : '○'}</span>
                      <span>{opt.label}</span>
                    </div>
                    {opt.description && (
                      <div className="text-[10px] text-text-3 mt-1">
                        {opt.description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {(q.type === 'text' || q.type === 'longtext') && (
            <textarea
              value={(answers[q.id] as string | undefined) ?? ''}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              rows={q.type === 'longtext' ? 4 : 2}
              className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder={q.helper}
            />
          )}
        </div>
      ))}

      {error && <div className="text-sm text-danger">⚠ {error}</div>}

      <div className="flex justify-between items-center pt-4 border-t border-border">
        <Button variant="ghost" size="sm" onClick={onSkip} disabled={refining}>
          Skip rest
        </Button>
        <Button
          onClick={onSubmit}
          disabled={refining || Object.keys(answers).length === 0}
        >
          {refining ? 'Synthesizing…' : 'Save & continue'}
        </Button>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
        {label}
      </div>
      <div className="text-text-1">{children}</div>
    </div>
  );
}
