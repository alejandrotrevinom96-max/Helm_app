// PR #85 — Sprint 7.10: filesystem-backed blog loader.
//
// Posts live as Markdown files under `content/blog/` at the repo
// root (NOT under `app/` — that folder is not a Next.js route
// group, it's a content workspace). We scan the directory at
// build/request time, parse YAML frontmatter, and expose a
// typed API the blog routes consume.
//
// Why filesystem (not a CMS): the founder's writing flow is
// "edit markdown → git push", which is faster than any CMS for
// 2-100 posts. When/if the post count or the editor lineup grows,
// swap this loader for a Notion/Sanity adapter — the consumers
// downstream only see `BlogPostMeta` + `BlogPost`, so the
// migration stays contained.
//
// PR #85 hotfix — moved from `Helm SEO/` to `content/blog/`. The
// previous path had a literal space which interacted badly with
// Vercel's file tracing in the App Router: build-time prerender
// claimed success, but `.next/prerender-manifest.json` ended up
// empty and the slug pages fell back to dynamic rendering, where
// `process.cwd()` resolution + the space made the runtime fs read
// fail with a 500. A clean lowercase path sidesteps both issues
// and matches what Next.js's `outputFileTracingIncludes` examples
// in the docs assume.
//
// All filesystem reads happen at build time (SSG via
// `generateStaticParams` + `dynamicParams: false` on /blog/[slug]).
// Either way they're server-only — never bundled into the client.
//
// PR Sprint pillarengine — hybrid loader. The loader now unions
// filesystem-backed posts (content/blog/*.md) with rows from the
// blog_posts_external table (Sprint pillarengine). File-backed
// posts take precedence on slug collision so the founder's
// hand-written editorial isn't silently overwritten by a noisy
// PillarEngine retry. This is the seam that lets us keep
// `/blog/[slug]` SSG while still picking up new content posted
// at runtime via webhook or cron — both write to the DB, then
// call revalidatePath('/blog', 'page') + revalidatePath(
// '/blog/[slug]', 'page') so the static manifest picks up the
// new rows on the next request.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { db } from '@/lib/db';
import { blogPostsExternal } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';

// The directory containing the markdown sources. Lives at the
// repo root under a clean, lowercase path so file tracing in
// Vercel deployments resolves predictably (see header note).
const POSTS_DIR = path.join(process.cwd(), 'content', 'blog');

export type BlogIcp =
  | 'founders'
  | 'agencies'
  | 'creators'
  | 'saas'
  | 'general';

export interface BlogPostMeta {
  // The filename slug — e.g. "context-switching-founders". This
  // is what /blog/[slug] routes match on, NOT the frontmatter
  // `slug:` field (which carries the full URL). Using the
  // filename keeps the file-to-URL mapping obvious and removes
  // a class of bugs where frontmatter drift causes 404s.
  slug: string;
  title: string;
  description: string;
  icp: BlogIcp;
  // Approximate reading time in minutes. Computed from word
  // count at parse time so it stays fresh as the post evolves.
  readingTimeMin: number;
  // Word count exposed so the index page can do its own
  // editorial decisions (e.g. badge "deep dive" over 1500 words).
  wordCount: number;
  // The original frontmatter `slug:` field — kept for redirect
  // safety. If a post wants its canonical URL different from the
  // filename, this is where it would diverge.
  canonicalPath: string;
  // PR Sprint pillarengine — origin tag. 'file' for the
  // hand-written posts living under content/blog/, 'pillarengine'
  // for ingested rows from blog_posts_external. The list page
  // can use this to render a "Generated" / "PillarEngine" badge
  // if we ever want editorial transparency; today it's purely
  // metadata, kept on the type so consumers don't have to widen.
  source: 'file' | 'pillarengine';
  // PR Sprint pillarengine — publication timestamp. ISO string
  // from blog_posts_external.approved_at for ingested rows;
  // null for file-based posts (their order is alphabetical by
  // slug — `date:` frontmatter can replace that later).
  publishedAt: string | null;
  // PR Sprint pillarengine — content intent ('seo' | 'aeo' |
  // 'hybrid' | null). Surfaced on the index card as editorial
  // context; null for file-based posts and any pillarengine row
  // that didn't carry the field.
  intent: string | null;
}

