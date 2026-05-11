// PR #62 — Sprint 7.0.5: auto-connect high-confidence sources from
// the latest brand_analysis row.
//
// Rules (respecting Sprint 7.0.3's RSS rate-limit contract):
//   - Only sources with predictedRelevance >= 80
//   - MAX 5 auto-connections per call (1 RSS fetch/day each ≤ 5/day
//     for the project → well inside Reddit's tolerance)
//   - Reddit sources are SKIPPED unless research_config.redditRssOptin
//     is true. The founder explicitly opted into the RSS contract;
//     no auto-add without consent.
//   - Sources the founder previously skipped stay skipped — we never
//     resurrect a skipped row automatically.
//   - YouTube channels go through too (no opt-in flag yet — the
//     YOUTUBE_API_KEY env var is opt-in at deploy level).
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  brandAnalysis,
  researchConfig,
  sourceDirectory,
  projectSources,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_AUTO_CONNECT = 5;
const HIGH_CONFIDENCE_THRESHOLD = 80;

interface SuggestedSource {
  platform: string;
  identifier: string;
  predictedRelevance: number;
  reasoning: string;
}

interface ConnectResult {
  source: string;
  platform: string;
  relevance: number;
  status: 'connected' | 'already_connected' | 'skipped_previously' | 'skipped_optin' | 'error';
  reason?: string;
}

function normalizeRedditIdentifier(input: string): string {
  return input
    .replace(/^https?:\/\/(www\.)?reddit\.com\//i, '')
    .replace(/^\/?r\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9_]/gi, '')
    .toLowerCase()
    .trim();
}

