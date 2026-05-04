'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';

export interface CompassFormData {
  // Validation
  userInterviewsConducted?: number;
  founderUsesProductDaily?: 'daily' | 'weekly' | 'rarely' | 'never';
  // Strategy
  whyNow?: string;
  unfairAdvantage?: string;
  nearTermRoadmap?: string;
  // Execution
  shippingFrequency?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'rarely';
  // Traction
  engagedFollowers?: number;
  payingUsers?: number;
  monthlyRevenueUsd?: number;
  investorInterest?: 'active' | 'soft' | 'none';
  // Market
  tamUsd?: number;
  innovationLevel?: 'category-creating' | 'novel-approach' | 'incremental';
  moat?: string;
  pathToScale?: string;
}

interface Props {
  previousFormData?: CompassFormData;
  onSubmit: (data: CompassFormData) => void;
  onClose: () => void;
  computing: boolean;
}

const STEPS = [
  { title: 'Validation', subtitle: 'How well do you know your users?' },
  { title: 'Strategy', subtitle: 'Why this, why now, why you?' },
  { title: 'Execution', subtitle: 'How fast do you ship?' },
  { title: 'Traction', subtitle: 'Who knows about your product?' },
  { title: 'Market', subtitle: 'How big could this become?' },
];

export function CompassFormModal({
  previousFormData = {},
  onSubmit,
  onClose,
  computing,
}: Props) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<CompassFormData>(previousFormData);

  // Esc closes the modal — keep dismissable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !computing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, computing]);

  const update = <K extends keyof CompassFormData>(
    key: K,
    value: CompassFormData[K]
  ) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const current = STEPS[step];

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 overflow-auto backdrop-blur-sm"
      onClick={() => !computing && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Compass reading form"
    >
      <GlassCard
        elevated
        className="max-w-2xl w-full p-6 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4 gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
              Compass · Step {step + 1} of {STEPS.length}
            </div>
            <h2 className="font-display text-2xl font-light">
              {current.title}
            </h2>
            <p className="text-sm text-text-2 mt-1">{current.subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-3 hover:text-text-1 text-xl leading-none px-1"
            aria-label="Close"
            disabled={computing}
          >
            ×
          </button>
        </div>

        <div className="h-1 bg-border rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <Field
              label="How many user interviews have you conducted?"
              hint="Conversations of 20+ minutes with potential users."
            >
              <input
                type="number"
                min="0"
                value={data.userInterviewsConducted ?? ''}
                onChange={(e) =>
                  update(
                    'userInterviewsConducted',
                    e.target.value === '' ? undefined : Number(e.target.value)
                  )
                }
                className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent w-32"
              />
            </Field>

            <Field label="Do you use your own product?">
              <RadioGroup
                value={data.founderUsesProductDaily}
                onChange={(v) =>
                  update(
                    'founderUsesProductDaily',
                    v as CompassFormData['founderUsesProductDaily']
                  )
                }
                options={[
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'rarely', label: 'Rarely' },
                  { value: 'never', label: 'Not yet' },
                ]}
              />
            </Field>

            <p className="text-xs text-text-3 italic">
              💡 Waitlist signups, pricing-test responses, and survey pain
              quotes are auto-pulled from your Helm data.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Field
              label="Why now? What's the catalyst?"
              hint="What macro shift makes this the right moment?"
            >
              <textarea
                value={data.whyNow ?? ''}
                onChange={(e) => update('whyNow', e.target.value)}
                rows={3}
                placeholder="AI maturity in design tools is accelerating, while solo founders still rely on…"
                className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Field>

            <Field
              label="What's your unfair advantage?"
              hint="What makes it hard for someone else to copy you?"
            >
              <textarea
                value={data.unfairAdvantage ?? ''}
                onChange={(e) => update('unfairAdvantage', e.target.value)}
                rows={3}
                placeholder="Years of context in indie hacker community + my own SaaS that uses it…"
                className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Field>

            <Field
              label="What's your 3-6 month roadmap?"
              hint="Specific milestones you're shipping toward."
            >
              <textarea
                value={data.nearTermRoadmap ?? ''}
                onChange={(e) => update('nearTermRoadmap', e.target.value)}
                rows={3}
                placeholder="Q1: launch to 50 indie hackers. Q2: GitHub OAuth deep integrations…"
                className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Field>

            <p className="text-xs text-text-3 italic">
              💡 Tagline, archetype, pillars, and competitor list are
              auto-pulled.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Field label="How often do you ship features?">
              <RadioGroup
                value={data.shippingFrequency}
                onChange={(v) =>
                  update(
                    'shippingFrequency',
                    v as CompassFormData['shippingFrequency']
                  )
                }
                options={[
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'biweekly', label: 'Every 2 weeks' },
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'quarterly', label: 'Quarterly' },
                  { value: 'rarely', label: 'Rarely' },
                ]}
              />
            </Field>

            <p className="text-xs text-text-3 italic">
              💡 Public posting cadence and feedback iteration are auto-pulled
              from your Marketing scheduled and rated posts.
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Field
              label="Engaged followers / subscribers"
              hint="Twitter, newsletter, Discord — anyone who actually reads your stuff."
            >
              <input
                type="number"
                min="0"
                value={data.engagedFollowers ?? ''}
                onChange={(e) =>
                  update(
                    'engagedFollowers',
                    e.target.value === '' ? undefined : Number(e.target.value)
                  )
                }
                className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent w-32"
              />
            </Field>

            <Field label="Paying users (if any)">
              <input
                type="number"
                min="0"
                value={data.payingUsers ?? ''}
                onChange={(e) =>
                  update(
                    'payingUsers',
                    e.target.value === '' ? undefined : Number(e.target.value)
                  )
                }
                className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent w-32"
              />
            </Field>

            <Field label="Monthly revenue in USD (MRR)">
              <input
                type="number"
                min="0"
                value={data.monthlyRevenueUsd ?? ''}
                onChange={(e) =>
                  update(
                    'monthlyRevenueUsd',
                    e.target.value === '' ? undefined : Number(e.target.value)
                  )
                }
                className="bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent w-40"
              />
            </Field>

            <Field label="Investor interest">
              <RadioGroup
                value={data.investorInterest}
                onChange={(v) =>
                  update(
                    'investorInterest',
                    v as CompassFormData['investorInterest']
                  )
                }
                options={[
                  { value: 'active', label: 'Active conversations' },
                  { value: 'soft', label: 'Soft inbound' },
                  { value: 'none', label: 'None yet (or not raising)' },
                ]}
              />
            </Field>

            <p className="text-xs text-text-3 italic">
              💡 Waitlist growth and competitor mentions are auto-pulled.
            </p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <Field
              label="TAM (Total Addressable Market) in USD"
              hint="Order of magnitude. $10B+ for venture-scale."
            >
              <input
                type="number"
                min="0"
                value={data.tamUsd ?? ''}
                onChange={(e) =>
                  update(
                    'tamUsd',
                    e.target.value === '' ? undefined : Number(e.target.value)
                  )
                }
                placeholder="e.g. 10000000000 for $10B"
                className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Field>

            <Field label="Innovation level">
              <RadioGroup
                value={data.innovationLevel}
                onChange={(v) =>
                  update(
                    'innovationLevel',
                    v as CompassFormData['innovationLevel']
                  )
                }
                options={[
                  { value: 'category-creating', label: 'Creating a new category' },
                  { value: 'novel-approach', label: 'Novel approach to known problem' },
                  { value: 'incremental', label: 'Incremental improvement' },
                ]}
              />
            </Field>

            <Field
              label="Defensibility / moat"
              hint="What makes it hard to copy after you've validated demand?"
            >
              <textarea
                value={data.moat ?? ''}
                onChange={(e) => update('moat', e.target.value)}
                rows={3}
                className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Field>

            <Field
              label="Path to $10M ARR"
              hint="Concrete steps. Distribution channels, pricing tiers, expansion markets."
            >
              <textarea
                value={data.pathToScale ?? ''}
                onChange={(e) => update('pathToScale', e.target.value)}
                rows={3}
                className="w-full bg-bg-elev border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Field>
          </div>
        )}

        <div className="flex justify-between mt-6 pt-4 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
            disabled={computing}
          >
            {step > 0 ? '← Back' : 'Cancel'}
          </Button>

          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={computing}>
              Next →
            </Button>
          ) : (
            <Button onClick={() => onSubmit(data)} disabled={computing}>
              {computing ? 'Computing…' : 'Compute reading'}
            </Button>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-text-3 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

interface RadioOption {
  value: string;
  label: string;
}

interface RadioGroupProps {
  value: string | undefined;
  onChange: (v: string) => void;
  options: RadioOption[];
}

function RadioGroup({ value, onChange, options }: RadioGroupProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`text-left p-3 rounded-lg border transition-colors ${
            value === opt.value
              ? 'border-accent bg-accent/10'
              : 'border-border hover:border-text-3'
          }`}
        >
          <div className="text-sm font-medium">{opt.label}</div>
        </button>
      ))}
    </div>
  );
}
