// PR #58 — Sprint 7.0.2: trigger the Weekly Brief immediately for a
// single project. The founder can preview what the Monday email
// looks like without waiting for the cron — also doubles as a sanity
// check that Resend domain verification is wired correctly.
//
// We deliberately allow this even when weeklyBriefEnabled is FALSE
// — the toggle gates the cron, but the founder explicitly asking
// for a test is signal enough.
//
// Rate-limited 3/hr because every call is an Opus invocation
// (~$0.05) plus a Resend send.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { generateAndSendBrief } from '@/lib/research/brief';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = checkRateLimit(
    `research-test-brief:${user.id}`,
    3,
    60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  let body: { projectId?: string; dryRun?: boolean };
  try {
    body = (await request.json()) as {
      projectId?: string;
      dryRun?: boolean;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { projectId, dryRun } = body;
  if (!projectId || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
  }

  const result = await generateAndSendBrief({
    userId: user.id,
    projectId,
    dryRun: Boolean(dryRun),
  });

  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        skipped: result.skipped ?? false,
        reason: result.reason,
        error: result.error,
        htmlPreview: result.htmlPreview,
      },
      { status: result.skipped ? 200 : 502 },
    );
  }

  return NextResponse.json({
    success: true,
    emailId: result.emailId,
    htmlPreview: dryRun ? result.htmlPreview : undefined,
  });
}
