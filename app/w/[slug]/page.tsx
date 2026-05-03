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
    <div className="min-h-screen flex items-center justify-center px-4 md:px-6 py-12 md:py-16 relative overflow-hidden">
      <div
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-accent-glow blur-[120px] opacity-25 -z-10 pointer-events-none"
      />

      <div className="max-w-xl w-full text-center">
        {(count?.c ?? 0) > 0 && (
          <div className="inline-flex items-center gap-2 px-3 py-1 glass rounded-full mb-8 text-sm text-text-2">
            <span className="w-2 h-2 rounded-full bg-success" />
            {count.c} {count.c === 1 ? 'person' : 'people'} on the waitlist
          </div>
        )}
        <h1 className="font-display text-display-lg font-light leading-tight tracking-tight mb-6">
          {page.title}
        </h1>
        {page.subtitle && (
          <p className="text-lg md:text-xl text-text-2 mb-10 leading-relaxed">{page.subtitle}</p>
        )}
        <WaitlistForm pageId={page.id} ctaText={page.ctaText ?? 'Join waitlist'} />
        <p className="text-text-3 text-sm mt-12">
          Built with{' '}
          <a href="/" className="text-accent hover:underline">
            Helm
          </a>
        </p>
      </div>
    </div>
  );
}
