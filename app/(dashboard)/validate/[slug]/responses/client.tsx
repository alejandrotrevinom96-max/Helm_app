'use client';

import Link from 'next/link';
import type { TemplateConfig } from '@/lib/validate/defaults';
import { GlassCard } from '@/components/ui/glass-card';
import { timeAgo } from '@/lib/utils';
import {
  SurveyAnalysisPanel,
  type SurveyAnalysis,
} from '../survey-analysis-panel';

interface ResponseRow {
  id: string;
  email: string | null;
  responses: Record<string, unknown> | null;
  createdAt: Date | string;
}

export function ResponsesClient({
  slug,
  title,
  template,
  templateConfig,
  surveyAnalysis,
  responses,
}: {
  slug: string;
  title: string;
  template: string;
  templateConfig: TemplateConfig | null;
  surveyAnalysis: SurveyAnalysis | null;
  responses: ResponseRow[];
}) {
  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 md:mb-8">
        <Link
          href="/validate"
          className="text-xs text-accent hover:underline mb-2 inline-block"
        >
          ← Back to Validate
        </Link>
        <h1 className="font-display text-display-md font-light tracking-tight">
          {title}
        </h1>
        <p className="text-text-2 mt-2 max-w-2xl text-sm">
          {responses.length} response{responses.length === 1 ? '' : 's'} ·{' '}
          <a
            href={`/w/${slug}`}
            target="_blank"
            className="text-accent hover:underline"
          >
            View public page ↗
          </a>
        </p>
      </div>

      {template === 'survey-5q' && (
        <SurveyAnalysisPanel
          slug={slug}
          initialAnalysis={surveyAnalysis}
          responseCount={responses.length}
        />
      )}

      {responses.length === 0 ? (
        <GlassCard className="p-8 md:p-12 text-center">
          <p className="font-display text-2xl font-light mb-2">
            No responses yet
          </p>
          <p className="text-text-2 text-sm">
            Share your URL to start collecting answers.
          </p>
        </GlassCard>
      ) : template === 'feature-vote' ? (
        <FeatureVoteAnalysis
          templateConfig={templateConfig}
          responses={responses}
        />
      ) : template === 'pricing-test' ? (
        <PricingTestAnalysis responses={responses} />
      ) : template === 'survey-5q' ? (
        <SurveyResponses
          templateConfig={templateConfig}
          responses={responses}
        />
      ) : template === 'beta-tester' ? (
        <BetaTesterResponses
          templateConfig={templateConfig}
          responses={responses}
        />
      ) : (
        <MinimalResponses responses={responses} />
      )}
    </div>
  );
}

