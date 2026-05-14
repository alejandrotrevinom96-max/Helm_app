// PR Sprint 7.19 — admin overview dashboard.
//
// Founder-only at-a-glance view of platform health. All counts
// come straight from the source-of-truth tables (no derived
// materialized views — volumes are small enough that COUNT(*)
// is fine). All queries run in parallel.
//
// Sections:
//   - Top stats: users, projects, integrations, conversations.
//   - Content pipeline: drafts generated, posts scheduled, posts
//     published, HeyGen video jobs by status.
//   - Voice engine: ClientContext rows, voice audit events (last
//     7 days), brand bibles generated.
//   - Recent activity: 10 latest cross-cutting events
//     (signups, projects created, posts published, HeyGen
//     completions).
//
// Auth is enforced by app/(dashboard)/admin/layout.tsx.

import { db } from '@/lib/db';
import {
  scheduledPosts,
  users,
} from '@/lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';

// Sprint 7.19 follow-up — fix admin overview "server-side
// exception" caused by Supabase pooler statement_timeout (code
// 57014) when 17 parallel COUNT(*) queries fired via
// Promise.all. Some individually timed out and tanked the whole
// page.
//
// Strategy now:
//   1) Consolidate all 17 counts into ONE SQL round-trip via
//      scalar subqueries. Postgres pipelines this trivially
//      and the entire stat block finishes in one connection
//      checkout instead of fighting for 17.
//   2) Each block (counts, heygen group-by, recent signups,
//      recent published) lives inside its own try/catch. If any
//      one fails, the rest still render. The page becomes
//      strictly degraded instead of strictly broken.
//   3) Dates serialize to ISO strings before going into the raw
//      sql template — postgres-js's text-mode serializer chokes
//      on raw JS Date objects in template-literal params
//      (different bug from earlier; that one was inside a typed
//      Drizzle helper, this one is a raw sql template).

type CountRow = {
  users: string | number;
  projects: string | number;
  integrations: string | number;
  conversations: string | number;
  active_conversations: string | number;
  agent_conversations: string | number;
  messages: string | number;
  drafts: string | number;
  scheduled: string | number;
  published: string | number;
  client_contexts: string | number;
  voice_audit_7d: string | number;
  brand_analyses: string | number;
  signups_7d: string | number;
  drafts_7d: string | number;
  published_7d: string | number;
};

type HeygenRow = { status: string; c: string | number };

const ZERO_COUNTS = {
  users: 0,
  projects: 0,
  integrations: 0,
  conversations: 0,
  activeConversations: 0,
  agentConversations: 0,
  messages: 0,
  drafts: 0,
  scheduled: 0,
  published: 0,
  clientContexts: 0,
  voiceAudit7d: 0,
  brandAnalyses: 0,
  signups7d: 0,
  drafts7d: 0,
  published7d: 0,
};

// postgres-js returns COUNT(*) as a string (bigint), even when
// the underlying value fits in JS number range. Normalize once
// at the boundary so the render layer doesn't have to.
const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

