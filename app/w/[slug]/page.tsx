import { db } from '@/lib/db';
import { waitlistPages, waitlistSignups } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { WaitlistForm } from './form';

export default async function PublicWaitlistPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [page] = await db
    .select()
    .from(waitlistPages)
    .where(eq(waitlistPages.slug, slug))
    .limit(1);

  if (!page || !page.isActive) notFound();

  const [count] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(waitlistSignups)
    .where(eq(waitlistSignups.waitlistPageId, page.id));

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="max-w-xl w-full text-center">
        {(count?.c ?? 0) > 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1 border border-border-bright rounded-full bg-bg-elev mb-8 text-sm text-text-dim">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            {count.c} {count.c === 1 ? 'person' : 'people'} on the waitlist
          </div>
        )}
        <h1 className="font-display text-5xl md:text-6xl font-normal mb-6 leading-tight tracking-tight">
          {page.title}
        </h1>
        {page.subtitle && (
          <p className="text-xl text-text-dim mb-10 leading-relaxed">{page.subtitle}</p>
        )}
        <WaitlistForm pageId={page.id} ctaText={page.ctaText ?? 'Join waitlist'} />
        <p className="text-text-faint text-sm mt-12">
          Built with <a href="/" className="text-accent hover:underline">Helm</a>
        </p>
      </div>
    </div>
  );
}
