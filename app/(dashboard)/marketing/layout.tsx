import { MarketingSubNav } from './sub-nav';

// Shell layout for /marketing/* — owns the page padding, h1, subtitle,
// and sub-tab nav. Each child page (generate / calendar / library)
// renders inside the {children} slot below.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-6 md:mb-8">
        <h1 className="font-display text-display-md font-light tracking-tight">
          Marketing
        </h1>
        <p className="text-text-2 mt-2 max-w-2xl text-sm">
          Generate brand-aware posts, schedule them, track what works.
        </p>
      </div>

      <MarketingSubNav />

      <div className="mt-6 md:mt-8">{children}</div>
    </div>
  );
}
