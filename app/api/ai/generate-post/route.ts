import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  generatedPosts,
  brandQuotes,
  scheduledPosts,
} from '@/lib/db/schema';
import { eq, and, inArray, sql, desc, isNotNull } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { getTemplateById } from '@/lib/marketing/templates';
import {
  computeConsistencyScore,
  type ScoreBreakdown,
} from '@/lib/ai/consistency-score';
import { isVoiceFingerprint } from '@/lib/types/voice';
import type { VoiceFingerprint } from '@/lib/types/voice';
// PR #47 — Sprint 6.7.5: removed `generateVisual` /
// `uploadVisualFromUrl` imports along with the auto-visual
// block they served. Visuals now go exclusively through
// /api/visuals/generate, which both persists to DB and uploads
// to Supabase Storage in one place. See route handler comment
// near the (former) auto-visual block for the full rationale.
import { NextResponse } from 'next/server';
import type { BrandBible, BrandPillar } from '@/lib/types/brand';

// Bumped to 90s because we now (optionally) wait on fal.ai for the
// best-draft visual before responding. Generation without visual still
// finishes in ~10s; with visual usually ~15-20s end-to-end.
export const maxDuration = 90;

const VALID_PLATFORMS = [
  'instagram',
  'facebook',
  'linkedin',
  'threads',
  'reddit',
] as const;
type Platform = (typeof VALID_PLATFORMS)[number];
const VALID_PLATFORM_SET = new Set<Platform>(VALID_PLATFORMS);

function isPlatform(p: unknown): p is Platform {
  return typeof p === 'string' && VALID_PLATFORM_SET.has(p as Platform);
}

// PR #49 — Sprint 6.8: Dual Learning System — context-block
// builders. The generator now consumes FOUR signal types side
// by side, each scoped to a different learning surface:
//
//   1. Brand Bible (existing) — high-level frame.
//   2. Voice Fingerprint — abstract patterns derived from
//      Quote Vault (Opus pass, persisted on projects).
//   3. Voice Memory — recent likes/dislikes (drafts, in-app).
//   4. Performance Memory — worked/flopped published posts
//      (real-world feedback from scheduled_posts).
//
// CRITICAL DESIGN: voice and performance signals are SEPARATE.
// The prompt makes that explicit so Claude doesn't conflate
// "this style worked" with "this style sounds like the founder".
// The two answer different questions.
//
// All builders are tolerant of empty inputs — they emit a "not
// enough data" stub so the prompt structure stays stable across
// projects with zero, partial, and full learning history.

const VOICE_MEMORY_THRESHOLD = 5; // total votes before learning kicks in
const PERFORMANCE_THRESHOLD = 5; // total ratings before learning kicks in
const VOICE_MEMORY_LIMIT = 10; // recent N liked + N disliked
const PERFORMANCE_LIMIT = 10; // recent N worked + N flopped

interface VotedDraftRow {
  content: string;
  votedAt: Date | null;
}

interface RatedScheduledRow {
  content: string;
  performanceRating: string | null;
  performanceNote: string | null;
  metricsImpressions: number | null;
  metricsLikes: number | null;
  metricsComments: number | null;
  metricsShares: number | null;
  ratedAt: Date | null;
}

function buildVoiceFingerprintBlock(
  fingerprint: VoiceFingerprint | null
): string {
  if (!fingerprint) {
    return `## VOICE FINGERPRINT

No voice fingerprint yet. Add 3+ quotes to this project's Quote Vault and Helm will analyze them into abstract voice patterns. Until then, rely on the brand bible voice settings.`;
  }
  const parts: string[] = [
    `## VOICE FINGERPRINT (derived from ${fingerprint.sourceQuotesCount} real quotes)`,
    '',
    'These are ABSTRACT patterns. NEVER copy any phrasing verbatim from the source material — apply the patterns to NEW content.',
  ];
  const sections: Array<[string, string[]]> = [
    ['Structure', fingerprint.structuralPatterns],
    ['Vocabulary', fingerprint.vocabularyTraits],
    ['Signature phrasing', fingerprint.signaturePhrasings],
    ['Tone', fingerprint.toneCharacteristics],
    ['Avoid', fingerprint.avoidPatterns],
  ];
  for (const [label, items] of sections) {
    if (items.length === 0) continue;
    parts.push('');
    parts.push(`${label}:`);
    for (const item of items) parts.push(`  - ${item}`);
  }
  return parts.join('\n');
}

