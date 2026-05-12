// PR #69 — Sprint 7.1D: Strategic Timeline server shell. Resolves
// the active project + checks that a priority matrix exists (so the
// client can decide whether to disable the auto-populate button
// upfront without a roundtrip). Initial tasks are hydrated for the
// current week — client refetches when the founder navigates weeks.
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getActiveProject } from '@/lib/active-project';
import { db } from '@/lib/db';
import {
  compassTasks,
  priorityMatrices,
} from '@/lib/db/schema';
import { eq, and, gte, lte, asc, desc } from 'drizzle-orm';
import { TimelineClient } from './client';

function getCurrentMondayUtc(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + diffToMonday,
    ),
  );
}

export default async function CompassTimelinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const project = await getActiveProject(user.id);
  if (!project) redirect('/onboarding');

  const monday = getCurrentMondayUtc();
  const sunday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [matrix] = await db
    .select({ id: priorityMatrices.id })
    .from(priorityMatrices)
    .where(eq(priorityMatrices.projectId, project.id))
    .orderBy(desc(priorityMatrices.createdAt))
    .limit(1);

  const tasks = await db
    .select()
    .from(compassTasks)
    .where(
      and(
        eq(compassTasks.projectId, project.id),
        gte(compassTasks.scheduledFor, monday),
        lte(compassTasks.scheduledFor, sunday),
      ),
    )
    .orderBy(asc(compassTasks.scheduledFor));

  return (
    <TimelineClient
      project={{ id: project.id, name: project.name }}
      hasMatrix={Boolean(matrix)}
      initialWeekStart={monday.toISOString()}
      initialTasks={tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        taskType: t.taskType,
        scheduledFor: t.scheduledFor.toISOString(),
        estimatedMinutes: t.estimatedMinutes,
        effortLevel: t.effortLevel,
        status: t.status,
        sourceType: t.sourceType,
        sourceContext: t.sourceContext,
        suggestedPlatform: t.suggestedPlatform,
        suggestedContentType: t.suggestedContentType,
        suggestedPrompt: t.suggestedPrompt,
      }))}
    />
  );
}
