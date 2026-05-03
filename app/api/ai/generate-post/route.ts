import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, generatedPosts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { generatePost, type BrandContext } from '@/lib/ai/claude';
import { getTemplateById } from '@/lib/marketing/templates';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId, platform, prompt, templateId } = await request.json();
  if (!projectId || !platform || !prompt) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const template = getTemplateById(templateId);

  try {
    const content = await generatePost({
      platform,
      prompt,
      context: {
        name: project.name,
        description: prompt,
        brandContext: (project.brandContext as BrandContext | null) ?? null,
        templateHint: template?.systemHint ?? null,
      },
    });

    await db.insert(generatedPosts).values({
      projectId: project.id,
      platform,
      content,
      prompt,
    });

    return NextResponse.json({ content, templateUsed: template?.id ?? null });
  } catch (err) {
    console.error('[GENERATE POST] error', err);
    return NextResponse.json(
      {
        error: 'Generation failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
