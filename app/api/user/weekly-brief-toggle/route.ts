// PR #58 — Sprint 7.0.2: opt-in/out for the Weekly Brief email.
//
// The Monday-morning cron checks `users.weekly_brief_enabled` and
// only emails users who flipped this toggle. Default is FALSE so we
// never email a user who hasn't asked.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { users as usersTable } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { enabled?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const enabled = Boolean(body.enabled);
  await db
    .update(usersTable)
    .set({ weeklyBriefEnabled: enabled })
    .where(eq(usersTable.id, user.id));

  return NextResponse.json({ success: true, enabled });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [row] = await db
    .select({ enabled: usersTable.weeklyBriefEnabled })
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);

  return NextResponse.json({ enabled: row?.enabled ?? false });
}
