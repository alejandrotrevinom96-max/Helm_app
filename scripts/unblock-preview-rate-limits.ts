// PR #36 quick-fix support: clears the preview_rate_limits table so
// blocked IPs can retry. Run after a deploy that fixes the underlying
// failure mode — leaving the block in place punishes users for our
// bug.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { previewRateLimits } = await import('../lib/db/schema');
  const result = await db.delete(previewRateLimits).returning();
  console.log(`Cleared ${result.length} rate-limit row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
