// Diagnostic script: inspects preview rate-limits + cache rows.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { previewRateLimits, publicBiblePreviews } = await import(
    '../lib/db/schema'
  );

  const limits = await db.select().from(previewRateLimits);
  console.log(`Rate limit rows: ${limits.length}`);
  const now = new Date();
  for (const l of limits) {
    const blocked =
      l.blockedUntil && l.blockedUntil > now
        ? `blocked until ${l.blockedUntil.toISOString()}`
        : 'not blocked';
    console.log(
      `  ${l.ipHash.slice(0, 12)}…  count=${l.count}  windowStart=${l.windowStart.toISOString()}  ${blocked}`
    );
  }

  console.log(`\nPreview rows: `);
  const previews = await db.select().from(publicBiblePreviews);
  console.log(`Total: ${previews.length}`);
  for (const p of previews) {
    console.log(
      `  ${p.originalUrl}  visits=${p.visitCount}  archetype=${
        p.previewArchetype ?? '(null)'
      }  expires=${p.expiresAt?.toISOString() ?? 'null'}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
