// PR Sprint 7.14 — Feedback memory loader + prompt blocks.
//
// Extracted from app/api/ai/generate-post/route.ts so the
// structured-draft pipeline (/api/ai/generate-structured) can
// inject the SAME Voice Memory + Performance Memory signals into
// its system prompt. Pre-Sprint-7.14 only the legacy
// pillar-variants generator consumed these blocks; the new
// structured generator (which the founder actually uses via
// /marketing/generate) silently ignored every 👍/👎 / worked /
// flopped signal the UI captured.
//
// Dual learning architecture (preserved from PR #49 — Sprint 6.8):
//   - VOICE signals (Brand Bible + Voice Fingerprint + Voice
//     Memory) tell the model HOW to write.
//   - PERFORMANCE signals (Performance Memory from rated
//     published posts) tell the model WHAT to write about.
//   - The DUAL_LEARNING_GUIDANCE block makes the separation
//     explicit so Claude doesn't conflate "this style worked"
//     with "this style sounds like the founder."
//
// Tolerant of empty inputs: each builder emits a "not enough
// data yet" stub instead of an empty section, keeping prompt
// structure stable across projects with zero / partial / full
// learning history. Thresholds (5 votes / 5 ratings) match the
// confidence indicators in the Generate page's "Voice memory"
// + "Performance memory" cards so the UI and the prompt agree
// about when learning kicks in.

import { db } from '@/lib/db';
import { generatedPosts, scheduledPosts } from '@/lib/db/schema';
import { eq, and, desc, isNotNull } from 'drizzle-orm';

export const VOICE_MEMORY_THRESHOLD = 5;
export const PERFORMANCE_THRESHOLD = 5;
export const VOICE_MEMORY_LIMIT = 10;
export const PERFORMANCE_LIMIT = 10;

export interface VotedDraftRow {
  content: string;
  votedAt: Date | null;
}

export interface RatedScheduledRow {
  content: string;
  performanceRating: string | null;
  performanceNote: string | null;
  metricsImpressions: number | null;
  metricsLikes: number | null;
  metricsComments: number | null;
  metricsShares: number | null;
  ratedAt: Date | null;
}

const truncate = (s: string, n = 200): string =>
  s.length > n ? s.slice(0, n) + '…' : s;

// ============================================================
// Loaders — single round trip each. The caller runs them in
// parallel via Promise.all.
// ============================================================

export async function loadVoiceMemory(
  projectId: string,
): Promise<{ liked: VotedDraftRow[]; disliked: VotedDraftRow[] }> {
  const [liked, disliked] = await Promise.all([
    db
      .select({
        content: generatedPosts.content,
        votedAt: generatedPosts.votedAt,
      })
      .from(generatedPosts)
      .where(
        and(
          eq(generatedPosts.projectId, projectId),
          eq(generatedPosts.userVote, 'liked'),
        ),
      )
      .orderBy(desc(generatedPosts.votedAt))
      .limit(VOICE_MEMORY_LIMIT),
    db
      .select({
        content: generatedPosts.content,
        votedAt: generatedPosts.votedAt,
      })
      .from(generatedPosts)
      .where(
        and(
          eq(generatedPosts.projectId, projectId),
          eq(generatedPosts.userVote, 'disliked'),
        ),
      )
      .orderBy(desc(generatedPosts.votedAt))
      .limit(VOICE_MEMORY_LIMIT),
  ]);
  return { liked, disliked };
}

export async function loadPerformanceMemory(
  projectId: string,
): Promise<RatedScheduledRow[]> {
  return db
    .select({
      content: scheduledPosts.content,
      performanceRating: scheduledPosts.performanceRating,
      performanceNote: scheduledPosts.performanceNote,
      metricsImpressions: scheduledPosts.metricsImpressions,
      metricsLikes: scheduledPosts.metricsLikes,
      metricsComments: scheduledPosts.metricsComments,
      metricsShares: scheduledPosts.metricsShares,
      ratedAt: scheduledPosts.ratedAt,
    })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.projectId, projectId),
        isNotNull(scheduledPosts.performanceRating),
      ),
    )
    .orderBy(desc(scheduledPosts.ratedAt))
    .limit(PERFORMANCE_LIMIT * 2);
}

// ============================================================
// Prompt blocks. Tolerant of empty inputs — they emit a
// "not-enough-data" stub so the prompt structure stays stable.
// ============================================================

export function buildVoiceMemoryBlock(
  liked: VotedDraftRow[],
  disliked: VotedDraftRow[],
): string {
  const total = liked.length + disliked.length;
  if (total < VOICE_MEMORY_THRESHOLD) {
    return `## VOICE MEMORY

Not enough draft feedback yet (${total}/${VOICE_MEMORY_THRESHOLD} votes needed before patterns can be inferred). Use Brand Bible voice settings only for now.`;
  }
  const parts: string[] = [
    '## VOICE MEMORY (founder feedback on previous AI drafts)',
    '',
    'When generating new drafts, lean toward LIKED structural patterns (opening style, hook shape, length, emoji usage, question types) and avoid DISLIKED patterns. These are about HOW to write — not WHAT to write about.',
  ];
  if (liked.length > 0) {
    parts.push('');
    parts.push('Liked drafts (mimic the structure, tone, length):');
    liked.forEach((d, i) => {
      parts.push(`  Liked #${i + 1}: "${truncate(d.content)}"`);
    });
  }
  if (disliked.length > 0) {
    parts.push('');
    parts.push('Disliked drafts (avoid these patterns):');
    disliked.forEach((d, i) => {
      parts.push(`  Disliked #${i + 1}: "${truncate(d.content)}"`);
    });
  }
  return parts.join('\n');
}

