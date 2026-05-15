import type { Theme } from './design-tokens';

const COOKIE_NAME = 'helm-theme';

// PR Sprint 7.25 Phase 7 — DARK-ONLY. The platform redesign is
// dark-first by spec: deep navy canvas, ambient gradients, dot
// grid, cursor glow. Light theme was a leftover from the v1
// dashboard era and contradicted every mockup the founder
// produced. Now the resolver hardcodes 'dark' so:
//   - <html data-theme> on every request renders dark
//   - The boot script in app/layout.tsx pins data-theme='dark'
//     unconditionally too (cookie ignored)
//   - The ThemeToggle component is removed from the sidebar +
//     landing nav (one-shot — no switching)
// We keep the COOKIE_NAME export because the (actions)/theme.ts
// server action still imports it (kept on disk for revert
// safety; calling it is a no-op until the toggle ships again).
export async function getServerTheme(): Promise<Theme> {
  return 'dark';
}

export const themeCookieName = COOKIE_NAME;
