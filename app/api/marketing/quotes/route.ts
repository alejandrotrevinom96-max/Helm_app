// PR #51 — Sprint 6.8.2: /api/marketing/quotes alias.
//
// The Quote Vault has lived at /api/brand/quotes since the
// brand-bible flow was built (PR #19). Sprint 6.8.1 founder QA
// hit /api/marketing/quotes expecting the same surface under
// the marketing/* namespace and got a 404. Rather than rename
// the existing path (which would break older callers) we ship
// an alias here that reuses the same brand_quotes table + the
// same ownership / validation rules.
//
// Methods:
//   GET    /api/marketing/quotes?projectId=…    — list
//   POST   /api/marketing/quotes                — create
//   DELETE /api/marketing/quotes?id=…           — delete
//
// Ownership: every method checks projects.userId = current
// user. Reusable helper at the top so the three methods stay
// thin.
//
// Auto-trigger fingerprint refresh fires on POST so the
// founder doesn't have to click "Re-analyze" after dropping
// new quotes — same fire-and-forget pattern as the
// /api/brand/quotes POST (PR #49 Sprint 6.8).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { brandQuotes, projects } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';

const MAX_CONTENT_LEN = 2000;
const MIN_CONTENT_LEN = 10;

async function verifyProjectOwnership(projectId: string, userId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return project ?? null;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  const project = await verifyProjectOwnership(projectId, user.id);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Double-filter (projectId + userId) is intentional — defense
  // in depth so a future bug in verifyProjectOwnership can't
  // surface another user's quotes.
  const quotes = await db
    .select()
    .from(brandQuotes)
    .where(
      and(
        eq(brandQuotes.projectId, projectId),
        eq(brandQuotes.userId, user.id)
      )
    )
    .orderBy(desc(brandQuotes.createdAt))
    .limit(100);

  return NextResponse.json({ quotes });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  // Accept either `text` (per Sprint 6.8.2 plan) or `content`
  // (legacy /api/brand/quotes shape) so the same UI components
  // can call either path without changes.
  const projectId =
    typeof body?.projectId === 'string' ? body.projectId : '';
  const rawText =
    typeof body?.text === 'string'
      ? body.text
      : typeof body?.content === 'string'
        ? body.content
        : '';
  const source = typeof body?.source === 'string' ? body.source : null;
  const context = typeof body?.context === 'string' ? body.context : null;

  if (!projectId || !rawText.trim()) {
    return NextResponse.json(
      { error: 'projectId and text are required' },
      { status: 400 }
    );
  }
  if (rawText.length < MIN_CONTENT_LEN || rawText.length > MAX_CONTENT_LEN) {
    return NextResponse.json(
      {
        error: `Quote must be between ${MIN_CONTENT_LEN} and ${MAX_CONTENT_LEN} characters.`,
      },
      { status: 400 }
    );
  }

  const project = await verifyProjectOwnership(projectId, user.id);
  if (!project) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [created] = await db
    .insert(brandQuotes)
    .values({
      projectId,
      userId: user.id,
      content: rawText.trim(),
      source: source?.trim() || null,
      context: context?.trim() || null,
      tags: [],
    })
    .returning();

  triggerFingerprintRefresh(request, projectId);

  return NextResponse.json({ success: true, quote: created });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Direct ownership via brandQuotes.userId (which IS in the
  // table — quotes have userId column for fast isolation queries).
  // A foreign quote would fail this WHERE and return 0 rows; we
  // surface 404 rather than 403 so we don't leak existence.
  const result = await db
    .delete(brandQuotes)
    .where(
      and(eq(brandQuotes.id, id), eq(brandQuotes.userId, user.id))
    )
    .returning({ id: brandQuotes.id, projectId: brandQuotes.projectId });

  if (result.length === 0) {
    return NextResponse.json(
      { error: 'Not found or forbidden' },
      { status: 404 }
    );
  }

  // Fingerprint may be stale after a delete — refresh in
  // background. Best-effort, non-fatal.
  triggerFingerprintRefresh(request, result[0].projectId);

  return NextResponse.json({ success: true });
}

// Same fire-and-forget pattern used in /api/brand/quotes (Sprint
// 6.8). We don't await so the response returns immediately;
// Vercel may terminate before the refresh completes — the
// founder can always trigger manually via the "Re-analyze" UI
// button.
function triggerFingerprintRefresh(request: Request, projectId: string) {
  const cookie = request.headers.get('cookie') ?? '';
  if (!cookie) return;
  const host = request.headers.get('host');
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    (host ? `https://${host}` : null);
  if (!base) return;
  fetch(`${base}/api/marketing/voice/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ projectId }),
  }).catch((e) => {
    console.error(
      '[QUOTES alias] background fingerprint refresh failed (non-fatal):',
      e
    );
  });
}
