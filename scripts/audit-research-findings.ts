import { loadEnvConfig } from '@next/env';

// Read-only audit: for each project, list how many findings it has and
// what competitors are tagged. Helps confirm whether the insight bug is
// data leak (findings under wrong projectId) or prompt-poisoning (findings
// correct but LLM extrapolates due to a hardcoded fallback in the prompt).
async function main() {
  loadEnvConfig(process.cwd());
  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');

  console.log('• per-project findings count + competitor mix\n');
  const rows = (await db.execute(sql`
    SELECT
      p.id as project_id,
      p.name as project_name,
      count(rf.id)::int as finding_count,
      array_agg(DISTINCT rf.competitor) FILTER (WHERE rf.competitor IS NOT NULL) as competitors,
      array_agg(DISTINCT rf.source) FILTER (WHERE rf.source IS NOT NULL) as sources
    FROM projects p
    LEFT JOIN research_findings rf ON rf.project_id = p.id
    GROUP BY p.id, p.name
    ORDER BY p.name
  `)) as Array<{
    project_id: string;
    project_name: string;
    finding_count: number;
    competitors: string[] | null;
    sources: string[] | null;
  }>;

  for (const r of rows) {
    console.log(`  [${r.project_name}] ${r.finding_count} finding(s)`);
    if (r.competitors && r.competitors.length > 0) {
      console.log(`    competitors: ${r.competitors.join(', ')}`);
    }
    if (r.sources && r.sources.length > 0) {
      console.log(`    sources: ${r.sources.join(', ')}`);
    }
  }

  console.log('\n• orphan findings (project_id not in projects):');
  const orphans = (await db.execute(sql`
    SELECT count(*)::int as n
    FROM research_findings rf
    LEFT JOIN projects p ON p.id = rf.project_id
    WHERE p.id IS NULL
  `)) as Array<{ n: number }>;
  console.log('  count:', orphans[0]?.n ?? 0);

  console.log('\n• cached weeklyInsight per project (preview):');
  const insights = (await db.execute(sql`
    SELECT
      p.name,
      LEFT(rc.weekly_insight, 150) as insight_preview,
      rc.weekly_insight_at
    FROM research_config rc
    JOIN projects p ON p.id = rc.project_id
    WHERE rc.weekly_insight IS NOT NULL
    ORDER BY rc.weekly_insight_at DESC
  `)) as Array<{
    name: string;
    insight_preview: string;
    weekly_insight_at: Date | string;
  }>;
  for (const i of insights) {
    console.log(`  [${i.name}] (${i.weekly_insight_at})`);
    console.log(`    ${i.insight_preview.replace(/\s+/g, ' ').slice(0, 140)}…`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
