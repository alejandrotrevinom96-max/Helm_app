// PR Sprint 7.22 Sprint B — product bridge intake (TS port of
// Helm SEO/helm-adaptive-voice-engine/product_bridge_intake.py).
//
// LLM-driven onboarding helper. Generates a pain → product bridge
// map from minimal project inputs (product description, audience
// pain list, marketing one-liner) and AUTO-APPROVES every bridge
// that passes a deterministic quality gate. The client never sees
// an approval UI — the LLM produces, code approves, bridges land
// ready to use.
//
// Three layers of defense against bad bridges:
//   1. The intake prompt itself (strict on buzzwords + length +
//      concreteness).
//   2. The deterministic passesQualityGate() — banned-buzzword filter
//      synced with HUMANIZE_RULES + no pain↔bridge verbatim duplicates.
//   3. The runtime matcher's confidence threshold (>=0.5) plus the
//      AUTHENTICITY MARKERS / text-post validators on the final post.
//
// Recommended model: Claude Haiku. Cost per call: ~$0.005.
//
// Canonical TS source-of-truth. Python upstream at
// lib/voice-engine/product_bridge_intake.py (and
// Helm SEO/helm-adaptive-voice-engine/) MUST stay in lockstep.

import { anthropic, MODELS } from '@/lib/ai/claude';
import type { ProductBridge } from '@/lib/types/brand';

// ============================================================
// Deterministic quality gate
// ============================================================

// Synced exactly with the HUMANIZE_RULES "Words banned" section so
// there's no way a buzzword is forbidden in the generation prompt
// yet permitted in a bridge.
const BANNED_BUZZWORDS: readonly string[] = [
  'leverage',
  'harness',
  'unlock',
  'empower',
  'elevate',
  'streamline',
  'seamlessly',
  'effortlessly',
  'intuitively',
  'robust',
  'comprehensive',
  'holistic',
  'cutting-edge',
  'state-of-the-art',
  'game-changer',
  'game changer',
  'dive into',
  'delve into',
];

const BANNED_BUZZWORD_RE = new RegExp(
  '\\b(' +
    BANNED_BUZZWORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(
      '|',
    ) +
    ')\\b',
  'i',
);

export interface QualityGateResult {
  passed: boolean;
  reason: string;
}

/**
 * Run the deterministic quality gate on one LLM-generated bridge.
 *
 * Bridges that fail are dropped silently by the intake — they never
 * reach the project, the DB, or the runtime matcher. The intake LLM
 * is the generator; this function is the approver (replacing what
 * an operator would do mentally during review).
 */
export function passesQualityGate(
  pain: string,
  bridge: string,
): QualityGateResult {
  if (BANNED_BUZZWORD_RE.test(bridge)) {
    return { passed: false, reason: 'contains banned buzzword' };
  }
  if (bridge.trim().toLowerCase() === pain.trim().toLowerCase()) {
    return { passed: false, reason: 'bridge repeats pain verbatim' };
  }
  return { passed: true, reason: 'ok' };
}

// Marker stamped onto auto-approved bridges so audit logs can tell
// LLM-gate approvals apart from any future human-operator approvals.
// v1 leaves room to revise the gate criteria without rewriting
// historical rows — bump to v2 when we tighten the rules.
export const AUTO_APPROVER_ID = 'system:llm_intake_v1';

// ============================================================
// Prompt
// ============================================================

const INTAKE_PROMPT_TEMPLATE = `You are helping onboard a new client/project to Helm. Your job is to generate a pain → product bridge map that will be used to position the product naturally in marketing posts the client publishes.

INPUTS:

PRODUCT DESCRIPTION:
{productDescription}

MARKETING ONE-LINER:
{marketingOneLiner}

KEY AUDIENCE PAIN POINTS (the topics this client's content will address):
{painPointsBlock}

YOUR TASK:

For each audience pain point, generate a 1-2 sentence "bridge" that explains how the product fits into the answer. Plus generate 2-4 ADDITIONAL bridges for adjacent pains the client likely also addresses (use the product description and marketing one-liner to infer).

Each bridge MUST:
- Be specific (not generic positioning like "X helps founders win")
- Connect the pain to a concrete product capability
- Sound natural when woven into a marketing post (not corporate)
- Avoid: "leverage", "seamlessly", "unlock", "empower", "harness", "robust", "comprehensive", "holistic", "game-changer"
- Be written in present tense, third person about the product
- Be 20-200 chars long

EXAMPLES OF GOOD BRIDGES (study the shape, do not copy content):

Pain: "Distribution harder than building the product"
Bridge: "Helm handles the social media layer (X, LinkedIn) so the founder can spend time on the higher-ROI distribution channels: podcasts, communities, partnerships."

Pain: "Generic AI content that sounds like ChatGPT"
Bridge: "Helm learns the founder's voice fingerprint from past posts and applies it to every draft, so output sounds like one specific person, not a model averaged across millions."

EXAMPLES OF BAD BRIDGES (avoid this shape):

Pain: "Distribution is hard"
Bad bridge: "Helm leverages AI to streamline your marketing workflow seamlessly." (Generic, full of buzzwords, says nothing concrete.)

Pain: "AI content sounds generic"
Bad bridge: "Helm provides a comprehensive solution that empowers founders." (No concrete connection to the pain.)

OUTPUT SCHEMA (return ONLY this JSON, no commentary):

{
  "bridges": [
    {
      "pain": "<exact pain wording, copy from input or rephrase slightly>",
      "bridge": "<1-2 sentence bridge connecting product to pain>"
    }
  ]
}

Generate 8-12 bridges total. Cover all the input pains plus 2-4 inferred adjacent pains.

Return only the JSON. No preamble, no markdown fences, no thinking.`;

