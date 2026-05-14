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
  users,
  projects,
  integrations,
  generatedPosts,
  scheduledPosts,
  heygenJobs,
  brandAnalysis,
  clientContexts,
  voiceEngineAuditLog,
  chatConversations,
  chatMessages,
} from '@/lib/db/schema';
import { and, count, desc, eq, gte, isNotNull } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

async function loadOverview() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Run everything in parallel. Each promise is small (one count
  // each) so the wall-clock is ~max latency to Postgres.
  const [
    userCount,
    projectCount,
    integrationCount,
    conversationCount,
    activeConversationCount,
    agentConversationCount,
    messageCount,
    draftCount,
    scheduledCount,
    publishedCount,
    heygenByStatus,
    clientContextCount,
    voiceAuditRecent,
    brandAnalysisCount,
    last7Signups,
    last7Drafts,
    last7Published,
  ] = await Promise.all([
    db.select({ c: count() }).from(users),
    db.select({ c: count() }).from(projects),
    db.select({ c: count() }).from(integrations),
    db.select({ c: count() }).from(chatConversations),
    db
      .select({ c: count() })
      .from(chatConversations)
      .where(eq(chatConversations.status, 'active')),
    db
      .select({ c: count() })
      .from(chatConversations)
      .where(eq(chatConversations.mode, 'agent')),
    db.select({ c: count() }).from(chatMessages),
    db.select({ c: count() }).from(generatedPosts),
    db.select({ c: count() }).from(scheduledPosts),
    db
      .select({ c: count() })
      .from(scheduledPosts)
      .where(eq(scheduledPosts.status, 'posted')),
    db
      .select({
        status: heygenJobs.status,
        c: count(),
      })
      .from(heygenJobs)
      .groupBy(heygenJobs.status),
    db.select({ c: count() }).from(clientContexts),
    db
      .select({ c: count() })
      .from(voiceEngineAuditLog)
      .where(gte(voiceEngineAuditLog.createdAt, sevenDaysAgo)),
    db.select({ c: count() }).from(brandAnalysis),
    db
      .select({ c: count() })
      .from(users)
      .where(gte(users.createdAt, sevenDaysAgo)),
    db
      .select({ c: count() })
      .from(generatedPosts)
      .where(gte(generatedPosts.createdAt, sevenDaysAgo)),
    // Drizzle's typed gte() helper handles Date → timestamp
    // serialization correctly. A raw sql`${date}` template
    // literal does NOT — it leaks the JS Date through to
    // postgres-js without typecast info and the driver throws
    // "The 'string' argument must be of type string... Received
    // an instance of Date". So this branch deliberately uses
    // and(isNotNull(...), gte(...)) instead of a raw template.
    db
      .select({ c: count() })
      .from(scheduledPosts)
      .where(
        and(
          isNotNull(scheduledPosts.postedAt),
          gte(scheduledPosts.postedAt, sevenDaysAgo),
        ),
      ),
  ]);

  // Recent signups (last 10).
  const recentSignups = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(10);

  // Posts published in last 7 days (sample).
  const recentPublished = await db
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

  return {
    users: userCount[0]?.c ?? 0,
    projects: projectCount[0]?.c ?? 0,
    integrations: integrationCount[0]?.c ?? 0,
    conversations: conversationCount[0]?.c ?? 0,
    activeConversations: activeConversationCount[0]?.c ?? 0,
    agentConversations: agentConversationCount[0]?.c ?? 0,
    messages: messageCount[0]?.c ?? 0,
    drafts: draftCount[0]?.c ?? 0,
    scheduled: scheduledCount[0]?.c ?? 0,
    published: publishedCount[0]?.c ?? 0,
    heygenByStatus: heygenByStatus.reduce<Record<string, number>>(
      (acc, r) => {
        acc[r.status] = r.c;
        return acc;
      },
      {},
    ),
    clientContexts: clientContextCount[0]?.c ?? 0,
    voiceAudit7d: voiceAuditRecent[0]?.c ?? 0,
    brandAnalyses: brandAnalysisCount[0]?.c ?? 0,
    signups7d: last7Signups[0]?.c ?? 0,
    drafts7d: last7Drafts[0]?.c ?? 0,
    published7d: last7Published[0]?.c ?? 0,
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
