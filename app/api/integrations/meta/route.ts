// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// GET    /api/integrations/meta?projectId=…  — fetch the integration
//                                             (NEVER returns the token)
// DELETE /api/integrations/meta?projectId=…  — disconnect (drops row)
//
// Returns null when the project has no integration so the UI can
// render the "Connect" state without a 404 round-trip.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { metaIntegrations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 }
    );
  }

  const [integration] = await db
    .select()
    .from(metaIntegrations)
    .where(
      and(
        eq(metaIntegrations.userId, user.id),
        eq(metaIntegrations.projectId, projectId)
      )
    )
    .limit(1);

  if (!integration) {
    return NextResponse.json({ integration: null });
  }

  // Strip the encrypted token before returning to the client. Even
  // ciphertext shouldn't leave the server.
  const {
    facebookPageAccessToken: _token,
    ...safeIntegration
  } = integration;
  return NextResponse.json({ integration: safeIntegration });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 }
    );
  }

  const result = await db
    .delete(metaIntegrations)
    .where(
      and(
        eq(metaIntegrations.userId, user.id),
        eq(metaIntegrations.projectId, projectId)
      )
    )
    .returning({ id: metaIntegrations.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
