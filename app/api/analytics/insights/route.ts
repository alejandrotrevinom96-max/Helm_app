// PR #83 — Sprint 7.8: AI-generated weekly insights for /analytics.
//
// One Haiku 4.5 call that takes the current dashboard metrics and
// returns 2–3 short, actionable items the founder can act on right
// now from inside Helm. Lives at the top of /analytics as a "This
// week" strip; the client fetches on mount with a skeleton, and a
// failure renders nothing (the page degrades to plain widgets).
//
// Why Haiku (not Opus): the prompt is short, the output is short,
// the call is per-page-load. Opus would cost ~10x without changing
// the quality of "you have 4 posts, generate more". The model
// budget here is "fast and free-ish".
//
// Perf fix (Sprint 7.20) — DB-backed 24h cache.
//   Pre-fix this endpoint ran a fresh Haiku call on every render
//   of /analytics (~9.5s wall-clock blocking the strip). Now we
//   check `analytics_insights_cache` keyed on (userId,
//   projectsHash, expiresAt > now()) before generating. On miss
//   the AI runs as before and we upsert the result with a 24h
//   TTL. The hash is sha256 of the sorted project IDs so
//   adding/removing a project invalidates the cache naturally;
//   bare metric changes don't (a 24h cadence on actionable
//   bullets is fine — the underlying numbers update live in the
//   widgets below).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  scheduledPosts,
  researchFindings,
  waitlistResponses,
  waitlistPages,
  metricSnapshots,
  analyticsInsightsCache,
} from '@/lib/db/schema';
import { eq, and, gte, lt, count, inArray, desc } from 'drizzle-orm';
import { createHash } from 'crypto';
import {
  anthropic,
  MODELS,
  cachedSystem,
  LANGUAGE_INSTRUCTION_ANALYSIS,
} from '@/lib/ai/claude';

export const maxDuration = 30;

type InsightKind = 'up' | 'down' | 'neutral';

interface Insight {
  type: InsightKind;
  text: string;
}

function cleanJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function asInsight(v: unknown): Insight | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (!text) return null;
  const typeRaw = typeof o.type === 'string' ? o.type.toLowerCase() : 'neutral';
  const type: InsightKind =
    typeRaw === 'up' || typeRaw === 'down' || typeRaw === 'neutral'
      ? (typeRaw as InsightKind)
      : 'neutral';
  return { type, text: text.slice(0, 200) };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve the user's projects so the metrics aggregate matches
  // what /analytics renders in "All projects" mode. The insights
  // strip is currently global-scoped; per-project insights would
  // need the same scope param the dashboard uses (PR #18).
  const userProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, user.id));
  const projectIds = userProjects.map((p) => p.id);

  if (projectIds.length === 0) {
    return NextResponse.json({ insights: [] });
  }

  // Cache key — sorted IDs hashed so order doesn't matter and the
  // set itself is the input. Read first; if we have a fresh row
  // (expiresAt > now) the founder gets the cached bullets
  // instantly and we never touch Anthropic.
  const projectsHash = createHash('sha256')
    .update([...projectIds].sort().join(','))
    .digest('hex')
    .slice(0, 32);

  const now = new Date();
  const cached = await db
    .select({
      insights: analyticsInsightsCache.insights,
      expiresAt: analyticsInsightsCache.expiresAt,
    })
    .from(analyticsInsightsCache)
    .where(
      and(
        eq(analyticsInsightsCache.userId, user.id),
        eq(analyticsInsightsCache.projectsHash, projectsHash),
        gte(analyticsInsightsCache.expiresAt, now),
      ),
    )
    .limit(1);

  if (cached[0]) {
    // Defensive: the column is jsonb so it round-trips as the
    // same Insight[] shape, but treat it as unknown until we
    // confirm.
    const insights = Array.isArray(cached[0].insights)
      ? (cached[0].insights as Insight[])
      : [];
    return NextResponse.json({ insights, cached: true });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);

  // Run the 6 count queries in parallel — each is a tiny COUNT(*)
  // over an indexed column, so total wall-clock is the slowest one
  // (~50ms typically).
  const userPagesPromise = db
    .select({ id: waitlistPages.id })
    .from(waitlistPages)
    .where(inArray(waitlistPages.projectId, projectIds));

  const [userPages] = await Promise.all([userPagesPromise]);
  const pageIds = userPages.map((p) => p.id);

  const [
    postsThisWeekRes,
    postsLastWeekRes,
    researchTotalRes,
    waitlistTotalRes,
    latestSupabaseSnapshot,
    latestVisitorsSnapshot,
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.userId, user.id),
          gte(scheduledPosts.scheduledFor, sevenDaysAgo),
        ),
      ),
    db
      .select({ count: count() })
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.userId, user.id),
          gte(scheduledPosts.scheduledFor, fourteenDaysAgo),
          lt(scheduledPosts.scheduledFor, sevenDaysAgo),
        ),
      ),
    db
      .select({ count: count() })
      .from(researchFindings)
      .where(inArray(researchFindings.projectId, projectIds)),
    pageIds.length > 0
      ? db
          .select({ count: count() })
          .from(waitlistResponses)
          .where(inArray(waitlistResponses.waitlistPageId, pageIds))
      : Promise.resolve([{ count: 0 }] as { count: number }[]),
    db
      .select({ value: metricSnapshots.value })
      .from(metricSnapshots)
      .where(
        and(
          inArray(metricSnapshots.projectId, projectIds),
          eq(metricSnapshots.source, 'supabase'),
        ),
      )
      .orderBy(desc(metricSnapshots.date))
      .limit(1),
    db
      .select({ value: metricSnapshots.value })
      .from(metricSnapshots)
      .where(
        and(
          inArray(metricSnapshots.projectId, projectIds),
          eq(metricSnapshots.source, 'vercel'),
        ),
      )
      .orderBy(desc(metricSnapshots.date))
      .limit(1),
  ]);

  const metrics = {
    postsThisWeek: Number(postsThisWeekRes[0]?.count ?? 0),
    postsLastWeek: Number(postsLastWeekRes[0]?.count ?? 0),
    researchFindings: Number(researchTotalRes[0]?.count ?? 0),
    waitlistSignups: Number(waitlistTotalRes[0]?.count ?? 0),
    users: Number(latestSupabaseSnapshot[0]?.value ?? 0),
    visitors: Number(latestVisitorsSnapshot[0]?.value ?? 0),
  };

  // Refuse to call the model if every metric is zero — the founder
  // has nothing to act on yet, and the empty-state cards on the
  // page already tell them what to set up first. Returning an empty
  // array lets the client hide the strip.
  const everyZero = Object.values(metrics).every((n) => n === 0);
  if (everyZero) {
    return NextResponse.json({ insights: [] });
  }

  const systemPrompt = `You are analyzing marketing analytics for a founder using Helm (a marketing OS — drafting, publishing, research, strategy in one workspace).

Generate EXACTLY 2 or 3 short, actionable insights. Each insight MUST:
- Reference a specific number from the data
- Suggest one concrete action the founder can take RIGHT NOW inside Helm
- Be max 15 words

Return STRICT JSON only — a top-level array, no markdown fences:
[
  { "type": "up" | "down" | "neutral", "text": "..." },
  ...
]

Tone examples (don't echo verbatim — adapt to the user's actual numbers):
- "4 posts published this week — up 3x. Keep the momentum, generate more from Research."
- "2 research findings waiting. Turn them into posts before they go cold."
- "No waitlist responses yet. Add a CTA to your next post to drive signups."

${LANGUAGE_INSTRUCTION_ANALYSIS}`;

  const userMessage = `Current metrics for this founder:
- Posts published this week: ${metrics.postsThisWeek}
- Posts published the previous week: ${metrics.postsLastWeek}
- Research findings (all-time): ${metrics.researchFindings}
- Waitlist signups (all-time): ${metrics.waitlistSignups}
- Users (latest Supabase snapshot): ${metrics.users}
- Visitors (latest Vercel snapshot): ${metrics.visitors}

Return 2–3 insights now. JSON only.`;

  try {
    const response = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 500,
      system: cachedSystem(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });

    if (response.stop_reason === 'max_tokens') {
      console.warn('[analytics-insights] Haiku hit max_tokens — truncated');
      return NextResponse.json({ insights: [] });
    }

    const block = response.content.find((b) => b.type === 'text');
    const raw = block?.type === 'text' ? block.text : '';
    const parsed = JSON.parse(cleanJson(raw));
    if (!Array.isArray(parsed)) {
      return NextResponse.json({ insights: [] });
    }
    const insights = parsed
      .map(asInsight)
      .filter((v): v is Insight => v !== null)
      .slice(0, 3);

    // Persist the freshly generated insights with a 24h TTL.
    // We upsert on (userId, projectsHash) so a re-generation
    // overwrites the existing row rather than piling up history.
    // Failures here are non-fatal: the founder gets their
    // bullets back even if the cache write hiccups.
    if (insights.length > 0) {
      try {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db
          .insert(analyticsInsightsCache)
          .values({
            userId: user.id,
            projectsHash,
            insights,
            generatedAt: now,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [
              analyticsInsightsCache.userId,
              analyticsInsightsCache.projectsHash,
            ],
            set: {
              insights,
              generatedAt: now,
              expiresAt,
            },
          });
      } catch (cacheErr) {
        console.warn(
          '[analytics-insights] cache write failed:',
          cacheErr,
        );
      }
    }

    return NextResponse.json({ insights });
  } catch (err) {
    console.error('[analytics-insights] generation failed:', err);
    // Fail silently — the client treats empty insights array as
    // "hide the strip", which is the best UX for a transient
    // Anthropic blip.
    return NextResponse.json({ insights: [] });
  }
}
