import type { BrandBible } from '@/lib/types/brand';

export type ResearchSourceId =
  | 'reddit'
  | 'hackernews'
  | 'indiehackers'
  | 'googleTrends';

export interface SourcesConfig {
  reddit: boolean;
  hackernews: boolean;
  indiehackers: boolean;
  googleTrends: boolean;
}

// Pre-PR-16 every project shipped with all four sources enabled by default.
// That's wrong for non-tech audiences (a travel app doesn't benefit from
// Hacker News scans — those will surface dev posts and force the LLM to
// extrapolate cross-domain). We now infer sane defaults from the brand
// bible: Reddit + Google Trends are universal; HN/IH only get added when
// the audience text actually mentions tech / indie founder keywords.
const TECH_KEYWORDS = [
  'developer',
  'engineer',
  'coder',
  'tech',
  'software',
  'saas',
  'api',
  'dev',
  'programmer',
  'hacker',
];

const INDIE_KEYWORDS = [
  'founder',
  'indie',
  'maker',
  'builder',
  'micro-saas',
  'bootstrap',
  'solo founder',
  'side project',
];

export function getDefaultSources(bible: BrandBible | null): SourcesConfig {
  const universal: SourcesConfig = {
    reddit: true,
    hackernews: false,
    indiehackers: false,
    googleTrends: true,
  };

  if (!bible || !bible.identity) return universal;

  const audienceDesc = bible.audience?.primary?.description ?? '';
  const industry = bible.identity?.industry ?? '';
  const tagline = bible.identity?.tagline ?? '';
  const haystack = `${audienceDesc} ${industry} ${tagline}`.toLowerCase();

  // Don't trip on substrings inside other words — pad with whitespace.
  const padded = ` ${haystack} `;
  const hasTech = TECH_KEYWORDS.some((kw) => padded.includes(` ${kw}`));
  const hasIndie = INDIE_KEYWORDS.some((kw) => padded.includes(kw));

  return {
    reddit: true,
    hackernews: hasTech,
    indiehackers: hasIndie,
    googleTrends: true,
  };
}
