import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { compassReadings, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { pullHelmData } from '@/lib/compass/data-pull';
import { computeScore, bandLabel } from '@/lib/compass/scoring';
import { generateInsights } from '@/lib/compass/insights';
import { checkRateLimit } from '@/lib/rate-limit';

// Opus call + DB writes typically <30s, but we leave headroom for slow
// Anthropic responses on the bigger projects (lots of waitlist data, etc).
export const maxDuration = 90;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Each compute = ~1 Opus call (~$0.10). Cap so an accidental loop in the
  // UI can't drain the budget. 10/hr is generous for normal use.
  const limit = checkRateLimit(`compass:${user.id}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { projectId, formData = {}, computedBy = 'manual' } = body as {
    projectId?: string;
    formData?: Record<string, unknown>;
    computedBy?: string;
  };

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const safeFormData =
    formData && typeof formData === 'object' && !Array.isArray(formData)
      ? formData
      : {};

  const helmData = await pullHelmData(projectId, user.id);
  const { totalScore, band, dimensions, redFlags, dataQuality } = computeScore(
    helmData,
    safeFormData
  );
  const insights = await generateInsights(
    totalScore,
    dimensions,
    helmData,
    safeFormData
  );

  const [created] = await db
    .insert(compassReadings)
    .values({
      projectId,
      userId: user.id,
      totalScore,
      band,
      dimensions: dimensions as unknown,
      redFlags: redFlags as unknown,
      bullCase: insights.bullCase as unknown,
      bearCase: insights.bearCase as unknown,
      dueDiligenceQuestion: insights.dueDiligenceQuestion,
      recommendations: insights.recommendations as unknown,
      formData: safeFormData,
      computedBy: computedBy === 'auto' ? 'auto' : 'manual',
      dataQuality,
    })
    .returning();

  return NextResponse.json({
    ok: true,
    reading: {
      ...created,
      bandLabel: bandLabel(band),
    },
  });
}
