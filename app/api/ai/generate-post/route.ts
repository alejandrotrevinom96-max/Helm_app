import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  generatedPosts,
  brandQuotes,
  scheduledPosts,
} from '@/lib/db/schema';
import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { getTemplateById } from '@/lib/marketing/templates';
import {
  computeConsistencyScore,
  type ScoreBreakdown,
} from '@/lib/ai/consistency-score';
import { isVoiceFingerprint } from '@/lib/types/voice';
import type { VoiceFingerprint } from '@/lib/types/voice';
// PR Sprint 7.14 — shared feedback-memory module. Replaces the
// inline buildVoiceMemoryBlock + buildPerformanceBlock + loaders
// that lived in this file (Sprint 6.8). Same behavior; the
// extraction lets /api/ai/generate-structured consume the same
// blocks so the new structured generator honors 👍/👎 / worked /
// flopped signals too.
import {
  loadVoiceMemory,
  loadPerformanceMemory,
  buildVoiceMemoryBlock,
  buildPerformanceBlock,
  DUAL_LEARNING_GUIDANCE,
} from '@/lib/ai/feedback-memory';
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

// PR Sprint 7.14 — thresholds, row interfaces, voice / performance
// builders, and DUAL_LEARNING_GUIDANCE moved to
// lib/ai/feedback-memory.ts. This route imports + uses them
// unchanged; the structured generator imports the same module.

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

// PR Sprint 7.14 — buildVoiceMemoryBlock + buildPerformanceBlock
// + DUAL_LEARNING_GUIDANCE moved to lib/ai/feedback-memory.ts so
// /api/ai/generate-structured can consume the same blocks.

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

  // PR Sprint 7.14 — Voice + Performance Memory loaders moved
  // into lib/ai/feedback-memory.ts. Same queries, same shape,
  // same thresholds; just shared with the structured generator.
  const [{ liked: likedDrafts, disliked: dislikedDrafts }, ratedScheduled] =
    await Promise.all([
      loadVoiceMemory(projectId),
      loadPerformanceMemory(projectId),
    ]);

  const voiceFingerprintBlock = buildVoiceFingerprintBlock(fingerprint);
  const voiceMemoryBlock = buildVoiceMemoryBlock(likedDrafts, dislikedDrafts);
  const performanceBlock = buildPerformanceBlock(ratedScheduled);

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