export interface BlogPost extends BlogPostMeta {
  // Raw markdown body (without frontmatter). Render happens in
  // lib/blog/render.ts so this module stays pure data + IO.
  markdown: string;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asIcp(v: unknown): BlogIcp {
  const allowed: BlogIcp[] = [
    'founders',
    'agencies',
    'creators',
    'saas',
    'general',
  ];
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return (allowed as string[]).includes(s) ? (s as BlogIcp) : 'general';
}

// Rough reading-time math: 225 words/minute is the median for
// adult English readers (a number that's been stable across
// reading-time studies for decades). We round up so a 230-word
// post reads as 2 min rather than 1.
function computeReadingTime(markdown: string): {
  readingTimeMin: number;
  wordCount: number;
} {
  // Strip code fences + inline code so they don't inflate the
  // count. Strip markdown syntax characters since most don't read
  // as words.
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/[#*_>\-[\]()|]/g, ' ');
  const words = stripped
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  const minutes = Math.max(1, Math.ceil(words / 225));
  return { readingTimeMin: minutes, wordCount: words };
}

async function listMarkdownFiles(): Promise<string[]> {
  try {
    const entries = await fs.readdir(POSTS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch (err) {
    // If `content/blog/` is missing (e.g. shallow checkout, content
    // moved later), return empty rather than crashing the build.
    // The index page will render an empty state instead of 500.
    console.warn('[blog/loader] could not read content/blog directory:', err);
    return [];
  }
}

async function readPostFile(filename: string): Promise<BlogPost | null> {
  const fullPath = path.join(POSTS_DIR, filename);
  try {
    const raw = await fs.readFile(fullPath, 'utf8');
    const { data, content } = matter(raw);
    const slug = filename.replace(/\.md$/, '');
    const { readingTimeMin, wordCount } = computeReadingTime(content);
    // PR #86 — Sprint 7.11: accept both `title`/`description` and
    // `meta_title`/`meta_description` in frontmatter. The two AEO
    // pillars from Sprint 7.10 used `title:` but the SEO templates
    // the founder is generating from this batch lead with
    // `meta_title:`. Falling through covers both without forcing a
    // mechanical rewrite of every new post.
    //
    // Strip trailing " | Helm" / " — Helm" when we fall back to
    // `meta_title`: the SEO-style meta tag carries the brand
    // suffix because it's literally the <title> string, but the
    // slug page's <Metadata> template ALSO appends " — Helm" — so
    // without this we'd get "Foo | Helm — Helm". The AEO `title:`
    // field never has a suffix, so we only sanitize the fallback.
    const rawTitle =
      asString(data.title) ||
      asString(data.meta_title).replace(/\s*[|—-]\s*Helm\s*$/i, '');
    const rawDescription =
      asString(data.description) || asString(data.meta_description);
    return {
      slug,
      title: rawTitle || slug,
      description: rawDescription,
      icp: asIcp(data.icp),
      readingTimeMin,
      wordCount,
      canonicalPath: asString(data.slug, `/blog/${slug}`),
      source: 'file' as const,
      publishedAt: null,
      intent: null,
      markdown: content,
    };
  } catch (err) {
    console.warn(`[blog/loader] could not parse ${filename}:`, err);
    return null;
  }
}

// PR Sprint pillarengine — DB reader. Pulls every approved row
// from blog_posts_external and shapes them into the same
// BlogPost contract the file path returns. Best-effort: a DB
// failure logs + returns [] so the blog still renders the
// file-based posts (the hand-written editorial is the strict
// fallback). The render layer doesn't care which source the
// post came from — the markdown body uses the same renderer.
async function listExternalPosts(): Promise<BlogPost[]> {
  try {
    const rows = await db
      .select()
      .from(blogPostsExternal)
      .orderBy(desc(blogPostsExternal.approvedAt));
    return rows.map((row) => {
      const { readingTimeMin, wordCount } = computeReadingTime(
        row.markdownBody,
      );
      return {
        slug: row.slug,
        title: row.title,
        // Prefer the explicit description; fall back to meta_description.
        description: row.metaDescription ?? '',
        // PillarEngine doesn't carry an ICP today — bucket under
        // 'general' so the badge layer has a defined value. The
        // editorial badge becomes meaningful once PillarEngine
        // tags pages with an audience axis.
        icp: 'general' as const,
        readingTimeMin,
        wordCount,
        canonicalPath: `/blog/${row.slug}`,
        source: 'pillarengine' as const,
        publishedAt: row.approvedAt?.toISOString() ?? null,
        intent: row.intent ?? null,
        markdown: row.markdownBody,
      };
    });
  } catch (err) {
    console.warn(
      '[blog/loader] could not read blog_posts_external:',
      err,
    );
    return [];
  }
}

// All posts as light-meta records. The index page uses this; the
// slug page falls through to getPost() which also loads the
// markdown body.
//
// PR Sprint pillarengine — unions file-backed posts with
// blog_posts_external rows. Collision rule: file-backed wins. The
// hand-written editorial is canonical; any PillarEngine row
// claiming the same slug gets dropped on the floor (we log a
// warning so on-call sees it). Sort order: pillarengine rows by
// approvedAt desc, then file-based by slug alphabetical, so the
// freshest external content surfaces above the static catalog.
export async function listPosts(): Promise<BlogPostMeta[]> {
  const [files, external] = await Promise.all([
    listMarkdownFiles().then((names) =>
      Promise.all(names.map((f) => readPostFile(f))),
    ),
    listExternalPosts(),
  ]);

  const fileSlugs = new Set<string>();
  const filePosts: BlogPost[] = [];
  for (const p of files) {
    if (p === null) continue;
    fileSlugs.add(p.slug);
    filePosts.push(p);
  }

  const externalPosts: BlogPost[] = [];
  for (const p of external) {
    if (fileSlugs.has(p.slug)) {
      console.warn(
        `[blog/loader] slug collision — file-backed "${p.slug}" shadows blog_posts_external row.`,
      );
      continue;
    }
    externalPosts.push(p);
  }

  const stripMarkdown = (
    posts: BlogPost[],
  ): BlogPostMeta[] =>
    posts.map(({ markdown, ...meta }) => {
      void markdown;
      return meta;
    });

  const externalMeta = stripMarkdown(externalPosts).sort((a, b) => {
    // newest approved first; nulls sort last
    const ax = a.publishedAt ?? '';
    const bx = b.publishedAt ?? '';
    if (ax === bx) return a.slug.localeCompare(b.slug);
    return ax < bx ? 1 : -1;
  });
  const fileMeta = stripMarkdown(filePosts).sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );

  // External above file is intentional: an editor who just
  // shipped a new SEO piece should see it at the top of the
  // index, not buried under the alphabetical legacy posts.
  return [...externalMeta, ...fileMeta];
}

// Lookup by filename slug. Returns null when the slug doesn't
// match a file or a DB row — callers (e.g. the [slug] page)
// should `notFound()` on null rather than render an error state.
//
// PR Sprint pillarengine — file-first lookup. We check the
// filesystem before touching the DB so hand-written posts always
// win on collision (matches the listPosts() shadow rule), and so
// the common case (renders for known static slugs) doesn't pay
// an extra round-trip. The DB lookup only fires when the file
// path returned null.
export async function getPost(slug: string): Promise<BlogPost | null> {
  if (!slug || /[^a-z0-9-]/i.test(slug)) return null;
  const fromFile = await readPostFile(`${slug}.md`);
  if (fromFile) return fromFile;

  try {
    const externals = await listExternalPosts();
    return externals.find((p) => p.slug === slug) ?? null;
  } catch (err) {
    console.warn('[blog/loader] DB lookup for slug failed:', err);
    return null;
  }
}
