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
  type UGCBundle,
} from '@/lib/voice-engine/ugc-schema';
import { validateUgcBundle } from '@/lib/voice-engine/ugc-validator';

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
// use hook + beats + caption, ugc uses opening + body + closing.
// We concatenate whatever's present into a single string the
// HeyGen worker can pass straight to the avatar.
function extractScriptText(
  contentType: string,
  structured: unknown,
): string | null {
  if (!structured || typeof structured !== 'object') return null;
  const obj = structured as Record<string, unknown>;
  const parts: string[] = [];

  // Reel: hook + beat dialogue/audio + caption.
  if (contentType === 'reel') {
    if (typeof obj.hook === 'string') parts.push(obj.hook);
    if (Array.isArray(obj.beats)) {
      for (const b of obj.beats) {
        if (b && typeof b === 'object') {
          const beat = b as Record<string, unknown>;
          if (typeof beat.audio === 'string') parts.push(beat.audio);
        }
      }
    }
    if (typeof obj.caption === 'string') parts.push(obj.caption);
  }

  // UGC: opening + body + closing reads as a natural script.
  if (contentType === 'ugc') {
    if (typeof obj.opening === 'string') parts.push(obj.opening);
    if (typeof obj.body === 'string') parts.push(obj.body);
    if (typeof obj.closing === 'string') parts.push(obj.closing);
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

  const limit = checkRateLimit(
    `generate-structured:${user.id}`,
    5,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: {
    projectId?: string;
    platform?: string;
    prompt?: string;
    types?: string[];
  };
  try {
    body = (await request.json()) as {
      projectId?: string;
      platform?: string;
      prompt?: string;
      types?: string[];
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId, platform, prompt } = body;
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

    let parsed: unknown = null;
    let typeErrorKind: ErrorKind | null = null;
    let typeErrorMsg: string | null = null;
    try {
      const response = await anthropic.messages.create({
        model: MODELS.OPUS,
        max_tokens: 2500,
        system: cachedSystem(systemPrompt),
        messages: [{ role: 'user', content: userMessage }],
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
          const zodResult = UGCBundleSchema.safeParse(parsed);
          if (!zodResult.success) {
            const issues = zodResult.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ');
            console.warn(
              `[generate-structured] UGC schema invalid for ${platform}/${template.type}:`,
              issues,
            );
            if (voiceEngineCtx) {
              void logAudit({
                userId: user.id,
                projectId,
                action: 'ugc_schema_validation_failed',
                platform: platformLower as VoiceEnginePlatform,
                notes: issues.slice(0, 500),
              }).catch(() => {
                /* non-fatal */
              });
            }
            // Surface as a JSON kind failure so the wizard
            // shows a retry CTA — same path the malformed-JSON
            // branch uses.
            typeErrorKind = 'json';
            typeErrorMsg = `UGC bundle failed Zod validation: ${issues.slice(0, 300)}`;
            parsed = null;
          } else {
            const softFailures = validateUgcBundle(zodResult.data as UGCBundle);
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
      },
      { status: desc.status },
    );
  }

  return NextResponse.json({
    success: true,
    drafts,
    typesGenerated: successful.map((d) => d.contentType),
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
