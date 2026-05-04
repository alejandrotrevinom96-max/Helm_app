import { loadEnvConfig } from '@next/env';

// PR #16 added smart source defaults in lib/research/source-defaults.ts.
// Existing projects still have all four sources enabled (the legacy
// hardcoded default), which means non-tech projects keep getting noisy
// HN/IH findings filtered out at scoring time, wasting Haiku calls.
//
// This script recomputes defaults for every research_config row that
// looks like it has the legacy "all-on" preset AND has a brand bible
// to infer from. It SKIPS rows the user has already customized — we
// detect "all-on" exactly so a user choice of e.g. {reddit: true,
// hackernews: false, ...} is preserved.
//
// SAFE: only touches the `sources` column, never deletes findings or
// changes keywords/competitors. Skips rows without a brand bible (no
// signal to infer from).
//
// Run manually:
//   DATABASE_URL=<prod> npx tsx scripts/fix-research-sources-defaults.ts
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { projects, researchConfig } = await import('../lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const { getDefaultSources } = await import(
    '../lib/research/source-defaults'
  );
  type BrandBible = import('../lib/types/brand').BrandBible;

  const configs = await db.select().from(researchConfig);
  console.log(`• inspecting ${configs.length} research_config row(s) …`);

  let updated = 0;
  let skippedCustomized = 0;
  let skippedNoBible = 0;

  for (const cfg of configs) {
    const sources = (cfg.sources ?? null) as Record<string, boolean> | null;
    const isLegacyAllOn =
      sources !== null &&
      sources.reddit === true &&
      sources.hackernews === true &&
      sources.indiehackers === true &&
      sources.googleTrends === true;

    if (!isLegacyAllOn) {
      skippedCustomized++;
      continue;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, cfg.projectId))
      .limit(1);
    if (!project) continue;

    const bible = (project.brandContext as BrandBible | null) ?? null;
    if (!bible || !bible.identity) {
      skippedNoBible++;
      continue;
    }

    const recomputed = getDefaultSources(bible);
    await db
      .update(researchConfig)
      .set({ sources: recomputed })
      .where(eq(researchConfig.projectId, cfg.projectId));

    console.log(
      `  [${project.name}] ${JSON.stringify(recomputed)}`
    );
    updated++;
  }

  console.log(
    `\n✓ Updated: ${updated}  ·  Skipped (customized): ${skippedCustomized}  ·  Skipped (no bible): ${skippedNoBible}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