function buildVoiceMemoryBlock(
  liked: VotedDraftRow[],
  disliked: VotedDraftRow[]
): string {
  const total = liked.length + disliked.length;
  if (total < VOICE_MEMORY_THRESHOLD) {
    return `## VOICE MEMORY

Not enough draft feedback yet (${total}/${VOICE_MEMORY_THRESHOLD} votes needed before patterns can be inferred). Use Brand Bible voice settings only for now.`;
  }
  const truncate = (s: string) => (s.length > 200 ? s.slice(0, 200) + '…' : s);
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

function buildPerformanceBlock(rows: RatedScheduledRow[]): string {
  const worked = rows.filter((r) => r.performanceRating === 'worked');
  const flopped = rows.filter((r) => r.performanceRating === 'flopped');
  const total = worked.length + flopped.length;
  if (total < PERFORMANCE_THRESHOLD) {
    return `## PERFORMANCE LEARNING

Not enough rated published posts yet (${total}/${PERFORMANCE_THRESHOLD} ratings needed before topic-level patterns can be inferred). Use Brand Bible pillars only for topic selection.`;
  }
  const truncate = (s: string) => (s.length > 150 ? s.slice(0, 150) + '…' : s);
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
    worked.forEach((r, i) => {
      const metrics = renderMetrics(r);
      parts.push(`  Worked #${i + 1}: "${truncate(r.content)}"`);
      if (r.performanceNote) parts.push(`    Why it worked: ${r.performanceNote}`);
      if (metrics) parts.push(`    Metrics: ${metrics}`);
    });
  }
  if (flopped.length > 0) {
    parts.push('');
    parts.push('Flopped (avoid these angles/topics):');
    flopped.forEach((r, i) => {
      parts.push(`  Flopped #${i + 1}: "${truncate(r.content)}"`);
      if (r.performanceNote) parts.push(`    Why it flopped: ${r.performanceNote}`);
    });
  }
  return parts.join('\n');
}

const DUAL_LEARNING_GUIDANCE = `## DUAL LEARNING SIGNAL ARCHITECTURE

You receive TWO different signal types above. Treat them separately:

🎨 VOICE signals (Brand Bible + Voice Fingerprint + Voice Memory):
   These tell you HOW to write — structure, tone, length, hooks, vocabulary.
   Honor them strictly: the founder has chosen this voice.

📊 PERFORMANCE signals (Performance Learning):
   These tell you WHAT to write about — topics, angles, framing.
   Use them for topic selection and angle bias.

Optimize for BOTH simultaneously: write in the founder's authentic voice ABOUT topics that have validated performance. Each draft should feel like the founder wrote it about a topic that resonates with their audience.

If you only have one signal type (e.g. lots of voice data, no performance data), use the available signal and don't compensate by mixing.`;

// PR #42 — Sprint 6.7: bumped 3 → 4 so the generate page can show
// drafts in a balanced 2-column grid (4 → 2×2). Founder feedback:
// "I had 2 good ones and could only save 1" — voting fixes the
// "save 1" problem; 4 drafts give a fairer pool to vote across.
const PILLAR_VARIANTS_COUNT = 4;

const PLATFORM_GUIDANCE: Record<Platform, string> = {
  instagram:
    'Visual-first, casual tone, 100-150 words, use 2-3 relevant emojis, end with a question or CTA. Use line breaks for readability.',
  facebook:
    'Conversational, 80-120 words, can be slightly longer. Personal storytelling works well.',
  linkedin:
    'Professional but human. 100-200 words. Lead with a hook. Use "I learned X" framing. No more than 1 emoji.',
  threads:
    'Punchy, 50-80 words max. Conversational, like a tweet but slightly longer. No hashtags.',
  reddit:
    'Humble, story-driven, conversational. 200-1500 chars. Hook (1-2 lines) → context → specific story with numbers/dates → lesson → genuine question to community. NO emojis (except ironic 🤡). NO hashtags. NO buzzwords like "disrupting" or "game-changer". Mention your project as context, not as a pitch. Match subreddit tone if user names one (r/SaaS, r/SideProject, r/IndieHackers, r/Entrepreneur).',
};

