// PR #66 — Sprint 7.0.9: LinkedIn UGC publishing.
//
// Three publish paths today:
//   - text — pure text post via /v2/ugcPosts with NONE media category
//   - image — single-image post: register-upload → PUT bytes → post
//   - "carousel" — LinkedIn doesn't have a feed-image carousel like
//     IG. Real carousels require document uploads (PDF), which is
//     a separate API surface + asset pipeline. For now we publish
//     a single-image post using the first slide + describe the
//     remaining slides honestly in the copy. Sprint 7.0.10+ can
//     wire PDF carousels properly.
//
// Token resolution: we lazy-load + decrypt per call. Cheap, and it
// means a token rotation (e.g. user reconnected mid-session) takes
// effect immediately.
import { db } from '@/lib/db';
import { linkedinIntegrations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { decryptToken } from '@/lib/crypto/token-encryption';

export interface LinkedInPublishResult {
  postUrn: string;
  url: string;
}

interface ResolvedIntegration {
  accessToken: string;
  authorUrn: string;
  scopes: string[];
}

async function loadIntegration(projectId: string): Promise<ResolvedIntegration> {
  const [row] = await db
    .select()
    .from(linkedinIntegrations)
    .where(eq(linkedinIntegrations.projectId, projectId))
    .limit(1);
  if (!row) {
    throw new Error(
      'LinkedIn not connected for this project. Connect at /integrations.',
    );
  }
  if (row.tokenExpiresAt && new Date(row.tokenExpiresAt) < new Date()) {
    throw new Error(
      'LinkedIn token expired. Re-connect at /integrations.',
    );
  }
  const scopes = Array.isArray(row.scopes) ? (row.scopes as string[]) : [];
  if (!scopes.includes('w_member_social')) {
    throw new Error(
      'LinkedIn connection is missing the w_member_social scope. Re-connect to grant posting permission.',
    );
  }
  let accessToken: string;
  try {
    accessToken = decryptToken(row.accessTokenEncrypted);
  } catch {
    throw new Error('LinkedIn token decryption failed — re-connect.');
  }
  return {
    accessToken,
    authorUrn: `urn:li:person:${row.linkedinUserId}`,
    scopes,
  };
}

async function stampLastUsed(projectId: string): Promise<void> {
  await db
    .update(linkedinIntegrations)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(linkedinIntegrations.projectId, projectId));
}

function buildUgcUrl(postUrn: string): string {
  // urns look like "urn:li:share:123" — the activity feed URL
  // accepts the urn as-is in the path.
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`;
}

async function callLinkedIn<T>(
  accessToken: string,
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('X-Restli-Protocol-Version', '2.0.0');
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`https://api.linkedin.com${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LinkedIn ${path} → ${res.status}: ${text.slice(0, 240)}`);
  }
  // Some endpoints return 201 No Content; tolerate empty bodies.
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function publishLinkedInText(args: {
  projectId: string;
  text: string;
  visibility?: 'PUBLIC' | 'CONNECTIONS';
}): Promise<LinkedInPublishResult> {
  const text = (args.text ?? '').trim();
  if (!text) throw new Error('LinkedIn text post is empty.');
  // LinkedIn enforces ~3000 chars; 1500 is a saner cap we already
  // surface in the structured-draft prompt.
  if (text.length > 3000) {
    throw new Error(`LinkedIn text post is ${text.length} chars (over 3000).`);
  }
  const { accessToken, authorUrn } = await loadIntegration(args.projectId);
  const body = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': args.visibility ?? 'PUBLIC',
    },
  };
  const result = await callLinkedIn<{ id: string }>(
    accessToken,
    '/v2/ugcPosts',
    { method: 'POST', json: body },
  );
  await stampLastUsed(args.projectId);
  return { postUrn: result.id, url: buildUgcUrl(result.id) };
}

export async function publishLinkedInImage(args: {
  projectId: string;
  text: string;
  imageUrl: string;
  altText?: string;
  visibility?: 'PUBLIC' | 'CONNECTIONS';
}): Promise<LinkedInPublishResult> {
  if (!args.imageUrl) throw new Error('LinkedIn image post needs an image URL.');
  const { accessToken, authorUrn } = await loadIntegration(args.projectId);

  // Step 1: register the upload — LinkedIn returns a presigned URL
  // and an asset URN we'll attach to the post.
  type RegisterResp = {
    value: {
      uploadMechanism: {
        'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
          uploadUrl: string;
        };
      };
      asset: string;
    };
  };
  const reg = await callLinkedIn<RegisterResp>(
    accessToken,
    '/v2/assets?action=registerUpload',
    {
      method: 'POST',
      json: {
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: authorUrn,
          serviceRelationships: [
            {
              relationshipType: 'OWNER',
              identifier: 'urn:li:userGeneratedContent',
            },
          ],
        },
      },
    },
  );
  const uploadUrl =
    reg.value.uploadMechanism[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ].uploadUrl;
  const assetUrn = reg.value.asset;

  // Step 2: fetch the image bytes (Supabase / fal.ai public URL) and
  // POST them to LinkedIn's presigned upload URL.
  const blobRes = await fetch(args.imageUrl);
  if (!blobRes.ok) {
    throw new Error(
      `Failed to fetch source image (${blobRes.status}): ${args.imageUrl}`,
    );
  }
  const buf = await blobRes.arrayBuffer();
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: buf,
  });
  if (!uploadRes.ok) {
    const t = await uploadRes.text();
    throw new Error(
      `LinkedIn image upload failed (${uploadRes.status}): ${t.slice(0, 200)}`,
    );
  }

  // Step 3: create the post pointing at the uploaded asset.
  const post = await callLinkedIn<{ id: string }>(
    accessToken,
    '/v2/ugcPosts',
    {
      method: 'POST',
      json: {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: (args.text ?? '').trim() },
            shareMediaCategory: 'IMAGE',
            media: [
              {
                status: 'READY',
                description: { text: args.altText ?? '' },
                media: assetUrn,
                title: { text: '' },
              },
            ],
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility':
            args.visibility ?? 'PUBLIC',
        },
      },
    },
  );
  await stampLastUsed(args.projectId);
  return { postUrn: post.id, url: buildUgcUrl(post.id) };
}

/**
 * Carousel-style on LinkedIn. We intentionally publish as a SINGLE
 * image post using the first slide + a structured copy that lists
 * the remaining slide titles. Real LinkedIn carousels need a PDF
 * document upload (different API surface + asset pipeline) — that
 * lands in a later sprint. Honest now beats fake-carousel later.
 */
export async function publishLinkedInCarousel(args: {
  projectId: string;
  coverCopy: string;
  imageUrls: string[];
  slideTitles?: string[];
}): Promise<LinkedInPublishResult> {
  if (!args.imageUrls || args.imageUrls.length === 0) {
    throw new Error('LinkedIn carousel needs at least one slide image.');
  }
  const first = args.imageUrls[0];
  const tail = args.slideTitles && args.slideTitles.length > 1
    ? `\n\n— More in carousel —\n${args.slideTitles
        .slice(1)
        .map((t, i) => `${i + 2}. ${t}`)
        .join('\n')}`
    : '';
  return publishLinkedInImage({
    projectId: args.projectId,
    text: `${args.coverCopy.trim()}${tail}`.trim(),
    imageUrl: first,
    altText: args.slideTitles?.[0] ?? '',
  });
}
