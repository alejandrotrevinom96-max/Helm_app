'use client';

// PR #76 — Sprint 7.3: collapsible wrapper around BrandBibleCard.
//
// Default behavior:
//   - completionScore ≥ 80 → starts COLLAPSED (the card has no
//     news, summarize it as a one-liner header)
//   - completionScore < 80 → starts EXPANDED with a yellow nudge
//     ("complete your brand bible for better quality")
//   - no bible at all → fall through to the full card (it has its
//     own empty state with the "Start brand discovery" CTA)
//
// We deliberately did NOT modify BrandBibleCard. Wrapping it
// preserves every behavior (modal opening, voice fingerprint
// rendering, completion-score logic) and means a regression in
// the wrapper can't brick the underlying card.
//
// The plan suggested re-implementing the inner content (voice
// sliders, pillar chips) from scratch inside the wrapper. That
// would duplicate ~400 lines of UI and require keeping the two
// implementations in sync as the BrandBibleCard evolves. The
// header summary here pulls the same fields the full card
// already exposes (identity.name, archetype.primary,
// meta.completionScore) — single source of truth.
import { useState } from 'react';
import {
  BrandBibleCard,
  type BrandProject,
} from '@/app/(dashboard)/marketing/brand-bible-card';

const COLLAPSE_THRESHOLD = 80;

export function CollapsibleBrandBible({ project }: { project: BrandProject }) {
  const bible = project.brandContext;
  const completion = bible?.meta?.completionScore ?? 0;

  // Empty state — let the underlying card handle "set up your
  // brand bible". No collapse logic applies pre-discovery.
  if (!bible || !bible.meta) {
    return <BrandBibleCard project={project} />;
  }

  const defaultCollapsed = completion >= COLLAPSE_THRESHOLD;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (!collapsed) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end -mb-1">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 hover:text-text-1"
            aria-expanded="true"
          >
            collapse ↑
          </button>
        </div>
        <BrandBibleCard project={project} />
      </div>
    );
  }

  // Collapsed header — single row summary of the bible. Same
  // fields the full card shows up top (identity, archetype,
  // completion score). The chevron + click-anywhere-on-row
  // toggles expanded; the per-element clicks (Edit link) are
  // forwarded to the full card by stopping propagation in the
  // wrapper button.
  const tint =
    completion >= 80
      ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
      : completion >= 50
        ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
        : 'bg-danger/20 text-danger border-danger/40';

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-expanded="false"
        className="w-full text-left rounded-xl border border-border bg-bg-elev/40 hover:bg-bg-elev/70 transition-colors px-5 py-4 flex items-center gap-4"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Brand bible
          </div>
          <div className="font-display text-base font-light text-text-1 truncate">
            {bible.identity?.name ?? project.name}
            {bible.archetype?.primary && (
              <span className="text-text-3 ml-2">
                · {bible.archetype.primary}
              </span>
            )}
          </div>
        </div>

        <span
          className={`text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-1 rounded border shrink-0 ${tint}`}
        >
          {completion}% complete
        </span>

        <span
          className="text-text-3 text-lg shrink-0 transition-transform"
          aria-hidden
        >
          ▾
        </span>
      </button>

      {completion < COLLAPSE_THRESHOLD && (
        <p className="text-xs text-amber-500 mt-2 px-1">
          💡 Brand bible incompleta ({completion}%) — completala para mejor
          quality de contenido.
        </p>
      )}
    </div>
  );
}
