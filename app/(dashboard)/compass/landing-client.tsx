'use client';

// PR #77 — Sprint 7.4: /compass landing.
//
// Strategic dashboard for the five deep-dive features (Priority
// Matrix, Positioning Benchmark, Strategic Timeline, Blind Spots,
// Decision Log). Each card links to its deep-dive page; cards show
// a one-glance summary so the founder can spot what needs attention
// without clicking into every section.
//
// PR Sprint 7.25 Phase 5 — repainted on top of the platform redesign
// (AmbientBackground wrapper, orange "live · strategic command"
// eyebrow, fire-gradient italic h1 accent, 5 platform-feature-card
// links with per-feature glow colors). Data fetching stays in
// page.tsx; this client just renders.
import Link from 'next/link';
import { AmbientBackground } from '@/components/ui/ambient-background';
import { CompassSubNav } from '@/components/compass/sub-nav';

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
  // PR Sprint 7.25 Phase 11.7 — pin the locale to 'en-US' so SSR
  // and CSR produce identical output. Pre-fix this used `undefined`
  // which falls back to the runtime's default locale — Node picks
  // en-US on Vercel, browsers pick the user's preferred locale, so
  // a Spanish-locale visitor saw "5 ene" on first paint and "5
  // Jan" after hydration. Sentry was logging "Hydration failed"
  // 6 events / 2 users on /compass for this exact reason.
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
  });
}

