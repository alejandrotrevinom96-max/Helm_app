// PR Sprint pillarengine — shared ingest logic.
//
// Webhook (/api/pillarengine/webhook) and cron
// (/api/cron/sync-pillarengine) both call `upsertApprovedPage`
// so the validation + DB upsert + revalidation contract stays
// single-source-of-truth. The webhook does HMAC verification +
// event routing on top; the cron does paging + lastSync
// bookkeeping on top.
//
// This module lives in lib/ (not in the route file) so:
//   - Tests can import it directly (no Next.js route boilerplate).
//   - The cron's loop calls it N times without re-importing the
//     full route module.
//   - Future ingest paths (e.g. a manual /admin/import-pillarengine
//     button) can reuse it.

import { db } from '@/lib/db';
import { blogPostsExternal } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,200})$/;

export interface PillarengineApprovedPage {
  page_id: string;
  title: string;
  slug: string;
  meta_title?: string | null;
  meta_description?: string | null;
  markdown_body: string;
  intent?: 'seo' | 'aeo' | 'hybrid' | null;
  approved_at?: string | null;
}

export type IngestResult =
  | { ok: true; slug: string; action: 'created' | 'updated' }
  | { ok: false; error: string; status: number };

export async function upsertApprovedPage(
  payload: PillarengineApprovedPage,
): Promise<IngestResult> {
  const slug = (payload.slug ?? '').trim().toLowerCase();
  const title = (payload.title ?? '').trim();
  const markdownBody = payload.markdown_body ?? '';

  if (!slug || !SLUG_RE.test(slug)) {
    return { ok: false, error: 'Invalid slug', status: 400 };
  }
  if (!title) {
    return { ok: false, error: 'title required', status: 400 };
  }
  if (markdownBody.length < 50) {
    return {
      ok: false,
      error: 'markdown_body too short (< 50 chars)',
      status: 400,
    };
  }
  if (!payload.page_id || typeof payload.page_id !== 'string') {
    return { ok: false, error: 'page_id required', status: 400 };
  }

  const parsedApprovedAt = payload.approved_at
    ? new Date(payload.approved_at)
    : new Date();
  const approvedAt = isNaN(parsedApprovedAt.getTime())
    ? new Date()
    : parsedApprovedAt;

  try {
    // Detect slug collision between the incoming page_id and a
    // pre-existing row holding the same slug under a different
    // upstream id. We refuse rather than rewrite — same posture
    // as the file-vs-DB collision rule in lib/blog/loader.ts.
    // Operators get a Sentry log so they can reconcile manually.
    const existing = await db
      .select({
        id: blogPostsExternal.id,
        pillarengineId: blogPostsExternal.pillarengineId,
      })
      .from(blogPostsExternal)
      .where(sql`slug = ${slug}`)
      .limit(1);
    if (
      existing.length > 0 &&
      existing[0].pillarengineId !== payload.page_id
    ) {
      Sentry.captureMessage('pillarengine_ingest_slug_conflict', {
        level: 'warning',
        tags: { area: 'pillarengine', kind: 'slug-conflict' },
        extra: {
          slug,
          incomingPageId: payload.page_id,
          existingPageId: existing[0].pillarengineId,
        },
      });
      return {
        ok: false,
        error: 'Slug already bound to a different pillarengine_id',
        status: 409,
      };
    }

    const inserted = await db
      .insert(blogPostsExternal)
      .values({
        pillarengineId: payload.page_id,
        slug,
        title,
        metaTitle: payload.meta_title ?? null,
        metaDescription: payload.meta_description ?? null,
        markdownBody,
        intent: payload.intent ?? null,
        approvedAt,
        source: 'pillarengine',
      })
      .onConflictDoUpdate({
        target: blogPostsExternal.pillarengineId,
        set: {
          slug,
          title,
          metaTitle: payload.meta_title ?? null,
          metaDescription: payload.meta_description ?? null,
          markdownBody,
          intent: payload.intent ?? null,
          approvedAt,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: blogPostsExternal.id,
        createdAt: blogPostsExternal.createdAt,
        updatedAt: blogPostsExternal.updatedAt,
      });

    const row = inserted[0];
    const action: 'created' | 'updated' =
      row && row.createdAt.getTime() === row.updatedAt.getTime()
        ? 'created'
        : 'updated';

    // Revalidate both the index and the specific slug so the
    // founder sees the new content without a redeploy. Wrapped
    // because revalidatePath can throw when called outside a
    // render context (rare, but never block ingest on it).
    try {
      revalidatePath('/blog');
    } catch (err) {
      console.warn('[pillarengine/ingest] revalidate /blog failed:', err);
    }
    try {
      revalidatePath(`/blog/${slug}`);
    } catch (err) {
      console.warn(
        `[pillarengine/ingest] revalidate /blog/${slug} failed:`,
        err,
      );
    }

    return { ok: true, slug, action };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { area: 'pillarengine', kind: 'ingest-failed' },
      extra: {
        slug,
        pageId: payload.page_id,
      },
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Ingest failed',
      status: 500,
    };
  }
}
