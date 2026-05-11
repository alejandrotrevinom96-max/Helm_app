// PR #66 — Sprint 7.0.9: X smoke-test. Posts a marked tweet, waits
// briefly so the founder can verify it landed in their feed, then
// deletes it. End-to-end proof that the configured creds carry
// both Read AND Write permissions (a common 401 cause is forgetting
// to bump scopes in the X dev portal).
//
// 1 call per 30 min per user — even a marked smoke tweet briefly
// in the founder's timeline is enough; no need to spam.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  isXConfigured,
  postTweet,
  deleteTweet,
} from '@/lib/x/client';

export const maxDuration = 30;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = checkRateLimit(`x-smoke:${user.id}`, 2, 30 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        hint: `Try again in ${Math.ceil(limit.resetMs / 60000)} minutes.`,
      },
      { status: 429 },
    );
  }

  if (!isXConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'X not configured. Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET in env.',
      },
      { status: 400 },
    );
  }

  // Marker text identifies the tweet as a Helm smoke test in case
  // the delete step fails — the founder will know what it was.
  const marker = `[Helm smoke test ${Date.now().toString(36)}] Verifying publish permissions. Auto-delete in 5s.`;

  let tweetId: string | undefined;
  let tweetUrl: string | undefined;
  try {
    const posted = await postTweet(marker);
    tweetId = posted.id;
    tweetUrl = posted.url;
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        stage: 'post',
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 502 },
    );
  }

  // Tiny pause so the founder can refresh their X tab and see the
  // tweet before delete fires. 5 seconds is enough for visual
  // confirmation without leaving the test tweet up long.
  await new Promise((resolve) => setTimeout(resolve, 5000));

  let deleted = false;
  let deleteError: string | undefined;
  try {
    await deleteTweet(tweetId);
    deleted = true;
  } catch (e) {
    deleteError = e instanceof Error ? e.message : 'Unknown error';
  }

  return NextResponse.json({
    success: true,
    tweetId,
    tweetUrl,
    deleted,
    deleteError,
    message: deleted
      ? 'Posted and deleted. X publishing is fully working.'
      : `Posted but delete failed. Tweet stays at ${tweetUrl} — remove manually. Error: ${deleteError ?? 'unknown'}.`,
  });
}
