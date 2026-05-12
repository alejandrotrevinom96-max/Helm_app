'use client';

// PR #77 — Sprint 7.4: /compass landing.
//
// Replaces the VC-compass single-page reading (dial + bull/bear +
// 5 dimensions) with a strategic dashboard that summarizes the
// five deep-dive features built across Sprints 7.1A–7.1E:
//   - Priority Matrix (compass_decisions … no, priority_items)
//   - Positioning Benchmark (competitors + positioning_benchmarks)
//   - Strategic Timeline (compass_tasks)
//   - Blind Spots (compass_blind_spots)
//   - Decision Log (compass_decisions)
//
// Each card is a `<Link>` to its deep-dive page; cards show a
// one-glance summary (quadrant counts, top competitor name, most
// recent decision alignment score, etc.) so the founder can spot
// what needs attention without clicking into every section.
//
// The legacy VC-compass UI lives on disk at
// app/(dashboard)/compass/{client.tsx, compass-dial.tsx,
// dimension-breakdown.tsx, etc.} but is no longer rendered from
// page.tsx. Revert = one server component file.
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { CompassSubNav } from '@/components/compass/sub-nav';

// ── Server-shaped data we receive from page.tsx ───────────────
interface BenchmarkRow {
  id: string;
  marketGap: string | null;
  uniquePositioning: string | null;
  competitorsAnalyzed: number | null;
  createdAt: string | null;
}

interface MatrixSummary {
  id: string;
  createdAt: string | null;
  // Quadrant counts — computed server-side from priority_items.
  doNow: number;
  scheduled: number;
  fillers: number;
  avoid: number;
  total: number;
}

interface CompetitorRow {
  id: string;
  name: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  scheduledFor: string | null;
  status: string;
  taskType: string | null;
}

interface BlindSpotRow {
  id: string;
  title: string;
  severity: string | null;
  framework: string;
  detected: boolean;
  userStatus: string;
}

interface DecisionRow {
  id: string;
  title: string;
  category: string | null;
  alignmentScore: number | null;
  decidedAt: string | null;
  status: string;
}

interface Props {
  project: { id: string; name: string };
  benchmark: BenchmarkRow | null;
  topCompetitor: CompetitorRow | null;
  matrix: MatrixSummary | null;
  upcomingTasks: TaskRow[];
  openBlindSpots: BlindSpotRow[];
  recentDecisions: DecisionRow[];
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

function alignmentTone(score: number | null): string {
  if (score === null) return 'text-text-3';
  if (score >= 80) return 'text-emerald-500';
  if (score >= 60) return 'text-amber-500';
  if (score >= 40) return 'text-orange-500';
  return 'text-danger';
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-danger',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
};

export function CompassLandingClient({
  project,
  benchmark,
  topCompetitor,
  matrix,
  upcomingTasks,
  openBlindSpots,
  recentDecisions,
}: Props) {
  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <header className="space-y-2">
        <CompassSubNav active="home" />
        <div>
          <h1 className="font-display text-display-md font-light tracking-tight">
            Compass
          </h1>
          <p className="text-text-2 text-sm max-w-2xl">
            Strategic dashboard for{' '}
            <span className="text-text-1 font-medium">{project.name}</span>.
            Cliqueá cualquier feature para ver detalle.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Priority Matrix */}
        <Link
          href="/compass/priority"
          className="group block focus:outline-none focus:ring-2 focus:ring-accent rounded-xl"
        >
          <GlassCard className="p-5 hover:border-accent/40 transition-colors h-full">
            <CardHeader
              eyebrow="Priority Matrix"
              title={
                matrix
                  ? `${matrix.total} items prioritized`
                  : 'No matrix yet'
              }
              meta={
                matrix?.createdAt
                  ? `Generated ${formatDate(matrix.createdAt)}`
                  : null
              }
            />
            {matrix ? (
              <div className="grid grid-cols-4 gap-2 mt-3">
                <QuadrantStat
                  label="Do now"
                  count={matrix.doNow}
                  tint="bg-emerald-500/15 text-emerald-500"
                />
                <QuadrantStat
                  label="Scheduled"
                  count={matrix.scheduled}
                  tint="bg-blue-500/15 text-blue-500"
                />
                <QuadrantStat
                  label="Fillers"
                  count={matrix.fillers}
                  tint="bg-amber-500/15 text-amber-500"
                />
                <QuadrantStat
                  label="Avoid"
                  count={matrix.avoid}
                  tint="bg-text-3/15 text-text-3"
                />
              </div>
            ) : (
              <p className="text-sm text-text-3 mt-3">
                Generá tu primer Priority Matrix para ver tareas por Impact ×
                Effort.
              </p>
            )}
          </GlassCard>
        </Link>

