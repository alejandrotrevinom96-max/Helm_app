import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, generatedPosts, brandQuotes } from '@/lib/db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { anthropic } from '@/lib/ai/claude';
import { getTemplateById } from '@/lib/marketing/templates';
import {
  computeConsistencyScore,
  type ScoreBreakdown,
} from '@/lib/ai/consistency-score';
import { generateVisual } from '@/lib/visuals/generate';
import { uploadVisualFromUrl } from '@/lib/visuals/storage';
import { NextResponse } from 'next/server';
import type { BrandBible, BrandPillar } from '@/lib/types/brand';

// Bumped to 90s because we now (optionally) wait on fal.ai for the
// best-draft visual before responding. Generation without visual still
// finishes in ~10s; with visual usually ~15-20s end-to-end.
export const maxDuration = 90;

const VALID_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'threads'] as const;
type Platform = (typeof VALID_PLATFORMS)[number];
const VALID_PLATFORM_SET = new Set<Platform>(VALID_PLATFORMS);

function isPlatform(p: unknown): p is Platform {
  return typeof p === 'string' && VALID_PLATFORM_SET.has(p as Platform);
}

const PILLAR_VARIANTS_COUNT = 3;

const PLATFORM_GUIDANCE: Record<Platform, string> = {
  instagram:
    'Visual-first, casual tone, 100-150 words, use 2-3 relevant emojis, end with a question or CTA. Use line breaks for readability.',
  facebook:
    'Conversational, 80-120 words, can be slightly longer. Personal storytelling works well.',
  linkedin:
    'Professional but human. 100-200 words. Lead with a hook. Use "I learned X" framing. No more than 1 emoji.',
  threads:
    'Punchy, 50-80 words max. Conversational, like a tweet but slightly longer. No hashtags.',
};

interface Draft {
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
  ];
  return [...pillars, ...generic].slice(0, PILLAR_VARIANTS_COUNT);
}

// Pillar-focused system prompt: takes the brand bible's main system prompt
// and amends it with explicit instructions to lean into ONE pillar so the
// 3 drafts are demonstrably different.
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
  const pillarSection = `\n\nIMPORTANT: This is draft ${draftIdx + 1} of ${PILLAR_VARIANTS_COUNT}. Lean SPECIFICALLY into the pillar "${pillar.name}: ${pillar.description}". Make this draft demonstrably different from drafts that lean into other pillars.`;

  if (!bible || !bible.identity) {
    return `You are a marketing assistant for "${projectName}".

${projectDescription ? `Project description: ${projectDescription}` : ''}
${templateHint ? `Template guidance: ${templateHint}` : ''}

Platform: ${platform}
Platform guidance: ${guidelines}

Rules:
- Write in first person as the founder
- Be authentic, not salesy
- No "Are you tired of..." openings
- No empty hype or buzzwords
- Output ONLY the post text, no preamble or explanation${pillarSection}`;
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

Write ONE post for ${platform}. Output ONLY the post text. No preamble, no quotes, no markdown fences.${pillarSection}`;
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

          let content = '';
          try {
            const response = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1500,
              system: systemPrompt,
              messages: [{ role: 'user', content: prompt }],
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

        // Persist only the highest-scoring non-error draft per platform so
        // the "Recent generations" list stays meaningful (not 3× cluttered).
        const sortedNonError = drafts
          .filter((d) => !d.error && d.content)
          .sort((a, b) => b.consistencyScore - a.consistencyScore);
        const best = sortedNonError[0];
        if (best) {
          await db.insert(generatedPosts).values({
            projectId: project.id,
            platform: p,
            content: best.content,
            prompt,
          });
        }

        // Auto-generate a visual for the best draft only. Other drafts get
        // visuals lazily if the user selects them. Cost-cap: $0.05 × N
        // platforms instead of $0.05 × N × 3. Fail-soft: if fal.ai/Storage
        // fails, the draft just ships without a visual.
        if (best && process.env.FAL_API_KEY) {
          try {
            const visual = await generateVisual({
              platform: p,
              postContent: best.content,
              brandBible: bible,
            });
            if (visual) {
              const uploaded = await uploadVisualFromUrl(
                visual.url,
                user.id,
                `draft-${p}-${Date.now()}`
              );
              const bestIdxInDrafts = drafts.indexOf(best);
              if (bestIdxInDrafts >= 0) {
                drafts[bestIdxInDrafts].visual = {
                  url: uploaded?.publicUrl ?? visual.url,
                  prompt: visual.prompt,
                };
              }
            }
          } catch (visualErr) {
            console.error(
              `[GENERATE POST] visual gen failed for ${p}`,
              visualErr
            );
          }
        }

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