function normalizeYouTubeIdentifier(input: string): string {
  return input
    .replace(/^https?:\/\/(www\.)?youtube\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .trim();
}

function buildSourceUrl(platform: string, identifier: string): string {
  if (platform === 'reddit') {
    return `https://www.reddit.com/r/${identifier}/`;
  }
  if (platform === 'youtube') {
    return `https://www.youtube.com/@${identifier}`;
  }
  return '';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { projectId?: string };
  try {
    body = (await request.json()) as { projectId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }

  const [analysis] = await db
    .select({
      id: brandAnalysis.id,
      suggestedSources: brandAnalysis.suggestedSources,
    })
    .from(brandAnalysis)
    .where(eq(brandAnalysis.projectId, projectId))
    .orderBy(desc(brandAnalysis.createdAt))
    .limit(1);

  if (!analysis) {
    return NextResponse.json(
      {
        error: 'No brand analysis found',
        hint: 'Run Brand Analysis first.',
        action: 'analyze-brand',
      },
      { status: 400 },
    );
  }

  const [config] = await db
    .select({ optin: researchConfig.redditRssOptin })
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);
  const redditOptin = Boolean(config?.optin);

  const suggestedRaw = (analysis.suggestedSources as unknown[]) ?? [];
  const candidates: SuggestedSource[] = [];
  for (const s of suggestedRaw) {
    if (!s || typeof s !== 'object') continue;
    const obj = s as Record<string, unknown>;
    const platform = typeof obj.platform === 'string' ? obj.platform.toLowerCase() : '';
    const rawIdent = typeof obj.identifier === 'string' ? obj.identifier : '';
    const relevance = Math.round(Number(obj.predictedRelevance) || 0);
    const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
    if (!platform || !rawIdent) continue;
    if (relevance < HIGH_CONFIDENCE_THRESHOLD) continue;
    candidates.push({ platform, identifier: rawIdent, predictedRelevance: relevance, reasoning });
  }

  // Sort by relevance descending so the top N are the strongest.
  candidates.sort((a, b) => b.predictedRelevance - a.predictedRelevance);

  const results: ConnectResult[] = [];
  let connectedCount = 0;

  for (const candidate of candidates) {
    if (connectedCount >= MAX_AUTO_CONNECT) break;

    // Reddit opt-in gate — non-fatal, just skip.
    if (candidate.platform === 'reddit' && !redditOptin) {
      results.push({
        source: candidate.identifier,
        platform: candidate.platform,
        relevance: candidate.predictedRelevance,
        status: 'skipped_optin',
        reason: 'Reddit RSS opt-in required',
      });
      continue;
    }

    // Normalize identifier per platform so the same source isn't
    // re-created as a duplicate row.
    let identifier = candidate.identifier;
    let displayName = candidate.identifier;
    let url = '';
    if (candidate.platform === 'reddit') {
      const norm = normalizeRedditIdentifier(candidate.identifier);
      if (!norm || norm.length < 2 || norm.length > 50) {
        results.push({
          source: candidate.identifier,
          platform: candidate.platform,
          relevance: candidate.predictedRelevance,
          status: 'error',
          reason: 'Invalid subreddit name',
        });
        continue;
      }
      identifier = norm;
      displayName = `r/${norm}`;
      url = buildSourceUrl('reddit', norm);
    } else if (candidate.platform === 'youtube') {
      const norm = normalizeYouTubeIdentifier(candidate.identifier);
      if (!norm) {
        results.push({
          source: candidate.identifier,
          platform: candidate.platform,
          relevance: candidate.predictedRelevance,
          status: 'error',
          reason: 'Invalid channel name',
        });
        continue;
      }
      identifier = norm;
      displayName = `@${norm}`;
      url = buildSourceUrl('youtube', norm);
    } else {
      // Other platforms — best effort
      url = `https://${candidate.platform}`;
    }

    try {
      // Find-or-create the directory row.
      let [source] = await db
        .select()
        .from(sourceDirectory)
        .where(
          and(
            eq(sourceDirectory.platform, candidate.platform),
            eq(sourceDirectory.identifier, identifier),
          ),
        )
        .limit(1);

      if (!source) {
        const inserted = await db
          .insert(sourceDirectory)
          .values({
            platform: candidate.platform,
            identifier,
            displayName,
            url,
            description: candidate.reasoning || null,
            metadata: { autoConnectedAt: new Date().toISOString() },
            lastVerified: new Date(),
          })
          .onConflictDoNothing({
            target: [sourceDirectory.platform, sourceDirectory.identifier],
          })
          .returning();
        if (inserted.length > 0) {
          source = inserted[0];
        } else {
          // Race with another caller — refetch.
          const [again] = await db
            .select()
            .from(sourceDirectory)
            .where(
              and(
                eq(sourceDirectory.platform, candidate.platform),
                eq(sourceDirectory.identifier, identifier),
              ),
            )
            .limit(1);
          if (!again) {
            results.push({
              source: candidate.identifier,
              platform: candidate.platform,
              relevance: candidate.predictedRelevance,
              status: 'error',
              reason: 'directory row missing',
            });
            continue;
          }
          source = again;
        }
      }

      // Check existing project-source row.
      const [existing] = await db
        .select()
        .from(projectSources)
        .where(
          and(
            eq(projectSources.projectId, projectId),
            eq(projectSources.sourceId, source.id),
          ),
        )
        .limit(1);

      if (existing) {
        if (existing.status === 'connected') {
          results.push({
            source: displayName,
            platform: candidate.platform,
            relevance: candidate.predictedRelevance,
            status: 'already_connected',
          });
          continue;
        }
        if (existing.status === 'skipped') {
          // Don't override a founder decision.
          results.push({
            source: displayName,
            platform: candidate.platform,
            relevance: candidate.predictedRelevance,
            status: 'skipped_previously',
          });
          continue;
        }
        // 'suggested' → flip to connected.
        await db
          .update(projectSources)
          .set({
            status: 'connected',
            connectedAt: new Date(),
            signalScore: candidate.predictedRelevance,
          })
          .where(eq(projectSources.id, existing.id));
        results.push({
          source: displayName,
          platform: candidate.platform,
          relevance: candidate.predictedRelevance,
          status: 'connected',
        });
        connectedCount++;
        continue;
      }

      // Brand-new — insert.
      await db.insert(projectSources).values({
        projectId,
        userId: user.id,
        sourceId: source.id,
        status: 'connected',
        connectedAt: new Date(),
        signalScore: candidate.predictedRelevance,
      });
      results.push({
        source: displayName,
        platform: candidate.platform,
        relevance: candidate.predictedRelevance,
        status: 'connected',
      });
      connectedCount++;
    } catch (e) {
      console.error('[auto-connect] failed for', candidate.identifier, e);
      results.push({
        source: candidate.identifier,
        platform: candidate.platform,
        relevance: candidate.predictedRelevance,
        status: 'error',
        reason: e instanceof Error ? e.message.slice(0, 100) : 'unknown',
      });
    }
  }

  const skippedOptin = results.filter((r) => r.status === 'skipped_optin').length;

  return NextResponse.json({
    success: true,
    autoConnected: connectedCount,
    cap: MAX_AUTO_CONNECT,
    threshold: HIGH_CONFIDENCE_THRESHOLD,
    redditOptin,
    rateLimitNote: `Auto-connect respects the Reddit RSS rate limit (1× per subreddit per 24h). Cap of ${MAX_AUTO_CONNECT} per call.`,
    skippedOptinHint:
      skippedOptin > 0
        ? 'Some Reddit suggestions were skipped because RSS opt-in is off. Enable it on /research/sources to include them.'
        : null,
    results,
  });
}
