'use client';

// PR #60 — Sprint 7.0.4: render one structured draft.
//
// One card per (platform, contentType) pair. The card dispatches to a
// sub-view based on the type so a Reel renders differently than a
// LinkedIn essay. Sub-views are dumb — they read fields off the
// structured payload, no fetching, no mutation.
//
// We keep this in components/marketing/ (new folder) instead of the
// existing app/(dashboard)/marketing/draft-card.tsx so the legacy
// Haiku-pillar-variants flow stays untouched.
import { useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';

interface Props {
  platform: string;
  contentType: string;
  displayName: string;
  structuredContent: Record<string, unknown> | null;
  error?: string;
  draftId?: string;
}

export function StructuredDraftCard({
  platform,
  contentType,
  displayName,
  structuredContent,
  error,
  draftId,
}: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!structuredContent) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(structuredContent, null, 2),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — no-op */
    }
  };

  return (
    <GlassCard className="p-5">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-text-3/15 text-text-2">
              {platform}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
              {contentType.replace(/_/g, ' ')}
            </span>
          </div>
          <h3 className="font-display text-lg font-light">{displayName}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!structuredContent}
            className="text-xs font-mono text-text-3 hover:text-text-1 disabled:opacity-50"
          >
            {copied ? 'Copied ✓' : 'Copy JSON'}
          </button>
          {draftId && (
            <span className="text-[10px] font-mono text-text-3 hidden md:inline">
              id:{draftId.slice(0, 8)}
            </span>
          )}
        </div>
      </header>

      {error ? (
        <div className="p-3 border border-danger/30 bg-danger/10 rounded text-sm text-danger">
          Generation failed: {error}
        </div>
      ) : !structuredContent ? (
        <div className="text-sm text-text-3">Empty draft.</div>
      ) : (
        <DraftBody contentType={contentType} payload={structuredContent} />
      )}
    </GlassCard>
  );
}

function DraftBody({
  contentType,
  payload,
}: {
  contentType: string;
  payload: Record<string, unknown>;
}) {
  switch (contentType) {
    case 'reel':
      return <ReelView payload={payload} />;
    case 'carousel':
      return <CarouselView payload={payload} />;
    case 'photo':
    case 'single_image':
      return <PhotoView payload={payload} />;
    case 'ugc':
      return <UgcView payload={payload} />;
    case 'community_post':
      return <CommunityPostView payload={payload} />;
    case 'text_post':
      return <TextPostView payload={payload} />;
    case 'self_post':
      return <RedditSelfPostView payload={payload} />;
    case 'link_post':
      return <RedditLinkPostView payload={payload} />;
    case 'single_tweet':
      return <SingleTweetView payload={payload} />;
    case 'thread':
      return <ThreadView payload={payload} />;
    default:
      return <FallbackView payload={payload} />;
  }
}

// ----- helpers ---------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
      {children}
    </div>
  );
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}
function asObjectArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
    : [];
}

// ----- sub-views -------------------------------------------------------------

