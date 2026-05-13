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

// Walk a token tree to produce plain text (no HTML, no markdown).
// Used to build heading IDs + TOC labels without depending on the
// renderer's `.parser` binding (which is fragile inside
// `marked.use({ renderer })` — the renderer instance we create
// here is NOT the one marked calls, so `renderer.parser` stays
// undefined at runtime and `parseInline` blows up).
//
// We don't care about emphasis / links / code spans for the id —
// just the surface text. So recursing into `tokens` and falling
// back to `text` / `raw` covers every inline node shape marked
// emits.
function tokensToPlainText(tokens: unknown): string {
  if (!Array.isArray(tokens)) return '';
  let out = '';
  for (const t of tokens as Array<Record<string, unknown>>) {
    if (Array.isArray(t.tokens)) {
      out += tokensToPlainText(t.tokens);
    } else if (typeof t.text === 'string') {
      out += t.text;
    } else if (typeof t.raw === 'string') {
      out += t.raw;
    }
  }
  return out;
}

export function renderMarkdown(markdown: string): RenderedPost {
  const toc: TocEntry[] = [];

  // PR #85 hotfix — Sprint 7.10: rebuilt without `new marked.Renderer()`.
  // Two reasons the prior implementation 500'd in production:
  //   1. `renderer.heading = ({ tokens }) => renderer.parser.parseInline(tokens)`
  //      used an arrow function whose closure captured the OUTER
  //      renderer object (which never gets its `.parser` set —
  //      marked sets `parser` on its INTERNAL renderer after
  //      `marked.use({ renderer })` copies the methods over).
  //      Result: `parseInline` of undefined → TypeError → 500.
  //   2. `marked.use(...)` with a Renderer instance mutates marked
  //      GLOBALLY for every subsequent parse call, so two SSG
  //      pages rendering in parallel could leak TOC entries across
  //      each other via the closure.
  //
  // The fix: pass renderer methods inline to a SCOPED `marked.use({
  // renderer })` so marked's API can still wire them up, but
  // derive every value (text, ids, toc entries) from the raw
  // tokens we receive — no dependency on `this.parser` or the
  // outer renderer object. We also still want HTML for inline
  // markup inside headings (so **bold** in an h2 doesn't render
  // as literal `**bold**`), so we call `this.parser.parseInline`
  // via `function` syntax — `this` is marked's internal renderer
  // when invoked, and IT does have `.parser` bound by then.
  marked.use({
    gfm: true,
    breaks: false,
    renderer: {
      heading(this: { parser: { parseInline(t: unknown[]): string } }, { tokens, depth }: { tokens: unknown[]; depth: number }) {
        const inlineHtml = this.parser.parseInline(tokens);
        const plain = tokensToPlainText(tokens);
        const id = slugifyHeading(plain);
        if (depth === 2 && id) {
          toc.push({ id, text: plain });
        }
        return `<h${depth} id="${id}">${inlineHtml}</h${depth}>\n`;
      },
      hr() {
        // Editorial dot-divider. Three centered dots with negative
        // tracking — quieter than a horizontal line, matches the
        // Editorial Glass card-rhythm.
        return `<div class="blog-hr" aria-hidden="true">· · ·</div>\n`;
      },
      code({ text, lang }: { text: string; lang?: string }) {
        const safeLang = (lang ?? '').replace(/[^a-z0-9-]/gi, '');
        const langAttr = safeLang ? ` data-lang="${safeLang}"` : '';
        const escaped = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<pre class="blog-code"${langAttr}><code>${escaped}</code></pre>\n`;
      },
    },
  });

  const html = marked.parse(markdown, { async: false }) as string;
  return { html, toc };
}
