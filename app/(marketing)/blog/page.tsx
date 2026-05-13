// PR #85 — Sprint 7.10: /blog index.
//
// Lists every markdown file under `Helm SEO/` (via lib/blog/loader)
// as an editorial card. Visual hierarchy matches the rest of the
// (marketing) route group — same Fraunces display + JetBrains mono
// labels, same Editorial Glass cards, same accent color tokens.
//
// Lives inside the (marketing) route group so it inherits the
// marketing layout (no dashboard chrome, no auth gate). Logged-in
// users land here unauth — they can read posts without bouncing
// to /analytics.
import Link from 'next/link';
import type { Metadata } from 'next';
import { listPosts } from '@/lib/blog/loader';

export const metadata: Metadata = {
  title: 'Blog — Helm',
  description:
    'How small teams ship marketing without context-switching. Field notes from the founder of Helm.',
  openGraph: {
    title: 'Blog — Helm',
    description:
      'How small teams ship marketing without context-switching.',
    url: 'https://trythelm.com/blog',
    siteName: 'Helm',
    type: 'website',
  },
};

const ICP_LABEL: Record<string, string> = {
  founders: 'For founders',
  agencies: 'For agencies',
  creators: 'For creators',
  saas: 'For SaaS',
  general: 'Field notes',
};

export default async function BlogIndexPage() {
  const posts = await listPosts();

  return (
    <main className="px-4 md:px-8 py-16 md:py-24 max-w-5xl mx-auto">
      <header className="mb-12 md:mb-16 max-w-3xl">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
          Blog
        </div>
        <h1 className="font-display text-5xl md:text-6xl font-light tracking-tight leading-[1.05] mb-5">
          Field notes from one workspace.
        </h1>
        <p className="text-base md:text-lg text-text-2 leading-relaxed">
          How small teams ship marketing without context-switching.
          Practical playbooks, the math behind tool sprawl, and what
          we&apos;re learning building Helm in public.
        </p>
      </header>

      {posts.length === 0 ? (
        <div className="bg-bg-elev/60 border border-border rounded-2xl p-12 text-center">
          <p className="text-text-2">
            No posts yet. Check back soon.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link
                href={`/blog/${post.slug}`}
                className="group block bg-bg-elev/60 border border-border rounded-2xl p-6 md:p-8 hover:border-accent/40 hover:bg-bg-elev/80 transition-colors"
              >
                <div className="flex items-center gap-3 mb-3 text-[10px] font-mono uppercase tracking-[0.15em] text-text-3">
                  <span className="text-accent">
                    {ICP_LABEL[post.icp] ?? ICP_LABEL.general}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{post.readingTimeMin} min read</span>
                  {post.wordCount >= 1500 && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Deep dive</span>
                    </>
                  )}
                </div>
                <h2 className="font-display text-2xl md:text-3xl font-light tracking-tight leading-tight mb-3 group-hover:text-accent transition-colors">
                  {post.title}
                </h2>
                <p className="text-sm md:text-base text-text-2 leading-relaxed mb-4">
                  {post.description}
                </p>
                <span className="text-xs font-mono text-accent group-hover:underline">
                  Read →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Soft footer — the marketing route's own footer is below
          on every page (it lives in app/(marketing)/_landing/
          landing-footer.tsx but only renders inside the landing
          page composer). On the blog, we add a minimal CTA strip
          so the visitor has a clear "what to do next" after they
          scan the list. */}
      <section className="mt-16 md:mt-24 pt-10 border-t border-border text-center">
        <p className="text-sm text-text-3 mb-3">
          Like the writing? See the product.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
        >
          Try Helm →
        </Link>
      </section>
    </main>
  );
}
