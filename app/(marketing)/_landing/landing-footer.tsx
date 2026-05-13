import Link from 'next/link';

// PR #34 — Sprint 6.2: footer simplified.
// PR #82 — Sprint 7.7: footer expanded to a 4-column nav (Product /
// Company / Resources / Legal) to match the v3.0 positioning. Logo
// + tagline live in their own column above on mobile, beside on
// desktop. Some destinations are placeholders today (Blog, Docs,
// API) — we list them so the visitor sees the full surface even if
// some pages 404. Better to commit to the IA now and fill in pages
// than to invent the IA later.
//
// Anchors (#features etc.) work because each section has its `id`
// set in the landing components.
export function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-12 md:py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 md:gap-10">
          {/* Logo + tagline — spans 2 columns on desktop so the
              4 link columns balance. */}
          <div className="col-span-2 md:col-span-1 mb-2 md:mb-0">
            <div className="flex items-center gap-2 mb-2">
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 text-accent"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <circle cx="12" cy="12" r="10" />
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
              </svg>
              <span className="font-display text-base font-medium">Helm</span>
            </div>
            <p className="text-xs text-text-3 leading-relaxed">
              The Marketing OS for people who&apos;d rather ship.
            </p>
          </div>

          <FooterColumn
            label="Product"
            items={[
              { label: 'Marketing', href: '#pillars' },
              { label: 'Research', href: '#pillars' },
              { label: 'Compass', href: '#pillars' },
              { label: 'Integrations', href: '#integrations' },
              { label: 'Pricing', href: '#pricing' },
            ]}
          />

          <FooterColumn
            label="Company"
            items={[
              // About / Blog pages don't exist yet. We anchor them
              // to the relevant landing sections for now so clicks
              // don't 404. When the dedicated pages ship, swap the
              // hrefs without touching the component.
              { label: 'About', href: '#who' },
              { label: 'Roadmap', href: '#roadmap' },
              { label: 'Blog', href: '#' },
              {
                label: 'Built in public',
                href: 'https://x.com/alex_trev2',
                external: true,
              },
            ]}
          />

          <FooterColumn
            label="Resources"
            items={[
              { label: 'Documentation', href: '#' },
              { label: 'Changelog', href: '#roadmap' },
              { label: 'Support', href: 'mailto:support@trythelm.com' },
              { label: 'API (coming v4.0)', href: '#', muted: true },
            ]}
          />

          <FooterColumn
            label="Legal"
            items={[
              // PR #29 — Privacy + Terms required by Meta App
              // Review.
              { label: 'Privacy', href: '/privacy' },
              { label: 'Terms', href: '/terms' },
              // PR #39 — public security disclosure policy.
              { label: 'Security', href: '/security' },
              { label: 'DPA', href: '#' },
            ]}
          />
        </div>

        <div className="mt-12 pt-6 border-t border-border flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-text-3">
          <p>© {new Date().getFullYear()} Helm. Built by builders, for builders.</p>
          <Link
            href="/login"
            className="hover:text-text-1 transition-colors"
          >
            Sign in →
          </Link>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  label,
  items,
}: {
  label: string;
  items: Array<{
    label: string;
    href: string;
    external?: boolean;
    muted?: boolean;
  }>;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-3">
        {label}
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const className = `text-sm transition-colors ${
            item.muted
              ? 'text-text-3'
              : 'text-text-2 hover:text-text-1'
          }`;
          return (
            <li key={item.label}>
              {item.external ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                >
                  {item.label}
                </a>
              ) : item.href.startsWith('#') || item.href.startsWith('mailto:') ? (
                <a href={item.href} className={className}>
                  {item.label}
                </a>
              ) : (
                <Link href={item.href} className={className}>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
