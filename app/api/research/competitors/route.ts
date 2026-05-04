import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchFindings, researchConfig } from '@/lib/db/schema';
import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { ResearchFinding } from '@/lib/db/schema';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [config] = await db
    .select({ competitors: researchConfig.competitors })
    .from(researchConfig)
    .where(eq(researchConfig.projectId, projectId))
    .limit(1);

  const competitors = (config?.competitors as string[] | null) ?? [];
  if (competitors.length === 0) {
    return NextResponse.json({ competitors: [], findings: {} });
  }

  const findings = await db
    .select()
    .from(researchFindings)
    .where(
      and(
        eq(researchFindings.projectId, projectId),
        isNotNull(researchFindings.competitor)
      )
    )
    .orderBy(desc(researchFindings.matchScore));

  // Bucket findings by competitor name. We initialize with all configured
  // competitors so the UI can render an empty card for ones with no mentions.
  const grouped: Record<string, ResearchFinding[]> = {};
  for (const c of competitors) grouped[c.toLowerCase()] = [];
  for (const f of findings) {
    if (f.competitor && grouped[f.competitor]) {
      grouped[f.competitor].push(f);
    }
  }

  return NextResponse.json({ competitors, findings: grouped });
}