        {/* Positioning Benchmark */}
        <Link
          href="/compass/competitors"
          className="group block focus:outline-none focus:ring-2 focus:ring-accent rounded-xl"
        >
          <GlassCard className="p-5 hover:border-accent/40 transition-colors h-full">
            <CardHeader
              eyebrow="Positioning Benchmark"
              title={
                benchmark
                  ? `${benchmark.competitorsAnalyzed ?? '—'} competitors analyzed`
                  : 'No benchmark yet'
              }
              meta={
                benchmark?.createdAt
                  ? `Generated ${formatDate(benchmark.createdAt)}`
                  : null
              }
            />
            {benchmark ? (
              <div className="mt-3 space-y-1.5">
                {topCompetitor?.name && (
                  <div className="text-xs text-text-2">
                    <span className="text-text-3">Top:</span>{' '}
                    <span className="font-medium text-text-1">
                      {topCompetitor.name}
                    </span>
                  </div>
                )}
                {benchmark.marketGap && (
                  <p className="text-xs text-text-3 line-clamp-2 italic">
                    “{benchmark.marketGap}”
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-text-3 mt-3">
                Identificá competidores + market gap en ~30 segundos.
              </p>
            )}
          </GlassCard>
        </Link>

        {/* Strategic Timeline */}
        <Link
          href="/compass/timeline"
          className="group block focus:outline-none focus:ring-2 focus:ring-accent rounded-xl"
        >
          <GlassCard className="p-5 hover:border-accent/40 transition-colors h-full">
            <CardHeader
              eyebrow="Strategic Timeline"
              title={
                upcomingTasks.length > 0
                  ? `${upcomingTasks.length} próximas tareas`
                  : 'Sin tareas programadas'
              }
              meta={null}
            />
            {upcomingTasks.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {upcomingTasks.slice(0, 3).map((t) => (
                  <li key={t.id} className="text-xs flex items-baseline gap-2">
                    <span className="text-text-3 font-mono shrink-0 w-12">
                      {formatDate(t.scheduledFor)}
                    </span>
                    <span className="text-text-1 truncate">{t.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-3 mt-3">
                Auto-popular desde Priority Matrix.
              </p>
            )}
          </GlassCard>
        </Link>

        {/* Blind Spots */}
        <Link
          href="/compass/blind-spots"
          className="group block focus:outline-none focus:ring-2 focus:ring-accent rounded-xl"
        >
          <GlassCard className="p-5 hover:border-accent/40 transition-colors h-full">
            <CardHeader
              eyebrow="Blind Spots"
              title={
                openBlindSpots.length > 0
                  ? `${openBlindSpots.length} open issues`
                  : 'Sin findings abiertos'
              }
              meta={null}
            />
            {openBlindSpots.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {openBlindSpots.slice(0, 3).map((s) => (
                  <li
                    key={s.id}
                    className="text-xs flex items-center gap-2 min-w-0"
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        SEVERITY_DOT[s.severity ?? ''] ?? 'bg-text-3'
                      }`}
                      aria-label={s.severity ?? 'unknown severity'}
                    />
                    <span className="text-text-1 truncate">{s.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-3 mt-3">
                6 frameworks scanean credibility, pricing, audience, content
                fit, platform scatter, social proof.
              </p>
            )}
          </GlassCard>
        </Link>

        {/* Decision Log — full width */}
        <Link
          href="/compass/decisions"
          className="group block focus:outline-none focus:ring-2 focus:ring-accent rounded-xl md:col-span-2"
        >
          <GlassCard className="p-5 hover:border-accent/40 transition-colors">
            <CardHeader
              eyebrow="Decision Log"
              title={
                recentDecisions.length > 0
                  ? `${recentDecisions.length} decisión${recentDecisions.length === 1 ? '' : 'es'} reciente${recentDecisions.length === 1 ? '' : 's'}`
                  : 'Loggeá tu primera decisión estratégica'
              }
              meta={null}
            />
            {recentDecisions.length > 0 ? (
              <ul className="mt-3 divide-y divide-border">
                {recentDecisions.slice(0, 3).map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start justify-between gap-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-1 truncate">
                        {d.title}
                      </div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mt-0.5">
                        {formatDate(d.decidedAt)}
                        {d.category && (
                          <>
                            {' '}
                            <span>·</span> {d.category}
                          </>
                        )}
                        {d.status !== 'decided' && (
                          <>
                            {' '}
                            <span>·</span> {d.status}
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={`font-display text-2xl font-light shrink-0 ${alignmentTone(d.alignmentScore)}`}
                    >
                      {d.alignmentScore ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-3 mt-3">
                Pre-decision alignment scoring + outcome tracking + pattern
                detection con histórico.
              </p>
            )}
          </GlassCard>
        </Link>
      </div>
    </div>
  );
}

// ── Local UI helpers (private to this component) ──────────────

function CardHeader({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
          {eyebrow}
        </div>
        <h2 className="font-display text-lg font-light mt-0.5">{title}</h2>
        {meta && (
          <p className="text-[10px] font-mono text-text-3 mt-1">{meta}</p>
        )}
      </div>
      <span
        aria-hidden
        className="text-text-3 text-lg group-hover:text-accent transition-colors shrink-0"
      >
        →
      </span>
    </div>
  );
}

function QuadrantStat({
  label,
  count,
  tint,
}: {
  label: string;
  count: number;
  tint: string;
}) {
  return (
    <div
      className={`rounded p-2 text-center ${tint}`}
      title={`${label}: ${count}`}
    >
      <div className="font-display text-xl font-light leading-none">
        {count}
      </div>
      <div className="text-[9px] font-mono uppercase tracking-[0.1em] mt-1">
        {label}
      </div>
    </div>
  );
}
