import { loadEnvConfig } from '@next/env';

interface LegacyBrandContext {
  voice?: string;
  tone?: string[];
  audience?: string;
  keyPhrases?: string[];
  productFocus?: string;
  extractedAt?: string;
}

// Map a PR #2-shape brandContext into the PR #10 BrandBible structure.
// Idempotent: rows that already have `archetype` are skipped. Original
// data is preserved under `_legacyOriginal` so we can roll back if needed.
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  const rows = (await db.execute(sql`
    SELECT id, brand_context FROM projects WHERE brand_context IS NOT NULL
  `)) as Array<{ id: string; brand_context: Record<string, unknown> | null }>;

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    const ctx = row.brand_context;
    if (!ctx) {
      skipped++;
      continue;
    }
    // Already migrated rows have an `archetype` field (legacy shape never did).
    if ('archetype' in ctx) {
      skipped++;
      continue;
    }

    const legacy = ctx as LegacyBrandContext;
    const tone = Array.isArray(legacy.tone) ? legacy.tone.map((t) => String(t).toLowerCase()) : [];

    const bible = {
      identity: {
        name: null,
        tagline: legacy.voice ?? null,
        mission: null,
        vision: null,
        foundedYear: null,
        industry: null,
      },
      archetype: { primary: null, secondary: null, rationale: null },
      pillars: [],
      voice: {
        formal: tone.includes('formal') ? 7 : 3,
        serious: tone.includes('serious') ? 7 : tone.includes('playful') ? 2 : 5,
        bold: tone.includes('bold') ? 7 : 5,
        innovative: 5,
        approachable: tone.includes('friendly') || tone.includes('casual') ? 8 : 5,
      },
      vocabulary: {
        preferredTerms: [],
        bannedTerms: [],
        brandPhrases: Array.isArray(legacy.keyPhrases) ? legacy.keyPhrases : [],
        emojiPolicy: 'tasteful',
        hashtagPolicy: 'minimal',
      },
      nonNegotiables: [],
      audience: {
        primary: {
          description: legacy.audience ?? '',
          demographics: null,
          psychographics: null,
          painPoints: [],
          jobsToBeDone: [],
          toolsTried: [],
          wateringHoles: [],
        },
        antiPersona: { description: null, reasons: [] },
      },
      messaging: {
        primaryTagline: null,
        taglineVariants: [],
        valueProps: [],
        objections: [],
        antiPositioning: [],
      },
      visual: {
        colors: { primary: null, secondary: null, accent: null, neutral: null },
        typography: { headingStyle: null, bodyStyle: null },
        imageStyle: null,
        photographyMood: null,
      },
      culturalMoments: [],
      meta: {
        autoDiscoveredAt: null,
        lastEditedAt: new Date().toISOString(),
        completionScore: 15,
        sourceUrls: [],
        confidence: {
          identity: 'inferred',
          archetype: 'low',
          pillars: 'low',
          voice: 'inferred',
          audience: 'inferred',
          messaging: 'low',
        },
      },
      _legacyOriginal: legacy,
    };

    await db.execute(sql`
      UPDATE projects
      SET brand_context = ${JSON.stringify(bible)}::jsonb
      WHERE id = ${row.id}
    `);
    migrated++;
  }

  console.log(`✓ Migrated ${migrated} projects, skipped ${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
