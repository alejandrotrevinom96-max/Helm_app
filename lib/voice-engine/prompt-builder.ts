// PR Sprint 7.16 — Adaptive prompt builder port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/prompt_builder.py.
//
// Composes the final generation prompt by stacking:
//   PROMPT_COMPOSITION_RULES (from lib/ai/platform-tone.ts)
//     ↓
//   CLIENT CONTEXT block (dynamic — per ClientContext)
//     ↓
//   PAIN_POINT (the user's topic)
//     ↓
//   CONTENT_TYPE_RULES + CONTENT_TYPE_EXAMPLES
//     ↓
//   PLATFORM_TONE
//
// Builds on top of buildGenerationPrompt from
// lib/ai/platform-tone.ts (Sprint 7.13) — we reuse its
// validation + the canonical static scaffolding rather than
// duplicating the rule banks here. The new layer is the
// adaptive CLIENT CONTEXT block + the structured output
// contract that asks the model to emit <override_log> tags.

import {
  CONTENT_TYPE_EXAMPLES,
  CONTENT_TYPE_RULES,
  PLATFORM_CONTENT_COMPATIBILITY,
  PLATFORM_TONE_INSTRUCTIONS,
  PROMPT_COMPOSITION_RULES,
  type ContentTypeTaxonomy,
  type Platform as ToneEnginePlatform,
} from '@/lib/ai/platform-tone';
import {
  getPlatformSlots,
  getRecentLosingPatterns,
  getRecentWinningPatterns,
  getVoiceSamples,
  type ClientContext,
  type ContentType,
  type Dimension,
  type Platform,
} from './types';

// ============================================================
// Public API
// ============================================================

export interface BuildAdaptivePromptOpts {
  platform: Platform;
  contentType: ContentType;
  clientContext: ClientContext;
  painPoint: string;
  targetSub?: string | null;
  includeExamples?: boolean;
}

export class VoiceEngineValidationError extends Error {
  constructor(
    public readonly code:
      | 'unknown_platform'
      | 'unknown_content_type'
      | 'incompatible_combination',
    message: string,
  ) {
    super(message);
    this.name = 'VoiceEngineValidationError';
  }
}

export function buildAdaptivePrompt(opts: BuildAdaptivePromptOpts): string {
  const platformKey = opts.platform;
  const contentTypeKey = opts.contentType;
  const includeExamples = opts.includeExamples ?? true;

  validateCombination(platformKey, contentTypeKey);

  const dynamicContext = formatDynamicContext(
    opts.clientContext,
    opts.platform,
  );

  const contentRules = CONTENT_TYPE_RULES[contentTypeKey as ContentTypeTaxonomy];
  const platformTone =
    PLATFORM_TONE_INSTRUCTIONS[platformKey as ToneEnginePlatform];

  const subLine =
    platformKey === 'reddit' && opts.targetSub
      ? `\nTARGET SUBREDDIT: ${opts.targetSub}\n`
      : '';

  let examplesSection = '';
  if (includeExamples) {
    const examples = (
      CONTENT_TYPE_EXAMPLES[contentTypeKey as ContentTypeTaxonomy] ?? ''
    ).trim();
    if (examples.length > 0) {
      examplesSection = `\nCONTENT_TYPE_EXAMPLES for ${contentTypeKey.toUpperCase()} (good vs bad pairs to pattern-match against):\n${examples}\n`;
    }
  }

  return `${PROMPT_COMPOSITION_RULES}

CLIENT CONTEXT (apply strongly, this is the client-specific intelligence):
${dynamicContext}

PAIN_POINT (what this post is about):
${opts.painPoint}
${subLine}
CONTENT_TYPE_RULES for ${contentTypeKey.toUpperCase()} (base format mechanics):
${contentRules}
${examplesSection}
PLATFORM_TONE for ${platformKey.toUpperCase()} (specialization on top of content-type rules):
${platformTone}

Now write the ${contentTypeKey} for ${platformKey}. After drafting, run BOTH
scan checklists (the CONTENT_TYPE_RULES checklist and the PLATFORM_TONE
checklist). If any item fails, regenerate.

If you applied any learned_override that contradicts a default in
CONTENT_TYPE_RULES or PLATFORM_TONE, append a structured log AFTER the draft:

<override_log>
dimension=<name>, applied=<value>, default=<value>, confidence=<0.0-1.0>
</override_log>

Include one line per override applied. Omit the entire tag block if no
overrides were applied.

Return: the final draft + (if any) the override_log block. No commentary,
no preamble.
`;
}

// ============================================================
// Output parsing
// ============================================================

// Captures one <override_log>...</override_log> block. /s flag
// for dotAll so multi-line bodies match. We tolerate
// surrounding whitespace + extra newlines.
const OVERRIDE_LOG_PATTERN = /<override_log>([\s\S]*?)<\/override_log>/i;

export interface OverrideLogRecord {
  dimension: string;
  applied: string;
  default: string;
  confidence: string;
  // Anything else key=value the model emits (forward-compat).
  [key: string]: string;
}

export interface ParseOverrideLogResult {
  cleanDraft: string;
  records: OverrideLogRecord[];
}

export function parseOverrideLog(modelOutput: string): ParseOverrideLogResult {
  const match = modelOutput.match(OVERRIDE_LOG_PATTERN);
  if (!match) {
    return { cleanDraft: modelOutput.trim(), records: [] };
  }
  const rawLog = match[1].trim();
  const cleanDraft = modelOutput.replace(OVERRIDE_LOG_PATTERN, '').trim();

  const records: OverrideLogRecord[] = [];
  for (const line of rawLog.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const record: Record<string, string> = {};
    for (const pair of trimmed.split(',')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const key = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      if (key) record[key] = value;
    }
    if (Object.keys(record).length > 0) {
      records.push(record as OverrideLogRecord);
    }
  }
  return { cleanDraft, records };
}

