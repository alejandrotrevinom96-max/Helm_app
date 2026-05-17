// PR Sprint 7.19 Round 1 — Sentry next.config integration.
// Org: helm-mk
// Project: javascript-nextjs
//
// `withSentryConfig` wraps the export to enable:
//   - Source map upload at build time (so Sentry events show
//     un-minified stack traces). Requires SENTRY_AUTH_TOKEN to
//     be set in Vercel env; without it the upload step is a
//     silent no-op and you get minified stacks but everything
//     else works.
//   - `/monitoring` tunnel route — proxies Sentry ingest
//     through our own domain so adblockers don't drop events.
//   - React component name annotation for better breadcrumbs.
//
// To activate fully:
//   1. NEXT_PUBLIC_SENTRY_DSN=<dsn from sentry.io/settings/projects/javascript-nextjs/keys/>
//   2. SENTRY_AUTH_TOKEN=<token from sentry.io/settings/account/api/auth-tokens/>
//      (needs project:write scope for source map upload)
//   Both set in Vercel project env. Redeploy.
import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */

// PR #39 — Sprint 6.5: security headers.
//
// Headers applied to every response. CSP is the noisy one — it can
// break a site if a third-party script we use isn't whitelisted.
// The list below covers what we actually load:
//   - Vercel + va.vercel-scripts (analytics)
//   - Supabase (auth + storage)
//   - Anthropic (we don't call it from the browser, but the
//     extension/devtools fetch from connect-src might)
//   - fal.media + fbcdn + cdninstagram + googleusercontent (image
//     hosts referenced from <img> tags in posts / brand bibles)
//
// `unsafe-inline` is required for Next.js 15's runtime chunk loader
// in App Router (the framework injects an inline script with the
// flight payload). `unsafe-eval` is required ONLY in dev for HMR;
// next-build strips it in production. Both are documented limits
// of Next.js 15 — we'll revisit when next-csp-nonce is stable.
//
// frame-ancestors 'none' = nobody can iframe Helm. X-Frame-Options
// is the legacy equivalent kept for older browsers.
const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    // 2 years + preload-eligible. Once shipped you can submit to
    // hstspreload.org so browsers refuse plain-HTTP forever.
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()',
  },
  // PR #40 — Sprint 6.5.1: cross-origin isolation. We deliberately
  // skip COEP (require-corp) because we render <img> from
  // Supabase / fal.ai / Meta CDNs heavily; require-corp would
  // break those without giving us anything we can't get from COOP
  // alone at our threat level.
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
  {
    key: 'Cross-Origin-Resource-Policy',
    value: 'same-site',
  },
  {
    key: 'Content-Security-Policy',
    // The CSP that actually ships is the per-request, nonce-based
    // version assembled in middleware.ts. THIS one is a static
    // fallback for any path that bypasses middleware (none in
    // practice — the matcher catches everything except static
    // assets). It matches the middleware policy minus the nonce
    // (since static config can't see per-request state).
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.vercel.com https://va.vercel-scripts.com https://vercel.live",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' blob: data: https://*.supabase.co https://*.fal.media https://fal.media https://*.fbcdn.net https://*.cdninstagram.com https://scontent-*.cdninstagram.com https://*.googleusercontent.com https://avatars.githubusercontent.com https://lh3.googleusercontent.com https://*.heygen.ai https://*.tiktokcdn.com",
      "media-src 'self' blob: https://*.supabase.co",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://*.vercel.com https://vitals.vercel-insights.com https://va.vercel-scripts.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
  },
];

const nextConfig = {
  // PR #40 — Sprint 6.5.1: hide x-powered-by: Next.js. Pre-PR-40
  // every response advertised the framework + version, which is a
  // small information leak (lets a scanner skip framework
  // fingerprinting and jump straight to known-CVE checks). Free
  // win — toggling this off costs nothing.
  poweredByHeader: false,
  // PR #85 hotfix — Sprint 7.10: force blog markdown into the
  // Vercel deployment bundle. Next.js's static analysis can miss
  // dynamic fs.readdir/readFile calls (see lib/blog/loader.ts),
  // which means the .md files don't make it into the serverless
  // function's file tree and the slug page 500s in production.
  // Listing them here is belt-and-braces alongside the SSG path —
  // even if a future change accidentally turns the slug page
  // dynamic, the files will still be reachable.
  outputFileTracingIncludes: {
    '/blog': ['./content/blog/**/*.md'],
    '/blog/[slug]': ['./content/blog/**/*.md'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: [
      { hostname: 'avatars.githubusercontent.com' },
      { hostname: 'lh3.googleusercontent.com' },
    ],
  },
  async headers() {
    return [
      {
        // Apply to every route. /_next/* and /api/* both get them
        // — the API headers don't hurt JSON responses and protect
        // anyone who somehow loads them in a browser.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  // PR Sprint D-8 — permanent route renames. /marketing/generate
  // became /marketing/photo-studio when the Marketing surface split
  // into the two-studio paradigm (Photo Studio for images / carousels,
  // UGC Studio for chat-mode video). Same idea for /marketing/studio
  // → /marketing/ugc-studio. 301 (permanent=true) so search engines,
  // browser histories, and any external bookmarks update once and
  // for all instead of every visitor paying a 302 round-trip.
  //
  // Query strings are preserved by Next.js by default — ?prompt=…
  // and ?painPointId=… both flow through the redirect untouched.
  async redirects() {
    return [
      {
        source: '/marketing/generate',
        destination: '/marketing/photo-studio',
        permanent: true,
      },
      {
        source: '/marketing/studio',
        destination: '/marketing/ugc-studio',
        permanent: true,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Set by the wizard from the values passed in the
  // `npx @sentry/wizard@latest -i nextjs --saas --org helm-mk
  // --project javascript-nextjs` invocation.
  org: 'helm-mk',
  project: 'javascript-nextjs',

  // Auth token for source map upload at build time. Required
  // for un-minified stack traces. Read from Vercel env; absent
  // in dev/local builds (source maps still build but don't get
  // uploaded — Sentry events show minified frames).
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet the build. Source map upload progress only matters
  // when troubleshooting CI; in normal builds it's noise.
  silent: !process.env.CI,

  // Hide source maps from public bundles so customers can't
  // download them. Sentry still receives them via the upload
  // step before this happens.
  hideSourceMaps: true,

  // Pull in additional client chunks for source map upload
  // (per the canonical SDK guide). Without this, some lazy-
  // loaded chunks ship minified frames to Sentry even with
  // auth token set.
  widenClientFileUpload: true,

  // Tunnel events through our own domain to bypass ad blockers
  // that drop direct requests to ingest.sentry.io. /monitoring
  // becomes a thin proxy to Sentry.
  tunnelRoute: '/monitoring',

  // Auto-instrument Vercel cron monitors. No-op locally.
  automaticVercelMonitors: true,

  // Disable telemetry pings from the Sentry build plugin.
  telemetry: false,
});
