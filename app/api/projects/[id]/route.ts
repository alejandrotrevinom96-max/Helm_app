// PR Sprint 7.19 — Delete Project endpoint.
//
// DELETE /api/projects/[id]
// Returns: { success, deletedProjectId, remainingCount, nextProjectId }
//
// Auth: caller must own the project. Ownership is enforced by
// the projects.user_id check; without it a logged-in user
// could nuke another user's project by guessing the UUID.
//
// Cascade strategy:
//   Most child tables use `.references(() => projects.id,
//   { onDelete: 'cascade' })` so the DB handles the deletion
//   automatically when we drop the projects row. Three tables
//   are NOT FK-cascaded and need a manual pass before the
//   project delete:
//     - metric_daily_snapshots (no FK — soft ref)
//     - onboarding_progress.primary_project_id (nullable, no
//       FK; nulled out to keep the user's wizard state valid)
//     - anthropic_usage_log (nullable, no FK; we KEEP these
//       rows as a cost audit trail even though the project is
//       gone — billing analytics shouldn't lose history)
//
//   tiktok_publish_jobs.scheduled_post_id is also soft-ref;
//   the rows survive as historical audit traces (same call
//   the schema comment makes). chat_conversations.project_id
//   is `ON DELETE SET NULL` so it self-handles.
//
// Active project handoff:
//   Once the row is gone, we resolve the next project to
//   surface (oldest remaining) and write it to the
//   active_project_id cookie. If no projects remain we clear
//   the cookie — the client will land on /onboarding/project
//   to seed a fresh one.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import {
  projects,
  metricDailySnapshots,
  onboardingProgress,
} from '@/lib/db/schema';
import { and, asc, eq, ne } from 'drizzle-orm';
import { logger } from '@/lib/observability/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: 'Invalid projectId' },
      { status: 400 },
    );
  }

  // Ownership check. Same anti-tampering pattern as
  // setActiveProject + the Meta DELETE endpoint.
  const [owned] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
    .limit(1);
  if (!owned) {
    return NextResponse.json(
      { error: 'Project not found or forbidden' },
      { status: 403 },
    );
  }

  try {
    // Manual cleanup for the tables that aren't FK-cascaded.
    // Both queries are safe to run even if zero rows match —
    // the DELETE/UPDATE returns 0 affected rows. We run them
    // BEFORE the project delete so an interrupted request
    // leaves the DB in a recoverable state (orphan rows are
    // easier to GC than dangling project references).
    await db
      .delete(metricDailySnapshots)
      .where(eq(metricDailySnapshots.projectId, id));

    await db
      .update(onboardingProgress)
      .set({ primaryProjectId: null })
      .where(eq(onboardingProgress.primaryProjectId, id));

    // Drop the project. The CASCADE on the FK columns triggers
    // for ~25 child tables in one statement; we don't have to
    // enumerate them.
    await db
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, user.id)));

    // Resolve the next active project for the cookie handoff.
    // Oldest remaining project is the natural fallback (same
    // ordering active-project.ts uses elsewhere).
    const remaining = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, user.id), ne(projects.id, id)))
      .orderBy(asc(projects.createdAt))
      .limit(1);
    const nextProjectId = remaining[0]?.id ?? null;

    const cookieStore = await cookies();
    if (nextProjectId) {
      cookieStore.set('active_project_id', nextProjectId, {
        maxAge: 60 * 60 * 24 * 365,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    } else {
      // No projects left — clear the cookie so the layout's
      // resolver returns null and the UI prompts the founder
      // to create a fresh project.
      cookieStore.set('active_project_id', '', {
        maxAge: 0,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    }

    // Count remaining projects so the client can decide its
    // redirect target without a second round-trip.
    const countRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, user.id));
    const remainingCount = countRows.length;

    logger.info('projects/delete', 'project deleted', {
      userId: user.id,
      projectId: id,
      projectName: owned.name,
      remainingCount,
      nextProjectId: nextProjectId ?? null,
    });

    return NextResponse.json({
      success: true,
      deletedProjectId: id,
      remainingCount,
      nextProjectId,
    });
  } catch (e) {
    logger.error('projects/delete', 'delete failed', {
      userId: user.id,
      projectId: id,
      error: e,
    });
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : 'Could not delete project',
      },
      { status: 500 },
    );
  }
}