async function loadCounts(sevenDaysAgoIso: string) {
  // Single SQL round-trip — 17 scalar subqueries. Each is
  // independent of the others; Postgres picks an optimal plan.
  // Passing the ISO timestamp as a parameter avoids the JS
  // Date-to-text serialization bug that bit us before.
  const rows = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM projects) AS projects,
      (SELECT COUNT(*) FROM integrations) AS integrations,
      (SELECT COUNT(*) FROM chat_conversations) AS conversations,
      (SELECT COUNT(*) FROM chat_conversations WHERE status = 'active') AS active_conversations,
      (SELECT COUNT(*) FROM chat_conversations WHERE mode = 'agent') AS agent_conversations,
      (SELECT COUNT(*) FROM chat_messages) AS messages,
      (SELECT COUNT(*) FROM generated_posts) AS drafts,
      (SELECT COUNT(*) FROM scheduled_posts) AS scheduled,
      (SELECT COUNT(*) FROM scheduled_posts WHERE status = 'posted') AS published,
      (SELECT COUNT(*) FROM client_contexts) AS client_contexts,
      (SELECT COUNT(*) FROM voice_engine_audit_log WHERE created_at >= ${sevenDaysAgoIso}::timestamp) AS voice_audit_7d,
      (SELECT COUNT(*) FROM brand_analysis) AS brand_analyses,
      (SELECT COUNT(*) FROM users WHERE created_at >= ${sevenDaysAgoIso}::timestamp) AS signups_7d,
      (SELECT COUNT(*) FROM generated_posts WHERE created_at >= ${sevenDaysAgoIso}::timestamp) AS drafts_7d,
      (SELECT COUNT(*) FROM scheduled_posts WHERE posted_at IS NOT NULL AND posted_at >= ${sevenDaysAgoIso}::timestamp) AS published_7d
  `)) as unknown as CountRow[];

  const r = rows[0];
  if (!r) return ZERO_COUNTS;
  return {
    users: toNum(r.users),
    projects: toNum(r.projects),
    integrations: toNum(r.integrations),
    conversations: toNum(r.conversations),
    activeConversations: toNum(r.active_conversations),
    agentConversations: toNum(r.agent_conversations),
    messages: toNum(r.messages),
    drafts: toNum(r.drafts),
    scheduled: toNum(r.scheduled),
    published: toNum(r.published),
    clientContexts: toNum(r.client_contexts),
    voiceAudit7d: toNum(r.voice_audit_7d),
    brandAnalyses: toNum(r.brand_analyses),
    signups7d: toNum(r.signups_7d),
    drafts7d: toNum(r.drafts_7d),
    published7d: toNum(r.published_7d),
  };
}

async function loadHeygenByStatus(): Promise<Record<string, number>> {
  const rows = (await db.execute(sql`
    SELECT status, COUNT(*) AS c
    FROM heygen_jobs
    GROUP BY status
  `)) as unknown as HeygenRow[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = toNum(r.c);
  return out;
}

async function loadRecentSignups() {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(10);
}

async function loadRecentPublished() {
  return db
    .select({
      id: scheduledPosts.id,
      platform: scheduledPosts.platform,
      postedAt: scheduledPosts.postedAt,
      projectId: scheduledPosts.projectId,
    })
    .from(scheduledPosts)
    .where(eq(scheduledPosts.status, 'posted'))
    .orderBy(desc(scheduledPosts.postedAt))
    .limit(10);
}

// Each block lands in its own try/catch. One failure renders a
// degraded section but never crashes the whole page.
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    logger.error('admin/overview', `${label} query failed`, { error: e });
    return fallback;
  }
}

async function loadOverview() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoIso = sevenDaysAgo.toISOString();

  const [counts, heygenByStatus, recentSignups, recentPublished] =
    await Promise.all([
      safe('counts', () => loadCounts(sevenDaysAgoIso), ZERO_COUNTS),
      safe('heygenByStatus', () => loadHeygenByStatus(), {}),
      safe('recentSignups', () => loadRecentSignups(), []),
      safe('recentPublished', () => loadRecentPublished(), []),
    ]);

  return {
    ...counts,
    heygenByStatus,
    recentSignups,
    recentPublished,
  };
}

export default async function AdminOverviewPage() {
  const data = await loadOverview();

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="font-display text-3xl">Admin Overview</h1>
        <p className="text-sm text-text-3 mt-1">
          Everything happening in Helm at a glance. Counts are
          live — refresh the page for the freshest numbers.
        </p>
      </header>

      {/* TOP-LINE STATS */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
          Platform
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Users"
            value={data.users}
            delta={`+${data.signups7d} in 7d`}
          />
          <Stat label="Projects" value={data.projects} />
          <Stat label="Integrations" value={data.integrations} />
          <Stat
            label="Chat conversations"
            value={data.conversations}
            sub={`${data.activeConversations} active · ${data.agentConversations} agent`}
          />
        </div>
      </section>

      {/* CONTENT PIPELINE */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
          Content pipeline
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Drafts generated"
            value={data.drafts}
            delta={`+${data.drafts7d} in 7d`}
          />
          <Stat label="Posts scheduled" value={data.scheduled} />
          <Stat
            label="Posts published"
            value={data.published}
            delta={`+${data.published7d} in 7d`}
          />
          <Stat label="Chat messages" value={data.messages} />
        </div>
      </section>

      {/* HEYGEN */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
          HeyGen video jobs
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            label="Queued"
            value={data.heygenByStatus.queued ?? 0}
          />
          <Stat
            label="Processing"
            value={data.heygenByStatus.processing ?? 0}
          />
          <Stat
            label="Completed"
            value={data.heygenByStatus.completed ?? 0}
          />
          <Stat
            label="Failed"
            value={data.heygenByStatus.failed ?? 0}
            tone={data.heygenByStatus.failed ? 'danger' : 'neutral'}
          />
        </div>
      </section>

      {/* VOICE ENGINE */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
          Voice engine
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Client contexts" value={data.clientContexts} />
          <Stat label="Brand analyses" value={data.brandAnalyses} />
          <Stat
            label="Audit events"
            value={data.voiceAudit7d}
            sub="last 7d"
          />
        </div>
      </section>

      {/* RECENT SIGNUPS */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
          Recent signups
        </h2>
        <div className="glass rounded-xl overflow-hidden border border-border">
          {data.recentSignups.length === 0 && (
            <div className="px-4 py-6 text-xs text-text-3">No users yet.</div>
          )}
          {data.recentSignups.map((u, i) => (
            <div
              key={u.id}
              className={`px-4 py-3 flex items-center justify-between gap-3 ${
                i > 0 ? 'border-t border-border' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {u.name || u.email}
                </div>
                <div className="text-[11px] font-mono text-text-3 truncate">
                  {u.email}
                </div>
              </div>
              <div className="text-[11px] text-text-3 shrink-0">
                {formatDate(u.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* RECENT PUBLISHED */}
      <section>
        <h2 className="text-xs font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
          Recently published posts
        </h2>
        <div className="glass rounded-xl overflow-hidden border border-border">
          {data.recentPublished.length === 0 && (
            <div className="px-4 py-6 text-xs text-text-3">
              No posts published yet.
            </div>
          )}
          {data.recentPublished.map((p, i) => (
            <div
              key={p.id}
              className={`px-4 py-3 flex items-center justify-between gap-3 ${
                i > 0 ? 'border-t border-border' : ''
              }`}
            >
              <div className="text-sm">
                <span className="font-medium">{p.platform}</span>
                <span className="text-text-3 ml-2 font-mono text-[11px]">
                  {p.projectId.slice(0, 8)}
                </span>
              </div>
              <div className="text-[11px] text-text-3">
                {p.postedAt ? formatDate(p.postedAt) : '—'}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  delta?: string;
  sub?: string;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div className="glass rounded-xl p-4 border border-border">
      <div className="text-[11px] uppercase tracking-wider text-text-3">
        {label}
      </div>
      <div
        className={`font-display text-3xl mt-1 ${
          tone === 'danger' && value > 0 ? 'text-danger' : 'text-text-1'
        }`}
      >
        {value.toLocaleString()}
      </div>
      {delta && (
        <div className="text-[11px] text-success mt-1 font-mono">{delta}</div>
      )}
      {sub && (
        <div className="text-[11px] text-text-3 mt-1 font-mono">{sub}</div>
      )}
    </div>
  );
}

function formatDate(d: Date): string {
  try {
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}
