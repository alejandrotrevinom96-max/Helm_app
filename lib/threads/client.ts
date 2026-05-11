// PR #66 — Sprint 7.0.9: Threads publishing.
//
// Threads piggybacks the Meta platform — its API lives at
// graph.threads.net and accepts the same Facebook page access
// token (when the token has the threads_basic +
// threads_content_publish scopes). We DON'T add a separate
// integration table; we read meta_integrations.facebookPageAccessToken
// and probe the Threads /me endpoint at runtime to see if the
// scopes are present. The probe doubles as connection state: if
// /me returns 200 the founder is good to publish.
//
// Two publish paths today:
//   - text — POST /me/threads with media_type=TEXT then publish
//   - photo — POST /me/threads with media_type=IMAGE + image_url
//
// 500-char ceiling per Threads docs; we surface it in the schedule
// endpoint validation upstream.
import { db } from '@/lib/db';
import { metaIntegrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { decryptToken } from '@/lib/crypto/token-encryption';

const THREADS_BASE = 'https://graph.threads.net/v1.0';

export interface ThreadsPublishResult {
  threadId: string;
  url: string;
}

interface ResolvedThreads {
  accessToken: string;
  threadsUserId: string;
  username: string;
}

async function loadAccess(projectId: string): Promise<ResolvedThreads> {
  const [meta] = await db
    .select()
    .from(metaIntegrations)
    .where(eq(metaIntegrations.projectId, projectId))
    .limit(1);
  if (!meta) {
    throw new Error(
      'Threads requires a connected Meta integration. Connect Facebook + Instagram at /integrations first.',
    );
  }
  if (!meta.facebookPageAccessToken) {
    throw new Error('Meta integration has no access token — re-connect.');
  }
  let accessToken: string;
  try {
    accessToken = decryptToken(meta.facebookPageAccessToken);
  } catch {
    throw new Error('Meta token decryption failed — re-connect.');
  }

  // /me on graph.threads.net verifies the scopes are present + returns
  // the threads user id we need for subsequent calls. Without
  // threads_basic this returns 401/400 with a "scope required" message.
  const res = await fetch(
    `${THREADS_BASE}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) {
    const text = await res.text();
    if (
      /threads_basic|scope|permission/i.test(text) ||
      res.status === 401 ||
      res.status === 403
    ) {
      throw new Error(
        'Meta token is missing the threads_basic + threads_content_publish scopes. Re-connect Meta and grant the Threads permissions during the OAuth flow.',
      );
    }
    throw new Error(
      `Threads /me failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as { id?: string; username?: string };
  if (!data.id) {
    throw new Error('Threads /me returned no user id.');
  }
  return {
    accessToken,
    threadsUserId: data.id,
    username: data.username ?? '',
  };
}

interface ContainerResp {
  id: string;
}

async function createTextContainer(
  ctx: ResolvedThreads,
  text: string,
): Promise<string> {
  const url = `${THREADS_BASE}/${ctx.threadsUserId}/threads`;
  const params = new URLSearchParams({
    media_type: 'TEXT',
    text,
    access_token: ctx.accessToken,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Threads container failed (${res.status}): ${t.slice(0, 240)}`);
  }
  const data = (await res.json()) as ContainerResp;
  return data.id;
}

async function createImageContainer(
  ctx: ResolvedThreads,
  text: string,
  imageUrl: string,
): Promise<string> {
  const url = `${THREADS_BASE}/${ctx.threadsUserId}/threads`;
  const params = new URLSearchParams({
    media_type: 'IMAGE',
    image_url: imageUrl,
    text,
    access_token: ctx.accessToken,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(
      `Threads image container failed (${res.status}): ${t.slice(0, 240)}`,
    );
  }
  const data = (await res.json()) as ContainerResp;
  return data.id;
}

async function publishContainer(
  ctx: ResolvedThreads,
  containerId: string,
): Promise<string> {
  const url = `${THREADS_BASE}/${ctx.threadsUserId}/threads_publish`;
  const params = new URLSearchParams({
    creation_id: containerId,
    access_token: ctx.accessToken,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(
      `Threads publish failed (${res.status}): ${t.slice(0, 240)}`,
    );
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

function buildUrl(ctx: ResolvedThreads, threadId: string): string {
  // Threads permalinks live under /@username/post/{id}; the public
  // canonical URL also accepts /post/{id} without the handle.
  return ctx.username
    ? `https://www.threads.net/@${ctx.username}/post/${threadId}`
    : `https://www.threads.net/post/${threadId}`;
}

export async function publishThreadsText(args: {
  projectId: string;
  text: string;
}): Promise<ThreadsPublishResult> {
  const text = (args.text ?? '').trim();
  if (!text) throw new Error('Threads post body is empty.');
  if (text.length > 500) {
    throw new Error(`Threads body is ${text.length} chars (over 500).`);
  }
  const ctx = await loadAccess(args.projectId);
  const containerId = await createTextContainer(ctx, text);
  const threadId = await publishContainer(ctx, containerId);
  return { threadId, url: buildUrl(ctx, threadId) };
}

export async function publishThreadsPhoto(args: {
  projectId: string;
  text: string;
  imageUrl: string;
}): Promise<ThreadsPublishResult> {
  if (!args.imageUrl) throw new Error('Threads photo needs an image URL.');
  const text = (args.text ?? '').trim();
  if (text.length > 500) {
    throw new Error(`Threads body is ${text.length} chars (over 500).`);
  }
  const ctx = await loadAccess(args.projectId);
  const containerId = await createImageContainer(ctx, text, args.imageUrl);
  const threadId = await publishContainer(ctx, containerId);
  return { threadId, url: buildUrl(ctx, threadId) };
}

/**
 * Used by the Integrations card. Returns the connected handle + a
 * health flag without attempting to publish.
 */
export async function checkThreadsConnection(projectId: string): Promise<
  | { connected: true; username: string; threadsUserId: string }
  | { connected: false; error: string }
> {
  try {
    const ctx = await loadAccess(projectId);
    return {
      connected: true,
      username: ctx.username,
      threadsUserId: ctx.threadsUserId,
    };
  } catch (e) {
    return {
      connected: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}
