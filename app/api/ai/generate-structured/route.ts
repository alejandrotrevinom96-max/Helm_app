// PR #60 — Sprint 7.0.4: structured multi-type generation.
//
// Companion to /api/ai/generate-post — NOT a replacement. The legacy
// endpoint produces 4 plain-text variants per platform via pillars;
// this one produces ONE structured draft per (platform, contentType)
// the founder explicitly selected. Both paths persist into
// generatedPosts so Library/Calendar pick them up.
//
// Cost discipline:
//   - One Opus call PER content type (not one big call) so a single
//     bad JSON parse only loses that draft, not the whole batch.
//   - System prompt is cached: brand-bible + voice fingerprint is the
//     same across every call inside a session, so the cache reads
//     after the first call cost ~10% of normal input.
//   - 5/hr rate limit per user — Opus runs ~$0.05/call, this puts a
//     hard ceiling of ~$1.50/hr/user.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  contentTypes,
  generatedPosts,
  heygenJobs,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import {
  anthropic,
  MODELS,
  cachedSystem,
  LANGUAGE_INSTRUCTION_AUDIENCE,
} from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  categorizeAnthropicError,
  describeError,
  type ErrorKind,
} from '@/lib/ai/categorize-error';
import type { BrandBible } from '@/lib/types/brand';
// PR Sprint 7.13 — platform-native tone system. Layers
// PLATFORM_TONE_INSTRUCTIONS + CONTENT_TYPE_RULES on top of the
// existing Brand Bible + Voice Fingerprint logic. Brand /
// voice / language instruction inside the cached system prompt
// stay UNCHANGED — these rules go in the user prompt.
import {
  buildGenerationPrompt,
  mapDbContentTypeToTaxonomy,
  PLATFORM_CONTENT_COMPATIBILITY,
  InvalidContentForPlatformError,
  type Platform,
} from '@/lib/ai/platform-tone';
// PR Sprint 7.13 (BUG 2) — Brand fit score on drafts. Restored
// after structured-draft path skipped it during the Sprint 7.0.4
// pipeline migration.
import { computeConsistencyScore } from '@/lib/ai/consistency-score';
// PR Sprint 7.14 — feedback memory loop. Voice Memory (👍/👎 on
// drafts) + Performance Memory (worked/flopped on published
// rows) were captured by the UI but never reached this generator
// — only the legacy /api/ai/generate-post pipeline read them.
// Now the same dual-learning blocks flow into the cached system
// prompt here so the new structured generator honors them too.
import { loadFeedbackMemoryBlock } from '@/lib/ai/feedback-memory';
// PR Sprint 7.16 — Adaptive Voice Engine. Per-project learning
// state (ClientContext) feeds the dynamic CLIENT CONTEXT block
// of the user prompt + the model self-reports applied overrides
// via <override_log> tags we parse server-side for the audit
// log. Sits ON TOP of platform-tone + feedback-memory — doesn't
// replace them.
import {
  loadClientContext,
  logAudit,
} from '@/lib/voice-engine/loader';
import {
  buildAdaptivePrompt,
  parseOverrideLog,
} from '@/lib/voice-engine/prompt-builder';
import type {
  ContentType as VoiceEngineContentType,
  Platform as VoiceEnginePlatform,
} from '@/lib/voice-engine/types';
// PR Sprint 7.18 — UGC bundle support. content_type='ugc' gets
// the strict JSON-schema instruction appended, then Zod
// validates the shape and the soft validator catches the
// qualitative rules (hook specificity, sales CTA, etc.).
// Failures trigger a single retry — beyond that we surface the
// bundle as-is with the failure list so the founder can decide
// whether to ship it or regenerate manually.
import { appendUgcSchemaToPrompt } from '@/lib/voice-engine/ugc-prompt';
import {
  UGCBundleSchema,
  parseUgcBundle,
  type UGCBundle,
} from '@/lib/voice-engine/ugc-schema';
import { validateUgcBundle } from '@/lib/voice-engine/ugc-validator';
// PR Sprint 7.22 Fase 2 — text-post validators (Sprint 1 + Patch 1).
// Runs after a successful Opus generation for non-UGC content types;
// failures land as audit rows but never block the draft (same
// observability-only pattern UGC uses).
import {
  flattenStructuredContentForValidation,
  validateTextPost,
} from '@/lib/voice-engine/text-post-validator';
// PR Sprint 7.22 Sprint B — Patch 2 product bridges. The matcher
// picks the best pain → bridge match for this generation (Haiku
// call, ~$0.001). When it returns a match, the formatted
// PRODUCT_RELEVANCE block gets spliced into both the adaptive and
// the fallback prompt paths so the model weaves the product into
// the post organically instead of defaulting to a templated
// disclosure.
import {
  formatBridgeForPrompt,
  matchBridgeForPain,
} from '@/lib/voice-engine/product-bridge-matcher';
// PR Sprint 7.22 Sprint C — F3 authenticity smell test. Fire-and-
// forget final-pass Haiku scoring on the first successful draft of
// each request so we collect telemetry without blocking the
// response or paying for N parallel calls per generation.
import {
  smellTestAuthenticity,
  type SmellTestResult,
} from '@/lib/voice-engine/authenticity-smell-test';
// PR Sprint 7.22 Sprint E.1 — F4 variety injection. Decides ONCE
// per request whether to inject a variety mode override. Tracks
// chosen archetypes in brandContext.recentArchetypes (per platform)
// so we can rotate over time and respect the cooldown window.
import {
  getVarietyInstruction,
  recordArchetypeUsage,
  selectVarietyArchetype,
  shouldInjectVariety,
} from '@/lib/voice-engine/variety-injector';
import type { ArchetypeUsage, PostArchetype } from '@/lib/types/brand';
// PR Sprint 7.22 Sprint E.2 — E1 voice idiosyncrasies. The
// run-on-request refresher decides whether to use the cached
// profile, kick off a background refresh, or extract synchronously
// the first time. Returns null when the project hasn't shipped
// >=10 posted samples on the platform.
import { getOrRefreshIdiosyncrasies } from '@/lib/voice-engine/maybe-refresh-idiosyncrasies';
import { formatIdiosyncrasiesAsPromptRules } from '@/lib/voice-engine/voice-idiosyncrasy-extractor';
// PR Sprint onboarding-wow — Sentry capture for the dedicated
// area='onboarding' kind='wow-moment' events the wow page reads
// off telemetry dashboards.
import * as Sentry from '@sentry/nextjs';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_PLATFORMS = new Set([
  'instagram',
  'facebook',
  'linkedin',
  'reddit',
  'threads',
  'x',
  // PR #88 — Sprint 7.12: TikTok joins the structured-draft
  // pipeline. content_types is seeded with photo + ugc + carousel
  // for tiktok; TYPES_NEED_VIDEO already includes 'ugc' so the
  // HeyGen job auto-queues for UGC scripts.
  'tiktok',
]);

