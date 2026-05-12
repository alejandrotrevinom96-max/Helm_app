'use client';

// PR #73 — Sprint 7.2A.5: Dark Reader detection (defense layer 3).
//
// Helm ships its own light/dark theme toggle. When a user has the
// Dark Reader browser extension active in "Force" mode (or an older
// version that ignores the <meta name="darkreader-lock">), Dark
// Reader applies a second inversion on top of our dark theme,
// producing the "double dark" effect a real user reported as
// "looks a bit wonky".
//
// Defense in depth:
//   1. <meta name="darkreader-lock">   → app/layout.tsx
//   2. body { --darkreader-* : initial } → app/globals.css
//   3. This runtime detector            → renders a dismissible
//      banner if Dark Reader slipped past both passive defenses,
//      pointing the user at the extension's per-site disable.
//
// The detector deliberately polls a handful of fingerprints rather
// than relying on a single one — Dark Reader's injection shape
// shifts across versions (style tag id, custom-property prefix,
// fake-meta convention) so a single check misses easily.
//
// Why a banner instead of trying to "fix" the rendering?
//   Browser extensions outrank page CSS by design. We can't undo
//   Dark Reader's inversion from inside the page without writing
//   our own injected style that races the extension on every
//   stylesheet load — fragile and user-hostile. Telling the user
//   "this is happening, here's how to turn it off" is honest and
//   actionable.
import { useEffect, useState } from 'react';

const DISMISS_KEY = 'helm:darkReaderWarningDismissed';
const DETECT_DELAY_MS = 600; // Give Dark Reader time to inject.

export function DarkReaderDetector() {
  const [detected, setDetected] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Bail if previously dismissed for this origin.
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') {
        setDismissed(true);
        return;
      }
    } catch {
      // Private mode / quota — non-fatal, keep detecting.
    }

    // Dark Reader injects its style + meta on first paint, but the
    // exact timing varies by version. 600ms is a comfortable margin
    // over the extension's typical 100-300ms injection window.
    const timer = setTimeout(() => {
      if (detectDarkReader()) {
        setDetected(true);
      }
    }, DETECT_DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private mode — banner won't reappear this session at least.
    }
    setDismissed(true);
  };

  if (!detected || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-4 right-4 max-w-sm p-4 rounded-lg shadow-lg z-[100] border"
      style={{
        // We deliberately use static colors here (not CSS vars) so
        // the banner renders even if Dark Reader is mangling the
        // surrounding palette. Yellow/amber on warm-white reads
        // correctly in both Helm themes AND under Dark Reader's
        // inversion — the contrast survives either way.
        backgroundColor: 'rgb(254 243 199)', // amber-100
        borderColor: 'rgb(252 211 77)', // amber-300
        color: 'rgb(120 53 15)', // amber-900
      }}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none" aria-hidden>
          🌓
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm">
            Dark Reader detectado
          </h4>
          <p className="text-xs mt-1 leading-relaxed">
            Helm ya tiene su propio modo oscuro (toggle en la sidebar).
            Si los colores se ven raros, pausá Dark Reader para este
            sitio: click el icono de la extensión →{' '}
            <strong>Disable for trythelm.com</strong>.
          </p>
          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={handleDismiss}
              className="text-xs underline hover:no-underline ml-auto"
              style={{ color: 'rgb(120 53 15)' }}
            >
              Entendido, no mostrar más
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Detect Dark Reader via multiple fingerprints. Any positive →
 * detected. Each method is independent so a version change that
 * breaks one signal doesn't blind the rest.
 */
function detectDarkReader(): boolean {
  if (typeof document === 'undefined') return false;

  // Method 1 — <style> elements Dark Reader injects. Across versions
  // we've seen the data-darkreader-mode attribute, a .darkreader
  // class, and the #dark-reader-style id. Match any.
  const styleHit =
    document.querySelector('style[data-darkreader-mode]') ||
    document.querySelector('style[data-darkreader-scheme]') ||
    document.querySelector('style.darkreader') ||
    document.querySelector('style#dark-reader-style') ||
    document.querySelector('style.darkreader--fallback') ||
    document.querySelector('style.darkreader--text');
  if (styleHit) return true;

  // Method 2 — custom properties Dark Reader sets on the document
  // element. Reading from computed style covers both inline-set vars
  // and ones promoted through Dark Reader's own stylesheet.
  try {
    const computed = getComputedStyle(document.documentElement);
    if (
      computed.getPropertyValue('--darkreader-neutral-background').trim() ||
      computed.getPropertyValue('--darkreader-neutral-text').trim() ||
      computed.getPropertyValue('--darkreader-selection-background').trim()
    ) {
      return true;
    }
  } catch {
    // getComputedStyle can throw under exotic sandboxing; non-fatal.
  }

  // Method 3 — the fake meta Dark Reader injects to advertise itself
  // (older versions of the extension's "compatibility" mode).
  if (document.querySelector('meta[name="darkreader"]')) return true;

  return false;
}
