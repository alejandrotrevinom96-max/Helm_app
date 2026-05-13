// PR #82 — Sprint 7.7: integrations / "plays well with your stack".
//
// Two columns: Data Sources (read-only ingestion — Vercel, Supabase,
// Reddit) and Publishing (where the user's posts go). Both columns
// use the same Live / Coming badge vocabulary as the publishing-
// platforms section above so the visitor builds a mental model of
// "green = today, amber = roadmap" by the time they hit the Roadmap
// section.
//
// Why repeat publishing here when section 4 already covered it: the
// integrations section frames the SAME platforms differently — there
// they're "places you publish to", here they're "things connected
// to your workspace". Two angles on the same proof point.
interface Integration {
  name: string;
  status: 'live' | 'coming';
  release?: string;
  note?: string;
}

const DATA_SOURCES: Integration[] = [
  {
    name: 'Vercel',
    status: 'live',
    note: 'Web analytics, deployments, traffic',
  },
  {
    name: 'Supabase',
    status: 'live',
    note: 'Auth users, signups, activity',
  },
  {
    name: 'Reddit',
    status: 'live',
    note: 'Audience research (read-only)',
  },
];

const PUBLISHING: Integration[] = [
  { name: 'X (Twitter)', status: 'live', note: 'Pay-per-use API' },
  { name: 'LinkedIn', status: 'live', note: 'UGC API' },
  {
    name: 'Threads',
    status: 'coming',
    release: 'v3.0',
    note: 'Meta Graph API',
  },
  { name: 'Reddit posting', status: 'coming', release: 'v3.0' },
  {
    name: 'Instagram',
    status: 'coming',
    release: 'v3.5',
    note: 'Meta Graph API',
  },
  { name: 'Facebook', status: 'coming', release: 'v3.5' },
];

export function LandingIntegrations() {
  return (
    <section
      id="integrations"
      className="py-24 px-4 md:px-8 border-t border-border"
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-3 mb-3">
            Integrations
          </div>
          <h2 className="font-display text-4xl md:text-5xl tracking-tight font-light">
            Plays well with your stack.
          </h2>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <IntegrationColumn
            label="Data sources"
            sublabel="Read-only ingestion"
            items={DATA_SOURCES}
          />
          <IntegrationColumn
            label="Publishing"
            sublabel="Live + roadmap"
            items={PUBLISHING}
          />
        </div>
      </div>
    </section>
  );
}

function IntegrationColumn({
  label,
  sublabel,
  items,
}: {
  label: string;
  sublabel: string;
  items: Integration[];
}) {
  return (
    <div className="bg-bg-elev/60 border border-border rounded-2xl p-6">
      <div className="mb-5">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
          {sublabel}
        </div>
        <h3 className="font-display text-xl font-light">{label}</h3>
      </div>
      <ul className="space-y-3">
        {items.map((item) => {
          const isLive = item.status === 'live';
          return (
            <li
              key={item.name}
              className="flex items-start gap-3"
            >
              <span
                className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${
                  isLive ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                aria-label={isLive ? 'Live' : 'Coming'}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-medium text-text-1">
                    {item.name}
                  </span>
                  <span
                    className={`text-[9px] font-mono uppercase tracking-[0.15em] ${
                      isLive ? 'text-emerald-500' : 'text-amber-500'
                    }`}
                  >
                    {isLive ? 'Live' : `Coming ${item.release ?? 'soon'}`}
                  </span>
                </div>
                {item.note && (
                  <p className="text-xs text-text-3 mt-0.5">{item.note}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
