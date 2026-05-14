'use client';

// PR #70 — Sprint 7.1C: Blind Spots client.
//
// Layout: top summary chips (detected count by severity), then
// 6 framework cards in priority order (detected critical first,
// down to not-detected last). Each card exposes:
//   - title + severity badge + confidence
//   - description ("what's happening")
//   - evidence (concrete citations from the brand inputs)
//   - recommendation + suggested actions
//   - status pills: acknowledge / dismiss / resolve / reopen
//   - inline notes textarea (debounced save on blur)
//
// "Run scan" / "Re-scan" sits in the header — the first scan
// blocks (Opus call, ~30s), so we show a loading state with a
// patience message rather than spinning silently.
//
// Re-scan is destructive (server DELETEs prior rows + inserts
// fresh batch). userStatus + userNotes do not carry over — we
// explain that in the confirm dialog.
import { useState } from 'react';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { Button } from '@/components/ui/button';
import { CompassSubNav } from '@/components/compass/sub-nav';

interface BlindSpot {
  id: string;
  framework: string;
  detected: boolean;
  severity: string | null;
  confidenceScore: number | null;
  title: string;
  description: string;
  evidence: string[];
  recommendation: string | null;
  suggestedActions: string[];
  userStatus: string;
  userNotes: string | null;
  createdAt: string | null;
  expiresAt: string | null;
}

interface Props {
  project: { id: string; name: string };
  hasBrandAnalysis: boolean;
  hasBenchmark: boolean;
  initialBlindSpots: BlindSpot[];
}

const FRAMEWORK_LABEL: Record<string, string> = {
  credibility_gap: 'Credibility Gap',
  pricing_psychology: 'Pricing Psychology',
  icp_drift: 'ICP Drift',
  content_product_mismatch: 'Content ↔ Product Mismatch',
  platform_scatter: 'Platform Scatter',
  social_proof_vacuum: 'Social Proof Vacuum',
};

const FRAMEWORK_BLURB: Record<string, string> = {
  credibility_gap:
    'You say one thing about your brand — does the content actually prove it?',
  pricing_psychology:
    'Does the leap from free attention to paid offer feel motivated, or arbitrary?',
  icp_drift:
    'Are you posting for the audience you set out to serve, or one that quietly replaced them?',
  content_product_mismatch:
    'Is what you post aligned with what you actually sell?',
  platform_scatter:
    'Thin presence across many platforms, or focused presence on the right one?',
  social_proof_vacuum:
    'Whose voice fills your content — yours, or your customers’?',
};

const FRAMEWORK_ORDER = [
  'credibility_gap',
  'pricing_psychology',
  'icp_drift',
  'content_product_mismatch',
  'platform_scatter',
  'social_proof_vacuum',
];

const SEVERITY_TINT: Record<string, string> = {
  critical: 'bg-danger/20 text-danger border-danger/40',
  high: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  low: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
};

const STATUS_TINT: Record<string, string> = {
  open: 'bg-bg-elev text-text-2 border-border',
  acknowledged: 'bg-accent/15 text-accent border-accent/30',
  dismissed: 'bg-text-3/15 text-text-3 border-text-3/30',
  resolved: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
};

const STATUS_LABEL: Record<string, string> = {
  open: 'OPEN',
  acknowledged: 'ACKNOWLEDGED',
  dismissed: 'DISMISSED',
  resolved: 'RESOLVED',
};

function rankSpot(spot: BlindSpot): number {
  if (!spot.detected) return 0;
  const sevRank =
    spot.severity === 'critical'
      ? 4
      : spot.severity === 'high'
        ? 3
        : spot.severity === 'medium'
          ? 2
          : spot.severity === 'low'
            ? 1
            : 0;
  return sevRank * 100 + (spot.confidenceScore ?? 0);
}

