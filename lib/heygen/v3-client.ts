// PR Sprint D-2 — HeyGen V3 Video Agent client.
//
// Wraps the V3 endpoints we need for chat-mode interactive
// sessions. V3 is the new paradigm: founder sends a prompt, the
// agent picks avatar + voice + writes script + composes scenes
// (or accepts overrides), pauses at a storyboard checkpoint, and
// renders after approval.
//
// V2 (lib/heygen/fire.ts) stays untouched — it powers the
// existing /marketing/generate UGC A/B flow where the founder
// already picked an avatar + script. V3 powers a NEW surface:
// /marketing/studio.
//
// Docs:
//   POST /v3/video-agents             create session
//   GET  /v3/video-agents/{id}        poll status + messages
//   POST /v3/video-agents/{id}        send follow-up
//   POST /v3/video-agents/{id}/stop   cancel an in-progress run
//   GET  /v3/video-agents/{id}/resources/{rid}  fetch storyboard / draft / etc
//   GET  /v3/video-agents/styles      list visual styles
//   GET  /v3/videos/{id}              final video status

const HEYGEN_V3_BASE = 'https://api.heygen.com/v3';

function apiKey(): string | null {
  return process.env.HEYGEN_API_KEY?.trim() || null;
}

interface HeygenError {
  code?: string;
  message?: string;
}

interface HeygenEnvelope<T> {
  data?: T;
  error?: HeygenError | null;
  message?: string;
}

// ─────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────

export type SessionStatus =
  | 'thinking'
  | 'waiting_for_input'
  | 'reviewing'
  | 'generating'
  | 'completed'
  | 'failed';

export interface AgentMessage {
  role: 'user' | 'model';
  content: string;
  type: 'text' | 'resource' | 'error';
  created_at: number | null;
  resource_ids: string[] | null;
}

export interface AgentSession {
  session_id: string;
  status: SessionStatus;
  progress?: number;
  title?: string | null;
  video_id?: string | null;
  created_at?: number;
  messages?: AgentMessage[];
}

export interface AgentResource {
  resource_id: string;
  resource_type: string; // 'image' | 'video' | 'draft' | 'avatar' | 'voice'
  source_type: string | null;
  url: string | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  created_at: number | null;
  metadata: Record<string, unknown> | null;
}

export interface VideoAgentStyle {
  style_id: string;
  name: string;
  thumbnail_url: string | null;
  preview_video_url: string | null;
  tags: string[];
  aspect_ratio: '16:9' | '9:16' | '1:1' | null;
}

export interface FinalVideo {
  id: string;
  title: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  video_url: string | null;
  thumbnail_url: string | null;
  gif_url: string | null;
  captioned_video_url: string | null;
  subtitle_url: string | null;
  duration: number | null;
  created_at: number | null;
  completed_at: number | null;
  failure_code: string | null;
  failure_message: string | null;
}

// ─────────────────────────────────────────────────────────────
// Low-level fetch helper
// ─────────────────────────────────────────────────────────────

