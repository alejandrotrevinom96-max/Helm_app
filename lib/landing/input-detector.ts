// PR #36 — Sprint 6.2.2: smart input detector for the landing
// preview hero. Two testers reported having only Instagram, no
// website — so we accept either signal and route accordingly.
//
// Detection priorities (first match wins):
//   1. Bare @handle  →  Instagram
//   2. instagram.com / ig.com URL  →  Instagram (extract handle)
//   3. Anything with a dot, no spaces  →  Website
//   4. Otherwise  →  invalid (with hint)
//
// Note: we never auto-promote a bare hostname like "voyaa" to
// either type. Old IG vs website typo guesses are too noisy; we
// ask the user to clarify with @ or a TLD.

export type InputType = 'website' | 'instagram' | 'invalid';

export interface DetectedInput {
  type: InputType;
  // Canonical form for the detected type:
  //   - website  → 'https://example.com' (scheme + lowercase, no trailing /)
  //   - instagram → 'voyaa.app' (handle only, lowercase)
  //   - invalid  → ''
  normalized: string;
  originalInput: string;
  reason?: string;
}

// Instagram username rules (loose match — Meta's regex permits
// a-z, 0-9, dot, underscore; min 1 char; max 30 in practice).
const IG_HANDLE_RE = /^[a-zA-Z0-9._]{1,30}$/;

export function detectInputType(rawInput: string): DetectedInput {
  const input = rawInput.trim();
  if (!input) {
    return {
      type: 'invalid',
      normalized: '',
      originalInput: rawInput,
      reason: 'Empty input',
    };
  }

  // 1. @handle — bare or trailing slash. Strip everything after the
  // first slash so "@voyaa.app/" or "@voyaa.app/some/path" still
  // resolve to "voyaa.app".
  if (input.startsWith('@')) {
    const candidate = input.slice(1).split('/')[0].trim();
    if (IG_HANDLE_RE.test(candidate)) {
      return {
        type: 'instagram',
        normalized: candidate.toLowerCase(),
        originalInput: rawInput,
      };
    }
    return {
      type: 'invalid',
      normalized: '',
      originalInput: rawInput,
      reason: 'Invalid Instagram handle',
    };
  }

  // 2. instagram.com / ig.com URL — extract the first path segment
  // as the handle.
  const igUrlMatch = input.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|ig\.com)\/([a-zA-Z0-9._]+)\/?/i
  );
  if (igUrlMatch && IG_HANDLE_RE.test(igUrlMatch[1])) {
    return {
      type: 'instagram',
      normalized: igUrlMatch[1].toLowerCase(),
      originalInput: rawInput,
    };
  }

  // 3. Website. Must contain a dot and no spaces. We accept inputs
  // with or without scheme; the URL constructor handles the rest.
  if (input.includes('.') && !input.includes(' ')) {
    const candidate = input.startsWith('http://') || input.startsWith('https://')
      ? input
      : `https://${input}`;
    try {
      const parsed = new URL(candidate);
      // Belt-and-suspenders: if a user pastes an instagram URL that
      // didn't match step 2 (e.g. with a query string), force the
      // IG branch instead of treating the whole URL as a website.
      const host = parsed.hostname.toLowerCase();
      if (host === 'instagram.com' || host === 'www.instagram.com') {
        return {
          type: 'invalid',
          normalized: '',
          originalInput: rawInput,
          reason:
            'Use the Instagram handle directly: @yourhandle or instagram.com/yourhandle',
        };
      }
      return {
        type: 'website',
        normalized: parsed.toString().replace(/\/$/, '').toLowerCase(),
        originalInput: rawInput,
      };
    } catch {
      return {
        type: 'invalid',
        normalized: '',
        originalInput: rawInput,
        reason: 'Invalid URL',
      };
    }
  }

  // 4. Bare hostname / single word — too ambiguous to route safely.
  return {
    type: 'invalid',
    normalized: '',
    originalInput: rawInput,
    reason: 'Add a domain (.com, .app) or @ for Instagram',
  };
}