export function BlindSpotsClient({
  project,
  hasBrandAnalysis,
  hasBenchmark,
  initialBlindSpots,
}: Props) {
  const [spots, setSpots] = useState<BlindSpot[]>(initialBlindSpots);
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error' | 'info';
    msg: string;
  } | null>(null);

  const hasScan = spots.length > 0;
  const lastScannedAt = hasScan
    ? spots
        .map((s) => s.createdAt)
        .filter((d): d is string => typeof d === 'string')
        .sort()
        .pop() ?? null
    : null;
  const expiresAt = hasScan
    ? spots
        .map((s) => s.expiresAt)
        .filter((d): d is string => typeof d === 'string')
        .sort()[0] ?? null
    : null;

  const summary = {
    total: spots.length,
    detected: spots.filter((s) => s.detected).length,
    critical: spots.filter((s) => s.detected && s.severity === 'critical')
      .length,
    high: spots.filter((s) => s.detected && s.severity === 'high').length,
    medium: spots.filter((s) => s.detected && s.severity === 'medium').length,
    low: spots.filter((s) => s.detected && s.severity === 'low').length,
    open: spots.filter((s) => s.detected && s.userStatus === 'open').length,
  };

  // Merge by framework key so each card always renders even if a
  // framework somehow didn't come back (defensive — the API
  // validates all 6, but UI shouldn't disappear if a row is
  // missing).
  const byFramework = new Map(spots.map((s) => [s.framework, s]));
  const ordered = FRAMEWORK_ORDER.map((fw) => byFramework.get(fw)).filter(
    (s): s is BlindSpot => Boolean(s),
  );
  ordered.sort((a, b) => rankSpot(b) - rankSpot(a));

  const runScan = async (force = false) => {
    if (scanning) return;
    if (force) {
      const ok = window.confirm(
        'Re-scan deletes the current scan and replaces it with a fresh one. Your acknowledgements, dismissals, and notes will be cleared. Continue?',
      );
      if (!ok) return;
    }
    setScanning(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/compass/blind-spots/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, force }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        cached?: boolean;
        blindSpots?: BlindSpot[];
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.success) {
        setFeedback({
          kind: 'error',
          msg: data.error ?? data.hint ?? 'Scan failed',
        });
        return;
      }
      if (data.blindSpots) {
        // Server returns minimal row shape; normalize fields that
        // can come back as DB strings (createdAt) or null.
        type ServerSpot = {
          id: string;
          framework: string;
          detected: boolean;
          severity: string | null;
          confidenceScore: number | null;
          title: string;
          description: string;
          evidence?: unknown;
          recommendation: string | null;
          suggestedActions?: unknown;
          userStatus: string;
          userNotes: string | null;
          createdAt?: string | Date | null;
          expiresAt?: string | Date | null;
        };
        const normalized: BlindSpot[] = (data.blindSpots as ServerSpot[]).map(
          (s) => ({
            id: s.id,
            framework: s.framework,
            detected: s.detected,
            severity: s.severity,
            confidenceScore: s.confidenceScore,
            title: s.title,
            description: s.description,
            evidence: Array.isArray(s.evidence) ? (s.evidence as string[]) : [],
            recommendation: s.recommendation,
            suggestedActions: Array.isArray(s.suggestedActions)
              ? (s.suggestedActions as string[])
              : [],
            userStatus: s.userStatus,
            userNotes: s.userNotes,
            createdAt:
              typeof s.createdAt === 'string'
                ? s.createdAt
                : s.createdAt instanceof Date
                  ? s.createdAt.toISOString()
                  : null,
            expiresAt:
              typeof s.expiresAt === 'string'
                ? s.expiresAt
                : s.expiresAt instanceof Date
                  ? s.expiresAt.toISOString()
                  : null,
          }),
        );
        setSpots(normalized);
      }
      setFeedback({
        kind: 'success',
        msg: data.cached
          ? 'Loaded cached scan (still fresh).'
          : 'Scan complete.',
      });
    } catch (e) {
      setFeedback({
        kind: 'error',
        msg: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setScanning(false);
    }
  };

  const updateSpot = async (
    id: string,
    patch: { userStatus?: string; userNotes?: string },
  ) => {
    setSpots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    );
    try {
      await fetch(`/api/compass/blind-spots/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch {
      // Soft fail — UI already updated optimistically. A reload
      // will resync; we don't roll back on transient network.
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <header className="space-y-2">
        <CompassSubNav active="blind-spots" />
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-display-md font-light tracking-tight">
              Blind Spots
            </h1>
            <p className="text-text-2 text-sm max-w-2xl">
              Six strategic frameworks scanning for drift patterns you might
              not see until they become a crisis — credibility, pricing,
              audience, content/product fit, platform spread, and social
              proof.
            </p>
          </div>
          {hasScan && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => runScan(true)}
              disabled={scanning}
            >
              {scanning ? 'Scanning…' : 'Re-scan'}
            </Button>
          )}
        </div>
      </header>

      {!hasBrandAnalysis && (
        <GlassCard className="p-5 border border-amber-500/30 bg-amber-500/5">
          <h3 className="font-display text-lg font-light mb-1">
            Brand analysis required
          </h3>
          <p className="text-sm text-text-3 mb-3">
            The scanner reads your brand pillars, audience layers, and recent
            content to detect drift. Run Smart Auto-configure first.
          </p>
          <Link href="/research">
            <Button size="sm">Open Research →</Button>
          </Link>
        </GlassCard>
      )}

      {hasBrandAnalysis && !hasBenchmark && (
        <GlassCard className="p-4 border border-border bg-bg-elev/40 text-sm text-text-3">
          Tip: generate a Positioning Benchmark first for a richer scan — it
          gives the model real competitor context. Without it, scans skip
          competitor-related cues.
          <Link
            href="/compass/competitors"
            className="text-accent ml-2 font-mono text-xs hover:opacity-80"
          >
            open →
          </Link>
        </GlassCard>
      )}

      {!hasScan && hasBrandAnalysis && (
        <GlassCard className="p-6 text-center space-y-4">
          <div>
            <h3 className="font-display text-xl font-light mb-1">
              Run your first scan
            </h3>
            <p className="text-sm text-text-3 max-w-xl mx-auto">
              Helm will analyze your brand + recent content across all 6
              frameworks and return concrete, evidence-backed findings. Takes
              about 30 seconds.
            </p>
          </div>
          <Button onClick={() => runScan(false)} disabled={scanning}>
            {scanning ? 'Scanning… (this can take ~30s)' : 'Scan blind spots'}
          </Button>
        </GlassCard>
      )}

      {hasScan && (
        <>
          <section className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <SummaryChip
              label="DETECTED"
              value={`${summary.detected}/${summary.total}`}
              tone="neutral"
            />
            {summary.critical > 0 && (
              <SummaryChip
                label="CRITICAL"
                value={summary.critical}
                tone="critical"
              />
            )}
            {summary.high > 0 && (
              <SummaryChip label="HIGH" value={summary.high} tone="high" />
            )}
            {summary.medium > 0 && (
              <SummaryChip
                label="MEDIUM"
                value={summary.medium}
                tone="medium"
              />
            )}
            {summary.low > 0 && (
              <SummaryChip label="LOW" value={summary.low} tone="low" />
            )}
            {summary.open > 0 && (
              <SummaryChip
                label="OPEN"
                value={summary.open}
                tone="neutral"
              />
            )}
            <div className="ml-auto text-text-3 text-[10px]">
              {lastScannedAt && (
                <>scanned {new Date(lastScannedAt).toLocaleDateString()}</>
              )}
              {expiresAt && (
                <span className="ml-2">
                  · expires {new Date(expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </section>

          <div className="space-y-3">
            {ordered.map((spot) => (
              <SpotCard
                key={spot.id}
                spot={spot}
                onUpdate={(patch) => updateSpot(spot.id, patch)}
              />
            ))}
          </div>
        </>
      )}

      {feedback && (
        <div
          className={`text-xs ${
            feedback.kind === 'error'
              ? 'text-danger'
              : feedback.kind === 'success'
                ? 'text-emerald-500'
                : 'text-text-2'
          }`}
        >
          {feedback.msg}
        </div>
      )}
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: 'neutral' | 'critical' | 'high' | 'medium' | 'low';
}) {
  const toneClass =
    tone === 'critical'
      ? 'border-danger/40 text-danger bg-danger/10'
      : tone === 'high'
        ? 'border-orange-500/40 text-orange-500 bg-orange-500/10'
        : tone === 'medium'
          ? 'border-amber-500/40 text-amber-500 bg-amber-500/10'
          : tone === 'low'
            ? 'border-blue-500/40 text-blue-500 bg-blue-500/10'
            : 'border-border text-text-2 bg-bg-elev';
  return (
    <span
      className={`px-2 py-1 rounded border uppercase tracking-[0.1em] ${toneClass}`}
    >
      {label} <span className="font-medium">{value}</span>
    </span>
  );
}

function SpotCard({
  spot,
  onUpdate,
}: {
  spot: BlindSpot;
  onUpdate: (patch: { userStatus?: string; userNotes?: string }) => void;
}) {
  const [notes, setNotes] = useState(spot.userNotes ?? '');
  const [notesOpen, setNotesOpen] = useState(false);

  const severityClass =
    spot.detected && spot.severity
      ? SEVERITY_TINT[spot.severity] ?? SEVERITY_TINT.low
      : 'bg-bg-elev text-text-3 border-border';

  const dimmed = !spot.detected || spot.userStatus === 'dismissed';

  return (
    <GlassCard
      className={`p-5 ${dimmed ? 'opacity-60' : ''} ${
        spot.detected && spot.severity === 'critical'
          ? 'border-danger/40'
          : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
              {FRAMEWORK_LABEL[spot.framework] ?? spot.framework}
            </span>
            <span
              className={`text-[9px] font-mono uppercase tracking-[0.15em] px-1.5 py-0.5 rounded border ${severityClass}`}
            >
              {spot.detected
                ? (spot.severity ?? 'detected').toUpperCase()
                : 'CLEAR'}
            </span>
            {spot.detected && (
              <span className="text-[10px] font-mono text-text-3">
                {spot.confidenceScore ?? 0}% confidence
              </span>
            )}
          </div>
          <h3 className="font-display text-lg font-light text-text-1 leading-tight">
            {spot.title}
          </h3>
          <p className="text-[10px] font-mono italic text-text-3 mt-1">
            {FRAMEWORK_BLURB[spot.framework] ?? ''}
          </p>
        </div>
        {spot.detected && (
          <span
            className={`text-[9px] font-mono uppercase tracking-[0.15em] px-1.5 py-0.5 rounded border shrink-0 ${
              STATUS_TINT[spot.userStatus] ?? STATUS_TINT.open
            }`}
          >
            {STATUS_LABEL[spot.userStatus] ?? spot.userStatus.toUpperCase()}
          </span>
        )}
      </div>

      <p className="text-sm text-text-2 mb-3 whitespace-pre-line">
        {spot.description}
      </p>

      {spot.detected && spot.evidence.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1.5">
            Evidence
          </div>
          <ul className="space-y-1">
            {spot.evidence.map((e, i) => (
              <li
                key={i}
                className="text-xs text-text-2 pl-3 border-l border-border"
              >
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {spot.detected && spot.recommendation && (
        <div className="mb-3 p-3 bg-bg-elev/40 rounded border border-border">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
            Recommendation
          </div>
          <p className="text-sm text-text-1">{spot.recommendation}</p>
        </div>
      )}

      {spot.detected && spot.suggestedActions.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1.5">
            Suggested moves
          </div>
          <ul className="space-y-1 list-none">
            {spot.suggestedActions.map((a, i) => (
              <li key={i} className="text-xs text-text-2 flex gap-2">
                <span className="text-accent shrink-0">→</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {spot.detected && (
        <div className="flex items-center gap-1 flex-wrap pt-2 mt-2 border-t border-border">
          {spot.userStatus !== 'acknowledged' && (
            <button
              type="button"
              onClick={() => onUpdate({ userStatus: 'acknowledged' })}
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border border-border text-text-2 hover:border-accent hover:text-accent"
            >
              acknowledge
            </button>
          )}
          {spot.userStatus !== 'dismissed' && (
            <button
              type="button"
              onClick={() => onUpdate({ userStatus: 'dismissed' })}
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border border-border text-text-3 hover:border-text-2 hover:text-text-2"
            >
              dismiss
            </button>
          )}
          {spot.userStatus !== 'resolved' && (
            <button
              type="button"
              onClick={() => onUpdate({ userStatus: 'resolved' })}
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border border-border text-text-3 hover:border-emerald-500 hover:text-emerald-500"
            >
              mark resolved
            </button>
          )}
          {spot.userStatus !== 'open' && (
            <button
              type="button"
              onClick={() => onUpdate({ userStatus: 'open' })}
              className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border border-border text-text-3 hover:border-text-1 hover:text-text-1"
            >
              reopen
            </button>
          )}
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 ml-auto text-text-3 hover:text-text-1"
          >
            {notesOpen ? 'hide notes' : spot.userNotes ? 'edit notes' : '+ notes'}
          </button>
        </div>
      )}

      {spot.detected && notesOpen && (
        <div className="mt-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if ((notes ?? '') !== (spot.userNotes ?? '')) {
                onUpdate({ userNotes: notes });
              }
            }}
            placeholder="Your notes on this finding — what you decided, why, what you're testing…"
            rows={3}
            className="w-full px-3 py-2 bg-bg border border-border rounded text-sm placeholder:text-text-3 focus:outline-none focus:border-border-bright"
          />
          <div className="text-[10px] font-mono text-text-3 mt-1">
            saves on blur · {notes.length}/2000
          </div>
        </div>
      )}
    </GlassCard>
  );
}
