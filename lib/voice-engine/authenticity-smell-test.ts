// PR Sprint 7.22 Sprint C — F3 authenticity smell test (TS port of
// Helm SEO/helm-adaptive-voice-engine/authenticity_smell_test.py).
//
// Final-pass authenticity check via a small Haiku call. Asks:
// "would a real founder/operator post this on [platform]?" and
// returns a 0-100 score plus a structured diagnostic.
//
// Runs AFTER all platform-specific + content-type validators pass,
// as a meta-check that catches outputs that satisfied the rules
// but still feel AI-shaped (the patterns the regex validators
// can't detect — em-dash breath rhythm, lack of organic flow,
// tricolon-shaped paragraphs that fall just outside check_tricolon,
// etc.).
//
// Cost: ~$0.001 per call (Haiku, ~250 tokens in, ~150 tokens out).
// Latency: ~1 second.
// Recommended threshold: score < 70 = fail, regenerate.
//
// In the initial Sprint C wire-up the result is logged to the
// audit table only (telemetry) — no regeneration, no blocking.
// We need a week or two of base-rate data before deciding how to
// gate. The smell test costs ~$0.001 per generation and adds
// ~1s of latency (fire-and-forget so it doesn't block the
// response).
//
// Canonical TS source-of-truth. Python upstream at
// lib/voice-engine/authenticity_smell_test.py (and
// Helm SEO/helm-adaptive-voice-engine/) MUST stay in lockstep.

import { anthropic, MODELS } from '@/lib/ai/claude';

// ============================================================
// Result types
// ============================================================

export type SmellTestVerdict = 'pass' | 'borderline' | 'fail';

export interface SmellTestResult {
  score: number; // 0..100
  verdict: SmellTestVerdict;
  primaryIssues: string[]; // 0..3 entries, each <= 1 sentence
  whatWouldMakeItHuman: string;
}

export function smellTestPasses(
  result: SmellTestResult,
  threshold = 70,
): boolean {
  return result.score >= threshold;
}

export class SmellTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmellTestError';
  }
}

// ============================================================
// Prompt
// ============================================================

const SMELL_TEST_PROMPT_TEMPLATE = `You are evaluating whether a marketing post sounds like it was written by a real human or by AI. Be brutally honest. Bias toward marking AI-shaped content as fail; do not be charitable.

PLATFORM: {platform}
CONTENT_TYPE: {contentType}

POST:
{postText}

Score the post 0-100 on AUTHENTICITY:
- 90-100: Reads exactly like a real founder/operator wrote it. Has natural imperfections (parentheticals, hedges, fragments, tangents).
- 70-89: Sounds mostly real with minor polish. Could pass for human.
- 50-69: Has noticeable AI tells. Feels slightly fabricated. A real reader would suspect.
- 30-49: Clearly AI-shaped. Multiple AI patterns visible.
- 0-29: Reads as pure AI output. Would never pass for human.

What to look for as AI tells:
- Em dashes used for breath-pause rhythm
- "X, not Y" chiastic constructions
- Tricolons (three parallel items, especially with crescendo)
- Symmetric parallel headers (3+ in matched form)
- Pre-constructed quotable lines (especially in blockquotes)
- Numbers without hedging (real humans say "around 9 months" not "9 months")
- Perfect closing CTAs ("specifically curious about...", "what's your take?")
- Polished structure with no tangents, asides, or self-corrections
- Lack of fragments, parentheticals, or informal markers (tbh, ngl, idk, fwiw)
- Words and phrases like: leverage, seamlessly, unlock, empower, harness, dive into, delve into

What real humans on this platform DO:
- Reddit: include "tbh", "ngl", "imo", "fwiw"; hedge numbers; parenthetical asides; sometimes end with "anyway" or trail off
- X / Threads: lowercase first letter sometimes; abandon thoughts; reply-thread feel
- LinkedIn: include specific personal details (date, name, tool); admit uncertainty
- Instagram: storytelling with parenthetical asides
- Facebook: warm conversational, less polished than LinkedIn

Output JSON:
{
  "score": <integer 0-100>,
  "verdict": "<one of: pass, borderline, fail>",
  "primaryIssues": ["<top 1-3 issues, each 1 short sentence>"],
  "whatWouldMakeItHuman": "<one concrete suggestion, 1 sentence>"
}

Verdict mapping: pass = score >= 70, borderline = 50-69, fail = below 50.

Return only the JSON. No commentary.`;

// ============================================================
// Public API
// ============================================================

export interface SmellTestArgs {
  postText: string;
  platform: string;
  contentType: string;
  threshold?: number;
  maxRetries?: number;
}

/**
 * Run the authenticity smell test on a generated post.
 *
 * Never throws for transient parse failures within max_retries.
 * Throws SmellTestError only when ALL retries fail (the caller
 * should already be in fire-and-forget mode and swallow it).
 */
export async function smellTestAuthenticity(
  args: SmellTestArgs,
): Promise<SmellTestResult> {
  const { postText, platform, contentType, maxRetries = 1 } = args;

  const prompt = SMELL_TEST_PROMPT_TEMPLATE.replace('{platform}', platform)
    .replace('{contentType}', contentType)
    .replace('{postText}', postText.trim());

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODELS.HAIKU,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = response.content.find((b) => b.type === 'text');
      const raw = block?.type === 'text' ? block.text : '';
      const payload = extractJsonObject(raw);
      return parseSmellTestResult(payload);
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  throw new SmellTestError(
    `Failed to parse smell test result after ${maxRetries + 1} attempts. ` +
      `Last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
  );
}

// ============================================================
// Helpers
// ============================================================

function parseSmellTestResult(payload: unknown): SmellTestResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Smell test returned non-object payload');
  }
  const obj = payload as Record<string, unknown>;

  let score =
    typeof obj.score === 'number' ? obj.score : Number(obj.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.round(Math.max(0, Math.min(100, score)));

  const verdictRaw =
    typeof obj.verdict === 'string' ? obj.verdict.toLowerCase().trim() : '';
  let verdict: SmellTestVerdict;
  if (verdictRaw === 'pass' || verdictRaw === 'borderline' || verdictRaw === 'fail') {
    verdict = verdictRaw;
  } else if (score >= 70) {
    verdict = 'pass';
  } else if (score >= 50) {
    verdict = 'borderline';
  } else {
    verdict = 'fail';
  }

  const rawIssues = obj.primaryIssues;
  const primaryIssues: string[] = Array.isArray(rawIssues)
    ? rawIssues
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .slice(0, 3)
    : [];

  const whatWouldMakeItHuman =
    typeof obj.whatWouldMakeItHuman === 'string' ? obj.whatWouldMakeItHuman : '';

  return { score, verdict, primaryIssues, whatWouldMakeItHuman };
}

function extractJsonObject(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith('```')) {
    const newlineIdx = text.indexOf('\n');
    text = newlineIdx >= 0 ? text.slice(newlineIdx + 1) : text;
    if (text.endsWith('```')) {
      text = text.slice(0, text.lastIndexOf('```'));
    }
    text = text.trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in smell test response');
  }
  return JSON.parse(text.slice(start, end + 1));
}