async function v3<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) {
    return { ok: false, error: 'HEYGEN_API_KEY not configured' };
  }
  try {
    const res = await fetch(`${HEYGEN_V3_BASE}${path}`, {
      ...init,
      headers: {
        'x-api-key': key,
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as HeygenEnvelope<T>;
    if (!res.ok || body.error) {
      const msg =
        body.error?.message ??
        body.message ??
        `HeyGen V3 returned HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    if (!body.data) {
      return { ok: false, error: 'HeyGen V3 returned empty data' };
    }
    return { ok: true, data: body.data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'V3 request failed',
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Create / message / get / stop sessions
// ─────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  prompt: string;
  mode?: 'generate' | 'chat';
  avatarId?: string | null;
  voiceId?: string | null;
  styleId?: string | null;
  orientation?: 'landscape' | 'portrait';
  files?: Array<
    | { type: 'url'; url: string }
    | { type: 'asset_id'; asset_id: string }
    | { type: 'base64'; media_type: string; data: string }
  >;
  autoProceed?: boolean;
  callbackUrl?: string;
  callbackId?: string;
}

export async function createAgentSession(
  input: CreateSessionInput,
): Promise<
  | { ok: true; session: AgentSession }
  | { ok: false; error: string }
> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
  };
  if (input.mode) body.mode = input.mode;
  if (input.avatarId) body.avatar_id = input.avatarId;
  if (input.voiceId) body.voice_id = input.voiceId;
  if (input.styleId) body.style_id = input.styleId;
  if (input.orientation) body.orientation = input.orientation;
  if (input.files && input.files.length > 0) body.files = input.files;
  if (input.autoProceed) body.auto_proceed = input.autoProceed;
  if (input.callbackUrl) body.callback_url = input.callbackUrl;
  if (input.callbackId) body.callback_id = input.callbackId;
  const r = await v3<AgentSession>('/video-agents', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;
  return { ok: true, session: r.data };
}

export async function getAgentSession(
  sessionId: string,
): Promise<
  | { ok: true; session: AgentSession }
  | { ok: false; error: string }
> {
  const r = await v3<AgentSession>(
    `/video-agents/${encodeURIComponent(sessionId)}`,
    { method: 'GET' },
  );
  if (!r.ok) return r;
  return { ok: true, session: r.data };
}

export interface SendMessageInput {
  message: string;
  avatarId?: string | null;
  voiceId?: string | null;
  autoProceed?: boolean;
}

export async function sendAgentMessage(
  sessionId: string,
  input: SendMessageInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body: Record<string, unknown> = { message: input.message };
  if (input.avatarId) body.avatar_id = input.avatarId;
  if (input.voiceId) body.voice_id = input.voiceId;
  if (input.autoProceed) body.auto_proceed = input.autoProceed;
  // The endpoint returns { session_id, run_id, title }; we don't
  // need those fields here — the next GET will surface the new
  // model message. Just confirm 200.
  const r = await v3<Record<string, unknown>>(
    `/video-agents/${encodeURIComponent(sessionId)}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!r.ok) return r;
  return { ok: true };
}

export async function stopAgentSession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await v3<Record<string, unknown>>(
    `/video-agents/${encodeURIComponent(sessionId)}/stop`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (!r.ok) return r;
  return { ok: true };
}

export async function getAgentResource(
  sessionId: string,
  resourceId: string,
): Promise<
  | { ok: true; resource: AgentResource }
  | { ok: false; error: string }
> {
  const r = await v3<AgentResource>(
    `/video-agents/${encodeURIComponent(sessionId)}/resources/${encodeURIComponent(resourceId)}`,
    { method: 'GET' },
  );
  if (!r.ok) return r;
  return { ok: true, resource: r.data };
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

export type StyleTag =
  | 'cinematic'
  | 'retro-tech'
  | 'iconic-artist'
  | 'pop-culture'
  | 'handmade'
  | 'print';

interface StylesListResponse {
  data?: VideoAgentStyle[];
  has_more?: boolean;
  next_token?: string;
}

export async function listAgentStyles(opts?: {
  tag?: StyleTag;
  limit?: number;
  token?: string;
}): Promise<
  | { ok: true; styles: VideoAgentStyle[]; nextToken?: string }
  | { ok: false; error: string }
> {
  const key = apiKey();
  if (!key) return { ok: false, error: 'HEYGEN_API_KEY not configured' };
  const params = new URLSearchParams();
  if (opts?.tag) params.set('tag', opts.tag);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.token) params.set('token', opts.token);
  const url = `${HEYGEN_V3_BASE}/video-agents/styles${params.size > 0 ? `?${params.toString()}` : ''}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': key, accept: 'application/json' },
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `HeyGen /v3/video-agents/styles returned HTTP ${res.status}`,
      };
    }
    const body = (await res.json().catch(() => ({}))) as StylesListResponse;
    return {
      ok: true,
      styles: body.data ?? [],
      nextToken: body.next_token,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Styles list failed',
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Final video poll
// ─────────────────────────────────────────────────────────────

export async function getFinalVideo(
  videoId: string,
): Promise<
  | { ok: true; video: FinalVideo }
  | { ok: false; error: string }
> {
  const r = await v3<FinalVideo>(
    `/videos/${encodeURIComponent(videoId)}`,
    { method: 'GET' },
  );
  if (!r.ok) return r;
  return { ok: true, video: r.data };
}
