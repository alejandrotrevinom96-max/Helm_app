import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import { listUserProjects } from '@/lib/integrations/supabase-mgmt';
import { NextResponse } from 'next/server';

interface SupabaseProject {
  id?: string;
  ref?: string;
  name?: string;
  region?: string;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [int] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, user.id), eq(integrations.provider, 'supabase')))
    .limit(1);
  if (!int) return NextResponse.json({ projects: [] });

  try {
    const token = decrypt(int.encryptedAccessToken);
    const remote = (await listUserProjects(token)) as SupabaseProject[];
    return NextResponse.json({
      projects: remote.map((p) => ({
        ref: p.ref ?? p.id ?? '',
        name: p.name ?? '',
        region: p.region ?? '',
      })),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[SUPABASE LIST PROJECTS ERROR]', {
      userId: user.id,
      error: detail,
      stack: e instanceof Error ? e.stack : undefined,
    });
    return NextResponse.json(
      {
        error: 'Failed to list Supabase projects',
        detail,
        hint:
          'Verify your token is a Personal Access Token from supabase.com/dashboard/account/tokens — NOT a service_role key, anon key, or DB connection string.',
      },
      { status: 500 }
    );
  }
}
