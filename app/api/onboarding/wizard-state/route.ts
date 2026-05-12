// PR #74 — Sprint 7.2B: wizard-state endpoint.
//
// IMPORTANT — parallel to (NOT replacing) /api/onboarding/progress.
// The legacy `progress` route reads/writes users.onboardingStep
// (integer, 0-99) and is still used by components/onboarding/wizard.tsx
// (the overlay-style wizard rendered inside the dashboard layout
// for users who haven't completed onboarding).
//
// This route extends that contract for the new 5-step wizard by
// also writing to the onboarding_progress table — granular
// timestamps, skipped steps, primaryProjectId, brandAnswers. We
// keep BOTH sources in sync so:
//   - Legacy overlay still resolves "completed" via users.* and
//     stays hidden once the new wizard finishes.
//   - New wizard reads its own granular state from this table.
//
// POST body shape (all fields optional except step):
//   {
//     step: 'welcome' | 'project' | 'brand' | 'research' |
//            'first-content',
//     completed?: boolean,
//     skipped?: boolean,
//     primaryProjectId?: string (uuid),
//     firstDraftId?: string (uuid),
//     brandAnswers?: { niche?: string, audience?: string,
//                      tone?: string, oneLiner?: string },
//     markOnboardingComplete?: boolean
//   }
//
// `markOnboardingComplete` flips users.onboardingStep=99 +
// users.hasCompletedOnboarding=true + users.onboardingCompletedAt
// so the legacy dashboard overlay disappears and the layout's
// "redirect to /onboarding" guard stops firing.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { onboardingProgress, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STEPS = [
  'welcome',
  'project',
  'brand',
  'research',
  'first-content',
] as const;

// Step→numeric mapping for the legacy users.onboardingStep column.
// Keeps the integer field roughly synced with the granular string
// step so the dashboard overlay's progress bar (which reads the
// integer) stays accurate. 99 = completed in legacy semantics.
const STEP_TO_INT: Record<string, number> = {
  welcome: 1,
  project: 2,
  brand: 3,
  research: 4,
  'first-content': 5,
};

// Step key → schema column name. Built explicitly because the
// plan's `step.replace('-','')+'At'` produced `firstcontentAt`,
// which doesn't exist on the table (the column is camelCase
// `firstContentAt`). Map by hand to avoid that class of bug.
const STEP_TO_COLUMN: Record<
  string,
  keyof typeof onboardingProgress.$inferInsert
