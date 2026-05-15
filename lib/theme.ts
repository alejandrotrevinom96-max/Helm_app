import { cookies, headers } from 'next/headers';
import type { Theme } from './design-tokens';

const COOKIE_NAME = 'helm-theme';

export async function getServerTheme(): Promise<Theme> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(COOKIE_NAME)?.value as Theme | undefined;
  if (fromCookie === 'light' || fromCookie === 'dark') return fromCookie;

  // Browsers that support client-hints expose Sec-CH-Prefers-Color-Scheme.
  // Most browsers don't send it without an Accept-CH negotiation, so this
  // is best-effort. The inline script in the layout is the real fallback.
  const headerStore = await headers();
  const prefer = headerStore.get('sec-ch-prefers-color-scheme');
  if (prefer === 'light') return 'light';

  // PR Sprint 7.25 Phase 1 — dark-first default for new visitors.
  // The platform redesign is dark-first; defaulting unset visitors
  // to dark surfaces the new visuals immediately. Existing users
  // already have helm-theme=light on their cookie and stay on
  // light until they actively toggle. Users with
  // prefers-color-scheme: light still get light (explicit signal
  // wins over the dark-first default).
  return 'dark';
}

export const themeCookieName = COOKIE_NAME;
