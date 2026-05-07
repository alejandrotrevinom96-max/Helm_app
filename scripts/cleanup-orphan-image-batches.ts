// PR #28 — Sprint 4.1: cleanup helper for orphan / partial batches.
//
// PR #27 had a sequential generator that timed out after ~60s on
// Vercel, leaving partial batches in brand_image_validations. PR #28
// fixes the root cause (chunked parallel), but rows from the timeout
// era still sit around with <12 images per batch. This script lists
// them and (with --confirm) deletes them.
//
// Idempotent + DRY-RUN-by-default — running without --confirm just
// reports what *would* be deleted. Run with --confirm only after
// reviewing the output.
//
// Usage (dry run):
//   npx tsx scripts/cleanup-orphan-image-batches.ts
// Apply:
//   npx tsx scripts/cleanup-orphan-image-batches.ts --confirm
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  const apply = process.argv.includes('--confirm');

  const incomplete = (await db.execute(sql`
    SELECT batch_id::text AS batch_id, COUNT(*)::int AS image_count
    FROM brand_image_validations
    GROUP BY batch_id
    HAVING COUNT(*) < 12
    ORDER BY MAX(created_at) DESC
  `)) as Array<{ batch_id: string; image_count: number }>;

  if (incomplete.length === 0) {
    console.log('✓ No incomplete batches found.');
    return;
  }

  console.log(`Found ${incomplete.length} incomplete batches:`);
  for (const row of incomplete) {
    console.log(`  ${row.batch_id} — ${row.image_count}/12 images`);
  }

  if (!apply) {
    console.log('\nDRY RUN — re-run with --confirm to delete these.');
    return;
  }

  const ids = incomplete.map((r) => r.batch_id);
  const deleted = (await db.execute(sql`
    DELETE FROM brand_image_validations
    WHERE batch_id = ANY(${ids}::uuid[])
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  console.log(
    `\n✓ Deleted ${deleted.length} rows across ${incomplete.length} batches.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
