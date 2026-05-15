// PR Sprint 7.22 Sprint B — product bridge matcher (TS port of
// Helm SEO/helm-adaptive-voice-engine/product_bridge_matcher.py).
//
// LLM-driven runtime matcher. Per generation, takes the post's
// pain_point and the project's approved ProductBridges; returns the
// best semantic match (or null if nothing fits well enough).
//
// Recommended model: Claude Haiku. Cost per call: ~$0.001.
// Confidence threshold: 0.5 — below that, no bridge applies.
//
// Production usage from /api/ai/generate-structured:
//   const match = await matchBridgeForPain({
//     painPoint: userPrompt,
//     availableBridges: brandBible.painToProductBridges ?? [],
//   });
//   const productRelevanceSection = formatBridgeForPrompt(match);
//   const stackedPrompt = buildGenerationPrompt({
//     ...args,
//     productRelevanceSection,
//   });
//
// Canonical TS source-of-truth. Python upstream at
// lib/voice-engine/product_bridge_matcher.py (and
// Helm SEO/helm-adaptive-voice-engine/) MUST stay in lockstep.

import { anthropic, MODELS } from '@/lib/ai/claude';
import type { ProductBridge } from '@/lib/types/brand';

// ============================================================
// Match result
// ============================================================

export interface BridgeMatch {
  matchedPain: string | null;
  matchedBridge: string | null;
  confidence: number; // 0..1
  reasoning: string;
}

export function matchApplies(match: BridgeMatch): boolean {
  return match.matchedBridge !== null && match.confidence >= 0.5;
}

// ============================================================
// Prompt
// ============================================================

const MATCHER_PROMPT_TEMPLATE = `You are helping a marketing system decide whether to mention a client's product in a generated post. Your job is to match the post's pain point against the client's available pain → product bridges.

POST'S PAIN POINT (what the post is fundamentally about):
{painPoint}

AVAILABLE BRIDGES (the client's pre-configured pain → product mappings):
{bridgesBlock}

YOUR TASK:

Pick the SINGLE best bridge that semantically matches the post's pain point. Match by meaning, not by literal string. If the post's pain is about "distribution beyond social media" and a bridge addresses "distribution harder than building", that's a match.

If no bridge truly fits the post's pain (semantic distance > 0.5), return null. It is better to skip the bridge than to force one that doesn't fit; a forced bridge produces awkward product mentions.

CONFIDENCE GUIDE:
- 0.9-1.0: bridge directly addresses the same pain
- 0.7-0.9: bridge addresses a closely related pain
- 0.5-0.7: bridge tangentially relates; might fit the post but not the obvious choice
- below 0.5: no real match; return null

OUTPUT SCHEMA (return ONLY this JSON, no commentary):

{
  "matchedPain": "<exact pain text from a bridge entry, or null>",
  "matchedBridge": "<the bridge text from that entry, or null>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<one sentence explaining the match decision>"
}

If matchedPain is null, matchedBridge must also be null and confidence must be < 0.5.

Return only the JSON. No preamble, no markdown fences.`;

// ============================================================
// Public API
// ============================================================

export interface MatchBridgeArgs {
  painPoint: string;
  availableBridges: readonly ProductBridge[];
  confidenceThreshold?: number;
  maxRetries?: number;
}

const EMPTY_MATCH: BridgeMatch = {
  matchedPain: null,
  matchedBridge: null,
  confidence: 0,
  reasoning: '',
};

/**
 * Pick the best ProductBridge for a given pain point.
 *
 * Filters out kill-switched bridges (pendingReview=true) automatically.
 * Returns an empty BridgeMatch on:
 *   - no approved bridges available
 *   - Haiku call fails (network, parse, etc.)
 *   - confidence below threshold
 *
 * Never throws — generation must not be blocked by a failed match.
 */
export async function matchBridgeForPain(
  args: MatchBridgeArgs,
): Promise<BridgeMatch> {
  const {
    painPoint,
    availableBridges,
    confidenceThreshold = 0.5,
    maxRetries = 1,
  } = args;

  // Filter to approved bridges only. The kill-switch (pendingReview)
  // lives on the model so an operator can disable a specific live
  // bridge via SQL without a redeploy; the matcher honors it
  // defensively here.
  const approved = availableBridges.filter((b) => !b.pendingReview);
  if (approved.length === 0) {
    return {
      ...EMPTY_MATCH,
      reasoning: 'No approved bridges available for this client.',
    };
  }

  const bridgesBlock = approved
    .map((b) => `- pain: "${b.pain}"\n  bridge: "${b.bridge}"`)
    .join('\n');

  const prompt = MATCHER_PROMPT_TEMPLATE.replace(
    '{painPoint}',
    painPoint.trim(),
  ).replace('{bridgesBlock}', bridgesBlock);

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
      const parsed = parseBridgeMatch(payload);

      // Defensive confidence gate — the model may try to apply a
      // bridge despite the prompt instructions. We re-check here.
      if (parsed.confidence < confidenceThreshold) {
        return {
          matchedPain: null,
          matchedBridge: null,
          confidence: parsed.confidence,
          reasoning: `Confidence ${parsed.confidence.toFixed(2)} below threshold ${confidenceThreshold}.`,
        };
      }

      return parsed;
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  return {
    ...EMPTY_MATCH,
    reasoning: `Matcher failed after ${maxRetries + 1} attempts. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  };
}

// ============================================================
// Prompt formatting helper
// ============================================================

/**
 * Format an applied BridgeMatch as a PRODUCT_RELEVANCE section ready
 * to inject into the generation prompt. Returns an empty string when
 * the match did not apply.
 */
export function formatBridgeForPrompt(match: BridgeMatch): string {
  if (!matchApplies(match)) return '';

  return `
PRODUCT_RELEVANCE (how the product fits the answer to this pain):

The pain point of this post relates to: "${match.matchedPain}"
The client's product fits the answer this way: "${match.matchedBridge}"

INTEGRATION RULES:
- Weave this product relevance into the narrative or closing organically.
- Do NOT use templated disclosures like "I'm building X, link in bio".
- The product's relevance should emerge from the post's argument, not be
  bolted on at the end.
- If the post is short or the relevance feels forced, omit the product mention
  entirely. A missing mention is better than an awkward one.
`;
}

// ============================================================
// Helpers
// ============================================================

function parseBridgeMatch(payload: unknown): BridgeMatch {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Matcher returned non-object payload');
  }
  const obj = payload as Record<string, unknown>;
  const rawConfidence = obj.confidence;
  let confidence =
    typeof rawConfidence === 'number' ? rawConfidence : Number(rawConfidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const matchedPain =
    typeof obj.matchedPain === 'string' && obj.matchedPain.trim().length > 0
      ? obj.matchedPain
      : null;
  const matchedBridge =
    typeof obj.matchedBridge === 'string' && obj.matchedBridge.trim().length > 0
      ? obj.matchedBridge
      : null;
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';

  // Enforce the schema invariant: if matchedPain is null, matchedBridge
  // must also be null. The prompt says so but defensive code wins.
  if (matchedPain === null || matchedBridge === null) {
    return {
      matchedPain: null,
      matchedBridge: null,
      confidence,
      reasoning,
    };
  }

  return { matchedPain, matchedBridge, confidence, reasoning };
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
    throw new Error('No JSON object found in matcher response');
  }
  return JSON.parse(text.slice(start, end + 1));
}
