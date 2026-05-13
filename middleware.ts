import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// PR #39 — Sprint 6.5: security headers injected from middleware.
//
// Why here and not next.config.mjs `headers()`: in initial deploy
// testing, only HSTS made it through to the browser via the
// next.config path. Likely an interaction with the App Router
// middleware response chain. Setting headers directly on the
// middleware response is guaranteed to apply for every route
// the matcher catches (i.e. everything except /_next/static and
// image extensions, which don't need CSP anyway).
//
// PR #40 — Sprint 6.5.1: three hardening additions on top of 6.5:
//   1. Cross-Origin-Opener-Policy: same-origin
//      Mitigates window.opener leak + Spectre cross-origin reads.
//   2. Cross-Origin-Resource-Policy: same-site
//      Stops other sites from embedding our resources cross-origin.
//      We deliberately DO NOT add Cross-Origin-Embedder-Policy
//      (require-corp) — it would break <img> from Supabase / fal.ai
//      / Meta CDNs, all of which we render heavily.
//   3. Per-request nonce-based CSP with 'strict-dynamic'.
//      Pre-PR-40 script-src had 'unsafe-inline' + 'unsafe-eval',
//      which neutered the policy (any injected <script> ran).
//      Now we mint a fresh nonce each request, embed it in the
//      CSP, and pipe it to the layout via x-nonce so the inline
//      themeBootScript carries a nonce. 'strict-dynamic' means
//      any script loaded BY a nonced script is implicitly
//      trusted — that lets Vercel Analytics's chained loads work
//      without listing every inner script source. We keep
//      'unsafe-eval' for one more sprint (some deps may still
//      require it; remove after a 24h soak with no console
//      violations).
//
// CSP allowlist scoped to actual sources we use:
//   - Vercel + va.vercel-scripts (analytics + preview)
//   - Supabase (auth + storage + realtime ws)
//   - Anthropic (we don't call from browser today, but devtools
//     fetch pattern matchers expect connect-src declared)
//   - fal.media + fbcdn + cdninstagram + googleusercontent
//     (image hosts we render in <img> tags)

// Static headers — the same value goes out on every response.
const STATIC_SECURITY_HEADERS: Record<string, string> = {
  'X-DNS-Prefetch-Control': 'on',
  'Strict-Transport-Security':
    'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()',
  // PR #40 — Sprint 6.5.1: cross-origin isolation (partial — no
  // COEP because we render external <img> heavily).
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
};

// Generate a CSP per-request because we mint a fresh nonce per
// request. Browsers cache HTML responses with their CSP header, so
// reusing a nonce across requests would either (a) leak a
// long-lived nonce or (b) break the cached pages once the nonce
// rotates. Per-request is the conventional fix.
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' makes browsers ignore the host allowlist
    // when they support it; the nonce + transitive trust covers
    // everything Vercel Analytics chains in. The host list stays
    // for older browsers (pre-CSP3) as a fallback. 'unsafe-eval'
    // kept for one sprint while we soak; remove next pass.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' https://*.vercel.com https://va.vercel-scripts.com https://vercel.live`,
    // CSS isn't a code-execution surface in the way <script> is,
    // so 'unsafe-inline' for styles stays — drops would break
    // Tailwind's compiled inline @keyframes etc. with no security
    // gain.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // PR Sprint 7.13 hotfix — added https://*.heygen.ai for the
    // avatar selector preview images. HeyGen serves stock avatar
    // previews from files2.heygen.ai / resource2.heygen.ai under
    // the same root domain. *.tiktokcdn.com lets us render the
    // founder's TikTok avatar in the Integrations card.
    "img-src 'self' blob: data: https://*.supabase.co https://*.fal.media https://fal.media https://*.fbcdn.net https://*.cdninstagram.com https://scontent-*.cdninstagram.com https://*.googleusercontent.com https://avatars.githubusercontent.com https://lh3.googleusercontent.com https://*.heygen.ai https://*.tiktokcdn.com",
    "media-src 'self' blob: https://*.supabase.co https://*.heygen.ai",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://*.vercel.com https://vitals.vercel-insights.com https://va.vercel-scripts.com",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join('; ');
}

// Mint a fresh CSP nonce. Edge runtime exposes `crypto` (web
// crypto) globally; we use 16 random bytes → base64 (~22 chars),
// well above the 16-byte / 128-bit recommendation.
function generateNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  // btoa with String.fromCharCode is the Edge-friendly way to
  // produce base64 without pulling in Buffer.
  let binary = '';
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function applySecurityHeaders(
  response: NextResponse,
  nonce: string
): NextResponse {
  for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  response.headers.set('Content-Security-Policy', buildCsp(nonce));
  return response;
}

export async function middleware(request: NextRequest) {
  // PR #40 — Sprint 6.5.1: per-request CSP nonce. Generated FIRST
  // and stamped onto requestHeaders BEFORE the Supabase client
  // takes a snapshot of those headers — otherwise the nonce
  // wouldn't reach server components via `headers()`.
  const nonce = generateNonce();

  // Expose the current pathname to server components via header so they can
  // skip self-redirects (e.g. dashboard layout deciding whether to send the
  // user to /onboarding when they are already on /onboarding).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  requestHeaders.set('x-nonce', nonce);

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  // PR #33 — Sprint 6.1: /signup, /forgot-password, /reset-password
  // join /login as auth-public routes. Without this, an
  // unauthenticated visitor hits /signup and the middleware bounces
  // them to /login, which is the opposite of useful.
  const isAuthRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth');
  // PR #29 — /privacy and /terms MUST be publicly accessible because
  // Meta App Review and Vercel's robots both crawl them anonymously.
  // Hiding them behind /login fails Meta's review. /w/* are the
  // public waitlist pages from Sprint 1.
  // PR #39 — /security is the public disclosure policy and
  // /.well-known/* (security.txt + future robots/well-known) MUST
  // be reachable anonymously per RFC 9116.
  // PR #85 — Sprint 7.10: /blog and /blog/* are the public AEO
  // content pages. They were 307'ing to /login on first ship because
  // this list never included them — the blog renderer assumed the
  // (marketing) route group auto-bypassed auth, but the middleware
  // runs BEFORE route groups resolve and treats unknown paths as
  // protected.
  const isPublicRoute =
    pathname === '/' ||
    pathname.startsWith('/w/') ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/security' ||
    pathname === '/blog' ||
    pathname.startsWith('/blog/') ||
    pathname.startsWith('/.well-known/');
  const isApiRoute = pathname.startsWith('/api');
  // PR #34 — Sprint 6.2: /api/public/* is the explicitly anonymous
  // surface (preview-bible for the landing page). Already covered by
  // isApiRoute above (the whole /api/* tree skips the auth gate);
  // we keep this comment so future devs don't add a guard that
  // breaks the public preview.

  // Protect dashboard routes
  if (!user && !isAuthRoute && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return applySecurityHeaders(NextResponse.redirect(url), nonce);
  }

  // Redirect logged-in users away from login page
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return applySecurityHeaders(NextResponse.redirect(url), nonce);
  }

  return applySecurityHeaders(supabaseResponse, nonce);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
