// PR #35 — Sprint 6.3: per-call usage telemetry for the Anthropic
// API. Idempotent (IF NOT EXISTS).
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• anthropic_usage_log …');
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS anthropic_usage_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid,
      project_id uuid,
      endpoint text NOT NULL,
      model text NOT NULL,
      input_tokens integer NOT NULL DEFAULT 0,
      output_tokens integer NOT NULL DEFAULT 0,
      cache_read_tokens integer NOT NULL DEFAULT 0,
      cache_write_tokens integer NOT NULL DEFAULT 0,
      estimated_cost_usd numeric(10, 6),
      created_at timestamp NOT NULL DEFAULT NOW()
    )
  `);

  console.log('• indexes …');
  // user_id + created_at lets the future Settings page filter by
  // "this month for this user" cheaply.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_anthropic_log_user_date
      ON anthropic_usage_log(user_id, created_at)
  `);
  // endpoint + created_at for the "what's our cache hit rate per
  // endpoint over the last 7 days?" diagnostic query.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_anthropic_log_endpoint_date
      ON anthropic_usage_log(endpoint, created_at)
  `);

  console.log('\nVerifying anthropic_usage_log:');
  const cols = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'anthropic_usage_log'
    ORDER BY ordinal_position
  `)) as Array<{ column_name: string }>;
  for (const c of cols) console.log('  ', c.column_name);

  console.log('\n✓ anthropic_usage_log ready');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