// PR #76 — Sprint 7.3: types that should produce a queued HeyGen
// video job alongside the structured draft. The job is INSERTED
// only; the actual HeyGen call happens in a separate worker once
// HEYGEN_ENABLED=true and a key are set. We intentionally use the
// seeded content-type keys verbatim (`reel`, `ugc`) instead of the
// plan's `reel`/`ugc_script` so the inArray match keeps working.
const TYPES_NEED_VIDEO = new Set(['reel', 'ugc']);

// Extract a clean script string from a structured draft. Different
// templates name the script-bearing fields differently — reels
// PR Sprint 7.24 — UGC script extraction fix.
//
// Pre-fix this function read the legacy { opening, body, closing }
// shape that pre-dated the UGCBundle port (Sprint 7.18). The real
// structured payload for ugc and reel content types is a UGCBundle:
//   { hook: { text, duration_seconds, delivery },
//     body: [ { beat, text, duration_seconds, delivery }, ... ],
//     cta: { text, duration_seconds, delivery },
//     overlays: [...], caption, hashtags, metadata }
//
// Reading obj.opening/body/closing returned undefined, scriptText
// resolved to null, and the heygenJobs row was NEVER created — so
// for every UGC and reel generation the HeyGen pipeline silently
// noop'd. From the founder's perspective: a video content type was
// selected, a draft was saved, but no video ever got queued.
//
// The fix reads the bundle's hook.text + body[].text + cta.text in
// order. This matches the canonical `scriptText` helper exported
// from ugc-schema.ts but we don't import it directly to avoid a
// Zod-parse round-trip on output that already passed validation
// upstream (we trust the shape because UGCBundleSchema.safeParse
// ran on `parsed` immediately before this function is called).
function extractScriptText(
  contentType: string,
  structured: unknown,
): string | null {
  if (!structured || typeof structured !== 'object') return null;
  const obj = structured as Record<string, unknown>;
  const parts: string[] = [];

  // Both 'reel' and 'ugc' content types map to the 'ugc' taxonomy
  // (DB_TO_TAXONOMY in lib/ai/platform-tone.ts) and produce the
  // UGCBundle shape. The original split branches dated from the
  // pre-7.18 era when reel and ugc had different prompts.
  if (contentType === 'reel' || contentType === 'ugc') {
    const hook = obj.hook as Record<string, unknown> | undefined;
    if (hook && typeof hook === 'object' && typeof hook.text === 'string') {
      parts.push(hook.text);
    }
    if (Array.isArray(obj.body)) {
      for (const b of obj.body) {
        if (b && typeof b === 'object') {
          const beat = b as Record<string, unknown>;
          if (typeof beat.text === 'string') parts.push(beat.text);
        }
      }
    }
    const cta = obj.cta as Record<string, unknown> | undefined;
    if (cta && typeof cta === 'object' && typeof cta.text === 'string') {
      parts.push(cta.text);
    }
  }

  const joined = parts.filter((p) => p.trim().length > 0).join('\n\n');
  return joined.length > 0 ? joined : null;
}

// PR #75 — Sprint 7.2C hotfix: per-draft error payloads now carry
// a categorized errorKind + actionable hint so callers (the
// onboarding wizard's step 5 in particular) can render specific
// states like "Anthropic is overloaded, retry in 60s" instead of
// the previous generic "Algo falló".
interface DraftPayload {
  id: string;
  contentType: string;
  displayName: string;
  structuredContent: unknown;
  // PR Sprint 7.13 hotfix v2 (BUG 2) — surface the brand-fit
  // score on the generation response so the Generator page's
  // StructuredDraftCard can render the badge immediately,
  // without a separate Library fetch. Null when the
  // computeConsistencyScore() call failed (best-effort, see
  // route body).
  consistencyScore?: number | null;
  // When the per-type Opus call failed: kind + raw message + hint.
  error?: string;
  errorKind?: ErrorKind;
  errorHint?: string;
  errorRetry?: boolean;
  // PR Sprint 7.24 — Prompt 3. Set when the request was one half
  // of an A/B pair. Cards in /marketing/generate + Library use it
  // to render the "Variant A" / "Variant B" chip.
  variantLabel?: 'A' | 'B' | null;
  variantGroupId?: string | null;
}

function brandContextSummary(bible: BrandBible | null): string {
  if (!bible) return 'No brand bible configured.';
  const lines: string[] = [];
  if (bible.identity?.name) lines.push(`Name: ${bible.identity.name}`);
  if (bible.identity?.tagline) lines.push(`Tagline: ${bible.identity.tagline}`);
  if (bible.identity?.industry) lines.push(`Industry: ${bible.identity.industry}`);
  if (bible.archetype?.primary) lines.push(`Archetype: ${bible.archetype.primary}`);
  if (bible.pillars?.length) {
    lines.push(
      `Pillars:\n${bible.pillars
        .map(
          (p) =>
            `  - ${p?.name ?? 'unnamed'}${p?.description ? ` — ${p.description}` : ''}`,
        )
        .join('\n')}`,
    );
  }
  const primary = bible.audience?.primary;
  if (primary?.description) lines.push(`Audience: ${primary.description}`);
  if (primary?.painPoints?.length) {
    lines.push(
      `Pains:\n${primary.painPoints
        .slice(0, 5)
        .map((p) => `  - ${p.pain} (intensity ${p.intensity}/5)`)
        .join('\n')}`,
    );
  }
  if (bible.vocabulary?.bannedTerms?.length) {
    lines.push(
      `Banned terms: ${bible.vocabulary.bannedTerms
        .map((t) => t.term)
        .slice(0, 8)
        .join(', ')}`,
    );
  }
  if (bible.vocabulary?.brandPhrases?.length) {
    lines.push(
      `Brand phrases: ${bible.vocabulary.brandPhrases.slice(0, 5).join(' | ')}`,
    );
  }
  return lines.join('\n');
}

