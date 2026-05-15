'use client';

// PR Sprint 7.25 Phase 1 — Platform redesign ambient background.
//
// Three stacked fixed-position layers that sit behind every
// redesigned platform page (Settings / Analytics / Research /
// Compass / Marketing):
//
//   1. .ambient  — three large radial gradients tinted blue + orange
//                  + purple. Static; sets the "deep canvas with
//                  warm/cool light bloom" vibe the design
//                  signature.
//   2. .dotgrid  — 28px dot grid masked to a soft radial centered
//                  on the cursor. Provides a subtle technical
//                  texture without competing for attention.
//   3. .cursor-glow — a single radial of pale-blue light that
//                  follows the cursor. Tracks via CSS vars set
//                  from JS so we don't re-render on every
//                  mousemove.
//
// All three are pointer-events: none + z-index: 0 so they never
// intercept clicks. Pages render at z-index: 1 inside the
// component's children.
//
// PR Sprint 7.25 Phase 7 hotfix — platform pages are ALWAYS dark.
// The mockups are dark-only; previously this component honored
// the user's theme cookie and short-circuited on light mode,
// which meant founders with the legacy `helm-theme=light` cookie
// saw zero of the redesign (no ambient, no glow, no dot grid).
// Now the wrapper sets `data-theme='dark'` on its root + paints
// the canvas with `var(--bg)` so every CSS var inside the
// subtree resolves to dark values regardless of the global
// cookie. The marketing site / auth pages keep respecting the
// cookie because they don't use AmbientBackground.

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  /** Override the page's primary accent for the radial gradient
   *  bloom. Defaults to the design system's "warm orange + cool
   *  blue + violet" blend used on most platform pages. */
  accentTint?: 'blue' | 'orange' | 'purple' | 'green' | 'red' | 'default';
  /** When true, suppress the cursor-following glow + dot mask
   *  (the static ambient gradients still render). Useful for
   *  motion-sensitive surfaces like the Calendar drag layer. */
  staticOnly?: boolean;
  /** Optional className appended to the wrapper. */
  className?: string;
}

const ACCENT_GRADIENTS: Record<string, string> = {
  default: [
    'radial-gradient(ellipse 1200px 800px at 18% 88%, rgba(37, 99, 235, 0.26), transparent 62%)',
    'radial-gradient(ellipse 900px 600px at 86% 96%, rgba(234, 88, 12, 0.18), transparent 60%)',
    'radial-gradient(ellipse 700px 500px at 50% 0%, rgba(124, 58, 237, 0.18), transparent 65%)',
  ].join(', '),
  blue: [
    'radial-gradient(ellipse 1300px 900px at 20% 30%, rgba(37, 99, 235, 0.30), transparent 65%)',
    'radial-gradient(ellipse 900px 600px at 80% 90%, rgba(96, 165, 250, 0.15), transparent 60%)',
  ].join(', '),
  orange: [
    'radial-gradient(ellipse 1200px 800px at 18% 88%, rgba(249, 115, 22, 0.28), transparent 60%)',
    'radial-gradient(ellipse 900px 600px at 85% 15%, rgba(234, 88, 12, 0.16), transparent 60%)',
  ].join(', '),
  purple: [
    'radial-gradient(ellipse 1100px 800px at 25% 20%, rgba(139, 92, 246, 0.28), transparent 60%)',
    'radial-gradient(ellipse 900px 600px at 80% 90%, rgba(196, 181, 253, 0.14), transparent 60%)',
  ].join(', '),
  green: [
    'radial-gradient(ellipse 1100px 750px at 30% 80%, rgba(34, 197, 94, 0.22), transparent 60%)',
    'radial-gradient(ellipse 850px 600px at 75% 15%, rgba(96, 165, 250, 0.16), transparent 60%)',
  ].join(', '),
  red: [
    'radial-gradient(ellipse 1100px 800px at 25% 25%, rgba(239, 68, 68, 0.20), transparent 60%)',
    'radial-gradient(ellipse 800px 600px at 80% 90%, rgba(249, 115, 22, 0.16), transparent 60%)',
  ].join(', '),
};

export function AmbientBackground({
  children,
  accentTint = 'default',
  staticOnly = false,
  className = '',
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (staticOnly) return;
    if (typeof window === 'undefined') return;
    // Respect prefers-reduced-motion — the cursor-following glow
    // is purely decorative.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const root = rootRef.current;
    if (!root) return;

    let ticking = false;
    const onMove = (e: MouseEvent) => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / window.innerHeight) * 100;
        root.style.setProperty('--mx', `${x}%`);
        root.style.setProperty('--my', `${y}%`);
        ticking = false;
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [staticOnly]);

  return (
    <div
      ref={rootRef}
      // data-theme='dark' here forces every var(--bg|surface-1|
      // text-1|border|...) inside this subtree to resolve to the
      // dark palette — even when the global <html> data-theme is
      // 'light'. That's what makes the platform pages render the
      // full ambient + glow treatment regardless of the user's
      // theme cookie. minHeight covers cases where the wrapped
      // page is shorter than the viewport (the ambient should
      // still extend to the bottom).
      data-theme="dark"
      className={`relative isolate ${className}`}
      style={
        {
          background: 'var(--bg)',
          color: 'var(--text-1)',
          minHeight: '100vh',
          // CSS vars consumed by the .dotgrid + .cursor-glow masks
          // below. Defaults center the spotlight when the cursor
          // hasn't moved yet (or on touch devices).
          '--mx': '50%',
          '--my': '40%',
        } as React.CSSProperties
      }
    >
      {/* Static ambient gradients + dot grid + cursor glow —
          `position: fixed` so they cover the viewport (cursor
          tracking maps mouse coords to layer coords cleanly).
          CSS variables (--bg, etc.) cascade through the DOM
          tree, not the stacking context — so even though fixed
          positions to the viewport, these layers still inherit
          data-theme='dark' from the wrapper via DOM ancestry.
          The wrapper's `isolation: isolate` keeps the fixed
          layers' stacking context scoped to AmbientBackground
          so they don't bleed over modals/toasts elsewhere on
          the page. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background: ACCENT_GRADIENTS[accentTint] ?? ACCENT_GRADIENTS.default,
          zIndex: 0,
        }}
      />
      {/* Dot grid masked to a circle around the cursor. */}
      {!staticOnly && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0"
          style={{
            zIndex: 0,
            backgroundImage:
              'radial-gradient(circle, rgba(255, 255, 255, 0.06) 1px, transparent 1.2px)',
            backgroundSize: '28px 28px',
            WebkitMaskImage:
              'radial-gradient(circle 420px at var(--mx, 50%) var(--my, 40%), rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.55) 45%, transparent 75%)',
            maskImage:
              'radial-gradient(circle 420px at var(--mx, 50%) var(--my, 40%), rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.55) 45%, transparent 75%)',
          }}
        />
      )}
      {/* Cursor-following pale-blue glow. */}
      {!staticOnly && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0"
          style={{
            zIndex: 0,
            background:
              'radial-gradient(circle 480px at var(--mx, 50%) var(--my, 40%), rgba(96, 165, 250, 0.10), transparent 60%)',
          }}
        />
      )}
      <div className="relative" style={{ zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
