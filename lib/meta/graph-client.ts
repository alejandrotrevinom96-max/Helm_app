// PR #29 — Sprint 5.1: Auto-posting Meta foundation.
//
// Thin client around Meta's Graph API. We use v21.0 (released
// Nov 2024) — current minimum supported by IG content publishing.
//
// Endpoints we actually use:
//   - /me, /me/accounts                                (OAuth bootstrap)
//   - /oauth/access_token                              (long-lived swap)
//   - /<page-id>/feed, /<page-id>/photos               (FB Page posts)
//   - /<page-id>/<post-id>?fields=permalink_url        (FB permalink)
//   - /<ig-id>/media, /<ig-id>/media_publish           (IG container 2-step)
//   - /<media-id>?fields=permalink                     (IG permalink)
//
// Errors come back as { error: { code, message, type, is_transient } }.
// MetaApiError wraps the code so the publisher can distinguish retry-
// worthy failures (rate limits, transient outages) from permanent
// ones (auth, content rejection).
const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaErrorPayload {
  code?: number;
  error_subcode?: number;
  message?: string;
  type?: string;
  is_transient?: boolean;
  fbtrace_id?: string;
}

// Error codes Meta documents as transient. Source: Graph API error
// reference. Don't blindly retry every transient — but these are safe
// for exponential backoff inside the cron worker.
const TRANSIENT_CODES = new Set<number>([
  1, // unknown error
  2, // service temporarily unavailable
  4, // app rate limit
  17, // user rate limit
  32, // page rate limit
  613, // calls to this api have exceeded the rate limit
]);

export class MetaApiError extends Error {
  code: number;
  isTransient: boolean;
  fbtraceId?: string;

  constructor(payload: MetaErrorPayload) {
    super(payload.message ?? 'Meta API error');
    this.code = payload.code ?? 0;
    this.isTransient =
      payload.is_transient === true || TRANSIENT_CODES.has(this.code);
    this.fbtraceId = payload.fbtrace_id;
  }
}

export class MetaGraphClient {
  constructor(private accessToken: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${GRAPH_BASE_URL}${path}`;
    // We pass the token in the URL because some Meta endpoints reject
    // Authorization headers (specifically the form-encoded ones used
    // by /media_publish). Consistency wins over Authorization purity.
    const sep = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${sep}access_token=${encodeURIComponent(
      this.accessToken
    )}`;

    const response = await fetch(fullUrl, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new MetaApiError({
        message: `HTTP ${response.status} (non-JSON response)`,
      });
    }

    if (!response.ok || (data as { error?: unknown })?.error) {
      const err = (data as { error?: MetaErrorPayload })?.error ?? {
        message: `HTTP ${response.status}`,
      };
      throw new MetaApiError(err);
    }
    return data as T;
  }

  // ============ OAUTH BOOTSTRAP ============

  async getMe(): Promise<{ id: string; name: string }> {
    return this.request('/me?fields=id,name');
  }