// ============================================================
// Public API
// ============================================================

export interface GenerateBridgeDraftsArgs {
  productDescription: string;
  audiencePains: readonly string[];
  marketingOneLiner: string;
  maxRetries?: number;
}

export class BridgeIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeIntakeError';
  }
}

/**
 * Generate auto-approved ProductBridges for a project.
 *
 * The LLM produces 8-12 candidates; the deterministic quality gate
 * drops any that contain banned buzzwords or repeat the pain verbatim.
 * Survivors come back as approved: pendingReview=false,
 * approvedAt=now ISO, approvedBy="system:llm_intake_v1".
 *
 * The caller drops the returned list straight into
 * BrandBible.painToProductBridges; the runtime matcher uses them on
 * the next generation with no further approval step.
 *
 * Returns an empty array if no candidates survive the gate (rare —
 * the prompt forbids the buzzwords explicitly).
 *
 * @throws BridgeIntakeError on repeated parse failure
 */
export async function generateBridgeDrafts(
  args: GenerateBridgeDraftsArgs,
): Promise<ProductBridge[]> {
  const {
    productDescription,
    audiencePains,
    marketingOneLiner,
    maxRetries = 2,
  } = args;

  if (audiencePains.length === 0) {
    throw new BridgeIntakeError('audiencePains cannot be empty');
  }

  // Cap to keep prompt size reasonable.
  const cappedPains = audiencePains.slice(0, 10);
  const painPointsBlock = cappedPains.map((p) => `- ${p.trim()}`).join('\n');

  const prompt = INTAKE_PROMPT_TEMPLATE.replace(
    '{productDescription}',
    productDescription.trim(),
  )
    .replace('{marketingOneLiner}', marketingOneLiner.trim())
    .replace('{painPointsBlock}', painPointsBlock);

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODELS.HAIKU,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = response.content.find((b) => b.type === 'text');
      const raw = block?.type === 'text' ? block.text : '';
      const payload = extractJsonObject(raw);
      return parseAndApproveBridges(payload);
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  throw new BridgeIntakeError(
    `Failed to generate bridge drafts after ${maxRetries + 1} attempts. ` +
      `Last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
  );
}

// ============================================================
// Helpers
// ============================================================

function parseAndApproveBridges(payload: unknown): ProductBridge[] {
  if (!payload || typeof payload !== 'object') {
    throw new Error("Intake JSON missing 'bridges' field");
  }
  const obj = payload as Record<string, unknown>;
  const rawBridges = obj.bridges;
  if (!Array.isArray(rawBridges)) {
    throw new Error("Intake JSON 'bridges' is not an array");
  }

  const nowIso = new Date().toISOString();
  const out: ProductBridge[] = [];
  for (const entry of rawBridges) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const pain = typeof e.pain === 'string' ? e.pain.trim() : '';
    const bridge = typeof e.bridge === 'string' ? e.bridge.trim() : '';
    if (!pain || !bridge) continue;

    // Length guards mirror the Pydantic min/max_length from the
    // Python upstream. Out-of-range bridges are silently dropped.
    if (pain.length < 10 || pain.length > 200) continue;
    if (bridge.length < 20 || bridge.length > 500) continue;

    const gate = passesQualityGate(pain, bridge);
    if (!gate.passed) continue;

    out.push({
      pain,
      bridge,
      pendingReview: false,
      createdAt: nowIso,
      approvedAt: nowIso,
      approvedBy: AUTO_APPROVER_ID,
    });
  }
  return out;
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
    throw new Error('No JSON object found in intake response');
  }
  return JSON.parse(text.slice(start, end + 1));
}
