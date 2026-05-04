'use client';

import { useEffect } from 'react';
import { MinimalTemplate } from '@/app/w/[slug]/templates/minimal';
import { BetaTesterTemplate } from '@/app/w/[slug]/templates/beta-tester';
import { FeatureVoteTemplate } from '@/app/w/[slug]/templates/feature-vote';
import { PricingTestTemplate } from '@/app/w/[slug]/templates/pricing-test';
import { Survey5QTemplate } from '@/app/w/[slug]/templates/survey-5q';
import type { PublicPageData } from '@/app/w/[slug]/templates/_shared';
import type { TemplateConfig } from '@/lib/validate/defaults';

const TEMPLATES = {
  minimal: MinimalTemplate,
  'beta-tester': BetaTesterTemplate,
  'feature-vote': FeatureVoteTemplate,
  'pricing-test': PricingTestTemplate,
  'survey-5q': Survey5QTemplate,
} as const;

export function PreviewModal({
  open,
  onClose,
  template,
  title,
  templateConfig,
}: {
  open: boolean;
  onClose: () => void;
  template: string;
  title: string;
  templateConfig: TemplateConfig;
}) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const TemplateComponent =
    TEMPLATES[template as keyof typeof TEMPLATES] ?? MinimalTemplate;

  // Mimic the shape /w/[slug]/page.tsx assembles for the templates.
  // ctaText falls back through the same chain the public page uses.
  const fakePage: PublicPageData = {
    id: 'preview',
    slug: '__preview__',
    title: title || 'Untitled',
    subtitle: templateConfig.subtitle ?? null,
    ctaText: templateConfig.ctaText ?? null,
    template,
    templateConfig,
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Template preview"
    >
      <div
        className="max-w-2xl w-full my-auto bg-bg rounded-xl border border-border-bright overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-5 py-3 bg-bg/80 backdrop-blur-glass border-b border-border flex justify-between items-center">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
            Preview · not saved yet
          </div>
          <button
            onClick={onClose}
            className="text-text-3 hover:text-text-1 text-xl leading-none px-1"
            aria-label="Close preview"
          >
            ×
          </button>
        </div>

        {/* pointer-events-none disables form submits / button clicks so the
            preview can't accidentally POST to /api/w/__preview__/respond.
            Inputs still render with their visual state. */}
        <div className="pointer-events-none select-none">
          <TemplateComponent slug="__preview__" page={fakePage} />
        </div>
      </div>
    </div>
  );
}
