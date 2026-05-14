// PR Sprint 7.19 Round 1 — structured logging + Sentry tee.
//
// One module that replaces ad-hoc `console.error(...)` calls
// across the codebase. Two goals:
//
//   1. Every log entry carries a consistent shape — endpoint,
//      user_id, request_id, error context — so Vercel's log
//      search becomes useful instead of a noisy text dump.
//
//   2. Errors are simultaneously forwarded to Sentry when the
//      DSN is configured. Without DSN, Sentry's no-op mode
//      makes the call a cheap pass-through.
//
// Usage:
//   import { logger } from '@/lib/observability/logger';
//
//   logger.error('chat/message', 'Claude call failed', {
//     userId: user.id,
//     conversationId: conv.id,
//     error: e,
//   });
//
//   logger.warn('admin/overview', 'counts query slow', {
//     elapsedMs: 1800,
//   });
//
// Log shape (one JSON line per entry, easy to grep in Vercel):
//   {"level":"error","endpoint":"chat/message","msg":"...",
//    "meta":{...},"ts":"2026-05-14T..."}

import * as Sentry from '@sentry/nextjs';

type Level = 'info' | 'warn' | 'error';

export interface LogMeta {
  userId?: string;
  requestId?: string;
  projectId?: string;
  conversationId?: string;
  elapsedMs?: number;
  error?: unknown;
  [key: string]: unknown;
}

interface LogEntry {
  level: Level;
  endpoint: string;
  msg: string;
  ts: string;
  meta: Record<string, unknown>;
}

/**
 * Serialize an Error into a JSON-friendly object. Plain
 * JSON.stringify drops `message` and `stack` because Error
 * fields are non-enumerable.
 */
function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return {
      name: e.name,
      message: e.message,
      stack: e.stack,
      // Some PostgresError / fetch errors carry a `cause`.
      cause:
        e.cause instanceof Error
          ? { name: e.cause.name, message: e.cause.message }
          : e.cause,
    };
  }
  if (typeof e === 'object' && e !== null) {
    try {
      return JSON.parse(JSON.stringify(e));
    } catch {
      return { value: String(e) };
    }
  }
  return { value: String(e) };
}

function emit(level: Level, endpoint: string, msg: string, meta: LogMeta = {}) {
  const { error, ...rest } = meta;
  const entry: LogEntry = {
    level,
    endpoint,
    msg,
    ts: new Date().toISOString(),
    meta: {
      ...rest,
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    },
  };
  // One JSON line per entry — Vercel's logs ingest happily and
  // we can search `endpoint:chat/message level:error` later.
  const json = JSON.stringify(entry);
  if (level === 'error') console.error(json);
  else if (level === 'warn') console.warn(json);
  else console.log(json);

  // Forward errors + warnings to Sentry. info-level stays local
  // to keep the free tier from filling with noise.
  if (level === 'error' || level === 'warn') {
    Sentry.withScope((scope) => {
      scope.setTag('endpoint', endpoint);
      if (rest.userId) scope.setUser({ id: String(rest.userId) });
      if (rest.requestId) scope.setTag('request_id', String(rest.requestId));
      if (rest.projectId) scope.setTag('project_id', String(rest.projectId));
      scope.setContext('meta', entry.meta);
      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureMessage(msg, level === 'error' ? 'error' : 'warning');
      }
    });
  }
}

export const logger = {
  info(endpoint: string, msg: string, meta?: LogMeta) {
    emit('info', endpoint, msg, meta);
  },
  warn(endpoint: string, msg: string, meta?: LogMeta) {
    emit('warn', endpoint, msg, meta);
  },
  error(endpoint: string, msg: string, meta?: LogMeta) {
    emit('error', endpoint, msg, meta);
  },
};