> = {
  welcome: 'welcomeAt',
  project: 'projectAt',
  brand: 'brandAt',
  research: 'researchAt',
  'first-content': 'firstContentAt',
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [progress] = await db
    .select()
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, user.id))
    .limit(1);

  // Lazy backward-compat: if there's no row but the legacy column
  // says the user finished onboarding, return a synthetic completed
  // payload. Avoids needing a backfill script for the 5 users who
  // started the legacy flow before this wizard shipped.
  if (!progress) {
    const [legacyUser] = await db
      .select({
        hasCompletedOnboarding: users.hasCompletedOnboarding,
        onboardingStep: users.onboardingStep,
        onboardingCompletedAt: users.onboardingCompletedAt,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (legacyUser?.hasCompletedOnboarding) {
      return NextResponse.json({
        progress: null,
        completed: true,
        legacyCompleted: true,
      });
    }
    return NextResponse.json({ progress: null, completed: false });
  }

  return NextResponse.json({
    progress,
    completed: Boolean(progress.completedAt),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    step?: unknown;
    completed?: unknown;
    skipped?: unknown;
    primaryProjectId?: unknown;
    firstDraftId?: unknown;
    brandAnswers?: unknown;
    markOnboardingComplete?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (
    typeof body.step !== 'string' ||
    !(VALID_STEPS as readonly string[]).includes(body.step)
  ) {
    return NextResponse.json(
      { error: `Invalid step. Must be one of: ${VALID_STEPS.join(', ')}` },
      { status: 400 },
    );
  }
  const step = body.step;
  const completed = body.completed === true;
  const skipped = body.skipped === true;
  const markComplete = body.markOnboardingComplete === true;

  // Upsert pattern: if no row exists, insert; otherwise update.
  // We use a SELECT-then-INSERT-or-UPDATE rather than ON CONFLICT
  // because we need to merge skippedSteps with the existing array
  // (not replace it) — that's awkward in a single UPSERT.
  let [progress] = await db
    .select()
    .from(onboardingProgress)
    .where(eq(onboardingProgress.userId, user.id))
    .limit(1);

  if (!progress) {
    [progress] = await db
      .insert(onboardingProgress)
      .values({
        userId: user.id,
        currentStep: step,
      })
      .returning();
  }

  const updates: Partial<typeof onboardingProgress.$inferInsert> = {
    currentStep: step,
    updatedAt: new Date(),
  };

  if (completed) {
    const col = STEP_TO_COLUMN[step];
    if (col) {
      // Stamp the per-step timestamp; idempotent (overwriting is
      // fine — repeated POSTs from a flaky network land the same
      // value).
      updates[col] = new Date() as never;
    }
  }

  if (skipped) {
    const prior = Array.isArray(progress.skippedSteps)
      ? (progress.skippedSteps as string[])
      : [];
    if (!prior.includes(step)) {
      updates.skippedSteps = [...prior, step];
    }
  }

  if (typeof body.primaryProjectId === 'string') {
    if (!UUID_RE.test(body.primaryProjectId)) {
      return NextResponse.json(
        { error: 'Invalid primaryProjectId' },
        { status: 400 },
      );
    }
    updates.primaryProjectId = body.primaryProjectId;
  }

  if (typeof body.firstDraftId === 'string') {
    if (!UUID_RE.test(body.firstDraftId)) {
      return NextResponse.json(
        { error: 'Invalid firstDraftId' },
        { status: 400 },
      );
    }
    updates.firstDraftId = body.firstDraftId;
  }

  if (body.brandAnswers && typeof body.brandAnswers === 'object') {
    // Merge — don't overwrite. The founder can fill `niche` in step
    // brand and `oneLiner` in step project; we don't want one to
    // wipe the other.
    const prior =
      (progress.brandAnswers as Record<string, unknown> | null) ?? {};
    const incoming = body.brandAnswers as Record<string, unknown>;
    const merged: Record<string, string> = { ...prior } as Record<
      string,
      string
    >;
    for (const [k, v] of Object.entries(incoming)) {
      if (typeof v === 'string' && v.trim()) {
        merged[k] = v.slice(0, 2000);
      }
    }
    updates.brandAnswers = merged;
  }

  if (markComplete) {
    updates.completedAt = new Date();
    updates.currentStep = 'completed';
  }

  await db
    .update(onboardingProgress)
    .set(updates)
    .where(eq(onboardingProgress.userId, user.id));

  // Mirror to legacy columns on users so the dashboard overlay
  // wizard stays in sync. We bump onboardingStep to the numeric
  // equivalent (or 99 on completion); the dashboard layout's
  // overlay shows for `< 99`.
  const legacyUpdates: {
    onboardingStep?: number;
    hasCompletedOnboarding?: boolean;
    onboardingCompletedAt?: Date;
  } = {};
  if (markComplete) {
    legacyUpdates.onboardingStep = 99;
    legacyUpdates.hasCompletedOnboarding = true;
    legacyUpdates.onboardingCompletedAt = new Date();
  } else if (completed && STEP_TO_INT[step] !== undefined) {
    // Only bump forward, never back — a re-visit to an earlier
    // step shouldn't downgrade the integer.
    const newStep = STEP_TO_INT[step];
    const [u] = await db
      .select({ onboardingStep: users.onboardingStep })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if ((u?.onboardingStep ?? 0) < newStep) {
      legacyUpdates.onboardingStep = newStep;
    }
  }
  if (Object.keys(legacyUpdates).length > 0) {
    await db
      .update(users)
      .set(legacyUpdates)
      .where(eq(users.id, user.id));
  }

  return NextResponse.json({ success: true });
}