  async getPages(): Promise<{
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string };
    }>;
  }> {
    return this.request(
      '/me/accounts?fields=id,name,access_token,instagram_business_account'
    );
  }

  async getInstagramBusinessAccount(igBusinessId: string): Promise<{
    id: string;
    username: string;
    name?: string;
  }> {
    return this.request(`/${igBusinessId}?fields=id,username,name`);
  }

  // Exchange short-lived (1h) token for long-lived (60d). MUST run
  // immediately after the OAuth code exchange — short tokens die fast.
  async exchangeForLongLivedToken(
    shortLivedToken: string,
    appId: string,
    appSecret: string
  ): Promise<{
    access_token: string;
    token_type: string;
    expires_in?: number;
  }> {
    const url = new URL(`${GRAPH_BASE_URL}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('fb_exchange_token', shortLivedToken);
    const response = await fetch(url.toString());
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new MetaApiError(data.error ?? { message: 'Token exchange failed' });
    }
    return data;
  }

  // ============ FACEBOOK PAGE POSTING ============

  async postTextToPage(
    pageId: string,
    message: string
  ): Promise<{ id: string }> {
    return this.request(`/${pageId}/feed`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  async postImageToPage(
    pageId: string,
    imageUrl: string,
    message?: string
  ): Promise<{ id: string; post_id?: string }> {
    return this.request(`/${pageId}/photos`, {
      method: 'POST',
      body: JSON.stringify({ url: imageUrl, caption: message ?? '' }),
    });
  }

  async getFacebookPostPermalink(
    fbPostId: string
  ): Promise<{ permalink_url: string }> {
    return this.request(`/${fbPostId}?fields=permalink_url`);
  }

  // ============ INSTAGRAM BUSINESS POSTING ============
  // Two-step: create a media container, wait for FINISHED status,
  // then call /media_publish.

  async createInstagramContainer(
    igBusinessId: string,
    imageUrl: string,
    caption?: string
  ): Promise<{ id: string }> {
    return this.request(`/${igBusinessId}/media`, {
      method: 'POST',
      body: JSON.stringify({
        image_url: imageUrl,
        caption: caption ?? '',
      }),
    });
  }

  // Container processing is async on Meta's side. status_code goes
  // through IN_PROGRESS → FINISHED (or ERROR / EXPIRED). We poll
  // briefly so we don't /media_publish too early.
  async getInstagramContainerStatus(containerId: string): Promise<{
    status_code: 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';
  }> {
    return this.request(`/${containerId}?fields=status_code`);
  }

  async publishInstagramContainer(
    igBusinessId: string,
    containerId: string
  ): Promise<{ id: string }> {
    return this.request(`/${igBusinessId}/media_publish`, {
      method: 'POST',
      body: JSON.stringify({ creation_id: containerId }),
    });
  }

  async getInstagramMediaPermalink(
    mediaId: string
  ): Promise<{ permalink: string }> {
    return this.request(`/${mediaId}?fields=permalink`);
  }

  // ============ INSTAGRAM CAROUSEL (PR #65 — Sprint 7.0.8) ============
  // Three-step posting:
  //   1. For each slide image, create a child container with
  //      is_carousel_item=true (no caption — the parent carries it).
  //   2. Create a parent container with media_type=CAROUSEL and
  //      children=<comma-separated child container ids>.
  //   3. /media_publish on the parent (same endpoint as single
  //      feed posts).
  //
  // Meta requires 2-10 slides; we enforce 2-8 upstream to leave
  // headroom (Reel + Story flags don't compose with carousels).
  // Container processing for each child is async like feed posts,
  // but the parent container's FINISHED status implies every child
  // is ready — so we only poll the parent.

  async createInstagramCarouselItemContainer(
    igBusinessId: string,
    imageUrl: string,
  ): Promise<{ id: string }> {
    return this.request(`/${igBusinessId}/media`, {
      method: 'POST',
      body: JSON.stringify({
        image_url: imageUrl,
        is_carousel_item: true,
      }),
    });
  }

  async createInstagramCarouselContainer(
    igBusinessId: string,
    childContainerIds: string[],
    caption?: string,
  ): Promise<{ id: string }> {
    return this.request(`/${igBusinessId}/media`, {
      method: 'POST',
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        // Graph API expects the children list as a comma-separated
        // string, NOT a JSON array — fight the obvious shape here.
        children: childContainerIds.join(','),
        caption: caption ?? '',
      }),
    });
  }

  // ============ INSTAGRAM STORIES ============
  // Same 2-step pattern as feed posts (container → media_publish),
  // but the container is created with media_type=STORIES. Only image
  // stories ship in PR #30 — video stories share the API surface but
  // need extra polling and metadata, deferred to Sprint 5.3 (Reels).
  //
  // Caveats baked into the integration's design:
  //   - 9:16 aspect ratio recommended; non-9:16 images get center-
  //     cropped or fit with bars by IG.
  //   - The story permalink is valid for ~24h; after that the URL
  //     can 404 unless the founder archived the story manually.
  //   - No text overlay via API — caption gets posted as the first
  //     comment instead, which IG renders as a tappable sticker.

  async createInstagramStoryContainer(
    igBusinessId: string,
    imageUrl: string
  ): Promise<{ id: string }> {
    return this.request(`/${igBusinessId}/media`, {
      method: 'POST',
      body: JSON.stringify({
        image_url: imageUrl,
        media_type: 'STORIES',
      }),
    });
  }

  async publishInstagramStory(
    igBusinessId: string,
    containerId: string
  ): Promise<{ id: string }> {
    // /media_publish is the same endpoint feed posts use — the
    // STORIES type lives on the container, not the publish call.
    return this.request(`/${igBusinessId}/media_publish`, {
      method: 'POST',
      body: JSON.stringify({ creation_id: containerId }),
    });
  }

  async getInstagramStoryPermalink(
    mediaId: string
  ): Promise<{ permalink: string }> {
    return this.request(`/${mediaId}?fields=permalink`);
  }

  // ============ INSTAGRAM REELS ============
  // Reels diverge from feed/stories because Meta processes the video
  // ASYNCHRONOUSLY. The flow is:
  //   1. createInstagramReelContainer  → returns a container_id
  //   2. (Meta processes the video)    → ~30–90s, sometimes longer
  //   3. getInstagramReelStatus polls  → wait for FINISHED
  //   4. publishInstagramReel          → actually posts
  //
  // share_to_feed=true makes the Reel appear in both the Reels tab
  // AND the regular feed — by default IG only shows it in the Reels
  // tab, which is much lower reach for most accounts.

  async createInstagramReelContainer(
    igBusinessId: string,
    videoUrl: string,
    caption?: string
  ): Promise<{ id: string }> {
    return this.request(`/${igBusinessId}/media`, {
      method: 'POST',
      body: JSON.stringify({
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption ?? '',
        share_to_feed: true,
      }),
    });
  }

  // Reels container processing has its own status_code values. Same
  // endpoint shape as the regular IG container status, broader enum.
  async getInstagramReelStatus(containerId: string): Promise<{
    status_code:
      | 'IN_PROGRESS'
      | 'FINISHED'
      | 'ERROR'
      | 'EXPIRED'
      | 'PUBLISHED';
    status?: string;
  }> {
    return this.request(`/${containerId}?fields=status_code,status`);
  }

  async publishInstagramReel(
    igBusinessId: string,
    containerId: string
  ): Promise<{ id: string }> {
    // Same /media_publish endpoint feed posts use; the difference
    // lives on the container's media_type.
    return this.request(`/${igBusinessId}/media_publish`, {
      method: 'POST',
      body: JSON.stringify({ creation_id: containerId }),
    });
  }

  async getInstagramReelPermalink(
    mediaId: string
  ): Promise<{ permalink: string }> {
    return this.request(`/${mediaId}?fields=permalink`);
  }

  // ============ HEALTH CHECK ============

  async validateToken(): Promise<boolean> {
    try {
      await this.getMe();
      return true;
    } catch {
      return false;
    }
  }
}
