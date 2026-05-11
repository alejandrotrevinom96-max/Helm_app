// PR #65 — Sprint 7.0.8: X (Twitter) v2 API client wrapper.
//
// Uses OAuth 1.0a User Context (app keys + user access tokens) so we
// can post on behalf of the configured account. The new X pay-per-
// use plan still supports this — the rate limit is the only thing
// that changed. We keep the wrapper graceful: if any env var is
// missing, `isXConfigured()` returns false and the publisher
// short-circuits with a concrete reason instead of throwing deep in
// the SDK.
//
// All four credentials are required to post:
//   - X_API_KEY        (consumer key)
//   - X_API_SECRET     (consumer secret)
//   - X_ACCESS_TOKEN
//   - X_ACCESS_TOKEN_SECRET
// X_BEARER_TOKEN is optional (app-only auth, useful for read paths).
import { TwitterApi } from 'twitter-api-v2';

export function isXConfigured(): boolean {
  return Boolean(
    process.env.X_API_KEY &&
      process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_TOKEN_SECRET,
  );
}

function buildClient(): TwitterApi {
  if (!isXConfigured()) {
    throw new Error(
      'X API credentials missing — set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET',
    );
  }
  return new TwitterApi({
    appKey: process.env.X_API_KEY!,
    appSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
  });
}

export interface PostedTweet {
  id: string;
  url: string;
}

export interface PostedThread {
  rootId: string;
  rootUrl: string;
  tweetIds: string[];
  count: number;
}

/**
 * Verify credentials are valid + return the authenticated user's
 * handle. Used by /api/integrations/x/test and by the Integrations
 * page card to show "✓ Connected as @handle" instead of a generic
 * "configured" badge.
 */
export async function whoAmI(): Promise<{ id: string; username: string }> {
  const client = buildClient();
  const me = await client.v2.me();
  return { id: me.data.id, username: me.data.username };
}

/**
 * Post a single tweet. The caller is responsible for enforcing the
 * 280-char ceiling (the schedule endpoint validates upfront so the
 * cron doesn't need to).
 */
export async function postTweet(text: string): Promise<PostedTweet> {
  const client = buildClient();
  const res = await client.v2.tweet(text);
  return {
    id: res.data.id,
    url: `https://x.com/i/web/status/${res.data.id}`,
  };
}

/**
 * Delete a previously-posted tweet. Used by the smoke-test endpoint
 * (post → verify → delete) and by future "undo publish" flows.
 *
 * Throws on failure — the caller is responsible for surfacing the
 * error. Twitter requires deleteTweet to use the same OAuth1.0a
 * user context that posted the tweet; our env credentials cover
 * that, but a tweet posted by a different account would 403.
 */
export async function deleteTweet(tweetId: string): Promise<void> {
  const client = buildClient();
  await client.v2.deleteTweet(tweetId);
}

/**
 * Post a thread (2-N tweets). Each tweet replies to the previous
 * one, producing a single canonical chain. Returns the root id so
 * the caller can persist a clickable permalink for the post.
 */
export async function postThread(tweets: string[]): Promise<PostedThread> {
  if (!Array.isArray(tweets) || tweets.length === 0) {
    throw new Error('Thread requires at least one tweet');
  }
  const client = buildClient();
  const ids: string[] = [];
  let previousId: string | undefined;
  for (const text of tweets) {
    const res = await client.v2.tweet(
      text,
      previousId
        ? { reply: { in_reply_to_tweet_id: previousId } }
        : undefined,
    );
    ids.push(res.data.id);
    previousId = res.data.id;
  }
  return {
    rootId: ids[0],
    rootUrl: `https://x.com/i/web/status/${ids[0]}`,
    tweetIds: ids,
    count: ids.length,
  };
}
