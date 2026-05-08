import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// PR #39 — Sprint 6.5: security headers injected from middleware.
//
// Why here and not next.config.mjs `headers()`: in initial deploy
// testing, only HSTS made it through to the browser via the
// next.config path. Likely a interaction with the App Router
// middleware response chain. Setting headers directly on the
// middleware response is guaranteed to apply for every route
// the matcher catches (i.e. everything except /_next/static and
// image extensions, which don't need CSP anyway).
//
// CSP allowlist scoped to actual sources we use:
//   - Vercel + va.vercel-scripts (analytics + preview)
//   - Supabase (auth + storage + realtime ws)
//   - Anthropic (we don't call from browser today, but devtools
//     fetch pattern matchers expect connect-src declared)
//   - fal.media + fbcdn + cdninstagram + googleusercontent
//     (image hosts we render in <img> tags)
//
// `unsafe-inline` is required for Next 15 App Router's flight
// payload script. `unsafe-eval` is required ONLY in dev for HMR
// (Webpack); production builds don't need it but we keep it in
// the policy because some Vercel preview features rely on it.
// Revisit when Next ships first-class CSP nonces.
const SECURITY_HEADERS: Record<string, string> = {
  'X-DNS-Prefetch-Control': 'on',
  'Strict-Transport-Security':
    'max-age=63072000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()',
  'Content-Security-Policy': [
    "default-src 'self'",
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
};

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function middleware(request: NextRequest) {
  // Expose the current pathname to server components via header so they can
  // skip self-redirects (e.g. dashboard layout deciding whether to send the
  // user to /onboarding when they are already on /onboarding).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);

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
  const isPublicRoute =
    pathname === '/' ||
    pathname.startsWith('/w/') ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname === '/security' ||
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
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  // Redirect logged-in users away from login page
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/onboarding';
    return applySecurityHeaders(NextResponse.redirect(url));
  }

  return applySecurityHeaders(supabaseResponse);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