function alignmentClass(score: number | null): string {
  if (score === null) return 'score score-mid';
  if (score >= 80) return 'score score-high';
  if (score >= 50) return 'score score-mid';
  return 'score score-low';
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'dot-severity-critical',
  high: 'dot-severity-high',
  medium: 'dot-severity-medium',
  low: 'dot-severity-low',
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
    <AmbientBackground accentTint="orange">
      <main className="platform-main platform-main-wide">
        <CompassSubNav active="home" />

        <header className="platform-page-head platform-reveal-1">
          <span className="platform-eyebrow platform-eyebrow-orange">
            live · strategic command
          </span>
          <h1>
            Compass<span className="accent-fire-grad">.</span>
          </h1>
          <p className="sub">
            Strategic dashboard for{' '}
            <b style={{ color: 'var(--text-1)' }}>{project.name}</b>. Five
            features keep your roadmap honest — click any card for the deep
            dive.
          </p>
        </header>

        <div
          className="platform-metrics-grid platform-metrics-grid-2 platform-reveal-2"
          style={{ marginBottom: '20px' }}
        >
          {/* Priority Matrix — green glow */}
          <Link
            href="/compass/priority"
            className="platform-feature-card platform-card-glow-green"
            style={{ ['--platform-glow' as string]: 'rgba(34, 197, 94, 0.22)' }}
          >
            <div className="platform-feature-head">
              <div>
                <div className="platform-feature-eyebrow">Priority Matrix</div>
                <h2 className="platform-feature-title">
                  {matrix
                    ? `${matrix.total} items prioritized`
                    : 'No matrix yet'}
                </h2>
                {matrix?.createdAt && (
                  <div className="platform-feature-meta">
                    Generated {formatDate(matrix.createdAt)}
                  </div>
                )}
              </div>
              <span className="platform-feature-arrow" aria-hidden>
                →
              </span>
            </div>
            {matrix ? (
              <div className="platform-quadrant-grid">
                <div className="platform-quadrant-tile platform-quadrant-tile-now">
                  <div className="count">{matrix.doNow}</div>
                  <div className="label">Do now</div>
                </div>
                <div className="platform-quadrant-tile platform-quadrant-tile-scheduled">
                  <div className="count">{matrix.scheduled}</div>
                  <div className="label">Scheduled</div>
                </div>
                <div className="platform-quadrant-tile platform-quadrant-tile-fillers">
                  <div className="count">{matrix.fillers}</div>
                  <div className="label">Fillers</div>
                </div>
                <div className="platform-quadrant-tile platform-quadrant-tile-avoid">
                  <div className="count">{matrix.avoid}</div>
                  <div className="label">Avoid</div>
                </div>
              </div>
            ) : (
              <p className="platform-feature-body">
                Generate your first Priority Matrix to see tasks by Impact ×
                Effort.
              </p>
            )}
          </Link>

          {/* Positioning Benchmark — blue glow */}
          <Link
            href="/compass/competitors"
            className="platform-feature-card platform-card-glow-blue"
            style={{ ['--platform-glow' as string]: 'rgba(96, 165, 250, 0.22)' }}
          >
            <div className="platform-feature-head">
              <div>
                <div className="platform-feature-eyebrow">
                  Positioning Benchmark
                </div>
                <h2 className="platform-feature-title">
                  {benchmark
                    ? `${benchmark.competitorsAnalyzed ?? '—'} competitors analyzed`
                    : 'No benchmark yet'}
                </h2>
                {benchmark?.createdAt && (
                  <div className="platform-feature-meta">
                    Generated {formatDate(benchmark.createdAt)}
                  </div>
                )}
              </div>
              <span className="platform-feature-arrow" aria-hidden>
                →
              </span>
            </div>
            {benchmark ? (
              <div style={{ marginTop: '12px' }}>
                {topCompetitor?.name && (
                  <div
                    style={{
                      fontSize: '13px',
                      color: 'var(--text-2)',
                      marginBottom: '6px',
                    }}
                  >
                    <span style={{ color: 'var(--text-3)' }}>Top:</span>{' '}
                    <b style={{ color: 'var(--text-1)' }}>
                      {topCompetitor.name}
                    </b>
                  </div>
                )}
                {benchmark.marketGap && (
                  <p
                    style={{
                      fontSize: '13px',
                      color: 'var(--text-2)',
                      fontStyle: 'italic',
                      margin: 0,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      lineHeight: 1.5,
                    }}
                  >
                    “{benchmark.marketGap}”
                  </p>
                )}
              </div>
            ) : (
              <p className="platform-feature-body">
                Identify competitors + market gap in ~30 seconds.
              </p>
            )}
          </Link>

          {/* Strategic Timeline — purple glow */}
          <Link
            href="/compass/timeline"
            className="platform-feature-card platform-card-glow-purple"
            style={{ ['--platform-glow' as string]: 'rgba(139, 92, 246, 0.22)' }}
          >
            <div className="platform-feature-head">
              <div>
                <div className="platform-feature-eyebrow">
                  Strategic Timeline
                </div>
                <h2 className="platform-feature-title">
                  {upcomingTasks.length > 0
                    ? `${upcomingTasks.length} upcoming task${upcomingTasks.length === 1 ? '' : 's'}`
                    : 'No tasks scheduled'}
                </h2>
              </div>
              <span className="platform-feature-arrow" aria-hidden>
                →
              </span>
            </div>
            {upcomingTasks.length > 0 ? (
              <ul className="platform-feature-list">
                {upcomingTasks.slice(0, 3).map((t) => (
                  <li key={t.id}>
                    <span className="stamp">{formatDate(t.scheduledFor)}</span>
                    <span className="body">{t.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="platform-feature-body">
                Auto-populate from Priority Matrix.
              </p>
            )}
          </Link>

          {/* Blind Spots — red glow */}
          <Link
            href="/compass/blind-spots"
            className="platform-feature-card platform-card-glow-red"
            style={{ ['--platform-glow' as string]: 'rgba(239, 68, 68, 0.22)' }}
          >
            <div className="platform-feature-head">
              <div>
                <div className="platform-feature-eyebrow">Blind Spots</div>
                <h2 className="platform-feature-title">
                  {openBlindSpots.length > 0
                    ? `${openBlindSpots.length} open issue${openBlindSpots.length === 1 ? '' : 's'}`
                    : 'No open findings'}
                </h2>
              </div>
              <span className="platform-feature-arrow" aria-hidden>
                →
              </span>
            </div>
            {openBlindSpots.length > 0 ? (
              <ul className="platform-feature-list">
                {openBlindSpots.slice(0, 3).map((s) => (
                  <li key={s.id}>
                    <span
                      className={`dot-severity ${
                        SEVERITY_CLASS[s.severity ?? ''] ??
                        'dot-severity-unknown'
                      }`}
                      aria-label={s.severity ?? 'unknown severity'}
                    />
                    <span className="body">{s.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="platform-feature-body">
                6 frameworks scan credibility, pricing, audience, content
                fit, platform scatter, and social proof.
              </p>
            )}
          </Link>

          {/* Decision Log — orange glow, full width */}
          <Link
            href="/compass/decisions"
            className="platform-feature-card platform-card-glow-orange"
            style={{
              ['--platform-glow' as string]: 'rgba(249, 115, 22, 0.22)',
              gridColumn: '1 / -1',
            }}
          >
            <div className="platform-feature-head">
              <div>
                <div className="platform-feature-eyebrow">Decision Log</div>
                <h2 className="platform-feature-title">
                  {recentDecisions.length > 0
                    ? `${recentDecisions.length} recent decision${recentDecisions.length === 1 ? '' : 's'}`
                    : 'Log your first strategic decision'}
                </h2>
              </div>
              <span className="platform-feature-arrow" aria-hidden>
                →
              </span>
            </div>
            {recentDecisions.length > 0 ? (
              <ul className="platform-feature-list">
                {recentDecisions.slice(0, 3).map((d) => (
                  <li key={d.id}>
                    <span className="stamp">{formatDate(d.decidedAt)}</span>
                    <span className="body">{d.title}</span>
                    <span className={alignmentClass(d.alignmentScore)}>
                      {d.alignmentScore ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="platform-feature-body">
                Pre-decision alignment scoring + outcome tracking + pattern
                detection over time.
              </p>
            )}
          </Link>
        </div>
      </main>
    </AmbientBackground>
  );
}
