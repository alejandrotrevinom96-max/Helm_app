import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { slugify } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const chosenProjects = body.projects as Array<{
    repo: { id: number; name: string; fullName: string };
    stack: { framework: string; hasSupabase: boolean; hasStripe: boolean };
  }>;

  for (const p of chosenProjects) {
    await db
      .insert(projects)
      .values({
        userId: user.id,
        name: p.repo.name,
        slug: slugify(p.repo.name),
        githubRepoFullName: p.repo.fullName,
        githubRepoId: p.repo.id,
        detectedStack: {
          framework: p.stack.framework,
          hasSupabase: p.stack.hasSupabase,
          hasStripe: p.stack.hasStripe,
        },
      })
      .onConflictDoNothing();
  }

  await db
    .update(users)
    .set({ hasCompletedOnboarding: true })
    .where(eq(users.id, user.id));

  return NextResponse.json({ success: true });
}
