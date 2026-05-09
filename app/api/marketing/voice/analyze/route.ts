// PR #49 — Sprint 6.8: Voice Fingerprint extraction.
//
// POST /api/marketing/voice/analyze
// Body: { projectId: string }
//
// Reads the project's brand_quotes (3-50 needed), asks Opus to
// extract ABSTRACT PATTERNS — never literal phrases — and stores
// the result on projects.voice_fingerprint. The generator then
// reads the fingerprint instead of the raw quotes, which means:
//   1. Founder's exact phrasings never appear verbatim in
//      AI-generated drafts (no plagiarism).
//   2. Each generate-post call doesn't re-send N quotes worth of
//      tokens; the fingerprint is a small JSON blob.
//
// Auth: must own the project. Uses Opus 4.7 because pattern
// extraction is the kind of nuanced work where Haiku misreads
// "my voice has these structural markers" as "produce text in
// this style." Cost ~$0.05 per call; called once per quote-set
// change.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { brandQuotes, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { anthropic, MODELS } from '@/lib/ai/claude';
import type { VoiceFingerprint } from '@/lib/types/voice';
import { isVoiceFingerprint } from '@/lib/types/voice';
import { revalidatePath } from 'next/cache';

export const maxDuration = 60;

const MIN_QUOTES = 3;
const MAX_QUOTES = 50; // token-budget cap

const SYSTEM_PROMPT = `You are a voice analyst. You receive real quotes from a founder and extract PATTERNS that describe HOW this person communicates. Your output enables a writer to write LIKE this person without ever copying them.

CRITICAL RULES:
1. NEVER output literal phrases or quotes from the source material.
2. Extract STRUCTURAL patterns (sentence shapes, hook openings, paragraph rhythm).
3. Extract VOCABULARY traits (formality, register, language mix, specific lexical choices).
4. Extract SIGNATURE PHRASING patterns — describe the SHAPE, not the words. Example: "opens with a direct second-person address" not "uses 'tú' a lot".
5. Extract TONE characteristics (warm/cold, dry/playful, etc).
6. Extract AVOID patterns: things this writer never does.

Output ONLY a JSON object with this exact shape:
{
  "structuralPatterns": ["...", "..."],
  "vocabularyTraits": ["...", "..."],
  "signaturePhrasings": ["...", "..."],
  "toneCharacteristics": ["...", "..."],
  "avoidPatterns": ["...", "..."]
}

Each array: 3-5 items max. Each item: ONE sentence describing the pattern abstractly.

NEVER include text from the input quotes in your output. NEVER use direct words/phrases the founder used. Describe patterns, not content.`;

interface AnalyzePayload {
  projectId?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as AnalyzePayload;
  const projectId = body.projectId;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return NextResponse.json(
      { error: 'projectId is required' },
      { status: 400 }
    );
  }

  // Ownership.
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  // Pull quotes (cap to MAX_QUOTES).
  const quoteRows = await db
    .select({ content: brandQuotes.content })
    .from(brandQuotes)
    .where(eq(brandQuotes.projectId, projectId))
    .limit(MAX_QUOTES);

  if (quoteRows.length < MIN_QUOTES) {
    return NextResponse.json(
      {
        error: `Need at least ${MIN_QUOTES} quotes to derive a fingerprint. Add more in the Quote Vault.`,
        currentCount: quoteRows.length,
      },
      { status: 400 }
    );
  }

  // Build the user message. We number the quotes so the model
  // can think about them by index and not by exact wording.
  const quotesBlock = quoteRows
    .map((q, i) => `${i + 1}. "${q.content}"`)
    .join('\n');

  const userMessage = `Analyze ${quoteRows.length} quotes from this founder and extract voice patterns:

${quotesBlock}

Return only the JSON object.`;

  let raw: string;
  try {
    const response = await anthropic.messages.create({
      model: MODELS.OPUS,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    raw = textBlock?.type === 'text' ? textBlock.text.trim() : '';
  } catch (e) {
    console.error('[VOICE ANALYZE] Anthropic call failed', e);
    return NextResponse.json(
      { error: 'Voice analysis failed. Please retry.' },
      { status: 502 }
    );
  }

  // Strip ``` fences if Opus added them despite the system rule.
  let jsonText = raw;
  if (jsonText.startsWith('```')) {
    jsonText = jsonText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
  }
  // Some responses wrap the JSON in prose; pull the first {...} block.
  const match = jsonText.match(/\{[\s\S]*\}/);
  if (match) jsonText = match[0];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    console.error('[VOICE ANALYZE] JSON parse failed', { raw: raw.slice(0, 500) });
    return NextResponse.json(
      { error: 'Voice analysis returned invalid JSON. Please retry.' },
      { status: 502 }
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as Record<string, unknown>).structuralPatterns)
  ) {
    return NextResponse.json(
      { error: 'Voice analysis output was missing required fields.' },
      { status: 502 }
    );
  }

  const fingerprint: VoiceFingerprint = {
    structuralPatterns: ((parsed as Record<string, unknown>)
      .structuralPatterns as unknown[]).filter(
      (s): s is string => typeof s === 'string'
    ),
    vocabularyTraits: (((parsed as Record<string, unknown>).vocabularyTraits as unknown[]) ?? []).filter(
      (s): s is string => typeof s === 'string'
    ),
    signaturePhrasings: (((parsed as Record<string, unknown>).signaturePhrasings as unknown[]) ?? []).filter(
      (s): s is string => typeof s === 'string'
    ),
    toneCharacteristics: (((parsed as Record<string, unknown>).toneCharacteristics as unknown[]) ?? []).filter(
      (s): s is string => typeof s === 'string'
    ),
    avoidPatterns: (((parsed as Record<string, unknown>).avoidPatterns as unknown[]) ?? []).filter(
      (s): s is string => typeof s === 'string'
    ),
    sourceQuotesCount: quoteRows.length,
    derivedAt: new Date().toISOString(),
  };

  // Persist.
  const updated = await db
    .update(projects)
    .set({
      voiceFingerprint: fingerprint,
      voiceFingerprintUpdatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id });

  if (updated.length === 0) {
    console.error('[VOICE ANALYZE] UPDATE 0 rows', { projectId, userId: user.id });
    return NextResponse.json(
      { error: 'Could not save fingerprint.' },
      { status: 500 }
    );
  }

  // Cache invalidation — Generate page reads project to inject
  // the fingerprint into Claude prompts.
  revalidatePath('/marketing/generate');

  // Belt-and-suspenders: validate the produced fingerprint
  // matches the type guard. Logs but doesn't fail (we already
  // persisted; if the shape is slightly off the consumer will
  // tolerate empty arrays).
  if (!isVoiceFingerprint(fingerprint)) {
    console.warn('[VOICE ANALYZE] fingerprint failed type guard', fingerprint);
  }

  return NextResponse.json({
    success: true,
    fingerprint,
    quotesAnalyzed: quoteRows.length,
  });
}
