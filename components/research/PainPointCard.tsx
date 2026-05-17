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
  // PR Sprint D-finish — projectId removed from props. The studios
  // resolve the active project server-side; the URL never needed
  // it. Kept the prop name out of the type so existing callers
  // that still pass it just have an ignored prop (TS treats it as
  // unknown extra). If the caller is strict-typed we'll see it at
  // build time — only one caller today (research/client.tsx) so
  // low blast radius.
}

export function PainPointCard({ painPoint }: Props) {
  const { id, theme, frequency, sampleQuote, platform, actionableAngle } =
    painPoint;

  // PR Sprint D-finish — painPointId is the canonical contract.
  //
  // Previously the card carried both ?projectId= and a ?prompt=
  // fallback (used when the pain point predated the id backfill).
  // The studios resolve the active project from the user session
  // server-side, so projectId in URL was dead-code; and the legacy
  // ?prompt= path bypassed the agent's pain-point-aware first
  // message (Case B in conceptBuilder.ts) — defeating the whole
  // reason the Studios know how to greet with the real quote +
  // 3 angle suggestions.
  //
  // Backward compat: rows without an id (only possible if the
  // admin backfill never ran on a given deploy) get a disabled
  // chip set instead of broken links. The PainPoint type still
  // has id optional for that exact case.
  const photoStudioHref = id
    ? `/marketing/photo-studio?painPointId=${encodeURIComponent(id)}`
    : null;
  const ugcStudioHref = id
    ? `/marketing/ugc-studio?painPointId=${encodeURIComponent(id)}`
    : null;

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
          there.
          PR Sprint D-finish — chips render disabled if the pain
          point lacks an id (admin backfill hasn't run on this
          deploy). Clicking would 404 on the lookup, so we'd
          rather show "Backfill pending" than a broken link. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-text-3 shrink-0">
          Send to:
        </span>
        {photoStudioHref ? (
          <Link
            href={photoStudioHref}
            className="text-xs font-mono px-2.5 py-1 rounded-md border border-border text-text-1 hover:bg-bg-elev hover:border-border-bright transition-colors"
          >
            🖼️ Photo Studio
          </Link>
        ) : (
          <span
            className="text-xs font-mono px-2.5 py-1 rounded-md border border-border text-text-3 opacity-50"
            title="Pain point predates the id backfill — run /api/admin/backfill-pain-point-ids"
          >
            🖼️ Photo Studio
          </span>
        )}
        {ugcStudioHref ? (
          <Link
            href={ugcStudioHref}
            className="text-xs font-mono px-2.5 py-1 rounded-md border border-border text-text-1 hover:bg-bg-elev hover:border-border-bright transition-colors"
          >
            🎬 UGC Studio
          </Link>
        ) : (
          <span
            className="text-xs font-mono px-2.5 py-1 rounded-md border border-border text-text-3 opacity-50"
            title="Pain point predates the id backfill — run /api/admin/backfill-pain-point-ids"
          >
            🎬 UGC Studio
          </span>
        )}
      </div>
    </GlassCard>
  );
}
