// PR Sprint 7.27 — Asset-based content flow: UGC script A/B picker.
// PR Sprint 7.28 — Routed through the canonical voice engine
// (buildAdaptivePrompt + appendUgcSchemaToPrompt) so the A/B
// variants inherit the same prompt engineering generate-structured
// has used since Sprint 7.16:
//
//   - Brand bible serialization (voice, audience, positioning,
//     pillars, banned phrases, mandatory signals)
//   - Voice fingerprint samples (writer's actual past output on
//     the target platform, weighted by recency)
//   - Winning / losing patterns + anti-samples by dimension
//   - Learned overrides from the feedback loop
//   - HUMANIZE_RULES (anti-AI-tell)
//   - PLATFORM_TONE for the target platform
//   - CONTENT_TYPE_RULES + CONTENT_TYPE_EXAMPLES for UGC
//   - UGC_OUTPUT_SCHEMA_INSTRUCTION (cadence + hook + delivery
//     rules + strict UGCBundle JSON shape)
//
// POST /api/ai/generate-ugc-scripts
//   Body: { projectId, prompt, assetType }
//          assetType in 'ugc_video' | 'reel'
//
// Returns two UGCBundle variants in parallel. They differ in HOOK
// STYLE via a deterministic varietyInstructionSection appended to
// the prompt — A = DIRECT (state insight plainly), B = STORY
// (open with question/scenario). Founder picks one; the chosen
// bundle's spoken text becomes the script that flows into
// /api/ai/generate-asset via baseContentOverride.
//
// Anthropic prompt caching means the cached system + the
// PROMPT_COMPOSITION_RULES + dynamic context prefix is re-used on
// the second call, so wall-clock for 2 variants is close to a
// single call.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  anthropic,
  MODELS,
  cachedSystem,
  LANGUAGE_INSTRUCTION_AUDIENCE,
} from '@/lib/ai/claude';
import { loadClientContext } from '@/lib/voice-engine/loader';
import { buildAdaptivePrompt } from '@/lib/voice-engine/prompt-builder';
import { appendUgcSchemaToPrompt } from '@/lib/voice-engine/ugc-prompt';
import {
  parseUgcBundle,
  scriptText as flattenScript,
  type UGCBundle,
} from '@/lib/voice-engine/ugc-schema';
import {
  assetTypeToContentType,
  platformToVoicePlatform,
  approximateSpokenDurationSeconds,
} from '@/lib/voice-engine/asset-mapping';
import type { AssetType, Platform } from '@/lib/marketing/platform-rules';

// Two parallel Haiku calls. With prompt caching the second is
// near-zero marginal latency, so 30s is plenty even on cold
// cache.
export const maxDuration = 30;

interface RequestBody {
  projectId?: string;
  prompt?: string;
  assetType?: string;
  // Optional: the founder's preferred publishing platform for
  // this asset. Engine-side learning is keyed by platform, so
  // when set we route through that platform's voice fingerprint
  // and winning/losing patterns. Defaults to 'tiktok' (the most
  // common UGC target).
  primaryPlatform?: string;
}

interface VariantResponse {
  label: 'A' | 'B';
  // Flat spoken text — what HeyGen reads. Concatenation of
  // bundle.hook.text + bundle.body[].text + bundle.cta.text.
  // The panel surfaces this as the script preview.
  spokenText: string;
  // Word count (for the panel's preview chips). 30s of natural
  // speech ≈ 70-90 words; the engine's UGC rules enforce that
  // range.
  wordCount: number;
  // The full structured bundle. Stored on the picked asset so
  // future surfaces can render overlays / hashtags / caption.
  bundle: UGCBundle;
  // 'ok' | 'repaired' — propagated from parseUgcBundle so the UI
  // can show a soft warning when the strict parser had to
  // salvage the output.
  parseKind: 'ok' | 'repaired';
}

