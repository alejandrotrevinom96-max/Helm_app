import { db } from '@/lib/db';
import {
  waitlistPages,
  waitlistResponses,
  waitlistSignups,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await request.json().catch(() => ({}));
  const { email, responses, template } = body as {
    email?: string;
    responses?: Record<string, unknown>;
    template?: string;
  };

  const [page] = await db
    .select()
    .from(waitlistPages)
    .where(eq(waitlistPages.slug, slug))
    .limit(1);
  if (!page || !page.isActive) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // The survey-5q template allows submitting without an email; everything
  // else requires it. Validate format if present.
  const emailRequired = template !== 'survey-5q';
  if (emailRequired && !email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  // Hash IP+slug so the same person submitting twice on the same page is
  // detectable without storing raw IPs.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const ipHash = createHash('sha256').update(ip + slug).digest('hex');

  await db.insert(waitlistResponses).values({
    waitlistPageId: page.id,
    email: email ?? null,
    responses: responses ?? {},
    ipHash,
    userAgent: request.headers.get('user-agent') ?? '',
  });

  // Backward-compat: keep populating the legacy waitlistSignups table when
  // an email is present. waitlistSignups has no unique constraint on email
  // so we just insert; duplicates are tolerable for the Validate signup count.
  if (email) {
    try {
      await db.insert(waitlistSignups).values({
        waitlistPageId: page.id,
        email,
      });
    } catch (e) {
      // Non-fatal — the response itself is recorded.
      console.error('[RESPOND] legacy signup insert failed', e);
    }
  }

  return NextResponse.json({ ok: true });
}