// ============================================================
// Internal helpers
// ============================================================

function validateCombination(
  platform: Platform,
  contentType: ContentType,
): void {
  if (!(platform in PLATFORM_TONE_INSTRUCTIONS)) {
    throw new VoiceEngineValidationError(
      'unknown_platform',
      `Unknown platform: ${platform}. Supported: ${Object.keys(PLATFORM_TONE_INSTRUCTIONS).sort().join(', ')}`,
    );
  }
  if (!(contentType in CONTENT_TYPE_RULES)) {
    throw new VoiceEngineValidationError(
      'unknown_content_type',
      `Unknown content_type: ${contentType}. Supported: ${Object.keys(CONTENT_TYPE_RULES).sort().join(', ')}`,
    );
  }
  const supported =
    PLATFORM_CONTENT_COMPATIBILITY[platform as ToneEnginePlatform];
  if (!supported.includes(contentType as ContentTypeTaxonomy)) {
    throw new VoiceEngineValidationError(
      'incompatible_combination',
      `Content type '${contentType}' not supported on platform '${platform}'. Supported types for ${platform}: ${supported.join(', ')}`,
    );
  }
}

// Render the per-client context block as a string for the
// prompt. 1:1 with the Python source's _format_dynamic_context.
function formatDynamicContext(
  ctx: ClientContext,
  platform: Platform,
): string {
  const bb = ctx.brandBible;
  const voiceSamples = getVoiceSamples(ctx, platform, 8);
  const winning = getRecentWinningPatterns(ctx, platform, 45, 5, 10);
  const losing = getRecentLosingPatterns(ctx, platform, 45, 5, 10);
  const overrides = getPlatformSlots(ctx, platform).learnedOverrides;

  const lines: string[] = [
    'BRAND_BIBLE:',
    `  Voice: ${bb.voice}`,
    `  Audience: ${bb.audience}`,
    `  Positioning: ${bb.positioning}`,
    `  Pillars: ${bb.pillars.length ? bb.pillars.join(', ') : '[none]'}`,
    `  Banned phrases: ${bb.bannedPhrases.length ? JSON.stringify(bb.bannedPhrases) : '[none]'}`,
    `  Mandatory signals: ${bb.mandatorySignals.length ? JSON.stringify(bb.mandatorySignals) : '[none]'}`,
    '',
    "VOICE_FINGERPRINT (writer's actual past output on this platform, sorted by weight):",
  ];

  if (voiceSamples.length > 0) {
    voiceSamples.forEach((s, i) => {
      const text = s.text.replace(/\n/g, ' ').slice(0, 280);
      lines.push(
        `  Sample ${i + 1} (weight=${s.weight.toFixed(2)}): ${text}`,
      );
    });
  } else {
    lines.push(
      '  [no samples yet for this platform; rely on BRAND_BIBLE and defaults]',
    );
  }

  lines.push('');
  lines.push(
    'LEARNED_OVERRIDES (apply on top of platform/content defaults):',
  );
  const overrideKeys = Object.keys(overrides) as Dimension[];
  if (overrideKeys.length > 0) {
    for (const dim of overrideKeys) {
      const o = overrides[dim];
      if (!o) continue;
      lines.push(
        `  ${dim} = ${JSON.stringify(o.value)} ` +
          `(confidence=${o.confidence.toFixed(2)}, samples=${o.sampleCount}, ` +
          `volatility=${o.volatility})`,
      );
    }
  } else {
    lines.push('  [none yet; system is still learning this platform]');
  }

  lines.push('');
  lines.push(
    'WINNING_PATTERNS (recent posts approved without edits or with high engagement):',
  );
  if (winning.length > 0) {
    winning.slice(0, 5).forEach((p, i) => {
      const text = p.text.replace(/\n/g, ' ').slice(0, 200);
      lines.push(`  Win ${i + 1}: ${text}`);
    });
  } else {
    lines.push('  [no winning patterns yet]');
  }

  lines.push('');
  lines.push(
    'LOSING_PATTERNS (recent posts rejected, edited heavily, or underperformed; DO NOT replicate):',
  );
  if (losing.length > 0) {
    losing.slice(0, 5).forEach((p, i) => {
      const text = p.text.replace(/\n/g, ' ').slice(0, 200);
      lines.push(`  Loss ${i + 1}: ${text}`);
    });
  } else {
    lines.push('  [no losing patterns yet]');
  }

  lines.push('');
  lines.push(
    'ANTI_SAMPLES_BY_DIMENSION (specific patterns to avoid, tagged by dimension):',
  );
  const dimensionKeys = Object.keys(ctx.antiSamples) as Dimension[];
  let anyAdded = false;
  for (const dim of dimensionKeys) {
    const samples = ctx.antiSamples[dim];
    if (samples && samples.length > 0) {
      lines.push(`  ${dim}:`);
      for (const s of samples.slice(0, 3)) {
        const text = s.text.replace(/\n/g, ' ').slice(0, 160);
        lines.push(`    - ${text}`);
      }
      anyAdded = true;
    }
  }
  if (!anyAdded) {
    lines.push('  [no anti-samples yet]');
  }

  return lines.join('\n');
}