interface Draft {
  // PR #42 — Sprint 6.7: every draft is now persisted to
  // generated_posts before the response returns, so we can hand
  // back the DB id and let the client vote on each draft
  // individually. Pre-PR-42 only the best-scoring draft per
  // platform was persisted; the others died in client memory.
  // Optional because errored drafts don't get persisted.
  id?: string;
  content: string;
  pillar: string;
  rationale: string;
  consistencyScore: number;
  scoreBreakdown: ScoreBreakdown;
  violations: string[];
  suggestions: string[];
  error?: string;
  // Set on the highest-scoring draft per platform when FAL_API_KEY is
  // configured. Lower-scoring drafts get a visual lazily via
  // /api/visuals/generate when the user picks them.
  visual?: {
    url: string;
    prompt: string;
  };
  // First ~80 chars of the founder quote that seeded this draft, surfaced
  // in the UI so the user can see "this draft was inspired by X".
  seededByQuote?: string;
}

interface PlatformResult {
  platform: Platform;
  drafts: Draft[];
  error?: string;
}

// When the bible doesn't have 3+ pillars, pad with generic angles so we
// still produce 3 distinguishable drafts. Better than returning fewer
// options — the user always sees the multi-draft layout.
function selectVariantPillars(bible: BrandBible | null): BrandPillar[] {
  const pillars = bible?.pillars ?? [];
  if (pillars.length >= PILLAR_VARIANTS_COUNT) {
    return pillars.slice(0, PILLAR_VARIANTS_COUNT);
  }
  const generic: BrandPillar[] = [
    { name: 'general', description: 'general approach', weight: 50 },
    { name: 'pragmatic', description: 'practical, no fluff', weight: 50 },
    { name: 'human', description: 'authentic and personal', weight: 50 },
    // PR #42 — Sprint 6.7: 4th generic pillar so PILLAR_VARIANTS_COUNT=4
    // never runs short for projects with no bible pillars.
    { name: 'specific', description: 'concrete and example-driven', weight: 50 },
  ];
  return [...pillars, ...generic].slice(0, PILLAR_VARIANTS_COUNT);
}