// Variety bias — the deterministic hook-style override appended
// at the END of the prompt (recency-bias placement, per the
// variety-injector's contract). Forces variant A to use a DIRECT
// hook and variant B to use a STORY hook so the founder has two
// meaningfully different takes to choose between.
//
// We intentionally do NOT use selectVarietyArchetype here — that
// helper is probabilistic and rotates archetypes based on recent
// usage. For A/B we want deterministic divergence on the SAME
// dimension (hook style) so the picker is actionable, not random.
function varietySectionFor(label: 'A' | 'B'): string {
  if (label === 'A') {
    return `VARIETY MODE: DIRECT HOOK ARCHETYPE
Open the hook by stating the insight plainly in the first line.
Avoid story setups. Avoid rhetorical questions. The viewer should
know the claim from the first 5-9 words. Body proves the claim
with one concrete example. CTA is a clear single-step ask.`;
  }
  return `VARIETY MODE: STORY HOOK ARCHETYPE
Open the hook with a question OR a one-sentence scenario the
viewer recognizes. DO NOT lead with the insight — reveal it at
mid-script as the payoff. CTA can be a reflection or a soft ask.
This variant should read meaningfully different from a direct-
hook take of the same topic.`;
}

async function generateOneVariant(args: {
  label: 'A' | 'B';
  prompt: string;
  voicePlatform: ReturnType<typeof platformToVoicePlatform>;
  clientContext: Awaited<ReturnType<typeof loadClientContext>>;
}): Promise<VariantResponse | { error: string }> {
  // buildAdaptivePrompt stacks: PROMPT_COMPOSITION_RULES +
  // HUMANIZE_RULES + CLIENT CONTEXT (brand bible + voice samples
  // + winning/losing + anti-samples + overrides) + PAIN_POINT +
  // CONTENT_TYPE_RULES (for 'ugc') + EXAMPLES + PLATFORM_TONE +
  // override_log instructions + VARIETY MODE block at the end.
  let basePrompt: string;
  try {
    basePrompt = buildAdaptivePrompt({
      platform: args.voicePlatform,
      contentType: 'ugc',
      clientContext: args.clientContext,
      painPoint: args.prompt,
      includeExamples: true,
      injectHumanize: true,
      varietyInstructionSection: varietySectionFor(args.label),
    });
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? `prompt build failed: ${e.message}`
          : 'prompt build failed',
    };
  }

  // appendUgcSchemaToPrompt splices UGC_OUTPUT_SCHEMA_INSTRUCTION
  // (cadence + hook + delivery + overlay + caption rules + the
  // strict JSON shape) onto the end. The model must return a
  // UGCBundle JSON; everything else is a parse failure.
  const stackedPrompt = appendUgcSchemaToPrompt(
    basePrompt,
    args.voicePlatform,
  );

  // System prompt mirrors generate-structured's pattern — a
  // brief identity setter + brand summary fragments. The bulk of
  // the prompt engineering lives in the user message because
  // that's what the engine returns from buildAdaptivePrompt.
  const systemText = [
    "You are Helm's content generator. You produce one UGCBundle JSON",
    'per request, matching the brand voice and the schema below.',
    '',
    'RULES (every output)',
    '- Match the brand voice exactly — use brand phrases, avoid banned terms.',
    '- Specific over generic. No vague marketing copy.',
    '- Respect the cadence + hook + delivery + overlay rules in the user message.',
    '- Return STRICT JSON only — no prose outside the JSON, no markdown fences.',
    '- The JSON must validate against the UGCBundle schema.',
    '- Never invent facts about the audience or product beyond the brand bible.',
    '',
    LANGUAGE_INSTRUCTION_AUDIENCE,
  ].join('\n');

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 2000,
      system: cachedSystem(systemText),
      messages: [{ role: 'user', content: stackedPrompt }],
    });
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? `model call failed: ${e.message}`
          : 'model call failed',
    };
  }

  const text = (resp.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('')
    .trim();

  // The model may include an <override_log> block alongside the
  // JSON. Strip surrounding markdown fences + leading prose; the
  // raw JSON is what parseUgcBundle expects.
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return {
      error: 'Model returned no JSON object',
    };
  }
  const jsonStr = text.slice(jsonStart, jsonEnd + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch (e) {
    return {
      error: `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`,
    };
  }

  const parsed = parseUgcBundle(raw);
  if (parsed.kind === 'failed') {
    return { error: `UGCBundle schema failed: ${parsed.issues.slice(0, 300)}` };
  }
  const bundle = parsed.bundle;
  const spoken = flattenScript(bundle);
  return {
    label: args.label,
    spokenText: spoken,
    wordCount: spoken.trim().split(/\s+/).filter(Boolean).length,
    bundle,
    parseKind: parsed.kind,
  };
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as RequestBody;
    const projectId = body.projectId;
    const prompt = (body.prompt ?? '').trim();
    const assetType = body.assetType as AssetType | undefined;
    if (!projectId || !prompt || !assetType) {
      return NextResponse.json(
        { error: 'projectId, prompt, and assetType are required' },
        { status: 400 },
      );
    }
    if (assetType !== 'ugc_video' && assetType !== 'reel') {
      return NextResponse.json(
        {
          error:
            'A/B script flow is only for ugc_video and reel asset types',
        },
        { status: 400 },
      );
    }

    // Ownership check — loadClientContext also enforces the
    // project belongs to this user, but failing fast saves a DB
    // round-trip for forged requests.
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
      .limit(1);
    if (!project) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Load the ClientContext (brand bible + voice fingerprint +
    // winning/losing patterns + learned overrides + anti-samples).
    // Cold start creates an empty row scoped to this project so
    // every Haiku call below sees the same baseline.
    const clientContext = await loadClientContext({
      userId: user.id,
      projectId,
    });

    // Engine learning is keyed by parent network — IG Reels and
    // FB Reels fold into 'instagram' / 'facebook'. UGC scripts
    // default to TikTok learning since most UGC ships there, but
    // the caller can override per-project.
    const requestedPlatform = (body.primaryPlatform ?? 'tiktok') as Platform;
    const voicePlatform = platformToVoicePlatform(requestedPlatform);

    // The fold from AssetType ('ugc_video' | 'reel') to engine
    // ContentType (collapses to 'ugc'). Used by the engine to
    // pick the correct CONTENT_TYPE_RULES + EXAMPLES.
    void assetTypeToContentType(assetType);

    // Two variants in parallel. Anthropic prompt cache means the
    // second call re-uses the cached system + the prompt prefix
    // up through the dynamic context block.
    const settled = await Promise.allSettled([
      generateOneVariant({
        label: 'A',
        prompt,
        voicePlatform,
        clientContext,
      }),
      generateOneVariant({
        label: 'B',
        prompt,
        voicePlatform,
        clientContext,
      }),
    ]);

    const variants: VariantResponse[] = [];
    const errors: Array<{ label: 'A' | 'B'; error: string }> = [];
    settled.forEach((r, i) => {
      const label = (i === 0 ? 'A' : 'B') as 'A' | 'B';
      if (r.status === 'fulfilled') {
        const value = r.value;
        if ('error' in value) {
          errors.push({ label, error: value.error });
        } else {
          variants.push(value);
        }
      } else {
        errors.push({
          label,
          error:
            r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });

    if (variants.length === 0) {
      return NextResponse.json(
        {
          error: 'Both variants failed to generate',
          partialErrors: errors,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      // Legacy shape preserved for the panel: { label, text }.
      // `text` is the spoken-only payload so the existing A/B
      // picker UI keeps working without changes; the richer
      // fields below (bundle, wordCount, durationSeconds) let
      // future PRs render overlays / hashtags / caption.
      variants: variants.map((v) => ({
        label: v.label,
        text: v.spokenText,
        wordCount: v.wordCount,
        durationSeconds: approximateSpokenDurationSeconds(v.spokenText),
        bundle: v.bundle,
        parseKind: v.parseKind,
      })),
      partialErrors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Script generation failed',
      },
      { status: 500 },
    );
  }
}
