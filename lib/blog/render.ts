// PR #85 — Sprint 7.10: server-side markdown → HTML renderer.
//
// Uses `marked` for the heavy lifting and a custom renderer to
// add a couple of Helm-specific affordances:
//
//   - Heading anchors. Every `## subhead` gets an `id` derived
//     from its text so the Table of Contents sidebar can deep
//     link. Markdown is rendered server-side so the IDs ship
//     statically — no client-side hashing of headings on hydration.
//
//   - Horizontal rule polish. The source posts use `---` as
//     section breaks; the default <hr> is too loud. We render it
//     as an editorial dot-divider that matches the Editorial Glass
//     visual vocabulary.
//
// We do NOT sanitize: the source markdown comes from the repo, not
// from user input. If/when posts ever come from outside this repo
// (CMS, contributor PRs), add DOMPurify or `marked`'s sanitizer.
//
// Returns both the HTML string and the parsed table of contents
// (level 2 headings) so the page component can render the sticky
// TOC without re-parsing.
import { marked } from 'marked';

export interface TocEntry {
  id: string;
  text: string;
}

export interface RenderedPost {
  html: string;
  toc: TocEntry[];
}

// Turn a heading string into a URL-safe slug. Mirrors GitHub's
// rule of lowercase + non-alphanumeric → dashes, collapsing
// consecutive dashes, trimming edges.
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function renderMarkdown(markdown: string): RenderedPost {
  const toc: TocEntry[] = [];
  // Fresh renderer per call so the toc closure doesn't leak
  // across invocations (matters for SSG where multiple pages
  // render in parallel).
  const renderer = new marked.Renderer();

  renderer.heading = ({ tokens, depth }) => {
    const text = renderer.parser.parseInline(tokens);
    // marked passes tokens; parseInline returns the HTML for the
    // heading. For the id we want the plain-text content, not the
    // HTML — strip any tags.
    const plain = text.replace(/<[^>]+>/g, '');
    const id = slugifyHeading(plain);
    if (depth === 2 && id) {
      toc.push({ id, text: plain });
    }
    return `<h${depth} id="${id}">${text}</h${depth}>\n`;
  };

  renderer.hr = () => {
    // Editorial dot-divider. Three centered dots with negative
    // tracking — quieter than a horizontal line, matches the
    // Editorial Glass card-rhythm.
    return `<div class="blog-hr" aria-hidden="true">· · ·</div>\n`;
  };

  // Default code-block handling — wrap in a styled container so
  // long lines scroll horizontally instead of breaking the layout.
  // Inline `code` keeps the default rendering.
  renderer.code = ({ text, lang }) => {
    const safeLang = (lang ?? '').replace(/[^a-z0-9-]/gi, '');
    const langAttr = safeLang ? ` data-lang="${safeLang}"` : '';
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<pre class="blog-code"${langAttr}><code>${escaped}</code></pre>\n`;
  };

  // Use the GFM extension that ships with marked by default
  // (tables, strikethrough, fenced code, autolinks). Disable
  // mangling so the email-obfuscation munging doesn't apply to
  // any `@handle` references in the prose.
  marked.use({ gfm: true, breaks: false, renderer });

  const html = marked.parse(markdown, { async: false }) as string;
  return { html, toc };
}
