import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [row] = await db
    .select({
      step: users.onboardingStep,
      completedAt: users.onboardingCompletedAt,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  return NextResponse.json({
    step: row?.step ?? 0,
    completed: row?.completedAt != null,
  });
}

// Advance to a specific step or skip the wizard entirely. step=99 and skip=true
// both mark onboardingCompletedAt so the wizard won't reappear.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { step, skip } = body as { step?: unknown; skip?: unknown };

  const updates: { onboardingStep?: number; onboardingCompletedAt?: Date } = {};

  if (typeof step === 'number' && step >= 0 && step <= 99) {
    updates.onboardingStep = step;
  }
  if (skip === true || step === 99) {
    updates.onboardingStep = 99;
    updates.onboardingCompletedAt = new Date();
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Invalid step' }, { status: 400 });
  }

  await db.update(users).set(updates).where(eq(users.id, user.id));
  return NextResponse.json({ ok: true });
}
