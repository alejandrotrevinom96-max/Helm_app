import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  generatedPosts,
  projects,
  scheduledPosts,
} from '@/lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';
import { isVoiceFingerprint } from '@/lib/types/voice';

// Threshold for the legacy Opus pattern analysis. Stays at 5
// across both voice and performance signals so the UI's
// "confidence: building" copy lines up with the prompt's
// learning floor.
const MIN_RATED_FOR_INSIGHTS = 5;

interface Pattern {
  type: 'voice' | 'structure' | 'topic' | 'length' | 'platform' | 'score_dimension';
  observation: string;
  evidence: string;
  actionable: string;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  // PR #49 — Sprint 6.8: voice block. Aggregate the in-app
  // feedback signals (likes/dislikes on drafts) plus the
  // project's voice fingerprint status, so the Generate page
  // can render two cards side by side ("Voice memory" +
  // "Performance memory") with separate confidence indicators.
  // Scoped to projectId when provided so a multi-project user
  // sees per-project learning, not a blended user-wide stat.
  let voiceLikes = 0;
  let voiceDislikes = 0;
  let voiceFingerprintQuotesCount = 0;
  let voiceHasFingerprint = false;
  let voiceFingerprintUpdatedAt: string | null = null;
  if (projectId) {
    const [project] = await db
      .select({
        id: projects.id,
        voiceFingerprint: projects.voiceFingerprint,
        voiceFingerprintUpdatedAt: projects.voiceFingerprintUpdatedAt,
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);
    // PR #55 — Sprint 6.9: refuse with 403 when the user passed
    // a projectId they don't own. Pre-PR-55 we silently returned
    // the empty/zero shape, which was technically not a data
    // leak but it differed from /quotes /library which return 403
    // for the same input. The inconsistency made it harder to
    // tell from a network log whether an ownership check ran.
    if (!project) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const draftRows = await db
      .select({ userVote: generatedPosts.userVote })
      .from(generatedPosts)
      .where(eq(generatedPosts.projectId, projectId));
    voiceLikes = draftRows.filter((r) => r.userVote === 'liked').length;
    voiceDislikes = draftRows.filter(
      (r) => r.userVote === 'disliked'
    ).length;
    const fp = project.voiceFingerprint as unknown;
    if (fp && isVoiceFingerprint(fp)) {
      voiceHasFingerprint = true;
      voiceFingerprintQuotesCount = fp.sourceQuotesCount;
    }
    voiceFingerprintUpdatedAt =
      project.voiceFingerprintUpdatedAt?.toISOString() ?? null;
  }
  const voiceTotalVotes = voiceLikes + voiceDislikes;
  const voiceConfidence: 'building' | 'not enough data' =
    voiceTotalVotes >= MIN_RATED_FOR_INSIGHTS ? 'building' : 'not enough data';

  const voiceBlock = {
    totalLikes: voiceLikes,
    totalDislikes: voiceDislikes,
    confidence: voiceConfidence,
    hasFingerprint: voiceHasFingerprint,
    fingerprintQuotesCount: voiceFingerprintQuotesCount,
    fingerprintUpdatedAt: voiceFingerprintUpdatedAt,
  };

  // Performance block — existing logic, scoped to projectId when
  // provided. (Pre-PR-49 the rated posts query crossed projects
  // for the same user; that was acceptable when most users had
  // one project, less so now.)
  const ratedFilters = [
    eq(scheduledPosts.userId, user.id),
    isNotNull(scheduledPosts.performanceRating),
  ];
  if (projectId) {
    ratedFilters.push(eq(scheduledPosts.projectId, projectId));
  }
  const ratedPosts = await db
    .select({
      content: scheduledPosts.content,
      platform: scheduledPosts.platform,
      consistencyScore: scheduledPosts.consistencyScore,
      scoreBreakdown: scheduledPosts.scoreBreakdown,
      performanceRating: scheduledPosts.performanceRating,
      performanceNote: scheduledPosts.performanceNote,
    })
    .from(scheduledPosts)
    .where(and(...ratedFilters));

  // PR #49 — Sprint 6.8: response now includes a `voice` block
  // and an `overall` block on every branch. Legacy fields
  // (`sufficient`, `ratedCount`, etc.) preserved at top level so
  // the existing PerformanceInsights component keeps rendering.

  if (ratedPosts.length < MIN_RATED_FOR_INSIGHTS) {
    // PR #53 — Sprint 6.8.4: compute totalWorked/totalFlopped
    // even in the below-threshold branch. Pre-PR-53 we hardcoded
    // both to 0 here, which gave the misleading response
    // {ratedCount: 2, totalWorked: 0, totalFlopped: 0} to the
    // dual-cards UI — the founder saw "0 worked" right after
    // rating two posts as worked. Confidence stays
    // 'not enough data' below the 5-rating threshold, but the
    // raw counts are now honest.
    const earlyWorked = ratedPosts.filter(
      (p) => p.performanceRating === 'worked'
    ).length;
    const earlyFlopped = ratedPosts.filter(
      (p) => p.performanceRating === 'flopped'
    ).length;
    const performanceBlock: {
      totalWorked: number;
      totalFlopped: number;
      ratedCount: number;
      confidence: 'building' | 'not enough data';
    } = {
      totalWorked: earlyWorked,
      totalFlopped: earlyFlopped,
      ratedCount: ratedPosts.length,
      confidence: 'not enough data',
    };
    return NextResponse.json({
      // Legacy top-level (back-compat with PerformanceInsights).
      sufficient: false,
      hint: `Need at least ${MIN_RATED_FOR_INSIGHTS} rated posts to derive insights. You have ${ratedPosts.length}.`,
      ratedCount: ratedPosts.length,
      // New dual-learning blocks.
      voice: voiceBlock,
      performance: performanceBlock,
      overall: {
        fullyOperational:
          voiceConfidence === 'building' &&
          performanceBlock.confidence === 'building',
      },
    });
  }

  const worked = ratedPosts.filter((p) => p.performanceRating === 'worked');
  const flopped = ratedPosts.filter((p) => p.performanceRating === 'flopped');

  const workedAvgScore = worked.length
    ? worked.reduce((s, p) => s + (p.consistencyScore ?? 0), 0) / worked.length
    : 0;
  const floppedAvgScore = flopped.length
    ? flopped.reduce((s, p) => s + (p.consistencyScore ?? 0), 0) / flopped.length
    : 0;

  // Performance block built once for both the one-sided and the
  // contrast paths. By the time this branch runs we've already
  // returned for ratedPosts.length < MIN_RATED_FOR_INSIGHTS, so
  // confidence is always 'building' here. Type widened to the
  // shared literal union so the legacy early-return path and
  // this one share a structural shape downstream.
  const performanceBlock: {
    totalWorked: number;
    totalFlopped: number;
    ratedCount: number;
    confidence: 'building' | 'not enough data';
  } = {
    totalWorked: worked.length,
    totalFlopped: flopped.length,
    ratedCount: ratedPosts.length,
    confidence: 'building',
  };
  const overallBlock = {
    fullyOperational:
      voiceConfidence === 'building' &&
      performanceBlock.confidence === 'building',
  };

  // Edge: if all ratings are one-sided, Opus pattern analysis is meaningless
  // (no contrast). Return stats without patterns and let the UI handle it.
  if (worked.length === 0 || flopped.length === 0) {
    return NextResponse.json({
      // Legacy top-level.
      sufficient: true,
      ratedCount: ratedPosts.length,
      workedCount: worked.length,
      floppedCount: flopped.length,
      workedAvgScore: Math.round(workedAvgScore),
      floppedAvgScore: Math.round(floppedAvgScore),
      patterns: [],
      summary:
        worked.length === 0
          ? 'All rated posts flopped. Rate some that worked to find what differentiates them.'
          : 'All rated posts worked. Keep going — patterns emerge once you have at least one flop.',
      // Dual-learning blocks.
      voice: voiceBlock,
      performance: performanceBlock,
      overall: overallBlock,
    });
  }

  // Trim post content for the prompt — Opus doesn't need full text to spot
  // patterns, and we cap context to keep token cost predictable.
  const formatPost = (p: typeof ratedPosts[number]) =>
    `[${p.platform}] Score: ${p.consistencyScore ?? 'n/a'} | ${p.content
      .slice(0, 200)
      .replace(/\s+/g, ' ')} | Note: ${p.performanceNote ?? 'none'}`;

  const analysisPrompt = `You are a brand performance analyst. The following are posts rated by their author as either "worked" or "flopped". Identify clear patterns.

WORKED POSTS (${worked.length}):
${worked.map(formatPost).join('\n\n')}

FLOPPED POSTS (${flopped.length}):
${flopped.map(formatPost).join('\n\n')}

Identify 3-5 specific patterns that distinguish worked from flopped. Be concrete. Output STRICTLY valid JSON, no markdown:

{
  "patterns": [
    {
      "type": "voice" | "structure" | "topic" | "length" | "platform" | "score_dimension",
      "observation": "Specific observation",
      "evidence": "Quote or data that supports this",
      "actionable": "What to do differently"
    }
  ],
  "summary": "1-2 sentence overall takeaway"
}`;

  const baseStats = {
    sufficient: true as const,
    ratedCount: ratedPosts.length,
    workedCount: worked.length,
    floppedCount: flopped.length,
    workedAvgScore: Math.round(workedAvgScore),
    floppedAvgScore: Math.round(floppedAvgScore),
  };

  let parsed: { patterns?: Pattern[]; summary?: string };
  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 3000,
      messages: [{ role: 'user', content: analysisPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    let raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(raw) as { patterns?: Pattern[]; summary?: string };
  } catch {
    return NextResponse.json({
      ...baseStats,
      patterns: [],
      summary: '',
      error: 'Pattern analysis failed',
    });
  }

  return NextResponse.json({
    ...baseStats,
    patterns: parsed.patterns ?? [],
    summary: parsed.summary ?? '',
    // PR #49 — Sprint 6.8: dual-learning blocks alongside legacy
    // pattern analysis. Fully-rated path; both confidences are
    // 'building' if voice has 5+ votes and performance has 5+
    // ratings.
    voice: voiceBlock,
    performance: performanceBlock,
    overall: overallBlock,
  });
}
