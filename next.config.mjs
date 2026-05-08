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
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // unsafe-inline + unsafe-eval are the cost of doing Next.js
      // 15 App Router with HMR; revisit when next ships nonce
      // helpers we can wire through middleware. unsafe-eval gets
      // stripped in production builds anyway.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.vercel.com https://va.vercel-scripts.com https://vercel.live",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' blob: data: https://*.supabase.co https://*.fal.media https://fal.media https://*.fbcdn.net https://*.cdninstagram.com https://scontent-*.cdninstagram.com https://*.googleusercontent.com https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
      "media-src 'self' blob: https://*.supabase.co",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://*.vercel.com https://vitals.vercel-insights.com https://va.vercel-scripts.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
  },
];

const nextConfig = {
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
};

export default nextConfig;
