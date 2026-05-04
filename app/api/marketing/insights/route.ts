import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';

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

  // projectId is currently unused — performance memory aggregates across
  // every post the user has rated, not per-project. We accept the param
  // for forward-compat with multi-project filtering.
  const { searchParams } = new URL(request.url);
  void searchParams.get('projectId');

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
    .where(
      and(
        eq(scheduledPosts.userId, user.id),
        isNotNull(scheduledPosts.performanceRating)
      )
    );

  if (ratedPosts.length < MIN_RATED_FOR_INSIGHTS) {
    return NextResponse.json({
      sufficient: false,
      hint: `Need at least ${MIN_RATED_FOR_INSIGHTS} rated posts to derive insights. You have ${ratedPosts.length}.`,
      ratedCount: ratedPosts.length,
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

  // Edge: if all ratings are one-sided, Opus pattern analysis is meaningless
  // (no contrast). Return stats without patterns and let the UI handle it.
  if (worked.length === 0 || flopped.length === 0) {
    return NextResponse.json({
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
  });
}
