import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, generatedPosts } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { generatePost } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId, platform, prompt } = await request.json();
  if (!projectId || !platform || !prompt) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const content = await generatePost({
      platform,
      prompt,
      context: { name: project.name, description: prompt },
    });

    await db.insert(generatedPosts).values({
      projectId: project.id,
      platform,
      content,
      prompt,
    });

    return NextResponse.json({ content });
  } catch (err) {
    console.error('Generation error:', err);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
