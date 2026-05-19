// PR #85 — Sprint 7.10: /blog/[slug] dynamic page with SSG.
//
// generateStaticParams emits one path per file under `Helm SEO/`
// so each post pre-renders at build time. New posts ship by
// committing a markdown file + redeploying; no API call, no DB,
// no admin UI needed for now.
//
// Layout: editorial hero (title + description + meta) on top,
// then a two-column body — sticky Table of Contents in a narrow
// left rail on desktop, prose content on the right. Single-column
// stack on mobile (TOC hidden — saves vertical room on phones).
//
// Visuals were chosen to add SIGNAL, not noise:
//   - Reading-time + ICP badges in the hero (set founder
//     expectations before they scroll)
//   - Editorial dot-divider between sections (the source `---` in
//     markdown renders as three centered dots, not a horizontal
//     rule — quieter, matches the card-rhythm of the rest of the
//     marketing site)
//   - Headings get auto-anchors so the TOC links work
//   - End-of-post CTA back to /signup with the same "Claim your
//     spot" lockup as the landing pricing section
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getPost, listPosts } from '@/lib/blog/loader';
import { renderMarkdown } from '@/lib/blog/render';

const ICP_LABEL: Record<string, string> = {
  founders: 'For founders',
  agencies: 'For agencies',
  creators: 'For creators',
  saas: 'For SaaS',
  general: 'Field notes',
};

// SSG with on-demand fallback. generateStaticParams pre-renders
// every post the loader knew about at build time (file-backed +
// any pillarengine rows already in the DB). dynamicParams=true
// lets new pillarengine slugs render the FIRST time they're
// requested after the webhook/cron upsert — they're then cached
// per the next on-demand revalidate cycle.
//
// PR Sprint pillarengine — was dynamicParams=false. Flipping it
// is what unblocks runtime ingest: webhook writes blog_posts_external,
// calls revalidatePath('/blog'), and the next request for the new
// slug resolves through getPost() (which now reads the DB) instead
// of 404ing because the slug wasn't in the static manifest.
//
// Worth noting: the loader's path-validation regex (^[a-z0-9-]+$)
// is the only thing standing between a malicious slug and
// notFound(). If we ever want stricter "only registered slugs
// render" semantics, we'd add a registered-slug check here BEFORE
// calling getPost.
export async function generateStaticParams() {
  const posts = await listPosts();
  return posts.map((p) => ({ slug: p.slug }));
}

export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: 'Not found — Helm' };
  return {
    title: `${post.title} — Helm`,
    description: post.description,
    openGraph: {
      title: `${post.title} — Helm`,
      description: post.description,
      url: `https://trythelm.com/blog/${post.slug}`,
      siteName: 'Helm',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
    alternates: {
      canonical: `https://trythelm.com${post.canonicalPath}`,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const { html, toc } = renderMarkdown(post.markdown);

  return (
    <main className="px-4 md:px-8 py-12 md:py-20 max-w-6xl mx-auto">
      {/* Breadcrumb back to /blog. Stays compact at the top so the
          hero reads cleanly below it. */}
      <nav
        aria-label="Breadcrumb"
        className="mb-8 text-xs font-mono uppercase tracking-[0.15em] text-text-3"
      >
        <Link href="/blog" className="hover:text-text-1 transition-colors">
          ← Blog
        </Link>
      </nav>

      {/* Hero: meta row + title + description. Title strips the
          leading `# ` that the markdown body also has — both come
          from the same source so they're guaranteed to match;
          rendering both lets crawlers + readers see the title
          even if the prose layout shifts. */}
      <header className="mb-10 md:mb-14 max-w-3xl">
        <div className="flex items-center gap-3 mb-4 text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 flex-wrap">
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
        <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-light tracking-tight leading-[1.05] mb-5">
          {post.title}
        </h1>
        <p className="text-base md:text-lg text-text-2 leading-relaxed">
          {post.description}
        </p>
      </header>

      {/* Two-column layout on desktop: sticky TOC + prose. On
          mobile, the TOC collapses (it's a sticky-sidebar UX, not
          something you'd want at the top of a phone screen). */}
      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-10 lg:gap-14">
        {toc.length > 1 ? (
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
                On this page
              </div>
              <ul className="space-y-2 text-sm">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="text-text-3 hover:text-text-1 transition-colors leading-snug block"
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        ) : (
          <div className="hidden lg:block" />
        )}

        {/* The prose container. All long-form styling lives in
            globals.css under `.prose-helm` so we keep the markdown
            body untouchable from React (the renderer's HTML is
            dangerouslySetInnerHTML'd here). The wrapper class is
            also where dark/light tokens flow into headings + body
            text without per-element overrides. */}
        <article className="prose-helm max-w-2xl">
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </article>
      </div>

      {/* End-of-post CTA. Same "Claim your spot" lockup as the
          landing pricing section so the reader sees the consistent
          conversion target on every surface. */}
      <section className="mt-20 md:mt-28 pt-12 border-t border-border text-center max-w-2xl mx-auto">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
          What now?
        </div>
        <h2 className="font-display text-3xl md:text-4xl font-light tracking-tight mb-4">
          See what one workspace looks like.
        </h2>
        <p className="text-base text-text-2 mb-8 leading-relaxed">
          Helm replaces 7 marketing tabs with one workspace. Voice-
          aware drafts, multi-platform publishing, strategic
          clarity. Free while in beta.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 px-8 py-3.5 bg-accent text-white rounded-xl text-base font-medium hover:opacity-90 transition-opacity shadow-editorial hover:shadow-editorial-lg"
        >
          Claim your spot
          <ArrowRight className="w-5 h-5" />
        </Link>
        <p className="text-xs text-text-3 mt-4">
          No credit card. No bullshit. 30 seconds to start.
        </p>
      </section>
    </main>
  );
}