// VoiceFingerprint type from lib/types/voice — kept loose because we
// only stringify it for the prompt.
function voiceFingerprintSummary(
  vf: Record<string, unknown> | null | undefined,
): string {
  if (!vf) return 'No voice fingerprint yet — match brand bible voice.';
  const parts: string[] = [];
  for (const key of [
    'toneCharacteristics',
    'signaturePhrasings',
    'vocabularyTraits',
    'structuralPatterns',
    'avoidPatterns',
  ] as const) {
    const v = vf[key];
    if (Array.isArray(v) && v.length > 0) {
      parts.push(`${key}: ${(v as string[]).slice(0, 6).join(' | ')}`);
    }
  }
  return parts.length > 0
    ? parts.join('\n')
    : 'No voice fingerprint yet — match brand bible voice.';
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // PR Sprint 7.24 — Prompt 3. variantLabel + variantGroupId are
  // optional. When the new client passes both, the request is one
  // half of an A/B pair fired in parallel from the panel; the
  // userMessage gets a variant-specific hook hint and the inserted
  // generated_posts row carries both fields so the Library can
  // render the pair as a 2-up comparison. Legacy callers (onboarding
  // wizard's first-content step) omit them and get the
  // single-variant behavior.
  type VariantLabel = 'A' | 'B';
  let body: {
    projectId?: string;
    platform?: string;
    prompt?: string;
    types?: string[];
    variantLabel?: VariantLabel;
    variantGroupId?: string;
    // PR Sprint onboarding-wow — when true, the request comes from
    // /onboarding/wow and gets a dedicated rate-limit bucket (so
    // it doesn't compete with the founder's main 5/hour limit on
    // the same day they sign up) + a top-level draftIds[] in the
    // response for easy consumption.
    wowMode?: boolean;
  };
  try {
    body = (await request.json()) as {
      projectId?: string;
      platform?: string;
      prompt?: string;
      types?: string[];
      variantLabel?: VariantLabel;
      variantGroupId?: string;
      wowMode?: boolean;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const wowMode = body.wowMode === true;

  // PR Sprint onboarding-wow — separate rate-limit bucket. The wow
  // page calls this exactly once per project (auto-dispatch on
  // mount), so a 3/day ceiling is plenty for honest signup +
  // signup-retry scenarios while still cutting off a script that
  // keeps spamming the endpoint with wowMode=true.
  const limitKey = wowMode
    ? `generate-structured-wow:${user.id}`
    : `generate-structured:${user.id}`;
  const limitCount = wowMode ? 3 : 5;
  const limitWindowMs = wowMode ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const limit = checkRateLimit(limitKey, limitCount, limitWindowMs);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: wowMode
          ? 'Onboarding wow moment already generated today. Use the regular Library or /marketing/generate to make more.'
          : `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  const { projectId, platform, prompt } = body;
  const variantLabel: VariantLabel | null =
    body.variantLabel === 'A' || body.variantLabel === 'B'
      ? body.variantLabel
      : null;
  const variantGroupId: string | null =
    typeof body.variantGroupId === 'string' && UUID_RE.test(body.variantGroupId)
      ? body.variantGroupId
      : null;
  // Each variant nudges the model toward a different opening
  // shape so the two drafts feel distinct without forcing different
  // content. Empty when the call is single-variant (legacy).
  const variantHint =
    variantLabel === 'A'
      ? `\n\nVARIANT INSTRUCTION (Variant A of an A/B pair): open this draft with a DIRECT, FACTUAL hook — a specific number, a tool name, a concrete confession verb ("I dropped...", "I spent..."). No story setup, no question opener.`
      : variantLabel === 'B'
        ? `\n\nVARIANT INSTRUCTION (Variant B of an A/B pair): open this draft with a STORY-BASED or QUESTION-BASED hook — start mid-action ("It was 2am. Tuesday."), pose a curious question, or set a brief scene. No leading number, no confession-verb pattern.`
        : '';
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }
  if (!platform || !VALID_PLATFORMS.has(platform)) {
    return NextResponse.json(
      { error: 'Invalid platform' },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.types) || body.types.length === 0) {
    return NextResponse.json(
      { error: 'Select at least one content type' },
      { status: 400 },
    );
  }
  // Hard cap on how many types per call — keeps cost predictable.
  const requestedTypes = body.types
    .filter((t): t is string => typeof t === 'string')
    .slice(0, 6);

  // Ownership.
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }

  // Pull the matching templates.
  const templates = await db
    .select()
    .from(contentTypes)
    .where(
      and(
        eq(contentTypes.platform, platform),
        inArray(contentTypes.type, requestedTypes),
      ),
    );
  if (templates.length === 0) {
    return NextResponse.json(
      {
        error: 'No matching content types',
        hint: 'These types may not be configured for this platform.',
      },
      { status: 400 },
    );
  }

  const bible = (project.brandContext as BrandBible | null) ?? null;
  const brand = brandContextSummary(bible);
  const voice = voiceFingerprintSummary(
    project.voiceFingerprint as Record<string, unknown> | null,
  );
  const userPrompt = (prompt ?? '').trim() || 'Generate content based on brand context.';

  // PR Sprint 7.22 Sprint B — Patch 2 product bridges. Run the LLM
  // matcher ONCE per request (the painPoint is the same userPrompt
  // for every content type in the batch). The result is reused
  // across all subsequent buildAdaptivePrompt / buildGenerationPrompt
  // calls inside the for-loop below.
  //
  // Skipped entirely when the project has no approved bridges (no
  // Haiku call at all). On Haiku failure the matcher returns an
  // empty BridgeMatch — never throws, never blocks generation.
  // PR Sprint 7.22 Sprint E.1 — F4 variety injection. ONE decision
  // per request (shared across all content types in the batch). The
  // archetype lives at brandContext.recentArchetypes[platform]; we
  // pull the current sliding window, run shouldInjectVariety, and
  // when it fires we pick a non-recent archetype + format the
  // VARIETY MODE instruction. After the response goes out we write
  // back the updated usage list so the next request sees this one.
  //
  // Note: the in-loop `platformLower` is recomputed per content type
  // (line ~540), but it's a pure toLowerCase() of the request-level
  // `platform` param so we compute the same value here once for the
  // pre-loop variety + writeback work. Naming it
  // `platformLowerForVariety` keeps the in-loop variable untouched.
  const platformLowerForVariety = platform.toLowerCase();
  const platformVarietyConfig =
    bible?.varietyConfig?.[platformLowerForVariety] ?? undefined;
  const recentArchetypesForPlatform: ArchetypeUsage[] =
    bible?.recentArchetypes?.[platformLowerForVariety] ?? [];

  let chosenArchetype: PostArchetype = 'essay';
  let varietyInjectedThisRequest = false;
  let varietyInstructionSection = '';
  try {
    if (
      shouldInjectVariety({
        recentArchetypes: recentArchetypesForPlatform,
        config: platformVarietyConfig,
      })
    ) {
      chosenArchetype = selectVarietyArchetype({
        recentArchetypes: recentArchetypesForPlatform,
        config: platformVarietyConfig,
      });
      varietyInjectedThisRequest = true;
      varietyInstructionSection = getVarietyInstruction(chosenArchetype);
      void logAudit({
        userId: user.id,
        projectId,
        action: 'variety_archetype_injected',
        platform: platformLowerForVariety as VoiceEnginePlatform,
        notes: `archetype=${chosenArchetype}`,
      }).catch(() => {
        /* non-fatal */
      });
    }
  } catch (err) {
    console.warn(
      '[generate-structured] variety selection threw — continuing with default essay:',
      err instanceof Error ? err.message : err,
    );
  }

  // PR Sprint 7.22 Sprint E.2 — E1 voice idiosyncrasies refresh.
  // Run-on-request: if the cached profile for this (project,
  // platform) is fresh → use as-is; if stale → use cached + kick
  // background refresh; if missing → extract synchronously (one-
  // time cost, then cached). Returns null when the project has
  // < 10 posted samples on this platform — the prompt builder
  // gets an empty WRITER VOICE PROFILE section and skips the
  // splice gracefully.
  let writerVoiceProfileSection = '';
  try {
    const idio = await getOrRefreshIdiosyncrasies({
      projectId,
      userId: user.id,
      platform: platformLowerForVariety,
      bible,
    });
    if (idio) {
      writerVoiceProfileSection = formatIdiosyncrasiesAsPromptRules(idio);
    }
  } catch (err) {
    console.warn(
      '[generate-structured] voice idiosyncrasies refresh failed (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }

  let productRelevanceSection = '';
  const projectBridges = bible?.painToProductBridges ?? [];
  if (projectBridges.length > 0) {
    try {
      const match = await matchBridgeForPain({
        painPoint: userPrompt,
        availableBridges: projectBridges,
      });
      productRelevanceSection = formatBridgeForPrompt(match);
      if (productRelevanceSection.length > 0) {
        // Audit so operators can see which generations are getting
        // bridge injection + which bridge fired. One row per request
        // keeps the volume sane.
        void logAudit({
          userId: user.id,
          projectId,
          action: 'product_bridge_applied',
          notes: `pain="${match.matchedPain}" confidence=${match.confidence.toFixed(2)}`.slice(
            0,
            500,
          ),
        }).catch(() => {
          /* non-fatal */
        });
      }
    } catch (err) {
      console.warn(
        '[generate-structured] bridge matcher threw — continuing without PRODUCT_RELEVANCE:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // PR Sprint 7.14 — load Voice Memory + Performance Memory.
  // Best-effort: a DB failure leaves the blocks as their
  // "not-enough-data" stubs (the builders are tolerant) so a
  // transient outage on the feedback side doesn't kill the
  // whole generate call. Goes in the SYSTEM prompt because
  // (a) Anthropic's prompt cache amortizes it across the N
  // content types in this batch and (b) feedback signals
  // change rarely (per-vote, per-rating events), so the cache
  // window stays warm for typical session activity.
  let feedbackBlock = '';
  try {
    const fb = await loadFeedbackMemoryBlock(projectId);
    feedbackBlock = fb.block;
  } catch (err) {
    console.warn(
      '[generate-structured] feedback memory load failed:',
      err instanceof Error ? err.message : err,
    );
  }

  // The cached system prompt is the same for every type in this
  // batch. Once warmed it costs ~10% of regular input on subsequent
  // calls inside the 5-min cache window.
  //
  // PR Sprint 7.14 — Voice Memory + Performance Memory blocks
  // join Brand + Voice Fingerprint in the system block. The
  // DUAL_LEARNING_GUIDANCE bundled inside feedbackBlock makes
  // the voice-vs-performance separation explicit so Claude
  // doesn't conflate "this style worked" with "this style
  // sounds like the founder."
  const systemPrompt = `You are Helm's content generator. You produce one structured draft per request, matching the brand voice and the exact schema specified by the caller.

BRAND
${brand}

VOICE FINGERPRINT
${voice}

${feedbackBlock}

RULES (every output)
- Match the brand voice exactly — use brand phrases, avoid banned terms.
- Specific over generic. No vague marketing copy.
- Respect the per-type guidelines provided in the user message.
- Return STRICT JSON only — no prose outside the JSON, no markdown fences.
- The JSON must validate against the provided structureSchema.
- Never invent facts about the audience or product beyond the brand bible.

${LANGUAGE_INSTRUCTION_AUDIENCE}`;

  const drafts: DraftPayload[] = [];

  // PR Sprint 7.13 — collapse DB content_type → platform-tone
  // taxonomy ('ugc' | 'carousel' | 'photo' | 'text') so the
  // compatibility validator + the rule banks key off the right
  // bucket. Done once outside the loop because the platform is
  // fixed for the whole batch.
  const platformLower = platform.toLowerCase();
  const platformIsKnown =
    platformLower in PLATFORM_CONTENT_COMPATIBILITY;

  // PR Sprint 7.16 — load Adaptive Voice Engine context once
  // before the loop. The context is fixed for the whole batch
  // (per-project), so loading it inside the loop would be
  // redundant. Best-effort: a failure leaves the context
  // undefined and we fall through to the non-adaptive prompt
  // path (Sprint 7.13's buildGenerationPrompt).
  let voiceEngineCtx: Awaited<
    ReturnType<typeof loadClientContext>
  > | null = null;
  try {
    voiceEngineCtx = await loadClientContext({
      userId: user.id,
      projectId,
    });
  } catch (err) {
    console.warn(
      '[generate-structured] voice engine context load failed:',
      err instanceof Error ? err.message : err,
    );
  }

  for (const template of templates) {
    // PR Sprint 7.13 — validate platform + content_type
    // compatibility BEFORE the Opus call. If the combination is
    // unsupported (e.g., carousel on Reddit), we short-circuit
    // with a categorized error rather than burn an Opus call
    // and have the model improvise.
    const taxonomy = mapDbContentTypeToTaxonomy(template.type);
    if (platformIsKnown && taxonomy) {
      const supported =
        PLATFORM_CONTENT_COMPATIBILITY[platformLower as Platform];
      if (!supported.includes(taxonomy)) {
        const err = new InvalidContentForPlatformError(
          platformLower as Platform,
          taxonomy,
        );
        drafts.push({
          id: '',
          contentType: template.type,
          displayName: template.displayName,
          structuredContent: null,
          error: err.message,
          errorKind: 'unknown',
          errorHint:
            'This content type is not allowed on this platform. Pick a different combination in the Generator.',
          errorRetry: false,
        });
        continue;
      }
    }

    // PR Sprint 7.13 — replace the per-template prompt with the
    // stacked platform-tone + content-type-rules prompt. Brand
    // Bible + Voice Fingerprint are passed via buildGeneration
    // Prompt so the model sees them in the canonical order
    // (alongside CONTENT_TYPE_RULES and PLATFORM_TONE), but the
    // cached system prompt above still carries them — that
    // duplication is intentional: the system prompt cache hit
    // keeps the cost near zero on subsequent calls, and the
    // user-prompt copy is the one the platform-tone rule set
    // explicitly references in its ORDER OF PRECEDENCE block.
    //
    // We also still append the per-template structureSchema so
    // Opus knows the exact JSON shape to emit. The
    // structureSchema lives in content_types (DB-driven) — that
    // hasn't moved.
    // PR Sprint 7.16 — when the Voice Engine context is loaded,
    // use the adaptive prompt (CLIENT CONTEXT block + override
    // self-report contract). Otherwise fall back to the
    // Sprint 7.13 platform-tone prompt — same scaffolding minus
    // the per-client learning layer.
    const baseStackedPrompt =
      platformIsKnown && taxonomy
        ? voiceEngineCtx
          ? buildAdaptivePrompt({
              platform: platformLower as VoiceEnginePlatform,
              contentType: taxonomy as VoiceEngineContentType,
              clientContext: voiceEngineCtx,
              painPoint: userPrompt,
              includeExamples: true,
              // PR Sprint 7.22 Sprint B — bridge match (or empty).
              productRelevanceSection,
              // PR Sprint 7.22 Sprint E.1 — variety mode (or empty).
              varietyInstructionSection,
              // PR Sprint 7.22 Sprint E.2 — writer voice profile.
              writerVoiceProfileSection,
            })
          : buildGenerationPrompt({
              platform: platformLower,
              contentType: taxonomy,
              brandBible: brand,
              voiceFingerprint: voice,
              painPoint: userPrompt,
              // PR Sprint 7.13 v2 — production default: examples ON.
              // The CONTENT_TYPE_EXAMPLES block adds ~400-600 tokens
              // to the user message but measurably improves output
              // quality (LLMs pattern-match on the good/bad pairs).
              includeExamples: true,
              // PR Sprint 7.22 Sprint B — bridge match (or empty).
              productRelevanceSection,
              // PR Sprint 7.22 Sprint E.1 — variety mode (or empty).
              varietyInstructionSection,
              // PR Sprint 7.22 Sprint E.2 — writer voice profile.
              writerVoiceProfileSection,
            })
        : null;

    // PR Sprint 7.18 — UGC bundle support. For content_type='ugc'
    // we append the strict-JSON UGC schema instructions + v2.0
    // additions (4 founder-voice archetypes + voice-priority
    // line) on top of the adaptive prompt. The per-template
    // structureSchema from content_types gets replaced by the
    // UGC schema in this branch — the UGC bundle shape is the
    // canonical output for video scripts and the DB column shape
    // (hook+beats+overlays+caption+metadata) supersedes the
    // legacy {opening, body, closing} the generic structureSchema
    // would otherwise emit.
    const isUgcType = taxonomy === 'ugc';
    const stackedPrompt = baseStackedPrompt
      ? isUgcType
        ? appendUgcSchemaToPrompt(baseStackedPrompt, platformLower)
        : baseStackedPrompt
      : null;

    const userMessage = stackedPrompt
      ? isUgcType
        ? // PR Sprint 7.18 — UGC path: appendUgcSchemaToPrompt
          // ALREADY embedded the canonical schema instructions
          // (UGC_OUTPUT_SCHEMA_INSTRUCTION) into stackedPrompt.
          // Don't append the DB structureSchema on top — that
          // would conflict with the UGC bundle shape and the
          // model would emit something neither validator can
          // parse. Per-row guidelines still useful as steering.
          `${stackedPrompt}

CONTENT TYPE (DB row): ${template.displayName} (platform: ${platform}, type: ${template.type})

GUIDELINES (per content_type row):
${template.guidelines ?? '(none)'}

Return ONLY the UGCBundle JSON as instructed above. No markdown fences, no prose outside JSON.`
        : `${stackedPrompt}

CONTENT TYPE (DB-specific override): ${template.displayName} (platform: ${platform}, type: ${template.type})

GUIDELINES (per content_type row):
${template.guidelines ?? '(none)'}

OUTPUT SCHEMA (JSON Schema — Opus must emit JSON matching this):
${JSON.stringify(template.structureSchema, null, 2)}

Return STRICT JSON matching the schema. No markdown fences, no prose outside JSON.`
      : // Fallback for unknown platform OR unmapped content_type.
        // Preserves the pre-Sprint-7.13 prompt shape so legacy
        // generation paths keep working.
        `CONTENT TYPE: ${template.displayName} (platform: ${platform}, type: ${template.type})

USER REQUEST
${userPrompt}

INSTRUCTIONS
${template.promptTemplate}

GUIDELINES
${template.guidelines ?? '(none)'}

OUTPUT SCHEMA (JSON Schema)
${JSON.stringify(template.structureSchema, null, 2)}

Return STRICT JSON matching the schema. No markdown fences, no prose outside JSON.`;

    // PR Sprint 7.24 — Prompt 3. Append the variant hint to the
    // userMessage (empty when single-variant). Keeping the hint at
    // the END so it's the last thing the model reads before
    // composing — recency bias makes the hook-style guidance
    // stickier than if it were buried higher in the prompt.
    const userMessageForVariant = `${userMessage}${variantHint}`;

    let parsed: unknown = null;
    let typeErrorKind: ErrorKind | null = null;
    let typeErrorMsg: string | null = null;
    try {
      const response = await anthropic.messages.create({
        model: MODELS.OPUS,
        max_tokens: 2500,
        system: cachedSystem(systemPrompt),
        messages: [{ role: 'user', content: userMessageForVariant }],
      });

      await trackUsage({
        endpoint: 'ai-generate-structured',
        model: MODELS.OPUS,
        usage: response.usage,
        userId: user.id,
        projectId,
      });

      // PR #75 — Sprint 7.2C hotfix: explicit max_tokens guard. The
      // 2500-token ceiling here is tight for some carousel templates;
      // a stop_reason='max_tokens' truncation produces invalid JSON
      // that the parser blames as a parse error. Surface this as its
      // own categorized failure so the wizard can render a clearer
      // retry CTA.
      if (response.stop_reason === 'max_tokens') {
        typeErrorKind = 'json';
        typeErrorMsg =
          'Opus hit the max_tokens ceiling — output truncated before completion.';
        console.error(
          `[generate-structured] ${platform}/${template.type} truncated at max_tokens`,
        );
      } else {
        const textBlock = response.content.find((b) => b.type === 'text');
        const raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';

        // PR Sprint 7.16 — strip + capture the model's
        // <override_log> self-report BEFORE the JSON parse. The
        // adaptive prompt asks Opus to append the tag block when
        // it actually applied any learned override; that block is
        // never part of the structured payload but our parser
        // would choke if it leaked into the JSON. parseOverrideLog
        // returns the clean output + the records; we persist the
        // records to the audit log so operators can trace which
        // overrides drove which drafts.
        const { cleanDraft, records } = parseOverrideLog(raw);
        if (records.length > 0 && voiceEngineCtx) {
          // Fire-and-forget audit writes (one row per override
          // applied). A failure here is non-fatal — the draft
          // still ships.
          for (const r of records) {
            void logAudit({
              userId: user.id,
              projectId,
              action: 'model_applied_override',
              platform: platformLower as VoiceEnginePlatform,
              notes: `dimension=${r.dimension} applied=${r.applied} default=${r.default} confidence=${r.confidence}`,
            }).catch(() => {
              /* non-fatal */
            });
          }
        }

        const cleaned = cleanDraft
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        parsed = JSON.parse(cleaned);

        // PR Sprint 7.18 — UGC bundle validation. Zod first
        // (strict JSON shape: hook 5-9 words, beats sequential,
        // overlay <=5 words, hashtag format, etc.). On success
        // run the soft validator (8 checks including v2.0's
        // hook_specificity + cta_not_sales_disguised). Both are
        // best-effort — we log + persist the bundle anyway so
        // the founder can see what came out and decide whether
        // to regenerate. Hard auto-retry is intentionally NOT
        // wired here yet (SHIP.md flags it as nice-to-have); a
        // failure today shows up in the audit log as a
        // ugc_validation_failed entry per check.
        if (isUgcType && parsed) {
          // PR Sprint 7.25 Phase 9 — resilient UGC parse. Strict
          // validation first; if it fails, the repair pass coerces
          // common Opus drift (cta returned as a string, delivery
          // value capitalised wrong, duration_seconds out of
          // range, missing beat numbers, etc.) into the canonical
          // shape and re-validates. We log original issues either
          // way so audit tells us which drift to fix at the prompt
          // level, but the founder doesn't see a failed generation
          // for repair-able shapes anymore.
          const parseResult = parseUgcBundle(parsed);
          if (parseResult.kind === 'failed') {
            console.warn(
              `[generate-structured] UGC schema invalid for ${platform}/${template.type} (repair failed):`,
              parseResult.issues,
              '— actual payload preview:',
              JSON.stringify(parsed).slice(0, 800),
            );
            if (voiceEngineCtx) {
              void logAudit({
                userId: user.id,
                projectId,
                action: 'ugc_schema_validation_failed',
                platform: platformLower as VoiceEnginePlatform,
                notes: parseResult.issues.slice(0, 500),
              }).catch(() => {
                /* non-fatal */
              });
            }
            typeErrorKind = 'json';
            typeErrorMsg = `UGC bundle failed Zod validation: ${parseResult.issues.slice(0, 300)}`;
            parsed = null;
          } else {
            if (parseResult.kind === 'repaired') {
              // Strict failed but repair worked — log the original
              // issues so we can iterate the prompt, but ship the
              // bundle anyway. Founders should never see this; it's
              // an observability signal for us.
              console.warn(
                `[generate-structured] UGC schema repaired for ${platform}/${template.type}. Original issues:`,
                parseResult.originalIssues,
              );
              if (voiceEngineCtx) {
                void logAudit({
                  userId: user.id,
                  projectId,
                  action: 'ugc_schema_repaired',
                  platform: platformLower as VoiceEnginePlatform,
                  notes: parseResult.originalIssues.slice(0, 500),
                }).catch(() => {
                  /* non-fatal */
                });
              }
              // Use the repaired bundle as `parsed` going forward
              // so persistence + downstream consumers see the
              // canonical shape, not the malformed original.
              parsed = parseResult.bundle as unknown as Record<string, unknown>;
            }
            const softFailures = validateUgcBundle(parseResult.bundle);
            if (softFailures.length > 0) {
              console.warn(
                `[generate-structured] UGC soft validation flagged ${softFailures.length} issues for ${platform}/${template.type}:`,
                softFailures.join(' | '),
              );
              if (voiceEngineCtx) {
                // One audit row per failure so the operator
                // grep query keeps surfacing individual rules
                // (hook_specificity, cta_not_sales_disguised,
                // etc.) instead of one giant blob.
                for (const msg of softFailures) {
                  void logAudit({
                    userId: user.id,
                    projectId,
                    action: 'ugc_soft_validation_warning',
                    platform: platformLower as VoiceEnginePlatform,
                    notes: msg.slice(0, 500),
                  }).catch(() => {
                    /* non-fatal */
                  });
                }
              }
              // Don't kill the draft — soft failures are
              // warnings, not blockers. The bundle still lands
              // in the Library and the founder can iterate.
            }
            // parsed stays = parsed; Zod normalized field
            // defaults but identity is preserved.
          }
        }

        // PR Sprint 7.22 Fase 2 — text-post validators for non-UGC
        // content types. Runs after the structured JSON parsed
        // successfully; failures go to the audit log per the same
        // observability pattern UGC uses. Soft validators are
        // intentionally non-blocking — at this stage we want
        // telemetry on how often each check fires before we
        // consider gating + regeneration.
        //
        // Why all non-UGC taxonomies: the validators are pure
        // string heuristics (chiastic flip, blockquote, tricolon,
        // header count, templated CTA, authenticity markers). A
        // carousel slide's body or a photo caption is just as
        // exposed to these AI tells as a pure text post; running
        // the checks across the full structured payload catches
        // tells wherever they land.
        if (!isUgcType && parsed) {
          const flat = flattenStructuredContentForValidation(parsed);
          if (flat.length > 0) {
            const textFailures = validateTextPost(flat, {
              platform: platformLower,
            });
            if (textFailures.length > 0) {
              console.warn(
                `[generate-structured] text-post validators flagged ${textFailures.length} issues for ${platform}/${template.type}:`,
                textFailures.join(' | '),
              );
              if (voiceEngineCtx) {
                // One audit row per failure so individual rules
                // (x_not_y, tricolon, templated_cta, etc.) keep
                // their own grep query in the operator dashboard.
                for (const msg of textFailures) {
                  void logAudit({
                    userId: user.id,
                    projectId,
                    action: 'text_post_soft_validation_warning',
                    platform: platformLower as VoiceEnginePlatform,
                    notes: msg.slice(0, 500),
                  }).catch(() => {
                    /* non-fatal */
                  });
                }
              }
              // Don't kill the draft — same posture as UGC soft
              // validation. Telemetry first, gating after we see
              // base rates from real production output.
            }
          }
        }
      }
    } catch (err) {
      // PR #75 — Sprint 7.2C hotfix: categorize instead of dropping
      // a raw error string. The shared helper distinguishes between
      // 529 overloaded (retryable in ~60s), 429 rate limit (back off),
      // 504 timeout (retryable), 502 malformed JSON (transient),
      // 401 auth (NOT user-fixable), and unknown.
      const cat = categorizeAnthropicError(err);
      typeErrorKind = cat.kind;
      typeErrorMsg = cat.message;
      console.error(
        `[generate-structured] ${platform}/${template.type} failed (${cat.kind}):`,
        typeErrorMsg,
      );
    }

    if (!parsed) {
      const finalKind = typeErrorKind ?? 'unknown';
      const desc = describeError(finalKind);
      drafts.push({
        id: '',
        contentType: template.type,
        displayName: template.displayName,
        structuredContent: null,
        error: typeErrorMsg ?? desc.error,
        errorKind: finalKind,
        errorHint: desc.hint,
        errorRetry: desc.retry,
      });
      continue;
    }

    // Build a human-readable fallback for the legacy `content` field
    // so Library/Calendar (which read `content`) still surface a
    // useful preview. We pick the most prominent string field; if
    // none, JSON-stringify a short version.
    const contentPreview = buildContentPreview(parsed);

    // PR Sprint 7.13 (BUG 2) — compute the brand-fit score on
    // the preview text. Best-effort: a failure (Opus overload,
    // missing bible, etc.) leaves the score null instead of
    // failing the whole draft. The post-card.tsx UI handles
    // null gracefully (no badge rendered).
    let consistencyScore: number | null = null;
    let scoreBreakdown: Record<string, unknown> | null = null;
    try {
      const score = await computeConsistencyScore(contentPreview, bible);
      consistencyScore = score.total;
      scoreBreakdown = score as unknown as Record<string, unknown>;
    } catch (scoreErr) {
      console.warn(
        `[generate-structured] consistency score failed for ${platform}/${template.type}:`,
        scoreErr instanceof Error ? scoreErr.message : scoreErr,
      );
    }

    const [inserted] = await db
      .insert(generatedPosts)
      .values({
        projectId,
        platform,
        content: contentPreview,
        prompt: userPrompt,
        contentType: template.type,
        structuredContent: parsed as object,
        consistencyScore,
        scoreBreakdown,
        // PR Sprint 7.24 — Prompt 3. Both fields null on single-
        // variant calls (legacy callers). Both set on A/B-pair
        // calls so the Library can render the pair side-by-side.
        variantLabel,
        variantGroupId,
      })
      .returning({ id: generatedPosts.id });

    // PR #76 — Sprint 7.3: video-needing types (reel, ugc) also
    // get a queued HeyGen job. The job is INSERTED only — the
    // actual HeyGen call lives in a future worker behind the
    // HEYGEN_ENABLED feature flag. We annotate the structured
    // content with heygenJobId + heygenStatus='queued' so the
    // Library/draft-card UI can render a "Video queued — coming
    // soon" badge without a second roundtrip.
    let outputContent: unknown = parsed;
    if (TYPES_NEED_VIDEO.has(template.type)) {
      const scriptText = extractScriptText(template.type, parsed);
      if (scriptText) {
        try {
          const [job] = await db
            .insert(heygenJobs)
            .values({
              draftId: inserted.id,
              projectId,
              userId: user.id,
              status: 'queued',
              scriptText: scriptText.slice(0, 4000),
            })
            .returning({ id: heygenJobs.id });

          // Merge the job ref into the structured content so the
          // client can render the badge directly from the draft
          // payload (no separate fetch needed for the common
          // "is this video queued?" check).
          outputContent = {
            ...(parsed as Record<string, unknown>),
            heygenJobId: job.id,
            heygenStatus: 'queued' as const,
          };

          // Also persist the annotated copy on the draft itself so
          // a Library page reload still sees the badge data.
          await db
            .update(generatedPosts)
            .set({ structuredContent: outputContent as object })
            .where(eq(generatedPosts.id, inserted.id));
        } catch (heygenErr) {
          // Don't fail the whole draft generation if the queue
          // insert errors — log + continue without the badge. The
          // founder still gets the script; they just can't queue
          // a video for it this round.
          console.error(
            `[generate-structured] heygen queue insert failed for ${template.type}:`,
            heygenErr,
          );
        }
      }
    }

    drafts.push({
      id: inserted.id,
      contentType: template.type,
      displayName: template.displayName,
      structuredContent: outputContent,
      consistencyScore,
      // PR Sprint 7.24 — Prompt 3. Surface to the client so the
      // generate panel + Library card can render the variant chip
      // immediately without a Library refetch.
      variantLabel,
      variantGroupId,
    });
  }

  // PR #75 — Sprint 7.2C hotfix: top-level success/failure
  // disambiguation. Before this commit the endpoint returned
  // success=true even when every per-type Opus call had failed,
  // forcing clients to inspect drafts[].structuredContent for null.
  // The wizard's first-content step was doing exactly that wrong —
  // success=true + drafts[0].structuredContent=null produced a
  // rendered carousel with empty slides.
  //
  // Now: ANY successful draft → success=true (preserves existing
  // partial-success semantics for /marketing/generate which submits
  // multiple types). ZERO successful drafts → success=false with the
  // categorized kind of the first failure (they're usually all the
  // same — if Opus is overloaded, every loop iteration hits the
  // same 529).
  const successful = drafts.filter((d) => d.structuredContent != null);
  if (successful.length === 0 && drafts.length > 0) {
    const first = drafts[0];
    const kind = (first.errorKind ?? 'unknown') as ErrorKind;
    const desc = describeError(kind);
    if (wowMode) {
      // PR Sprint onboarding-wow — terminal failure telemetry. The
      // wow page renders a fallback CTA when zero drafts succeed;
      // this event lets us measure how often the onboarding moment
      // fails entirely vs. partially fails.
      Sentry.captureMessage('onboarding_wow_drafts_failed', {
        level: 'warning',
        tags: { area: 'onboarding', kind: 'wow-moment' },
        extra: {
          userId: user.id,
          projectId,
          platform,
          requestedTypes,
          errorKind: kind,
          firstErrorMessage: first.error,
        },
      });
    }
    return NextResponse.json(
      {
        success: false,
        error: desc.error,
        errorKind: kind,
        retry: desc.retry,
        retryAfterSeconds: desc.retryAfterSeconds,
        hint: desc.hint,
        // Also include the per-type drafts so the legacy
        // /marketing/generate UI can still render its per-type cards
        // with categorized errors even on a total failure.
        drafts,
        typesGenerated: [],
        // PR Sprint onboarding-wow — even on total failure return
        // an empty draftIds[] so the wow page can read the field
        // unconditionally.
        draftIds: [] as string[],
      },
      { status: desc.status },
    );
  }

  // PR Sprint 7.22 Sprint E.1 — F4 variety injection writeback.
  // Only record archetype usage when at least one draft actually
  // came out — a failed batch shouldn't pollute the sliding window
  // with a usage that didn't ship. Fire-and-forget UPDATE on the
  // projects row so the next request sees the new window.
  if (successful.length > 0 && bible) {
    try {
      const nextRecentArchetypes = recordArchetypeUsage(
        recentArchetypesForPlatform,
        chosenArchetype,
        varietyInjectedThisRequest,
        platformVarietyConfig,
      );
      const nextBible: BrandBible = {
        ...bible,
        recentArchetypes: {
          ...(bible.recentArchetypes ?? {}),
          [platformLowerForVariety]: nextRecentArchetypes,
        },
      };
      void db
        .update(projects)
        .set({ brandContext: nextBible })
        .where(eq(projects.id, projectId))
        .catch((err: unknown) => {
          console.warn(
            '[generate-structured] variety archetype writeback failed (non-fatal):',
            err instanceof Error ? err.message : err,
          );
        });
    } catch (err) {
      console.warn(
        '[generate-structured] variety archetype recording threw (non-fatal):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // PR Sprint 7.22 Sprint C — F3 authenticity smell test (telemetry
  // only). Fire-and-forget Haiku call that scores the FIRST
  // successful draft 0-100 on authenticity and writes the result
  // to the audit log. ~$0.001 + ~1s but doesn't block the response
  // because we never await it. Picking only the first draft keeps
  // the per-request smell-test cost flat regardless of batch size.
  //
  // Why this lives at the bottom of the function (not per content
  // type in the loop): we want exactly ONE smell-test data point
  // per request so the metric is comparable across founders who
  // generate 1 vs 5 content types. The first successful draft is
  // representative — the same brand + voice + bridge inputs drive
  // every type in the batch.
  //
  // Once we have a week of base-rate scores in the audit log we
  // can decide whether to (a) gate generation on smellTestPasses
  // and regenerate failures, (b) expose the score to the UI as a
  // brand-fit indicator, or (c) feed scores back into a per-
  // platform calibration job. Today: telemetry only.
  if (successful.length > 0) {
    const firstSuccessful = successful[0];
    if (firstSuccessful) {
      const flatText = flattenStructuredContentForValidation(
        firstSuccessful.structuredContent,
      );
      if (flatText.length > 20) {
        void smellTestAuthenticity({
          postText: flatText,
          platform: platformLower,
          contentType: firstSuccessful.contentType,
        })
          .then((result: SmellTestResult) => {
            void logAudit({
              userId: user.id,
              projectId,
              action: 'authenticity_smell_test',
              platform: platformLower as VoiceEnginePlatform,
              notes: `score=${result.score} verdict=${result.verdict} type=${firstSuccessful.contentType} issues=${result.primaryIssues.slice(0, 2).join('; ').slice(0, 300)}`.slice(
                0,
                500,
              ),
            }).catch(() => {
              /* non-fatal */
            });
          })
          .catch((err: unknown) => {
            console.warn(
              '[generate-structured] smell test failed (non-fatal):',
              err instanceof Error ? err.message : err,
            );
          });
      }
    }
  }

  // PR Sprint onboarding-wow — extract IDs of successful drafts so
  // the wow page (and any future caller) doesn't have to filter
  // drafts[] client-side. Order matches the requested types order
  // because we iterate `templates` in DB row order which corresponds
  // to `requestedTypes`.
  const draftIds = successful.map((d) => d.id);

  if (wowMode) {
    Sentry.captureMessage('onboarding_wow_drafts_completed', {
      level: 'info',
      tags: { area: 'onboarding', kind: 'wow-moment' },
      extra: {
        userId: user.id,
        projectId,
        platform,
        requestedTypes,
        draftIds,
        successCount: successful.length,
      },
    });
  }

  return NextResponse.json({
    success: true,
    drafts,
    typesGenerated: successful.map((d) => d.contentType),
    // PR Sprint onboarding-wow — top-level draftIds[] for easy
    // consumption. Always present (empty on total failure handled
    // above; populated here for partial + full success).
    draftIds,
  });
}

// Pick a sensible string preview from a parsed structured draft so
// the legacy `content` column has something readable. Different
// types have different "headline" fields — caption for IG, hook for
// LinkedIn, title for Reddit, first tweet for threads.
function buildContentPreview(structured: unknown): string {
  if (!structured || typeof structured !== 'object') return '';
  const obj = structured as Record<string, unknown>;

  const preferredKeys = [
    'caption',
    'hook',
    'title',
    'content',
    'opening',
    'coverCopy',
  ];
  for (const key of preferredKeys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.slice(0, 2000);
    }
  }
  // Thread → join the first 2 tweets.
  if (Array.isArray(obj.tweets) && obj.tweets.length > 0) {
    return (obj.tweets as unknown[])
      .slice(0, 2)
      .filter((t): t is string => typeof t === 'string')
      .join('\n\n')
      .slice(0, 2000);
  }
  // Carousel → cover slide.
  if (Array.isArray(obj.slides) && obj.slides.length > 0) {
    const cover = obj.slides[0] as Record<string, unknown>;
    const title = typeof cover?.title === 'string' ? cover.title : '';
    const bodyTxt = typeof cover?.body === 'string' ? cover.body : '';
    return [title, bodyTxt].filter(Boolean).join(' — ').slice(0, 2000);
  }
  // Fallback — stringify a trimmed version.
  return JSON.stringify(structured).slice(0, 500);
}
