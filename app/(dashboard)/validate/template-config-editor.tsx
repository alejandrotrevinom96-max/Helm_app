'use client';

import type { TemplateConfig } from '@/lib/validate/defaults';
import type { ValidateTemplateId } from '@/lib/validate/templates';

// Per-template inline editor. Renders a minimal form for the fields each
// template actually uses. Stays in the parent's React state — caller flushes
// to the server when it submits the create-page action.
export function TemplateConfigEditor({
  templateId,
  config,
  onChange,
}: {
  templateId: ValidateTemplateId | string;
  config: TemplateConfig;
  onChange: (next: TemplateConfig) => void;
}) {
  const set = <K extends keyof TemplateConfig>(key: K, value: TemplateConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="space-y-4">
      <FieldRow label="Subtitle">
        <input
          value={config.subtitle ?? ''}
          onChange={(e) => set('subtitle', e.target.value)}
          placeholder="One-line value prop"
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </FieldRow>
      <FieldRow label="CTA text">
        <input
          value={config.ctaText ?? ''}
          onChange={(e) => set('ctaText', e.target.value)}
          placeholder="Join waitlist"
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </FieldRow>

      {templateId === 'beta-tester' && (
        <BetaTesterFields config={config} onChange={onChange} />
      )}
      {templateId === 'feature-vote' && (
        <FeatureVoteFields config={config} onChange={onChange} />
      )}
      {templateId === 'pricing-test' && (
        <PricingTestFields config={config} onChange={onChange} />
      )}
      {templateId === 'survey-5q' && (
        <SurveyFields config={config} onChange={onChange} />
      )}
    </div>
  );
}

function BetaTesterFields({
  config,
  onChange,
}: {
  config: TemplateConfig;
  onChange: (next: TemplateConfig) => void;
}) {
  const questions = config.qualifyingQuestions ?? [];
  const update = (i: number, patch: Partial<(typeof questions)[number]>) => {
    const next = questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q));
    onChange({ ...config, qualifyingQuestions: next });
  };
  const remove = (i: number) => {
    onChange({
      ...config,
      qualifyingQuestions: questions.filter((_, idx) => idx !== i),
    });
  };
  const add = () => {
    onChange({
      ...config,
      qualifyingQuestions: [
        ...questions,
        { question: 'New question', type: 'text' },
      ],
    });
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
        Qualifying questions
      </div>
      {questions.map((q, i) => (
        <div key={i} className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input
              value={q.question}
              onChange={(e) => update(i, { question: e.target.value })}
              className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <select
              value={q.type}
              onChange={(e) => update(i, { type: e.target.value as 'text' | 'select' })}
              className="bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="text">Text</option>
              <option value="select">Select</option>
            </select>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-text-3 hover:text-danger px-2"
              aria-label="Remove question"
            >
              ×
            </button>
          </div>
          {q.type === 'select' && (
            <input
              value={(q.options ?? []).join(', ')}
              onChange={(e) =>
                update(i, {
                  options: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Comma-separated options"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs outline-none focus:border-accent"
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-xs text-accent hover:underline"
      >
        + Add question
      </button>
    </div>
  );
}

function FeatureVoteFields({
  config,
  onChange,
}: {
  config: TemplateConfig;
  onChange: (next: TemplateConfig) => void;
}) {
  const features = config.features ?? [];
  const update = (i: number, patch: Partial<(typeof features)[number]>) => {
    const next = features.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange({ ...config, features: next });
  };
  const remove = (i: number) => {
    onChange({ ...config, features: features.filter((_, idx) => idx !== i) });
  };
  const add = () => {
    const id = `feat-${features.length + 1}`;
    onChange({
      ...config,
      features: [...features, { id, title: `Feature ${features.length + 1}`, description: '' }],
    });
  };

  return (
    <div className="space-y-3">
      <FieldRow label="Max votes per visitor">
        <input
          type="number"
          min={1}
          max={10}
          value={config.maxVotesPerUser ?? 3}
          onChange={(e) =>
            onChange({ ...config, maxVotesPerUser: Math.max(1, Number(e.target.value) || 1) })
          }
          className="w-24 bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </FieldRow>

      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
        Features
      </div>
      {features.map((f, i) => (
        <div key={i} className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input
              value={f.title}
              onChange={(e) => update(i, { title: e.target.value })}
              placeholder="Feature title"
              className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-text-3 hover:text-danger px-2"
              aria-label="Remove feature"
            >
              ×
            </button>
          </div>
          <input
            value={f.description}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder="One-line description"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-xs outline-none focus:border-accent"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-xs text-accent hover:underline"
      >
        + Add feature
      </button>
    </div>
  );
}

function PricingTestFields({
  config,
  onChange,
}: {
  config: TemplateConfig;
  onChange: (next: TemplateConfig) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldRow label="Price / month (USD)">
        <input
          type="number"
          min={1}
          value={config.pricePerMonth ?? 19}
          onChange={(e) =>
            onChange({
              ...config,
              pricePerMonth: Math.max(1, Number(e.target.value) || 1),
            })
          }
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </FieldRow>
      <FieldRow label="Founding member discount %">
        <input
          type="number"
          min={0}
          max={90}
          value={config.discountPct ?? 50}
          onChange={(e) =>
            onChange({
              ...config,
              discountPct: Math.min(90, Math.max(0, Number(e.target.value) || 0)),
            })
          }
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </FieldRow>
    </div>
  );
}

function SurveyFields({
  config,
  onChange,
}: {
  config: TemplateConfig;
  onChange: (next: TemplateConfig) => void;
}) {
  const questions = config.questions ?? [];
  const update = (i: number, value: string) => {
    const next = questions.map((q, idx) => (idx === i ? value : q));
    onChange({ ...config, questions: next });
  };
  const remove = (i: number) => {
    onChange({ ...config, questions: questions.filter((_, idx) => idx !== i) });
  };
  const add = () => {
    onChange({ ...config, questions: [...questions, 'New question'] });
  };

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
        Survey questions ({questions.length})
      </div>
      {questions.map((q, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-text-3 font-mono text-xs pt-2 w-6">{i + 1}.</span>
          <input
            value={q}
            onChange={(e) => update(i, e.target.value)}
            className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-text-3 hover:text-danger px-2"
            aria-label="Remove question"
          >
            ×
          </button>
        </div>
      ))}
      {questions.length < 10 && (
        <button
          type="button"
          onClick={add}
          className="text-xs text-accent hover:underline"
        >
          + Add question
        </button>
      )}
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
