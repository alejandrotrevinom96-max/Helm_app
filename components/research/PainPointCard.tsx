'use client';

// PR #57 — Sprint 7.0.1: single pain-point chip in the /research grid.
// PR Sprint D-8 — "Send to:" routing. Each pain point can flow into
// either Photo Studio or UGC Studio with the pain-point id pre-
// loaded as a URL param. The studios fetch the full pain-point
// context server-side via /api/research/pain-points/[id] so the
// agent's first message can quote the real audience pain.
//
// Backward compat: pain points generated before D-8 don't have an
// id field. For those we fall back to the legacy "?prompt=…" flow
// (the prompt seed is composed inline from theme + angle + quote
// just like before).
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';

export interface PainPoint {
  // PR Sprint D-8 — stable UUID. Optional for backward compat with
  // any older pain points that haven't been backfilled yet.
  id?: string;
  theme: string;
  frequency: number;
  sampleQuote: string;
  platform: string;
  isOnDomain?: boolean;
  actionableAngle: string;
}

interface Props {
  painPoint: PainPoint;
  projectId: string;
}

export function PainPointCard({ painPoint, projectId }: Props) {
  const { id, theme, frequency, sampleQuote, platform, actionableAngle } =
    painPoint;

  // Pre-fill prompt for the legacy fallback. Keep it short — the
  // composer already pulls full brand context, this is just a seed.
  // Only used when the pain point predates the D-8 id backfill.
  const promptText = [
    `Address this audience pain: "${theme}".`,
    actionableAngle,
    `Real quote from community: "${sampleQuote}"`,
  ]
    .filter(Boolean)
    .join(' ');

  // PR Sprint D-8 — prefer painPointId routing when available, fall
  // back to the legacy prompt seed when the row predates the
  // backfill. The studios know to read either param.
  const photoStudioHref = id
    ? `/marketing/photo-studio?projectId=${encodeURIComponent(projectId)}&painPointId=${encodeURIComponent(id)}`
    : `/marketing/photo-studio?projectId=${encodeURIComponent(projectId)}&prompt=${encodeURIComponent(promptText)}`;

  const ugcStudioHref = id
    ? `/marketing/ugc-studio?projectId=${encodeURIComponent(projectId)}&painPointId=${encodeURIComponent(id)}`
    : `/marketing/ugc-studio?projectId=${encodeURIComponent(projectId)}&prompt=${encodeURIComponent(promptText)}`;

  return (
    <GlassCard className="p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="font-display text-base font-light">{theme}</h3>
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 shrink-0">
          mentioned {frequency}×
        </span>
      </div>

      <blockquote className="italic text-sm text-text-2 mb-3 border-l-2 border-accent/40 pl-3">
        &ldquo;{sampleQuote}&rdquo;
        <cite className="block text-[11px] font-mono text-text-3 not-italic mt-1">
          — from {platform}
        </cite>
      </blockquote>

      {actionableAngle && (
        <p className="text-text-3 text-xs mb-3 italic">
          💡 {actionableAngle}
        </p>
      )}

      {/* PR Sprint D-8 — "Send to:" two-target router. Replaces
          the single "Generate post →" link. The founder picks the
          medium upfront (photo vs UGC video) — the chosen studio
          loads the pain point context and starts the chat from
          there. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-3 shrink-0">
          Send to:
        </span>
        <Link
          href={photoStudioHref}
          className="text-xs font-mono px-2.5 py-1 rounded-md border border-border text-text-1 hover:bg-bg-elev hover:border-border-bright transition-colors"
        >
          🖼️ Photo Studio
        </Link>
        <Link
          href={ugcStudioHref}
          className="text-xs font-mono px-2.5 py-1 rounded-md border border-border text-text-1 hover:bg-bg-elev hover:border-border-bright transition-colors"
        >
          🎬 UGC Studio
        </Link>
      </div>
    </GlassCard>
  );
}
