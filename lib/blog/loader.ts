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
import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

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
    return {
      slug,
      title: asString(data.title, slug),
      description: asString(data.description),
      icp: asIcp(data.icp),
      readingTimeMin,
      wordCount,
      canonicalPath: asString(data.slug, `/blog/${slug}`),
      markdown: content,
    };
  } catch (err) {
    console.warn(`[blog/loader] could not parse ${filename}:`, err);
    return null;
  }
}

// All posts as light-meta records. The index page uses this; the
// slug page falls through to getPost() which also loads the
// markdown body.
export async function listPosts(): Promise<BlogPostMeta[]> {
  const files = await listMarkdownFiles();
  const posts = await Promise.all(files.map((f) => readPostFile(f)));
  return posts
    .filter((p): p is BlogPost => p !== null)
    .map(({ markdown, ...meta }) => {
      // strip the body from the index payload so this function
      // can be safely awaited from generateStaticParams without
      // pulling raw markdown into the static manifest.
      void markdown;
      return meta;
    })
    // Stable sort — alphabetical by slug for now. When `date:`
    // frontmatter lands on every post, swap to date-desc.
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// Lookup by filename slug. Returns null when the slug doesn't
// match a file — callers (e.g. the [slug] page) should
// `notFound()` on null rather than render an error state.
export async function getPost(slug: string): Promise<BlogPost | null> {
  if (!slug || /[^a-z0-9-]/i.test(slug)) return null;
  return readPostFile(`${slug}.md`);
}