function MinimalResponses({ responses }: { responses: ResponseRow[] }) {
  return (
    <GlassCard className="p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <th className="text-left p-4 text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
              Email
            </th>
            <th className="text-right p-4 text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 whitespace-nowrap">
              When
            </th>
          </tr>
        </thead>
        <tbody>
          {responses.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <td className="p-4 break-all">{r.email ?? '—'}</td>
              <td className="p-4 text-right text-text-3 font-mono whitespace-nowrap">
                {timeAgo(r.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassCard>
  );
}

function BetaTesterResponses({
  templateConfig,
  responses,
}: {
  templateConfig: TemplateConfig | null;
  responses: ResponseRow[];
}) {
  const questions = templateConfig?.qualifyingQuestions ?? [];
  return (
    <div className="space-y-3">
      {responses.map((r) => (
        <GlassCard key={r.id} className="p-4 md:p-5">
          <div className="flex justify-between items-start mb-3 gap-3 flex-wrap">
            <div className="font-medium break-all">{r.email ?? '—'}</div>
            <div className="text-[11px] font-mono text-text-3">
              {timeAgo(r.createdAt)}
            </div>
          </div>
          <dl className="space-y-2">
            {questions.map((q, i) => {
              const answer = (r.responses?.[`q${i}`] as string | undefined) ?? '—';
              return (
                <div key={i}>
                  <dt className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-0.5">
                    {q.question}
                  </dt>
                  <dd className="text-sm text-text-1">{answer}</dd>
                </div>
              );
            })}
          </dl>
        </GlassCard>
      ))}
    </div>
  );
}

function FeatureVoteAnalysis({
  templateConfig,
  responses,
}: {
  templateConfig: TemplateConfig | null;
  responses: ResponseRow[];
}) {
  const features = templateConfig?.features ?? [];
  const tally = features.map((f) => {
    const votes = responses.filter((r) => {
      const arr = (r.responses?.votes as string[] | undefined) ?? [];
      return arr.includes(f.id);
    }).length;
    return { ...f, votes };
  });
  tally.sort((a, b) => b.votes - a.votes);
  const max = Math.max(1, ...tally.map((t) => t.votes));

  return (
    <div className="space-y-6">
      <GlassCard className="p-5 md:p-6">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-4">
          Vote tally
        </div>
        <div className="space-y-3">
          {tally.map((f) => {
            const pct = (f.votes / max) * 100;
            return (
              <div key={f.id}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-medium">{f.title}</span>
                  <span className="text-sm font-mono text-text-2">
                    {f.votes}
                  </span>
                </div>
                <div className="h-2 bg-bg-elev rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[image:var(--accent-grad)] rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <details className="text-sm">
        <summary className="cursor-pointer text-text-3 hover:text-text-1 mb-3">
          See raw responses ({responses.length})
        </summary>
        <div className="mt-3 space-y-2">
          {responses.map((r) => {
            const votes = (r.responses?.votes as string[] | undefined) ?? [];
            return (
              <div
                key={r.id}
                className="border border-border rounded-lg p-3 text-xs flex justify-between items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="break-all">{r.email ?? '—'}</div>
                  <div className="text-text-3 mt-1">
                    Voted: {votes.join(', ') || '—'}
                  </div>
                </div>
                <div className="text-text-3 font-mono whitespace-nowrap">
                  {timeAgo(r.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function PricingTestAnalysis({ responses }: { responses: ResponseRow[] }) {
  const commits = responses.filter(
    (r) => (r.responses as { commit?: boolean })?.commit
  );
  const conversionRate =
    responses.length > 0
      ? Math.round((commits.length / responses.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            Reservations
          </div>
          <div className="font-display text-3xl font-light">{commits.length}</div>
        </GlassCard>
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            Total visits saved
          </div>
          <div className="font-display text-3xl font-light">
            {responses.length}
          </div>
        </GlassCard>
        <GlassCard className="p-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
            Commit rate
          </div>
          <div className="font-display text-3xl font-light">
            {conversionRate}%
          </div>
        </GlassCard>
      </div>

      <details>
        <summary className="cursor-pointer text-text-3 hover:text-text-1 text-sm">
          See reservations ({commits.length})
        </summary>
        <div className="mt-3 space-y-2">
          {commits.map((r) => (
            <div
              key={r.id}
              className="border border-border rounded-lg p-3 text-xs flex justify-between items-center gap-3"
            >
              <span className="break-all">{r.email ?? '—'}</span>
              <span className="text-text-3 font-mono whitespace-nowrap">
                {timeAgo(r.createdAt)}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function SurveyResponses({
  templateConfig,
  responses,
}: {
  templateConfig: TemplateConfig | null;
  responses: ResponseRow[];
}) {
  const questions = templateConfig?.questions ?? [];
  return (
    <div className="space-y-3">
      {responses.map((r) => (
        <GlassCard key={r.id} className="p-4 md:p-5">
          <div className="flex justify-between items-start mb-3 gap-3 flex-wrap">
            <div className="font-medium break-all">
              {r.email ?? <span className="text-text-3 italic">anonymous</span>}
            </div>
            <div className="text-[11px] font-mono text-text-3">
              {timeAgo(r.createdAt)}
            </div>
          </div>
          <dl className="space-y-3">
            {questions.map((q, i) => {
              const answer = (r.responses?.[`q${i}`] as string | undefined) ?? '—';
              return (
                <div key={i}>
                  <dt className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
                    {i + 1}. {q}
                  </dt>
                  <dd className="text-sm text-text-2 whitespace-pre-wrap">{answer}</dd>
                </div>
              );
            })}
          </dl>
        </GlassCard>
      ))}
    </div>
  );
}
