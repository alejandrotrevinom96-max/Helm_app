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
  // PR Sprint D-finish — auto_proceed is only valid on the
  // SEND-MESSAGE endpoint, NOT on create. The create endpoint of
  // HeyGen V3's Video Agent rejects unknown fields with "Extra
  // inputs are not permitted" — that's where my Sprint D-7 fix
  // overshot. Server-side default for chat-mode sessions is to
  // wait for input anyway (the auto-render bug we hit before
  // was actually downstream — first follow-up message dispatched
  // auto_proceed=true by accident, not the create call).
  //
  // For session creation: only set auto_proceed when the caller
  // explicitly wants one-shot (autoProceed=true). Same as the
  // pre-D-7 conditional. For sendAgentMessage we keep the
  // explicit contract — that's where the auto-render actually
  // happens.
  if (input.autoProceed === true) body.auto_proceed = true;
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
  // Same explicit contract as createAgentSession: HeyGen defaults
  // auto_proceed=true server-side. We send it explicitly every
  // time so a "Send feedback" follow-up doesn't accidentally
  // become "Approve & render".
  body.auto_proceed = input.autoProceed === true;
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

// ─────────────────────────────────────────────────────────────
// Text-to-speech — Starfish engine
// ─────────────────────────────────────────────────────────────
//
// POST /v3/voices/speech
// Generates an audio file from text + voice_id. Required when
// we want to pass audio (not a script) downstream — e.g. the
// lipsync endpoint takes audio_url + video_url, not a script.

export interface SpeechResult {
  audio_url: string;
  duration: number | null;
}

interface SpeechResponse {
  audio_url?: string;
  url?: string; // some HeyGen responses use 'url' instead
  duration?: number;
}

export async function generateSpeech(args: {
  script: string;
  voiceId: string;
  locale?: string;
  speed?: number;
}): Promise<
  { ok: true; result: SpeechResult } | { ok: false; error: string }
