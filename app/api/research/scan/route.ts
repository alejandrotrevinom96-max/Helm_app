import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects, researchFindings } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { searchReddit } from '@/lib/integrations/reddit';
import { scoreResearchMatch } from '@/lib/ai/claude';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId } = await request.json();
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Generate query from project name + stack
  const stack = project.detectedStack || {};
  const queryParts = [
    project.name,
    stack.hasSupabase ? 'supabase' : '',
    stack.hasStripe ? 'stripe' : '',
    'dashboard analytics',
  ].filter(Boolean);
  const query = queryParts.join(' ');

  const posts = await searchReddit(query, { limit: 25, timeRange: 'week' });

  const description = `${project.name} — a SaaS using ${stack.framework || 'Next.js'}${
    stack.hasSupabase ? ' + Supabase' : ''
  }${stack.hasStripe ? ' + Stripe' : ''}`;

  let inserted = 0;
  for (const post of posts) {
    try {
      // Skip if already exists
      const [existing] = await db
        .select()
        .from(researchFindings)
        .where(
          and(
            eq(researchFindings.projectId, project.id),
            eq(researchFindings.externalId, post.id)
          )
        )
        .limit(1);
      if (existing) continue;

      const matchScore = await scoreResearchMatch({
        projectDescription: description,
        postTitle: post.title,
        postContent: post.selftext,
      });

      if (matchScore < 30) continue; // Filter low-relevance noise

      await db.insert(researchFindings).values({
        projectId: project.id,
        source: 'reddit',
        externalId: post.id,
        title: post.title,
        url: `https://reddit.com${post.permalink}`,
        snippet: post.selftext.slice(0, 300),
        matchScore,
        upvotes: post.ups,
        comments: post.num_comments,
        postedAt: new Date(post.created_utc * 1000),
      });
      inserted++;
    } catch {
      continue;
    }
  }

  return NextResponse.json({ scanned: posts.length, inserted });
}
