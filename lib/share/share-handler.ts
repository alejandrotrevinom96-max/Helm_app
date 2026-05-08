// PR #38 — Sprint 6.4: Web Share API + manual share fallback.
//
// WHY:
// Native Meta auto-publishing is blocked behind Meta App Review,
// which requires a verified business address (the user's MX entity
// doesn't have one yet — 4–6 week timeline at minimum). Helm needs
// a "ship today" path so testers can post the AI-generated content
// without waiting on Meta. Web Share API gives us that on mobile
// (1 tap → OS share sheet → Instagram / FB / X / WhatsApp / any
// installed app); a custom modal with copy + download + per-
// platform deep-link backstops desktop where Web Share is patchy.
//
// WHAT THIS FILE DOES (no React, framework-agnostic):
//   - getShareCapabilities()  — feature-detect: native share?
//                              files-in-share? mobile vs desktop?
//   - buildShareText()        — caption + hashtags joined for
//                              clipboard / share text payloads.
//   - urlToFile()             — fetch image URL into a File so it
//                              rides along with the share when the
//                              browser supports navigator.canShare
//                              ({files}) (mobile + some desktops).
//   - nativeShare()           — wraps navigator.share(); maps user-
//                              cancel into a non-error result so the
//                              UI doesn't show a fallback for it.
//   - copyToClipboard()       — async clipboard write, swallowing
//                              the "permission denied" rejection.
//   - downloadImage()         — fetch + Blob + createObjectURL +
//                              programmatic <a download> click.
//   - PLATFORM_COMPOSE_URLS   — deep links to each platform's
//                              compose page. X / LinkedIn / Threads
//                              / WhatsApp pre-fill text via URL
//                              params; Instagram + Facebook only
//                              open the home/create screen because
//                              they don't expose pre-fill APIs to
//                              the public web.
//
// ERROR HANDLING:
// All async helpers return booleans/results — they NEVER throw.
// CORS failures on urlToFile() / downloadImage() are common (some
// CDNs disallow cross-origin blob fetches even when the image URL
// works in <img>); we degrade to text-only sharing in that case.

export interface SharePayload {
  caption: string;
  imageUrl?: string;
  videoUrl?: string;
  hashtags?: string[];
}

export interface ShareResult {
  success: boolean;
  method: 'native' | 'fallback';
  error?: string;
}

export interface ShareCapabilities {
  hasNativeShare: boolean;
  canShareFiles: boolean;
  isMobile: boolean;
}

/**
 * Feature-detects what the current browser supports. Safe to call
 * during SSR — returns all-false when navigator is undefined.
 */
export function getShareCapabilities(): ShareCapabilities {
  if (typeof navigator === 'undefined') {
    return { hasNativeShare: false, canShareFiles: false, isMobile: false };
  }

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const hasNativeShare = typeof navigator.share === 'function';

  // canShare({files}) is the only reliable way to know whether the
  // OS share sheet will accept a file payload — both Chrome on
  // Android and Safari on iOS expose it; desktop browsers vary.
  let canShareFiles = false;
  if (typeof navigator.canShare === 'function') {
    try {
      const probe = new File([new Blob()], 'probe.png', { type: 'image/png' });
      canShareFiles = navigator.canShare({ files: [probe] });
    } catch {
      canShareFiles = false;
    }
  }

  return { hasNativeShare, canShareFiles, isMobile };
}

/**
 * Builds the text body shared / copied. Hashtags get appended
 * after a blank line (Instagram / Threads convention). Tags
 * already prefixed with `#` are preserved as-is.
 */
export function buildShareText(payload: SharePayload): string {
  if (!payload.hashtags || payload.hashtags.length === 0) {
    return payload.caption;
  }
  const tags = payload.hashtags
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .join(' ');
  return `${payload.caption}\n\n${tags}`;
}

/**
 * Fetches an image URL into a File. CORS failures (image hotlinked
 * from a CDN that doesn't send Access-Control-Allow-Origin) come
 * back as null instead of throwing — the caller should fall back
 * to text-only sharing.
 */
export async function urlToFile(
  url: string,
  filename = 'helm-post.png'
): Promise<File | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], filename, {
      type: blob.type || 'image/png',
    });
  } catch {
    return null;
  }
}

/**
 * Wraps navigator.share(). Caller must check `success`; an
 * AbortError (user dismissed the share sheet) is reported as
 * `success: false` with `error: 'User canceled'` so the caller
 * can distinguish it from genuine failures.
 */
export async function nativeShare(
  payload: SharePayload
): Promise<ShareResult> {
  const capabilities = getShareCapabilities();
  if (!capabilities.hasNativeShare) {
    return {
      success: false,
      method: 'fallback',
      error: 'Native share not supported',
    };
  }

  const text = buildShareText(payload);
  const shareData: ShareData = { text, title: 'Helm post' };

  // Try to attach the image. If urlToFile returns null (CORS, 404,
  // network) we still ship text-only — better than failing the
  // whole share.
  if (payload.imageUrl && capabilities.canShareFiles) {
    const file = await urlToFile(payload.imageUrl);
    if (file) {
      // Re-validate canShare with the actual file — some browsers
      // accept image/png in the probe but reject the real one
      // (rare, but a defensive check costs nothing).
      const withFile: ShareData = { ...shareData, files: [file] };
      if (
        typeof navigator.canShare === 'function' &&
        navigator.canShare(withFile)
      ) {
        shareData.files = [file];
      }
    }
  }

  try {
    await navigator.share(shareData);
    return { success: true, method: 'native' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, method: 'native', error: 'User canceled' };
    }
    return {
      success: false,
      method: 'native',
      error: error instanceof Error ? error.message : 'Share failed',
    };
  }
}

/**
 * Async clipboard write. Returns false on permission-denied or
 * non-secure-context (clipboard API requires HTTPS).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Triggers a browser download of an image URL. Same CORS caveat
 * as urlToFile — some CDNs block cross-origin blob fetches. When
 * that happens we open the URL in a new tab as a degraded path so
 * the user can right-click → save themselves.
 */
export async function downloadImage(
  url: string,
  filename = 'helm-post.png'
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke after a tick so the click handler can finish first.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 100);
    return true;
  } catch {
    // Degraded fallback: open in a new tab so the user can
    // right-click → "Save image as".
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Deep links to each platform's compose surface. Some platforms
 * accept pre-filled text via query params (X, LinkedIn, Threads,
 * WhatsApp); Instagram and Facebook do not on the public web —
 * we open the home / create screens and tell the user to paste.
 */
export const PLATFORM_COMPOSE_URLS = {
  instagram: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/',
  twitter: (text: string) =>
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
  linkedin: (text: string, url?: string) =>
    url
      ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
      : `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
  threads: (text: string) =>
    `https://www.threads.net/intent/post?text=${encodeURIComponent(text)}`,
  whatsapp: (text: string) =>
    `https://wa.me/?text=${encodeURIComponent(text)}`,
} as const;
