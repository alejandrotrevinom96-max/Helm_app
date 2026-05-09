// PR #49 — Sprint 6.8: VoiceFingerprint type.
//
// Abstract pattern bundle derived from a project's brand_quotes
// by Opus. The generator consumes this — NOT the raw quotes — so
// we never copy a founder's literal phrasing into outputs. The
// "signaturePhrasings" entries describe the SHAPE of phrasing
// (e.g. "starts with a question, then a number, then a CTA"),
// not actual phrases.
//
// All arrays should land at 3-5 items each in production. Empty
// arrays are tolerated (the prompt builder filters them out
// downstream) but indicate the analyzer struggled with the input.

export interface VoiceFingerprint {
  structuralPatterns: string[];
  vocabularyTraits: string[];
  signaturePhrasings: string[];
  toneCharacteristics: string[];
  avoidPatterns: string[];
  sourceQuotesCount: number;
  derivedAt: string; // ISO 8601
}

export function isVoiceFingerprint(x: unknown): x is VoiceFingerprint {
  if (!x || typeof x !== 'object') return false;
  const f = x as Record<string, unknown>;
  return (
    Array.isArray(f.structuralPatterns) &&
    Array.isArray(f.vocabularyTraits) &&
    Array.isArray(f.signaturePhrasings) &&
    Array.isArray(f.toneCharacteristics) &&
    Array.isArray(f.avoidPatterns) &&
    typeof f.sourceQuotesCount === 'number' &&
    typeof f.derivedAt === 'string'
  );
}
