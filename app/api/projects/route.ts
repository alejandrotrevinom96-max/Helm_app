// PR #33 — Sprint 6.1.
//
// POST /api/projects
//
// Manual project creation. Pre-PR-33 the only path to a project was
// the GitHub scan during onboarding — which excluded every founder
// without a GitHub repo. This endpoint creates a project with just a
// name + optional brand URL, and (importantly) sets it as the active
// project via the same cookie the rest of the app reads.
//
// We DON'T touch GitHub fields (githubRepoFullName, githubRepoId) —
// they stay null so the project shows up cleanly in lists that
// distinguish "scanned from GH" vs "manual".
//
// Slug: derived from name, deduped against existing slugs for this
// user. Reuses the same slugify pattern the onboarding flow uses.
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const NAME_MAX = 80;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-|-$/g, '');
}

async function uniqueSlugForUser(
  userId: string,
  base: string
): Promise<string> {
  // Slugs are scoped per-user (no global UNIQUE), so we just check
  // collisions for this user. If "voya" exists we try "voya-2",
  // "voya-3", etc. — capped at 50 attempts to avoid a runaway loop
  // on a pathological input.
  const candidate = base || 'project';
  const existing = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.userId, userId));
  const taken = new Set(existing.map((r) => r.slug));
  if (!taken.has(candidate)) return candidate;
  for (let i = 2; i <= 50; i++) {
    const next = `${candidate}-${i}`;
    if (!taken.has(next)) return next;
  }
  // Fallback: timestamp suffix.
  return `${candidate}-${Date.now()}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { name, brandUrl } = body as {
    name?: unknown;
    brandUrl?: unknown;
  };

  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json(
      { error: 'Name is required' },
      { status: 400 }
    );
  }
  if (name.trim().length > NAME_MAX) {
    return NextResponse.json(
      { error: `Name must be ${NAME_MAX} characters or fewer` },
      { status: 400 }
    );
  }

  // Optional URL — validate shape if provided.
  let normalizedUrl: string | null = null;
  if (typeof brandUrl === 'string' && brandUrl.trim().length > 0) {
    try {
      const candidate = brandUrl.startsWith('http')
        ? brandUrl
        : `https://${brandUrl}`;
      normalizedUrl = new URL(candidate).toString();
    } catch {
      return NextResponse.json(
        { error: 'Website URL is not valid' },
        { status: 400 }
      );
    }
  }

  const trimmedName = name.trim();
  const slug = await uniqueSlugForUser(user.id, slugify(trimmedName));

  const [created] = await db
    .insert(projects)
    .values({
      userId: user.id,
      name: trimmedName,
      slug,
      brandUrl: normalizedUrl,
      // Manual project — leave GH/Vercel/Supabase/Meta integrations
      // null so they're treated as "not connected" everywhere
      // downstream.
    })
    .returning();

  // Set as active project (same cookie the rest of the app reads).
  // Mirrors `setActiveProject` in app/(dashboard)/actions.ts.
  const cookieStore = await cookies();
  cookieStore.set('active_project_id', created.id, {
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  return NextResponse.json({ success: true, project: created });
}
