// PR Sprint 7.23 — anchored actionableAngle generator.
//
// Per-pain-point Haiku call that produces the directive the
// post-generation system uses to compose actual posts. The angle
// is the single most influential input to a generated post — a
// vague or hallucination-prone directive (e.g., "Show frameworks
// for X" when the founder has no framework) propagates fabrication
// all the way through to the final draft.
//
// The new template anchors the angle in:
//   - The founder's brand voice + audience + positioning + pillars
//   - Verified facts the founder explicitly knows (Patch 4 territory;
//     defaults to empty array until that ships)
//   - The project's approved product bridges (Sprint B / Patch 2.1)
//   - Platform culture (Reddit asks genuine questions; LinkedIn does
//     declarative case studies; X/Threads hot takes; etc.)
//
// Anchoring rules embedded in the prompt:
//   1. Verb matches available experience — "Show" only when the
//      founder has facts/bridges; "Discuss/Explore/Ask" otherwise.
//   2. Connect to product when a bridge matches the pain; otherwise
//      stay purely about the pain.
//   3. Respect platform culture (per-platform guidance).
//   4. Never fabricate — directives implying specific data the
//      founder doesn't have are anti-patterns.
//   5. Be concrete — no "Talk about importance of X".
//
// Cost: ~$0.001 per call (Haiku). For an extract-pain-points run
// that returns 10 pain points, ~$0.01 total. Latency: ~1s per call
// but the caller runs them in parallel via Promise.all so total
// wall-clock stays near a single call.

import { anthropic, MODELS } from '@/lib/ai/claude';
import type { BrandBible, ProductBridge } from '@/lib/types/brand';

// ============================================================
// Inputs
// ============================================================

export interface VerifiedFact {
  /** What the founder verifiably knows (a number, a date, a tool, an outcome). */
  text: string;
}

export interface GenerateActionableAngleArgs {
  painTheme: string;
  sampleQuote: string;
  platform: string;
  brandBible: BrandBible | null;
  /**
   * Optional. Patch 4 will introduce a verified-facts store on the
   * project; until then callers pass an empty array (or omit the
   * field) and the prompt switches to hedged/exploratory verbs.
   */
  verifiedFacts?: readonly VerifiedFact[];
  /**
   * Optional. Approved product bridges from Sprint B / Patch 2.1.
   * The caller should filter to bridges where `pendingReview === false`
   * before passing — but we filter defensively here too.
   */
  painToProductBridges?: readonly ProductBridge[];
  /** Override the model (default: Haiku). */
  model?: string;
  /** Retries on transient parse failure. */
  maxRetries?: number;
}

// ============================================================
// Prompt template
// ============================================================

const ANGLE_PROMPT_TEMPLATE = `You are generating a content angle suggestion for a marketing post. The angle will become the directive that drives an entire post generation. It MUST be specific, actionable, and ANCHORED in what the founder can authentically write about.

AUDIENCE PAIN POINT (extracted from {platform} research):
Theme: "{pain_theme}"
Sample quote from the audience: "{sample_quote}"
Source platform: {platform}

CLIENT/PROJECT CONTEXT (use this to anchor the angle):

Brand voice: {brand_voice}
Audience: {brand_audience}
Positioning: {brand_positioning}
Content pillars: {brand_pillars}

VERIFIED FACTS the founder can use (if any):
{verified_facts_block}

PRODUCT BRIDGES (how the product connects to common pains):
{product_bridges_block}

YOUR TASK:

Generate a single content angle (max 200 chars) that the post-generation system will use as its directive. The angle must follow these ANCHORING RULES:

1. MATCH VERB TO AVAILABLE EXPERIENCE
   - If the founder has VERIFIED FACTS or PRODUCT BRIDGES related to this pain → use authoritative verbs ("Show", "Walk through", "Share what worked")
   - If the founder has NO direct experience with this pain → use exploratory/curious verbs ("Discuss", "Explore", "Ask the audience", "Open question about")

2. CONNECT TO PRODUCT IF APPLICABLE
   - If a PRODUCT BRIDGE matches this pain, the angle should naturally lead to a discussion that lets the product be mentioned (let the actual generation handle the directness; you just set the topic up)
   - If no bridge matches, the angle is purely about the pain — no product mention needed

3. RESPECT PLATFORM CULTURE
   - {platform} = reddit: angle should feel like a question the founder is genuinely wrestling with, not a teaching moment
   - {platform} = linkedin: angle can be more declarative, case-study-shaped
   - {platform} = x or threads: angle should be a hot take or observation, short
   - {platform} = facebook: angle should be community-warm, story-shaped
   - {platform} = instagram: angle should be visual/lifestyle anchored
   - {platform} = tiktok: angle should be hookable in 5-second video format

4. NEVER FABRICATE
   - Don't suggest angles that imply specific data, numbers, customer counts, or events the founder doesn't have. The post generator will hallucinate them if you do.
   - If the angle could be misread as requiring fabrication, hedge the verb ("Discuss" not "Show").

5. BE CONCRETE
   - Avoid generic angles like "Talk about X importance" or "Discuss benefits of Y".
   - Specify the WAY the pain should be approached (story, question, contrarian take, lived experience, observation).

Examples of the angle shape (study, don't copy):
- Good (founder has bridge): "Show how consolidating into one workspace saved time on context-switching, with the specific tools dropped and reasoning"
- Good (no bridge, exploratory): "Open question to the audience about which batching frameworks have actually worked, sharing the founder's current uncertainty"
- Bad: "Show frameworks for batching marketing tasks" (too directive, may force fabrication if founder lacks frameworks)
- Bad: "Discuss the importance of marketing automation" (too generic, no concrete approach)

Return ONLY the angle string (max 200 chars). No JSON, no commentary, no quotes around it.`;

