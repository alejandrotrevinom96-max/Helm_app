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
  if (prefer === 'dark') return 'dark';

  return 'light';
}

export const themeCookieName = COOKIE_NAME;
