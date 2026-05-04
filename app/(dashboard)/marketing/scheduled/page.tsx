import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ScheduledManager } from './manager';

export default async function ScheduledPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const allScheduled = await db
    .select()
    .from(scheduledPosts)
    .where(eq(scheduledPosts.userId, user.id))
    .orderBy(desc(scheduledPosts.scheduledFor));

  // Serialise dates so the client component can read them as strings.
  const posts = allScheduled.map((p) => ({
    id: p.id,
    platform: p.platform,
    content: p.content,
    scheduledFor: p.scheduledFor.toISOString(),
    status: p.status,
    consistencyScore: p.consistencyScore,
    visualUrl: p.visualUrl,
    performanceRating: p.performanceRating,
    performanceNote: p.performanceNote,
  }));

  return (
    <div className="p-6 md:p-10 max-w-5xl">
      <Link href="/marketing" className="text-xs text-accent hover:underline">
        ← Back to Marketing
      </Link>
      <h1 className="font-display text-display-lg font-light tracking-tight mt-3 mb-2">
        Scheduled posts
      </h1>
      <p className="text-text-2 mb-6">
        {posts.length} total · manage in bulk
      </p>

      <ScheduledManager posts={posts} />
    </div>
  );
}
