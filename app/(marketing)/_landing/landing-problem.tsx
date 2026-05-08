// PR #34 — Sprint 6.2: replaced the v1 "7 tabs" problem section
// with the 3-pillars layout.
//
// We keep the file name (landing-problem.tsx) so the route group's
// layout / git history doesn't churn — the export is renamed to
// LandingPillars and re-exported as LandingProblem for the existing
// landing-page.tsx import. Component itself is the new pillars
// section.
import { Megaphone, Search, Compass } from 'lucide-react';

interface Pillar {
  icon: typeof Megaphone;
  label: string;
  title: string;
  description: string;
  features: string[];
}

const PILLARS: Pillar[] = [
  {
    icon: Megaphone,
    label: 'Marketing Suite',
    title: 'Generate. Schedule. Share.',
    description:
      'AI generates posts brand-aligned to your voice. Calendar with golden times. 1-tap share to Instagram, Facebook, X, anywhere — auto-post to Meta coming in V3.',
    features: [
      'Auto-generate brand bible from your website',
      '12-image visual validation loop',
      'Multi-platform post generation',
      'Drag-and-drop calendar with drafts pool',
      '1-tap share to Instagram, Facebook, X, more',
      'Auto-post to Meta coming in V3',
    ],
  },
  {
    icon: Search,
    label: 'Research',
    title: 'Find pain. Find users.',
    description:
      'Mine Reddit, Hacker News, Indie Hackers, and Google Trends for real pain points. Track what your audience is asking.',
    features: [
      'Multi-source pain mining',
      'Audience profile detection',
      'Trend tracking',
      'Saved findings library',
    ],
  },
  {
    icon: Compass,
    label: 'Compass',
    title: 'Score your startup like a VC.',
    description:
      'Strategy assessment with VC-grade rubrics. Spot your strengths and your gaps before you ship the next thing.',
    features: [
      'Strategy scoring',
      'Gap analysis',
      'Competitive positioning',
      'Strategic recommendations',
    ],
  },
];

function LandingPillars() {
  return (
    <section
      id="pillars"
      className="py-24 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            Three workspaces · One product
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light">
            What Helm does
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {PILLARS.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.label}
                className="bg-bg-elev/60 border border-border rounded-2xl p-7 flex flex-col"
              >
                <div className="w-11 h-11 bg-accent/10 rounded-xl flex items-center justify-center mb-5">
                  <Icon className="w-5 h-5 text-accent" />
                </div>
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
                  {pillar.label}
                </div>
                <h3 className="font-display text-xl mb-3 font-light">
                  {pillar.title}
                </h3>
                <p className="text-sm text-text-2 leading-relaxed mb-5">
                  {pillar.description}
                </p>
                <ul className="space-y-1.5 mt-auto">
                  {pillar.features.map((f, i) => (
                    <li
                      key={i}
                      className="text-sm text-text-2 flex items-start gap-2"
                    >
                      <span className="text-accent mt-1">·</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// Re-export under the legacy name so landing-page.tsx imports keep
// working without churn. Both names point to the same component.
export { LandingPillars };
export const LandingProblem = LandingPillars;
