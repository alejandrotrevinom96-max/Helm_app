// === Brand Bible types ===
// Single source of truth for the structure of projects.brandContext.
// Schema (lib/db/schema.ts) imports these so the jsonb column is typed
// consistently across server + client code.

export type Archetype =
  | 'hero'
  | 'sage'
  | 'outlaw'
  | 'creator'
  | 'caregiver'
  | 'magician'
  | 'ruler'
  | 'jester'
  | 'everyman'
  | 'lover'
  | 'innocent'
  | 'explorer';

export type EmojiPolicy = 'never' | 'rarely' | 'tasteful' | 'liberal';
export type HashtagPolicy = 'never' | 'minimal' | 'strategic' | 'aggressive';
export type ImageStyle =
  | 'photorealistic'
  | 'illustrated'
  | 'minimalist'
  | 'editorial'
  | 'mixed';
export type Confidence = 'high' | 'medium' | 'low' | 'inferred';
export type TypographyStyle = 'serif' | 'sans-serif' | 'display' | 'mono';

export interface BrandIdentity {
  name: string | null;
  tagline: string | null;
  mission: string | null;
  vision: string | null;
  foundedYear: number | null;
  industry: string | null;
}

export interface BrandArchetype {
  primary: Archetype | null;
  secondary: Archetype | null;
  rationale: string | null;
}

export interface BrandPillar {
  name: string;
  description: string;
  weight: number; // 0-100
}

export interface BrandVoice {
  formal: number; // 0..10 — 0=super casual, 10=corporate formal
  serious: number; // 0..10 — 0=playful, 10=dead serious
  bold: number; // 0..10 — 0=reserved, 10=bold/confident
  innovative: number; // 0..10 — 0=traditional, 10=cutting edge
  approachable: number; // 0..10 — 0=exclusive, 10=welcoming
}

export interface BrandVocabulary {
  preferredTerms: Array<{ term: string; instead_of: string | null }>;
  bannedTerms: Array<{ term: string; reason: string | null }>;
  brandPhrases: string[];
  emojiPolicy: EmojiPolicy;
  hashtagPolicy: HashtagPolicy;
}

export interface PainPoint {
  pain: string;
  intensity: 1 | 2 | 3 | 4 | 5;
}

export interface ToolTried {
  tool: string;
  why_failed: string | null;
}

export interface BrandPrimaryAudience {
  description: string;
  demographics: string | null;
  psychographics: string | null;
  painPoints: PainPoint[];
  jobsToBeDone: string[];
  toolsTried: ToolTried[];
  wateringHoles: string[];
}

export interface BrandAntiPersona {
  description: string | null;
  reasons: string[];
}

export interface BrandAudience {
  primary: BrandPrimaryAudience;
  antiPersona: BrandAntiPersona;
}

export interface ValueProp {
  pillar: string; // references BrandPillar.name
  proposition: string;
  proofPoints: string[];
}

export interface Objection {
  objection: string;
  response: string;
}

export interface BrandMessaging {
  primaryTagline: string | null;
  taglineVariants: string[];
  valueProps: ValueProp[];
  objections: Objection[];
  antiPositioning: string[]; // "we are NOT..."
}

export interface BrandColors {
  primary: string | null;
  secondary: string | null;
  accent: string | null;
  neutral: string | null;
}

export interface BrandTypography {
  headingStyle: TypographyStyle | null;
  bodyStyle: 'serif' | 'sans-serif' | 'mono' | null;
}

export interface BrandVisual {
  colors: BrandColors;
  typography: BrandTypography;
  imageStyle: ImageStyle | null;
  photographyMood: string | null;
}

export interface CulturalMoment {
  name: string;
  date: string;
  relevance: 1 | 2 | 3 | 4 | 5;
  angle: string | null;
}

export interface BrandConfidence {
  identity: Confidence;
  archetype: Confidence;
  pillars: Confidence;
  voice: Confidence;
  audience: Confidence;
  messaging: Confidence;
}

export interface BrandMeta {
  autoDiscoveredAt: string | null;
  lastEditedAt: string | null;
  completionScore: number; // 0..100
  sourceUrls: string[];
  confidence: BrandConfidence;
}

export interface BrandBible {
  identity: BrandIdentity;
  archetype: BrandArchetype;
  pillars: BrandPillar[];
  voice: BrandVoice;
  vocabulary: BrandVocabulary;
  nonNegotiables: string[];
  audience: BrandAudience;
  messaging: BrandMessaging;
  visual: BrandVisual;
  culturalMoments: CulturalMoment[];
  meta: BrandMeta;
  // Set by the migration script when upgrading from the PR #2 shape so the
  // original isn't lost. Optional going forward.
  _legacyOriginal?: Record<string, unknown>;
}

// Default empty bible — used when seeding or as a fallback.
export const EMPTY_VOICE: BrandVoice = {
  formal: 5,
  serious: 5,
  bold: 5,
  innovative: 5,
  approachable: 5,
};

// Compute a 0-100 score reflecting how complete the bible is. Used by the
// UI to nudge users to refine and by the discover endpoint to seed meta.
export function computeCompletionScore(bible: Partial<BrandBible>): number {
  let score = 0;
  if (bible.identity?.name) score += 5;
  if (bible.identity?.tagline) score += 5;
  if (bible.archetype?.primary) score += 10;
  if ((bible.pillars?.length ?? 0) >= 3) score += 15;
  if (bible.voice) score += 10;
  const vocab = bible.vocabulary;
  if ((vocab?.preferredTerms?.length ?? 0) > 0 || (vocab?.bannedTerms?.length ?? 0) > 0) {
    score += 10;
  }
  if ((bible.nonNegotiables?.length ?? 0) >= 3) score += 5;
  if (bible.audience?.primary?.description) score += 10;
  if ((bible.audience?.primary?.painPoints?.length ?? 0) >= 3) score += 10;
  if (bible.messaging?.primaryTagline) score += 5;
  if ((bible.messaging?.valueProps?.length ?? 0) >= 2) score += 10;
  if ((bible.messaging?.objections?.length ?? 0) >= 2) score += 5;
  return Math.min(100, score);
}