export function buildPerformanceBlock(rows: RatedScheduledRow[]): string {
  const worked = rows.filter((r) => r.performanceRating === 'worked');
  const flopped = rows.filter((r) => r.performanceRating === 'flopped');
  const total = worked.length + flopped.length;
  if (total < PERFORMANCE_THRESHOLD) {
    return `## PERFORMANCE LEARNING

Not enough rated published posts yet (${total}/${PERFORMANCE_THRESHOLD} ratings needed before topic-level patterns can be inferred). Use Brand Bible pillars only for topic selection.`;
  }
  const renderMetrics = (r: RatedScheduledRow): string => {
    const m: string[] = [];
    if (r.metricsImpressions != null) m.push(`reach=${r.metricsImpressions}`);
    if (r.metricsLikes != null) m.push(`likes=${r.metricsLikes}`);
    if (r.metricsComments != null) m.push(`comments=${r.metricsComments}`);
    if (r.metricsShares != null) m.push(`shares=${r.metricsShares}`);
    return m.join(', ');
  };
  const parts: string[] = [
    '## PERFORMANCE LEARNING (real-world feedback from published posts)',
    '',
    'When generating new posts, prioritize TOPICS and ANGLES similar to WORKED posts. Avoid TOPICS and ANGLES similar to FLOPPED posts. These are about WHAT to write about — not HOW to write.',
  ];
  if (worked.length > 0) {
    parts.push('');
    parts.push('Worked (replicate these angles/topics):');
    worked.slice(0, PERFORMANCE_LIMIT).forEach((r, i) => {
      const metrics = renderMetrics(r);
      parts.push(`  Worked #${i + 1}: "${truncate(r.content, 150)}"`);
      if (r.performanceNote)
        parts.push(`    Why it worked: ${r.performanceNote}`);
      if (metrics) parts.push(`    Metrics: ${metrics}`);
    });
  }
  if (flopped.length > 0) {
    parts.push('');
    parts.push('Flopped (avoid these angles/topics):');
    flopped.slice(0, PERFORMANCE_LIMIT).forEach((r, i) => {
      parts.push(`  Flopped #${i + 1}: "${truncate(r.content, 150)}"`);
      if (r.performanceNote)
        parts.push(`    Why it flopped: ${r.performanceNote}`);
    });
  }
  return parts.join('\n');
}

export const DUAL_LEARNING_GUIDANCE = `## DUAL LEARNING SIGNAL ARCHITECTURE

You receive TWO different signal types above. Treat them separately:

🎨 VOICE signals (Brand Bible + Voice Fingerprint + Voice Memory):
   These tell you HOW to write — structure, tone, length, hooks, vocabulary.
   Honor them strictly: the founder has chosen this voice.

📊 PERFORMANCE signals (Performance Learning):
   These tell you WHAT to write about — topics, angles, framing.
   Use them for topic selection and angle bias.

Optimize for BOTH simultaneously: write in the founder's authentic voice ABOUT topics that have validated performance. Each draft should feel like the founder wrote it about a topic that resonates with their audience.

If you only have one signal type (e.g. lots of voice data, no performance data), use the available signal and don't compensate by mixing.`;

// ============================================================
// One-shot: load both memories + render the combined block.
// Convenience wrapper for callers (like the structured-draft
// pipeline) that don't need the raw rows.
// ============================================================

export interface FeedbackMemoryResult {
  block: string;
  hasVoiceData: boolean;
  hasPerformanceData: boolean;
  voiceTotal: number;
  performanceTotal: number;
}

export async function loadFeedbackMemoryBlock(
  projectId: string,
): Promise<FeedbackMemoryResult> {
  const [{ liked, disliked }, rated] = await Promise.all([
    loadVoiceMemory(projectId),
    loadPerformanceMemory(projectId),
  ]);
  const voiceBlock = buildVoiceMemoryBlock(liked, disliked);
  const performanceBlock = buildPerformanceBlock(rated);
  const voiceTotal = liked.length + disliked.length;
  const performanceTotal = rated.filter(
    (r) =>
      r.performanceRating === 'worked' || r.performanceRating === 'flopped',
  ).length;
  return {
    block: [voiceBlock, performanceBlock, DUAL_LEARNING_GUIDANCE].join(
      '\n\n',
    ),
    hasVoiceData: voiceTotal >= VOICE_MEMORY_THRESHOLD,
    hasPerformanceData: performanceTotal >= PERFORMANCE_THRESHOLD,
    voiceTotal,
    performanceTotal,
  };
}