// Pillar-focused system prompt: takes the brand bible's main system prompt
// and amends it with explicit instructions to lean into ONE pillar so the
// 3 drafts are demonstrably different.
//
// PR #20-followup: when the user typed a real prompt (>10 chars after trim),
// that prompt IS the topic and the bible/pillars become STYLE guidance only.
// Pre-fix the prompt was sent as a user message but the system prompt was so
// heavy with PILLARS / PAINS / VOICE that Haiku defaulted to generic
// brand-bible-themed posts ("100 makers on the waitlist", "founders drowning
// in tabs") and ignored the user's actual topic. The pillarSection's "lean
// into this pillar" mandate was the loudest voice in the room.
function buildPillarPrompt(
  bible: BrandBible | null,
  platform: Platform,
  templateHint: string | null,
  projectName: string,
  projectDescription: string,
  pillar: BrandPillar,
  draftIdx: number
): string {
  const guidelines = PLATFORM_GUIDANCE[platform];
  // Heuristic: anything substantive the user typed counts as their topic.
  // The 10-char floor filters out empty / placeholder strings without
  // gating real one-line prompts ("we just shipped X").
  const hasUserTopic =
    typeof projectDescription === 'string' &&
    projectDescription.trim().length > 10;

  // When the user gave a topic, the pillar is a STYLE bias (how to slant
  // it) instead of a topic mandate. Otherwise the pillar IS the topic
  // angle, same as before.
  const pillarSection = hasUserTopic
    ? `\n\nDRAFT VARIATION: This is draft ${draftIdx + 1} of ${PILLAR_VARIANTS_COUNT}. Slant the SAME user topic through the lens of the pillar "${pillar.name}: ${pillar.description}". Different drafts emphasize different pillars but ALL drafts must stay on the user's topic.`
    : `\n\nIMPORTANT: This is draft ${draftIdx + 1} of ${PILLAR_VARIANTS_COUNT}. Lean SPECIFICALLY into the pillar "${pillar.name}: ${pillar.description}". Make this draft demonstrably different from drafts that lean into other pillars.`;

  // Always-on TASK block that anchors the topic when the user gave one.
  // Goes near the END of the system prompt so it's the freshest instruction
  // before the model generates.
  const userTopicAnchor = hasUserTopic
    ? `\n\n═══════ TOPIC (FROM USER — TREAT AS GROUND TRUTH) ═══════
${projectDescription.trim()}

CRITICAL: Write the post about THIS topic. Do not invent milestones, signup numbers, or pain points the user didn't mention. The brand bible above is for STYLE only (voice, vocabulary, what to avoid). Do NOT pivot to a different topic that "fits the bible better".`
    : '';

  if (!bible || !bible.identity) {
    return `You are a marketing assistant for "${projectName}".

${hasUserTopic ? `User-supplied topic: ${projectDescription.trim()}` : ''}
${templateHint ? `Template guidance: ${templateHint}` : ''}

Platform: ${platform}
Platform guidance: ${guidelines}

Rules:
- Write in first person as the founder
- Be authentic, not salesy
- No "Are you tired of..." openings
- No empty hype or buzzwords
- Output ONLY the post text, no preamble or explanation${userTopicAnchor}${pillarSection}`;
  }

  const pillarsList = (bible.pillars ?? [])
    .map((p) => `- ${p.name}: ${p.description}`)
    .join('\n');
  const banned = (bible.vocabulary?.bannedTerms ?? [])
    .map((t) => `- "${t.term}"${t.reason ? ` — ${t.reason}` : ''}`)
    .join('\n');
  const nonNeg = (bible.nonNegotiables ?? []).map((n) => `- ${n}`).join('\n');
  const pains = (bible.audience?.primary?.painPoints ?? [])
    .slice(0, 3)
    .map((p) => `- ${p.pain} (intensity ${p.intensity}/5)`)
    .join('\n');

  return `You are writing a social post for ${platform}. Follow the platform guidelines AND the brand bible STRICTLY.

═══════ BRAND BIBLE ═══════

IDENTITY: ${bible.identity?.name ?? projectName}
TAGLINE: ${bible.identity?.tagline ?? ''}

ARCHETYPE: ${bible.archetype?.primary ?? 'unknown'}

PILLARS:
${pillarsList || '- (none specified)'}

VOICE CALIBRATION (0=left, 10=right):
- Casual ↔ Formal: ${bible.voice?.formal ?? 5}/10
- Playful ↔ Serious: ${bible.voice?.serious ?? 5}/10
- Reserved ↔ Bold: ${bible.voice?.bold ?? 5}/10
- Traditional ↔ Innovative: ${bible.voice?.innovative ?? 5}/10
- Exclusive ↔ Approachable: ${bible.voice?.approachable ?? 5}/10

BANNED TERMS (NEVER use):
${banned || '- (none specified)'}

EMOJI POLICY: ${bible.vocabulary?.emojiPolicy ?? 'tasteful'}
HASHTAG POLICY: ${bible.vocabulary?.hashtagPolicy ?? 'minimal'}

NON-NEGOTIABLES (NEVER violate):
${nonNeg || '- (none specified)'}

═══════ AUDIENCE ═══════

PRIMARY: ${bible.audience?.primary?.description ?? '(unspecified)'}

THEY FEEL THESE PAINS:
${pains || '- (none specified)'}

═══════ PLATFORM ═══════

${platform.toUpperCase()} GUIDELINES:
${guidelines}
${templateHint ? `\nTemplate guidance: ${templateHint}` : ''}

═══════ TASK ═══════

Write ONE post for ${platform}. Output ONLY the post text. No preamble, no quotes, no markdown fences.${userTopicAnchor}${pillarSection}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { projectId, platform, platforms, prompt, templateId } = body as {
    projectId?: string;
    platform?: unknown;
    platforms?: unknown;
    prompt?: string;
    templateId?: string;
  };

  // Accept either `platforms: Platform[]` (new) or `platform: Platform` (legacy
  // single-platform callers). Normalize to an array internally.
  const requested: unknown[] = Array.isArray(platforms)
    ? platforms
    : platform !== undefined
      ? [platform]
      : [];
  const validatedPlatforms = requested.filter(isPlatform);

  if (!projectId || !prompt || validatedPlatforms.length === 0) {
    return NextResponse.json(
      { error: 'projectId, prompt and at least one valid platform required' },
      { status: 400 }
    );
  }
  if (validatedPlatforms.length > 4) {
    return NextResponse.json({ error: 'Max 4 platforms' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const template = getTemplateById(templateId);
  const bible = (project.brandContext as BrandBible | null) ?? null;
  const variantPillars = selectVariantPillars(bible);

  // Fetch up to PILLAR_VARIANTS_COUNT quotes for round-robin seeding,
  // ordering by `usage_count ASC, random()` so under-used quotes win.
  // Quotes are optional — if the founder hasn't added any, we just skip
  // the seeding entirely and the prompt looks identical to before.
  const seedQuotes = await db
    .select()
    .from(brandQuotes)
    .where(eq(brandQuotes.projectId, projectId))
    .orderBy(sql`usage_count ASC`, sql`random()`)
    .limit(PILLAR_VARIANTS_COUNT);

  // PR #49 — Sprint 6.8: Dual Learning System.
  //
  // Pull learning signals once per request (NOT per platform/
  // pillar combination — would be 4×4 = 16 redundant queries
  // for a 4-platform run). All four blocks are computed up
  // front, joined as a single string, and appended to every
  // systemPrompt downstream.
  //
  // Voice signals (HOW to write):
  //   - Brand Bible (already in pillar prompt).
  //   - Voice Fingerprint from project.voiceFingerprint
  //     (Opus-derived patterns from Quote Vault).
  //   - Voice Memory from generated_posts.user_vote
  //     (in-app likes/dislikes on prior drafts).
  //
  // Performance signals (WHAT to write about):
  //   - Performance Memory from scheduled_posts.performance_rating
  //     (worked/flopped after publish — real-world feedback).

  const fingerprintRaw = project.voiceFingerprint as unknown;
  const fingerprint =
    fingerprintRaw && isVoiceFingerprint(fingerprintRaw)
      ? fingerprintRaw
      : null;

  const [likedDrafts, dislikedDrafts] = await Promise.all([
    db
      .select({
        content: generatedPosts.content,
        votedAt: generatedPosts.votedAt,
      })
      .from(generatedPosts)
      .where(
        and(
          eq(generatedPosts.projectId, projectId),
          eq(generatedPosts.userVote, 'liked')
        )
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
          eq(generatedPosts.userVote, 'disliked')
        )
      )
      .orderBy(desc(generatedPosts.votedAt))
      .limit(VOICE_MEMORY_LIMIT),
  ]);

  // PR #51 — Sprint 6.8.2: pull performance ratings from BOTH
  // tables. scheduled_posts is the canonical "what got published
  // and how it did" surface, but drafts can also carry a rating
  // now (Sprint 6.8.2 added the columns + endpoint) — e.g. a
  // founder annotates a draft as "this style would have flopped"
  // before it ever ships. Treating both sources lets the
  // performance context learn from both signals.
  const [ratedScheduled, ratedDrafts] = await Promise.all([
    db
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
          isNotNull(scheduledPosts.performanceRating)
        )
      )
      .orderBy(desc(scheduledPosts.ratedAt))
      .limit(PERFORMANCE_LIMIT * 2),
    db
      .select({
        content: generatedPosts.content,
        performanceRating: generatedPosts.performanceRating,
        performanceNote: generatedPosts.performanceNote,
        performanceMetrics: generatedPosts.performanceMetrics,
        performanceRatedAt: generatedPosts.performanceRatedAt,
      })
      .from(generatedPosts)
      .where(
        and(
          eq(generatedPosts.projectId, projectId),
          isNotNull(generatedPosts.performanceRating)
        )
      )
      .orderBy(desc(generatedPosts.performanceRatedAt))
      .limit(PERFORMANCE_LIMIT * 2),
  ]);

  // Normalize the draft shape to the scheduled shape (the prompt
  // builder expects metrics as 4 separate fields) so a single
  // builder can consume both. Drafts' metrics jsonb is
  // { reach, likes, comments, shares, impressions? } — we map
  // it back to the scheduled column names.
  const normalizedRatedDrafts = ratedDrafts.map((d) => {
    const m = (d.performanceMetrics ?? null) as {
      reach?: number;
      impressions?: number;
      likes?: number;
      comments?: number;
      shares?: number;
    } | null;
    return {
      content: d.content,
      performanceRating: d.performanceRating,
      performanceNote: d.performanceNote,
      metricsImpressions: m?.impressions ?? m?.reach ?? null,
      metricsLikes: m?.likes ?? null,
      metricsComments: m?.comments ?? null,
      metricsShares: m?.shares ?? null,
      ratedAt: d.performanceRatedAt,
    };
  });

  // Merge both sources, then cap to PERFORMANCE_LIMIT * 2 most
  // recent overall so the prompt token budget stays bounded.
  const ratedCombined = [...ratedScheduled, ...normalizedRatedDrafts]
    .sort((a, b) => {
      const ta = a.ratedAt ? new Date(a.ratedAt).getTime() : 0;
      const tb = b.ratedAt ? new Date(b.ratedAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, PERFORMANCE_LIMIT * 2);

  const voiceFingerprintBlock = buildVoiceFingerprintBlock(fingerprint);
  const voiceMemoryBlock = buildVoiceMemoryBlock(likedDrafts, dislikedDrafts);
  const performanceBlock = buildPerformanceBlock(ratedCombined);

  // Single concatenation downstream prompts append at the end.
  const learningContext = [
    voiceFingerprintBlock,
    voiceMemoryBlock,
    performanceBlock,
    DUAL_LEARNING_GUIDANCE,
  ].join('\n\n');

  // 4 platforms × 3 drafts × 2 calls (gen + score) = up to 24 parallel
  // Anthropic calls. Promise.all keeps total wallclock bounded by the
  // slowest platform rather than the sum of all platforms.
  const platformResults: PlatformResult[] = await Promise.all(
    validatedPlatforms.map(async (p): Promise<PlatformResult> => {
      try {
        const draftPromises = variantPillars.map(async (pillar, idx): Promise<Draft> => {
          // Round-robin: with 3 drafts and 2 quotes, drafts 0/2 share quote
          // 0 and draft 1 gets quote 1. Empty quote vault = no seeding.
          const seedQuote =
            seedQuotes.length > 0
              ? seedQuotes[idx % seedQuotes.length]
              : null;

          let systemPrompt = buildPillarPrompt(
            bible,
            p,
            template?.systemHint ?? null,
            project.name,
            prompt,
            pillar,
            idx
          );

          if (seedQuote) {
            systemPrompt += `\n\n═══════ FOUNDER'S AUTHENTIC VOICE ═══════
The founder has shared this quote that captures their authentic voice:
"${seedQuote.content}"
${seedQuote.source ? `(Source: ${seedQuote.source})` : ''}
${seedQuote.context ? `Context: ${seedQuote.context}` : ''}

Don't quote this verbatim — instead, channel its spirit, energy, and specific phrasing patterns. Your draft should feel like the SAME PERSON who said this quote also wrote the post. Match cadence, vocabulary range, and worldview.`;
          }

          // PR #49 — Sprint 6.8: Dual Learning System. Append the
          // four learning blocks (Voice Fingerprint + Voice Memory
          // + Performance + dual-signal guidance) to every
          // platform/pillar variant. Same content for every draft
          // in this generate call — the per-pillar slant from
          // buildPillarPrompt + the per-quote seeding above stay
          // in front; the learning context comes after, framed as
          // global guidance the model should consider on top.
          systemPrompt += '\n\n' + learningContext;

          let content = '';
          try {
            // Explicit user message reinforces "this is the topic" so Haiku
            // doesn't drift to brand-bible-themed defaults. Pre-fix this was
            // just `prompt` raw, which sometimes read as a vague brief and
            // got out-prioritized by the much louder system prompt.
            const userMessage = `Write a post about this topic:\n\n${prompt.trim()}`;
            const response = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1500,
              system: systemPrompt,
              messages: [{ role: 'user', content: userMessage }],
            });
            const textBlock = response.content.find((b) => b.type === 'text');
            content = textBlock?.type === 'text' ? textBlock.text.trim() : '';
          } catch (err) {
            return {
              content: '',
              pillar: pillar.name,
              rationale: `Generation failed for pillar "${pillar.name}"`,
              consistencyScore: 0,
              scoreBreakdown: {
                voice: 0,
                vocabulary: 0,
                nonNegotiables: 0,
                pillarAlignment: 0,
                audienceResonance: 0,
              },
              violations: [],
              suggestions: [],
              error: err instanceof Error ? err.message : String(err),
            };
          }

          const score = await computeConsistencyScore(content, bible, pillar.name);

          return {
            content,
            pillar: pillar.name,
            rationale: `Leans into "${pillar.name}" — ${pillar.description}`,
            consistencyScore: score.total,
            scoreBreakdown: score.breakdown,
            violations: score.violations,
            suggestions: score.suggestions,
            seededByQuote: seedQuote?.content,
          };
        });

        const drafts = await Promise.all(draftPromises);

        // PR #42 — Sprint 6.7: persist EVERY non-error draft so the
        // generate page can vote on each one individually. Pre-PR-42
        // only the best-by-score draft was persisted, which meant a
        // founder who liked drafts #2 and #3 of 3 had to re-generate
        // to keep both. Now all 4 land in generated_posts with
        // userVote=null + visibleInLibrary=true; voting flips them
        // to liked / disliked and library filters disliked ones out.
        //
        // PR #44 — Sprint 6.7.2: zip ids back by INDEX, not by
        // content. Pre-PR-44 we matched the inserted row to a draft
        // via `d.content === row.content`, which silently dropped
        // any draft whose content collided with another already-
        // matched one (Haiku at 4 drafts/post occasionally produces
        // near-identical short drafts for terse prompts). Drafts
        // without an id then sent `draftId: undefined` to
        // /api/visuals/generate, the server skipped the imageUrl
        // persist, and the founder's image disappeared on Like /
        // refresh. `db.insert(...).returning()` preserves input
        // order; persistableDrafts is itself a stable filter of
        // drafts (filter preserves order). Zipping by index is
        // both simpler and guaranteed correct.
        const persistableDrafts = drafts.filter(
          (d) => !d.error && d.content
        );
        if (persistableDrafts.length > 0) {
          const inserted = await db
            .insert(generatedPosts)
            .values(
              persistableDrafts.map((d) => ({
                projectId: project.id,
                platform: p,
                content: d.content,
                prompt,
              }))
            )
            .returning({ id: generatedPosts.id });
          inserted.forEach((row, i) => {
            // persistableDrafts[i] holds the same object reference
            // as the corresponding entry in drafts[]; mutating its
            // id updates the array in place.
            persistableDrafts[i].id = row.id;
          });
        }
        // PR #47 — Sprint 6.7.5: removed auto-visual generation.
        //
        // Pre-PR-47 we auto-generated a fal.ai image for the
        // highest-scoring draft per platform and attached it to
        // `drafts[best].visual.url` IN MEMORY ONLY — no UPDATE
        // touched generated_posts.image_url. The client rendered
        // the visual; the founder Liked the draft; Library +
        // Calendar pulled from DB and saw image_url=NULL → no
        // thumbnail. The UX appeared as "the image disappears
        // when I Like a draft" and resisted three rounds of
        // cache-invalidation fixes (6.7.1 / 6.7.2 / 6.7.4).
        //
        // The actual data was never in the DB to begin with.
        //
        // Fix per founder decision (Plan #47, "DECISIÓN MI VOTO:
        // B"): visuals are explicit only. The "+ Add visual"
        // button on each DraftCard calls /api/visuals/generate
        // with draftId, that route persists imageUrl + imagePrompt
        // on the row (PR #43 / Sprint 6.7.1), and Library reads
        // image_url back as visualUrl. Single, persisted path.
        // Cost benefit: drafts that the founder doesn't intend
        // to ship don't burn $0.05 each on speculative imagery.

        return { platform: p, drafts };
      } catch (err) {
        console.error(`[GENERATE POST] failed for ${p}`, err);
        return {
          platform: p,
          drafts: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  // Bump usage stats for the quotes we actually consumed. We don't gate on
  // whether each platform succeeded — even a failed generation still pulled
  // the quote into a system prompt, so it counts as "used" for round-robin
  // purposes. Scoped to user.id as a defensive double-check on top of the
  // projectId query above.
  if (seedQuotes.length > 0) {
    const usedQuoteIds = seedQuotes
      .slice(0, variantPillars.length)
      .map((q) => q.id);
    if (usedQuoteIds.length > 0) {
      await db
        .update(brandQuotes)
        .set({
          usageCount: sql`${brandQuotes.usageCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(
          and(
            inArray(brandQuotes.id, usedQuoteIds),
            eq(brandQuotes.userId, user.id)
          )
        );
    }
  }

  return NextResponse.json({
    generations: platformResults,
    templateUsed: template?.id ?? null,
  });
}