> {
  const body: Record<string, unknown> = {
    script: args.script,
    voice_id: args.voiceId,
  };
  if (args.locale) body.locale = args.locale;
  if (args.speed) body.speed = args.speed;
  const r = await v3<SpeechResponse>('/voices/speech', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;
  const audioUrl = r.data.audio_url ?? r.data.url ?? null;
  if (!audioUrl) {
    return { ok: false, error: 'Speech response had no audio_url' };
  }
  return {
    ok: true,
    result: { audio_url: audioUrl, duration: r.data.duration ?? null },
  };
}

// ─────────────────────────────────────────────────────────────
// Lipsync — re-render audio on an existing video
// ─────────────────────────────────────────────────────────────

export type LipsyncMode = 'speed' | 'precision';

export interface LipsyncJobView {
  lipsync_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  video_url: string | null;
  caption_url: string | null;
  duration: number | null;
  failure_code: string | null;
  failure_message: string | null;
}

interface LipsyncCreateResponse {
  lipsync_id?: string;
}

export async function createLipsync(args: {
  videoUrl: string;
  audioUrl: string;
  mode?: LipsyncMode;
  title?: string;
  enableCaption?: boolean;
  enableSpeechEnhancement?: boolean;
  callbackId?: string;
}): Promise<
  { ok: true; lipsyncId: string } | { ok: false; error: string }
> {
  const body: Record<string, unknown> = {
    video: { type: 'url', url: args.videoUrl },
    audio: { type: 'url', url: args.audioUrl },
    mode: args.mode ?? 'speed',
    // Captions are table stakes for UGC on muted-by-default
    // social platforms — flip them on by default for every
    // lipsync re-render. Founder can opt out via the UI later.
    enable_caption: args.enableCaption ?? true,
    // Lifts perceived voice quality at no perceptible time
    // cost in our experiments.
    enable_speech_enhancement: args.enableSpeechEnhancement ?? true,
    // Allow HeyGen to stretch / shrink the video to fit the
    // new audio's natural duration. Without this, a longer
    // script gets clipped and a shorter one leaves silence.
    enable_dynamic_duration: true,
  };
  if (args.title) body.title = args.title;
  if (args.callbackId) body.callback_id = args.callbackId;
  const r = await v3<LipsyncCreateResponse>('/lipsyncs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;
  if (!r.data.lipsync_id) {
    return { ok: false, error: 'Lipsync response had no lipsync_id' };
  }
  return { ok: true, lipsyncId: r.data.lipsync_id };
}

export async function getLipsync(
  lipsyncId: string,
): Promise<
  { ok: true; job: LipsyncJobView } | { ok: false; error: string }
> {
  const r = await v3<LipsyncJobView>(
    `/lipsyncs/${encodeURIComponent(lipsyncId)}`,
    { method: 'GET' },
  );
  if (!r.ok) return r;
  return { ok: true, job: r.data };
}

// ─────────────────────────────────────────────────────────────
// Video Translation — V3
// ─────────────────────────────────────────────────────────────
//
// POST /v3/video-translations
//   Translates a video into one or more target languages with
//   voice cloning + lip-sync. Returns one translation_id per
//   language.
//
// GET /v3/video-translations/{id}
//   Polls a single translation job.
//
// GET /v3/video-translations/languages
//   Lists supported target language NAMES (e.g. "Spanish (Spain)",
//   "Portuguese (Brazil)"). HeyGen wants the NAMES, not BCP-47
//   codes — passing 'es-MX' fails.

export type TranslationMode = 'speed' | 'precision';

export interface TranslationJobView {
  video_translation_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  output_language: string | null;
  video_url: string | null;
  caption_url: string | null;
  duration: number | null;
  failure_code: string | null;
  failure_message: string | null;
}

interface TranslationCreateResponse {
  video_translation_ids?: string[];
}

export async function createVideoTranslation(args: {
  videoUrl: string;
  outputLanguages: string[];
  mode?: TranslationMode;
  title?: string;
  enableCaption?: boolean;
  enableSpeechEnhancement?: boolean;
  inputLanguage?: string;
  callbackId?: string;
}): Promise<
  | { ok: true; translationIds: string[] }
  | { ok: false; error: string }
> {
  if (args.outputLanguages.length === 0) {
    return { ok: false, error: 'At least one output language required' };
  }
  const body: Record<string, unknown> = {
    video: { type: 'url', url: args.videoUrl },
    output_languages: args.outputLanguages,
    mode: args.mode ?? 'speed',
    enable_caption: args.enableCaption ?? true,
    enable_speech_enhancement: args.enableSpeechEnhancement ?? true,
    enable_dynamic_duration: true,
  };
  if (args.title) body.title = args.title;
  if (args.inputLanguage) body.input_language = args.inputLanguage;
  if (args.callbackId) body.callback_id = args.callbackId;
  const r = await v3<TranslationCreateResponse>('/video-translations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;
  const ids = r.data.video_translation_ids ?? [];
  if (ids.length === 0) {
    return { ok: false, error: 'Translation response had no IDs' };
  }
  return { ok: true, translationIds: ids };
}

export async function getVideoTranslation(
  translationId: string,
): Promise<
  | { ok: true; job: TranslationJobView }
  | { ok: false; error: string }
> {
  const r = await v3<TranslationJobView>(
    `/video-translations/${encodeURIComponent(translationId)}`,
    { method: 'GET' },
  );
  if (!r.ok) return r;
  return { ok: true, job: r.data };
}

interface LanguagesResponse {
  languages?: string[];
}

export async function listTranslationLanguages(): Promise<
  { ok: true; languages: string[] } | { ok: false; error: string }
> {
  const r = await v3<LanguagesResponse>(
    '/video-translations/languages',
    { method: 'GET' },
  );
  if (!r.ok) return r;
  return { ok: true, languages: r.data.languages ?? [] };
}