function ReelView({ payload }: { payload: Record<string, unknown> }) {
  const hook = asString(payload.hook);
  const beats = asObjectArray(payload.beats);
  const onScreen = asStringArray(payload.onScreenText);
  const audio = asString(payload.audioSuggestion);
  const caption = asString(payload.caption);
  return (
    <div className="space-y-4">
      <div>
        <Label>Hook (first 3s)</Label>
        <p className="text-sm italic text-text-1">{hook}</p>
      </div>
      {beats.length > 0 && (
        <div>
          <Label>Beats</Label>
          <ol className="space-y-2">
            {beats.map((b, i) => (
              <li key={i} className="text-sm text-text-1">
                <span className="font-mono text-text-3 mr-2">
                  {asString(b.duration) || `${i + 1}.`}
                </span>
                {asString(b.visual)}
                {asString(b.audio) && (
                  <div className="text-xs text-text-3 ml-7">🎵 {asString(b.audio)}</div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {onScreen.length > 0 && (
        <div>
          <Label>On-screen text</Label>
          <div className="flex flex-wrap gap-2">
            {onScreen.map((t, i) => (
              <span key={i} className="px-2 py-1 bg-bg-elev rounded text-xs">
                &ldquo;{t}&rdquo;
              </span>
            ))}
          </div>
        </div>
      )}
      {audio && (
        <div>
          <Label>Audio</Label>
          <p className="text-sm text-text-1">{audio}</p>
        </div>
      )}
      {caption && (
        <div>
          <Label>Caption ({caption.length} chars)</Label>
          <p className="text-sm whitespace-pre-wrap text-text-1">{caption}</p>
        </div>
      )}
    </div>
  );
}

function CarouselView({ payload }: { payload: Record<string, unknown> }) {
  const slides = asObjectArray(payload.slides);
  const caption = asString(payload.caption) || asString(payload.coverCopy);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {slides.map((s, i) => {
          const role = asString(s.role) || 'slide';
          return (
            <div key={i} className="p-3 bg-bg-elev rounded text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                  Slide {i + 1}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
                  {role}
                </span>
              </div>
              <div className="font-medium text-text-1">{asString(s.title)}</div>
              {asString(s.body) && (
                <div className="text-xs text-text-2 mt-1">{asString(s.body)}</div>
              )}
            </div>
          );
        })}
      </div>
      {caption && (
        <div>
          <Label>Caption</Label>
          <p className="text-sm whitespace-pre-wrap text-text-1">{caption}</p>
        </div>
      )}
    </div>
  );
}

function PhotoView({ payload }: { payload: Record<string, unknown> }) {
  const direction = asString(payload.imageDirection);
  const caption = asString(payload.caption) || asString(payload.copy);
  return (
    <div className="space-y-4">
      {direction && (
        <div>
          <Label>Image direction</Label>
          <p className="text-sm italic text-text-1">{direction}</p>
        </div>
      )}
      {caption && (
        <div>
          <Label>Caption ({caption.length} chars)</Label>
          <p className="text-sm whitespace-pre-wrap text-text-1">{caption}</p>
        </div>
      )}
    </div>
  );
}

function UgcView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Opening</Label>
        <p className="text-sm italic text-text-1">{asString(payload.opening)}</p>
      </div>
      <div>
        <Label>Body</Label>
        <p className="text-sm whitespace-pre-wrap text-text-1">{asString(payload.body)}</p>
      </div>
      <div>
        <Label>Closing</Label>
        <p className="text-sm text-text-1">{asString(payload.closing)}</p>
      </div>
      {asString(payload.recommendedDuration) && (
        <div className="text-[11px] font-mono text-text-3">
          Duration: {asString(payload.recommendedDuration)}
        </div>
      )}
    </div>
  );
}

function CommunityPostView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Opening</Label>
        <p className="text-sm text-text-1">{asString(payload.opening)}</p>
      </div>
      <div>
        <Label>Body</Label>
        <p className="text-sm whitespace-pre-wrap text-text-1">{asString(payload.body)}</p>
      </div>
      <div>
        <Label>Closing</Label>
        <p className="text-sm text-text-1">{asString(payload.closing)}</p>
      </div>
    </div>
  );
}

function TextPostView({ payload }: { payload: Record<string, unknown> }) {
  const hook = asString(payload.hook);
  const bodyParas = asStringArray(payload.body);
  const cta = asString(payload.cta);
  return (
    <div className="space-y-3">
      {hook && (
        <div className="text-base italic text-text-1">{hook}</div>
      )}
      {bodyParas.map((p, i) => (
        <p key={i} className="text-sm text-text-1">
          {p}
        </p>
      ))}
      {cta && (
        <p className="text-sm text-text-2 italic border-l-2 border-accent/40 pl-3">
          {cta}
        </p>
      )}
    </div>
  );
}

function RedditSelfPostView({ payload }: { payload: Record<string, unknown> }) {
  const title = asString(payload.title);
  const body = asString(payload.body);
  const tldr = asString(payload.optionalTldr);
  return (
    <div className="space-y-3">
      <div>
        <Label>Title ({title.length} chars)</Label>
        <p className="text-sm font-medium text-text-1">{title}</p>
      </div>
      <div>
        <Label>Body</Label>
        <p className="text-sm whitespace-pre-wrap text-text-1">{body}</p>
      </div>
      {tldr && (
        <div>
          <Label>TL;DR</Label>
          <p className="text-sm italic text-text-2">{tldr}</p>
        </div>
      )}
    </div>
  );
}

function RedditLinkPostView({ payload }: { payload: Record<string, unknown> }) {
  const title = asString(payload.title);
  const comment = asString(payload.optionalComment);
  return (
    <div className="space-y-3">
      <div>
        <Label>Title</Label>
        <p className="text-sm font-medium text-text-1">{title}</p>
      </div>
      {comment && (
        <div>
          <Label>Optional context comment</Label>
          <p className="text-sm whitespace-pre-wrap text-text-1">{comment}</p>
        </div>
      )}
    </div>
  );
}

function SingleTweetView({ payload }: { payload: Record<string, unknown> }) {
  const content = asString(payload.content);
  return (
    <div className="space-y-1">
      <p className="text-sm whitespace-pre-wrap text-text-1">{content}</p>
      <p className="text-[11px] font-mono text-text-3">
        {content.length} / 280 chars
      </p>
    </div>
  );
}

function ThreadView({ payload }: { payload: Record<string, unknown> }) {
  const tweets = asStringArray(payload.tweets);
  return (
    <div className="space-y-2">
      {tweets.map((t, i) => (
        <div key={i} className="p-3 bg-bg-elev rounded">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3 mb-1">
            {i + 1} / {tweets.length}
          </div>
          <p className="text-sm text-text-1">{t}</p>
          <p className="text-[11px] font-mono text-text-3 mt-1">{t.length} / 280</p>
        </div>
      ))}
    </div>
  );
}

function FallbackView({ payload }: { payload: Record<string, unknown> }) {
  return (
    <pre className="text-xs font-mono text-text-2 bg-bg-elev p-3 rounded overflow-x-auto">
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}
