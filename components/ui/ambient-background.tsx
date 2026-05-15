'use client';

// PR Sprint 7.25 Phase 1 — Platform redesign ambient background.
//
// Three stacked fixed-position layers that sit behind every
// redesigned platform page (Settings / Analytics / Research /
// Compass / Generate):
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
// Activation: dark theme only. The light theme stays clean
// (current marketing-clean look), so the component renders empty
// when [data-theme='light'] is active. Founders on light see no
// change.
//
// Usage:
//   <AmbientBackground>
//     <YourPageContent />
//   </AmbientBackground>
//
// The cursor tracking runs in a single `useEffect` on mount; it
// short-circuits when the user is in light mode or has reduced-
// motion preference set, so we don't pay the mousemove cost when
// the gradient isn't visible anyway.

import { useEffect, useRef, useState } from 'react';
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
  // Track whether the dark theme is active so the layers stay
  // hidden on light mode (the platform design is dark-only). We
  // listen for theme attribute changes on <html> so a runtime
  // toggle picks up immediately.
  const [isDark, setIsDark] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const read = () => {
      const theme = html.getAttribute('data-theme');
      setIsDark(theme === 'dark');
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isDark || staticOnly) return;
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
  }, [isDark, staticOnly]);

  return (
    <div
      ref={rootRef}
      className={`relative isolate ${className}`}
      style={
        {
          // CSS vars consumed by the .dotgrid + .cursor-glow masks
          // below. Defaults center the spotlight when the cursor
          // hasn't moved yet (or on touch devices).
          '--mx': '50%',
          '--my': '40%',
        } as React.CSSProperties
      }
    >
      {isDark && (
        <>
          {/* Static ambient gradients — set the canvas glow. */}
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-0"
            style={{ background: ACCENT_GRADIENTS[accentTint] ?? ACCENT_GRADIENTS.default }}
          />
          {/* Dot grid masked to a circle around the cursor. */}
          {!staticOnly && (
            <div
              aria-hidden
              className="pointer-events-none fixed inset-0 z-0"
              style={{
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
              className="pointer-events-none fixed inset-0 z-0"
              style={{
                background:
                  'radial-gradient(circle 480px at var(--mx, 50%) var(--my, 40%), rgba(96, 165, 250, 0.10), transparent 60%)',
              }}
            />
          )}
        </>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
