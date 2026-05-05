import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { integrations, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';
import {
  listPublicTables,
  getTableCount,
} from '@/lib/integrations/supabase-mgmt';
import { NextResponse } from 'next/server';

// Each call hits Supabase Mgmt N+1 times (1 list + N counts), so we cap
// runtime explicitly. Most projects have <20 public tables; this is fine.
export const maxDuration = 30;

interface TableRow {
  tableName: string;
  count: number;
  isAuthTable?: boolean;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json(
      { error: 'projectId required' },
      { status: 400 }
    );
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!project.supabaseProjectRef) {
    return NextResponse.json(
      {
        error: 'Supabase project not mapped',
        hint: 'Map this project to a Supabase project first in Integrations.',
      },
      { status: 400 }
    );
  }

  const [int] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.userId, user.id),
        eq(integrations.provider, 'supabase')
      )
    )
    .limit(1);
  if (!int) {
    return NextResponse.json(
      { error: 'Supabase token missing' },
      { status: 400 }
    );
  }

  let token: string;
  try {
    token = decrypt(int.encryptedAccessToken);
  } catch {
    return NextResponse.json(
      { error: 'Could not decrypt Supabase token' },
      { status: 500 }
    );
  }

  try {
    // Always offer auth.users as the default option, even if the
    // public schema list is empty. That preserves PR #1 behaviour for
    // projects that already use Supabase Auth.
    const tableNames = await listPublicTables(token, project.supabaseProjectRef);

    // Counts in parallel — Supabase mgmt API rate-limits, but a typical
    // project has fewer than 20 public tables so this stays well below.
    const counts = await Promise.all(
      tableNames.map(async (tableName) => {
        try {
          const count = await getTableCount(
            token,
            project.supabaseProjectRef!,
            tableName
          );
          return { tableName, count };
        } catch {
          return { tableName, count: 0 };
        }
      })
    );

    let authUsersCount = 0;
    try {
      authUsersCount = await getTableCount(
        token,
        project.supabaseProjectRef,
        'auth.users'
      );
    } catch {
      // ignore — leave 0
    }

    const tables: TableRow[] = [
      { tableName: 'auth.users', count: authUsersCount, isAuthTable: true },
      ...counts,
    ];

    return NextResponse.json({ tables });
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Failed to list tables',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