// ============================================================
// Public API
// ============================================================

const MAX_ANGLE_CHARS = 200;
const NO_VERIFIED_FACTS_PLACEHOLDER =
  '[none yet — angle must avoid suggesting topics that require specific personal experience the founder may not have]';
const NO_BRIDGES_PLACEHOLDER = '[none yet]';

/**
 * Generate a single anchored actionableAngle for one pain point.
 *
 * Returns an empty string on transient failure — the caller stores
 * an empty angle and the downstream PainPointCard renders nothing in
 * the angle slot (graceful degradation; the pain card is still
 * useful without an angle). Errors are logged but never thrown.
 */
export async function generateActionableAngle(
  args: GenerateActionableAngleArgs,
): Promise<string> {
  const {
    painTheme,
    sampleQuote,
    platform,
    brandBible,
    verifiedFacts = [],
    painToProductBridges = [],
    model = MODELS.HAIKU,
    maxRetries = 1,
  } = args;

  const approvedBridges = painToProductBridges.filter(
    (b) => b && !b.pendingReview,
  );

  const prompt = ANGLE_PROMPT_TEMPLATE.replaceAll(
    '{platform}',
    platform || 'unknown',
  )
    .replace('{pain_theme}', painTheme)
    .replace('{sample_quote}', sampleQuote)
    .replace('{brand_voice}', formatBrandVoice(brandBible))
    .replace('{brand_audience}', formatBrandAudience(brandBible))
    .replace('{brand_positioning}', formatBrandPositioning(brandBible))
    .replace('{brand_pillars}', formatBrandPillars(brandBible))
    .replace('{verified_facts_block}', formatVerifiedFacts(verifiedFacts))
    .replace(
      '{product_bridges_block}',
      formatProductBridges(approvedBridges),
    );

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = response.content.find((b) => b.type === 'text');
      const raw = block?.type === 'text' ? block.text : '';
      return cleanAngle(raw);
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  console.warn(
    '[generate-actionable-angle] Haiku call failed after retries:',
    lastError instanceof Error ? lastError.message : lastError,
  );
  return '';
}

// ============================================================
// Formatters
// ============================================================

function formatBrandVoice(bible: BrandBible | null): string {
  const v = bible?.voice;
  if (!v) return '(unset)';
  // The 0-10 sliders are more useful to the LLM as narrative
  // descriptors than as raw numbers. Pick the two most extreme
  // axes so the angle stays platform-aware.
  const axes: Array<[number, string, string]> = [
    [v.formal, 'casual', 'formal'],
    [v.serious, 'playful', 'serious'],
    [v.bold, 'reserved', 'bold'],
    [v.innovative, 'traditional', 'innovative'],
    [v.approachable, 'exclusive', 'approachable'],
  ];
  const descriptors = axes
    .filter(([n]) => typeof n === 'number')
    .map(([n, low, high]) => `${n <= 4 ? low : n >= 7 ? high : 'balanced'}`)
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 4)
    .join(', ');
  return descriptors || '(balanced)';
}

function formatBrandAudience(bible: BrandBible | null): string {
  return (
    bible?.audience?.primary?.description?.trim() || '(unset)'
  );
}

function formatBrandPositioning(bible: BrandBible | null): string {
  // BrandBible doesn't have a top-level `positioning` field — we
  // synthesize from identity.tagline / identity.mission /
  // messaging.primaryTagline, whichever is set first.
  return (
    bible?.identity?.tagline?.trim() ||
    bible?.messaging?.primaryTagline?.trim() ||
    bible?.identity?.mission?.trim() ||
    '(unset)'
  );
}

function formatBrandPillars(bible: BrandBible | null): string {
  const pillars = (bible?.pillars ?? [])
    .map((p) => p?.name)
    .filter((n): n is string => Boolean(n))
    .slice(0, 5);
  return pillars.length > 0 ? pillars.join(', ') : '(none defined)';
}

function formatVerifiedFacts(facts: readonly VerifiedFact[]): string {
  if (facts.length === 0) return NO_VERIFIED_FACTS_PLACEHOLDER;
  return facts
    .map((f) => `- ${f.text}`)
    .filter((line) => line.length > 2)
    .slice(0, 10)
    .join('\n');
}

function formatProductBridges(bridges: readonly ProductBridge[]): string {
  if (bridges.length === 0) return NO_BRIDGES_PLACEHOLDER;
  return bridges
    .slice(0, 8)
    .map((b) => `- Pain "${b.pain}" → ${b.bridge}`)
    .join('\n');
}

// ============================================================
// Output cleanup
// ============================================================

function cleanAngle(raw: string): string {
  let out = raw.trim();
  // Strip markdown code fences if the model wrapped the output.
  if (out.startsWith('```')) {
    const newlineIdx = out.indexOf('\n');
    out = newlineIdx >= 0 ? out.slice(newlineIdx + 1) : out;
    if (out.endsWith('```')) out = out.slice(0, out.lastIndexOf('```'));
    out = out.trim();
  }
  // Strip surrounding quotes if the model wrapped the angle in them.
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  // Collapse internal newlines (the angle is a single sentence).
  out = out.replace(/\s+/g, ' ').trim();
  // Final 200-char cap; the prompt asks for ≤200 but we enforce.
  return out.slice(0, MAX_ANGLE_CHARS);
}
