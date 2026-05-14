// PR Sprint 7.19 — VisualPromptIR validator port.
//
// 1:1 translation of
// Helm SEO/helm-adaptive-voice-engine/visual_validator.py.
//
// Server-side soft validation of VisualPromptIR after
// buildVisualPromptIR(). Zod enforces the schema (field types,
// lengths, ranges). This module catches the rules that depend on
// cross-field relationships, brand-mood coherence, or known
// image-model failure patterns.
//
// Usage:
//   const failures = validateVisualPromptIR(ir);
//   if (failures.length > 0) {
//     // Either return to operator with reasons, or regenerate
//     // (typically rerun extractSubjectBlock with the failure
//     // as additional context).
//   }

import { getAspectRatio } from './platform-visual-language';
import type { VisualPromptIR } from './visual-schema';

// ============================================================
// Constants
// ============================================================

// Words/phrases in SubjectBlock that signal the model gave up
// and defaulted to abstraction. These produce stock-feeling
// output.
const SUBJECT_LAZY_TERMS: ReadonlyArray<string> = [
  'concept of',
  'abstract representation',
  'generic image of',
  'stock photo of',
  'people doing',
  'person at a desk',
  'modern office',
  'diverse team',
  'happy customer',
];

// Words in main_subject that conflict with the "no text" hard
// rule. Belt-and-suspenders for the schema-level check.
const SUBJECT_TEXT_TERMS: ReadonlyArray<string> = [
  'with text',
  'with caption',
  'text overlay',
  'logo',
  'watermark',
  'title card',
];

// Mood adjective sets that conflict. If brand mood and subject
// mood don't overlap in any of these clusters, validation flags
// a potential mismatch.
const MOOD_CLUSTERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  warm: ['warm', 'human', 'friendly', 'cozy', 'intimate', 'natural'],
  clinical: [
    'clinical',
    'minimal',
    'clean',
    'sterile',
    'precise',
    'technical',
  ],
  gritty: [
    'gritty',
    'raw',
    'documentary',
    'unfiltered',
    'moody',
    'dark',
  ],
  aspirational: [
    'aspirational',
    'polished',
    'luxe',
    'elegant',
    'refined',
  ],
  energetic: [
    'energetic',
    'bold',
    'vibrant',
    'dynamic',
    'high-energy',
  ],
};

// Cluster pairs that signal a clash when the brand sits in one
// and the subject sits in the other.
const OPPOSING_PAIRS: ReadonlyArray<[string, string]> = [
  ['warm', 'clinical'],
  ['warm', 'gritty'],
  ['aspirational', 'gritty'],
];

// Critical anti-patterns that should virtually always be on the
// negative list. Flagged if missing — caller might have
// overridden intentionally for an illustration-first brand.
const CRITICAL_AVOIDS: ReadonlyArray<string> = [
  'text in image',
  'watermark',
  'distorted hands or faces',
];

// ============================================================
// Public API
// ============================================================

/**
 * Run all soft validation rules against a VisualPromptIR.
 *
 * Zod already enforced the schema. These checks catch logical
 * inconsistencies, brand misalignment, and known image-model
 * failure patterns.
 *
 * Returns an empty array on all-pass. Otherwise a list of
 * human-readable failure messages — caller decides whether to
 * reject + regenerate or surface to an operator.
 */
export function validateVisualPromptIR(ir: VisualPromptIR): string[] {
  const failures: string[] = [];

  failures.push(...checkSubjectNotLazy(ir));
  failures.push(...checkSubjectNoTextInstructions(ir));
  failures.push(...checkBrandMoodCoherence(ir));
  failures.push(...checkColorPaletteSize(ir));
  failures.push(...checkNegativeBlockCompleteness(ir));
  failures.push(...checkAspectRatioConsistency(ir));

  return failures;
}

// ============================================================
// Individual checks
// ============================================================

function checkSubjectNotLazy(ir: VisualPromptIR): string[] {
  const subjectLower = ir.subject.main_subject.toLowerCase();
  for (const term of SUBJECT_LAZY_TERMS) {
    if (subjectLower.includes(term)) {
      return [
        `SubjectBlock.main_subject contains lazy phrase '${term}'. Re-run extractSubjectBlock with feedback that the visual should be specific and concrete, not abstract or stock.`,
      ];
    }
  }
  return [];
}

function checkSubjectNoTextInstructions(ir: VisualPromptIR): string[] {
  // Belt-and-suspenders: the schema validator catches this in
  // main_subject, but this check also looks at composition,
  // setting, and visual_metaphor where the validator doesn't run.
  const failures: string[] = [];
  const fields: Array<[string, string]> = [
    ['composition', ir.subject.composition],
    ['setting', ir.subject.setting],
    ['visual_metaphor', ir.subject.visual_metaphor ?? ''],
  ];
  for (const [fieldName, value] of fields) {
    const lower = value.toLowerCase();
    for (const term of SUBJECT_TEXT_TERMS) {
      if (lower.includes(term)) {
        failures.push(
          `SubjectBlock.${fieldName} contains text-instruction phrase '${term}'. Text overlays are added separately. Remove from ${fieldName}.`,
        );
      }
    }
  }
  return failures;
}

