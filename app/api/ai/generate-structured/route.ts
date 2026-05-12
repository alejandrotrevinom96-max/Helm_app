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
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import { trackUsage } from '@/lib/ai/usage-tracker';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  categorizeAnthropicError,
  describeError,
  type ErrorKind,
} from '@/lib/ai/categorize-error';
import type { BrandBible } from '@/lib/types/brand';

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
]);

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

  // The cached system prompt is the same for every type in this
  // batch. Once warmed it costs ~10% of regular input on subsequent
  // calls inside the 5-min cache window.
  const systemPrompt = `You are Helm's content generator. You produce one structured draft per request, matching the brand voice and the exact schema specified by the caller.

BRAND
${brand}

VOICE FINGERPRINT
${voice}

RULES (every output)
- Match the brand voice exactly — use brand phrases, avoid banned terms.
- Specific over generic. No vague marketing copy.
- Respect the per-type guidelines provided in the user message.
- Return STRICT JSON only — no prose outside the JSON, no markdown fences.
- The JSON must validate against the provided structureSchema.
- Never invent facts about the audience or product beyond the brand bible.`;

  const drafts: DraftPayload[] = [];

  for (const template of templates) {
    const userMessage = `CONTENT TYPE: ${template.displayName} (platform: ${platform}, type: ${template.type})

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
        const cleaned = raw
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        parsed = JSON.parse(cleaned);
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

    const [inserted] = await db
      .insert(generatedPosts)
      .values({
        projectId,
        platform,
        content: contentPreview,
        prompt: userPrompt,
        contentType: template.type,
        structuredContent: parsed as object,
      })
      .returning({ id: generatedPosts.id });

    drafts.push({
      id: inserted.id,
      contentType: template.type,
      displayName: template.displayName,
      structuredContent: parsed,
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
