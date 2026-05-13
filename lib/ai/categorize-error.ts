// PR #75 — Sprint 7.2C hotfix: shared Anthropic error categorizer.
//
// Lifted from the inline `categorizeError` introduced in
// app/api/research/analyze-brand/route.ts (PR #72, Sprint 7.2A).
// The wizard's step 5 (first-content) consumes
// /api/ai/generate-structured, which historically returned
// generic "Algo falló" for every upstream failure mode. With 5
// new users entering the funnel, a 529 from Anthropic during
// step 5 would silently kill the WOW moment.
//
// This module gives any endpoint that calls Anthropic a single
// place to:
//   1. Map an unknown error → one of our known kinds.
//   2. Get a Spanish-language, actionable hint per kind.
//   3. Pick the right HTTP status (503 for transient overload,
//      504 for timeout, 502 for upstream malformed JSON, etc.)
//
// We deliberately did NOT refactor analyze-brand to import this
// helper in the same PR — that endpoint already ships and its
// local copy keeps working. A follow-up can consolidate; right
// now keep blast radius narrow.
//
// Naming alignment: this module uses `kind` (not `category`)
// because PR #72 shipped with `errorKind` as the wire-format
// field. The plan that triggered this sprint used
// `errorCategory` — we honor the existing wire format for
// backward compat with /research/analyze-brand consumers.
import { NextResponse } from 'next/server';

export type ErrorKind =
  | 'overloaded'
  | 'rate_limit'
  | 'timeout'
  | 'json'
  | 'auth'
  | 'insufficient_context'
  | 'unknown';

export interface CategorizedError {
  kind: ErrorKind;
  message: string;
}

/**
 * Inspect an unknown thrown value and place it in one of our
 * known kinds. Order matters — the FIRST match wins, so put the
 * most specific signals at the top.
 *
 * Accepts Anthropic SDK errors (which expose .status), generic
 * Errors, and string messages. Never throws.
 */
export function categorizeAnthropicError(err: unknown): CategorizedError {
  // SDK errors carry .status; HTTP layer errors might carry .code.
  const e = err as { status?: number; code?: string } | undefined;
  const msg = err instanceof Error ? err.message : String(err);
  const lc = msg.toLowerCase();

  // 529 Overloaded — Anthropic's "queue is full, try again soon".
  if (e?.status === 529 || lc.includes('overloaded')) {
    return { kind: 'overloaded', message: msg };
  }

  // 429 Rate limit — distinct from overloaded; caller's per-key
  // budget rather than Anthropic's global queue.
  if (
    e?.status === 429 ||
    lc.includes('rate limit') ||
    lc.includes('too many requests')
  ) {
    return { kind: 'rate_limit', message: msg };
  }

  // Vercel maxDuration ceiling (60s Hobby, 300s Pro) or generic
  // network timeouts surface as ETIMEDOUT / AbortError / "timed out".
  if (
    lc.includes('timeout') ||
    lc.includes('timed out') ||
    lc.includes('aborted') ||
    e?.code === 'ETIMEDOUT' ||
    e?.code === 'ECONNABORTED'
  ) {
    return { kind: 'timeout', message: msg };
  }

  // Auth/credentials issues. These are NOT retryable from the
  // user's side — show "contact support" rather than a retry CTA.
  if (
    e?.status === 401 ||
    lc.includes('authentication') ||
    lc.includes('api key') ||
    lc.includes('unauthorized')
  ) {
    return { kind: 'auth', message: msg };
  }

  // JSON parse failures from cleanJson() / JSON.parse(). Usually
  // transient — Opus occasionally returns prose before the JSON
  // even when the system prompt forbids it. A re-run almost
  // always succeeds.
  if (
    lc.includes('json') ||
    lc.includes('unexpected token') ||
    lc.includes('unterminated string')
  ) {
    return { kind: 'json', message: msg };
  }

  // Endpoint-thrown sentinels for missing pre-flight context
  // (e.g. brand bible not set). These have to be thrown
  // explicitly by the caller before the Opus call — we match on
  // the message we agreed to use in those throw sites.
  if (
    lc.includes('insufficient') ||
    lc.includes('missing context') ||
    lc.includes('brand bible not configured')
  ) {
    return { kind: 'insufficient_context', message: msg };
  }

  return { kind: 'unknown', message: msg };
}

/**
 * Build an English-language hint + retry guidance per kind. The
 * returned object is shape-compatible with the legacy
 * /api/research/analyze-brand error responses (PR #72) so
 * client code that already handles those fields keeps working.
 *
 * PR #81 — Sprint 7.6: copy converted to English as part of the
 * i18n cleanup. The previous Spanish hints were carried over from
 * PR #72/75 when the founder + early users were all Spanish-
 * speaking. New users are mixed, and product copy is English-only
 * elsewhere, so consistency wins. The error KIND vocabulary is
 * unchanged so downstream callers don't need to update.
 */
export function describeError(kind: ErrorKind): {
  error: string;
  errorKind: ErrorKind;
  retry: boolean;
  retryAfterSeconds?: number;
  hint: string;
  status: number;
} {
  switch (kind) {
    case 'overloaded':
      return {
        error: 'Anthropic is overloaded right now.',
        errorKind: 'overloaded',
        retry: true,
        retryAfterSeconds: 60,
        hint: 'Wait ~1 minute and retry — the Anthropic queue clears fast.',
        status: 503,
      };
    case 'rate_limit':
      return {
        error: 'Too many requests in a short window.',
        errorKind: 'rate_limit',
        retry: true,
        retryAfterSeconds: 30,
        hint: 'Wait ~30 seconds before retrying.',
        status: 429,
      };
    case 'timeout':
      return {
        error: 'Generation took longer than the limit and was cut off.',
        errorKind: 'timeout',
        retry: true,
        hint: 'Retry — the network may have been the issue. If it keeps happening, shorten the context.',
        status: 504,
      };
    case 'json':
      return {
        error: 'Opus returned malformed output.',
        errorKind: 'json',
        retry: true,
        hint: 'This is transient — it almost always works on the second try.',
        status: 502,
      };
    case 'auth':
      return {
        error: 'Technical issue with the AI service.',
        errorKind: 'auth',
        retry: false,
        hint: 'Retrying won\'t help — contact support.',
        status: 500,
      };
    case 'insufficient_context':
      return {
        error: 'Brand context missing for generation.',
        errorKind: 'insufficient_context',
        retry: false,
        hint: 'Fill in niche + audience in the Brand step so Opus has concrete material to work with.',
        status: 400,
      };
    default:
      return {
        error: 'Something failed while generating content.',
        errorKind: 'unknown',
        retry: true,
        hint: 'Retry once. If it keeps happening, send us the details.',
        status: 500,
      };
  }
}

/**
 * Convenience wrapper: build a NextResponse for an
 * already-categorized error. Use this at the top level of an
 * endpoint when Opus has failed and you can't recover.
 */
export function categorizedErrorResponse(
  err: unknown,
  extras: Record<string, unknown> = {},
): NextResponse {
  const cat = categorizeAnthropicError(err);
  const desc = describeError(cat.kind);
  const { status, ...payload } = desc;
  return NextResponse.json({ success: false, ...payload, ...extras }, { status });
}