function checkBrandMoodCoherence(ir: VisualPromptIR): string[] {
  // The mood_descriptor and emotional_anchor in SubjectBlock
  // should be in the same emotional cluster as the brand mood.
  // A 'warm and human' brand should not produce 'cold and
  // clinical' subject moods.
  const brandMood = ir.brand.mood.toLowerCase();
  const brandCluster = moodToCluster(brandMood);
  if (!brandCluster) return [];

  const failures: string[] = [];

  // mood_descriptor against brand mood.
  const subjectMood = ir.subject.mood_descriptor.toLowerCase();
  const subjectCluster = moodToCluster(subjectMood);
  if (subjectCluster) {
    for (const [a, b] of OPPOSING_PAIRS) {
      const pair = new Set([subjectCluster, brandCluster]);
      if (pair.has(a) && pair.has(b) && pair.size === 2) {
        failures.push(
          `Brand mood '${ir.brand.mood}' (cluster: ${brandCluster}) and subject mood_descriptor '${ir.subject.mood_descriptor}' (cluster: ${subjectCluster}) are in opposing emotional clusters. Re-run extractSubjectBlock with brand mood as a stronger constraint.`,
        );
        break;
      }
    }
  }

  // emotional_anchor against brand mood (if present).
  if (ir.subject.emotional_anchor) {
    const anchor = ir.subject.emotional_anchor.toLowerCase();
    const anchorCluster = moodToCluster(anchor);
    if (anchorCluster) {
      for (const [a, b] of OPPOSING_PAIRS) {
        const pair = new Set([anchorCluster, brandCluster]);
        if (pair.has(a) && pair.has(b) && pair.size === 2) {
          failures.push(
            `Brand mood '${ir.brand.mood}' (cluster: ${brandCluster}) and subject emotional_anchor '${ir.subject.emotional_anchor}' (cluster: ${anchorCluster}) are in opposing emotional clusters.`,
          );
          break;
        }
      }
    }
  }

  return failures;
}

function checkColorPaletteSize(ir: VisualPromptIR): string[] {
  const n = ir.brand.color_palette.length;
  if (n === 0) {
    return [
      "BrandBlock.color_palette is empty. Image will use Flux defaults and won't reflect brand. Add 1-5 colors from BrandBible.",
    ];
  }
  if (n > 5) {
    return [
      `BrandBlock.color_palette has ${n} colors. More than 5 produces muddy output. Trim to 3-4 most representative colors.`,
    ];
  }
  return [];
}

function checkNegativeBlockCompleteness(ir: VisualPromptIR): string[] {
  // The default NegativeBlock has the critical AI-image
  // anti-patterns. If a caller overrode it and removed all the
  // defaults, flag it.
  const avoidSet = new Set(
    ir.negative.avoid_terms.map((t) => t.toLowerCase()),
  );
  const missing = CRITICAL_AVOIDS.filter((t) => !avoidSet.has(t));
  if (missing.length > 0) {
    return [
      `NegativeBlock missing critical anti-patterns: ${JSON.stringify(
        [...missing].sort(),
      )}. These are nearly always wanted unless the brand intentionally uses them. Re-add or confirm intentional override.`,
    ];
  }
  return [];
}

function checkAspectRatioConsistency(ir: VisualPromptIR): string[] {
  // Aspect ratio in PlatformBlock should match the canonical
  // mapping for (platform, content_type). Mismatches usually
  // mean the caller passed a custom override; flag for
  // confirmation.
  let expected;
  try {
    expected = getAspectRatio(ir.platform.platform, ir.platform.content_type);
  } catch {
    // No mapping for this (platform, content_type). Skip.
    return [];
  }
  if (ir.platform.aspect_ratio !== expected) {
    return [
      `PlatformBlock.aspect_ratio is ${ir.platform.aspect_ratio} but canonical mapping for (${ir.platform.platform}, ${ir.platform.content_type}) is ${expected}. Confirm intentional override or regenerate with default.`,
    ];
  }
  return [];
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Map a free-text mood descriptor to one of the known mood
 * clusters. Returns the cluster name if any cluster keyword
 * appears in the mood text, otherwise null.
 */
function moodToCluster(moodText: string): string | null {
  const lower = moodText.toLowerCase();
  for (const [clusterName, keywords] of Object.entries(MOOD_CLUSTERS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return clusterName;
    }
  }
  return null;
}
