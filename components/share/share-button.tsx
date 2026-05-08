'use client';

// PR #38 — Sprint 6.4: ShareButton.
//
// One button, three behaviors:
//   1. Mobile / browsers with Web Share API → 1 tap fires the OS
//      share sheet. Done — Instagram, Facebook, X, WhatsApp, any
//      installed app, all in one tap.
//   2. User cancels the share sheet → silent (not an error).
//   3. Desktop / browsers without Web Share OR a real share
//      failure → modal with copy / download / per-platform deep
//      links, so the user can still ship in 2 taps.
//
// VARIANTS:
//   - 'primary'   filled accent button — main action surface
//                 (Generate page, post detail modals).
//   - 'secondary' outlined — sits next to other secondary actions.
//   - 'icon'      square icon-only — for tight spots (Library
//                 cards). Tooltip via the title attribute.
//
// HTML CAVEAT:
// LibraryPostCard wraps its whole body in a <button> for card-
// click. Nesting our <button> inside is invalid HTML, but every
// modern browser tolerates it AND the existing card already has
// nested <a> — fixing the wrapper is out of scope. We
// stopPropagation so the card-click doesn't fire on share-click.
import { useState } from 'react';
import {
  Share2,
  Copy,
  Download,
  ExternalLink,
  Check,
  Loader2,
  X,
} from 'lucide-react';
import {
  nativeShare,
  copyToClipboard,
  downloadImage,
  buildShareText,
  getShareCapabilities,
  PLATFORM_COMPOSE_URLS,
  type SharePayload,
} from '@/lib/share/share-handler';

interface ShareButtonProps {
  caption: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  hashtags?: string[];
  variant?: 'primary' | 'secondary' | 'icon';
  className?: string;
  // Optional label override (e.g. for tighter UIs that want
  // "Share post" instead of just "Share").
  label?: string;
}

export function ShareButton({
  caption,
  imageUrl,
  videoUrl,
  hashtags = [],
  variant = 'primary',
  className = '',
  label = 'Share',
}: ShareButtonProps) {
  const [showFallback, setShowFallback] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const payload: SharePayload = {
    caption,
    imageUrl: imageUrl ?? undefined,
    videoUrl: videoUrl ?? undefined,
    hashtags,
  };
  const text = buildShareText(payload);

  const handleShare = async (e: React.MouseEvent) => {
    // LibraryPostCard wraps cards in a <button>. Without this the
    // card-click (open detail modal) fires alongside ours.
    e.stopPropagation();
    e.preventDefault();

    const capabilities = getShareCapabilities();

    if (capabilities.hasNativeShare) {
      setSharing(true);
      const result = await nativeShare(payload);
      setSharing(false);

      if (result.success) return;
      // User canceled the OS share sheet — leave them where they were.
      if (result.error === 'User canceled') return;

      // Real failure (permission denied, etc.) → show fallback so
      // the user still has a way to ship.
      setShowFallback(true);
      return;
    }

    // Desktop without Web Share → straight to fallback modal.
    setShowFallback(true);
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = async () => {
    if (!imageUrl) return;
    const ok = await downloadImage(imageUrl, 'helm-post.png');
    if (ok) {
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    }
  };

  const openPlatform = (url: string) => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Editorial Glass design system: filled accent / outlined / icon-only.
  // These mirror the existing Button component's variants but stay
  // self-contained so we don't pull in @/components/ui/button (which
  // doesn't have an icon-square variant anyway).
  const buttonClass =
    variant === 'primary'
      ? 'inline-flex items-center justify-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap'
      : variant === 'secondary'
        ? 'inline-flex items-center justify-center gap-2 px-4 py-2 bg-bg border border-border text-text-1 rounded-lg text-sm hover:border-accent hover:bg-bg-elev disabled:opacity-50 transition-colors whitespace-nowrap'
        : 'inline-flex items-center justify-center p-2 rounded-lg text-text-2 hover:text-text-1 hover:bg-bg-elev disabled:opacity-50 transition-colors';

  const Icon = sharing ? Loader2 : Share2;
  const iconClass = `w-4 h-4 ${sharing ? 'animate-spin' : ''}`;

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        disabled={sharing}
        className={`${buttonClass} ${className}`}
        title={sharing ? 'Sharing…' : label}
        aria-label={sharing ? 'Sharing…' : label}
      >
        <Icon className={iconClass} />
        {variant !== 'icon' && (
          <span>{sharing ? 'Sharing…' : label}</span>
        )}
      </button>

      {showFallback && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowFallback(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Share post"
        >
          <div
            className="bg-bg-elev border border-border rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-display text-xl">Share this post</h3>
                <p className="text-xs text-text-3 mt-1">
                  Pick where to share or copy the text.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFallback(false)}
                className="text-text-3 hover:text-text-1 p-1"
                aria-label="Close share dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Preview — gives the user confidence about what they're
                about to ship before they click anywhere. */}
            <div className="mb-4 p-3 bg-bg border border-border rounded-lg">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
                Preview
              </div>
              <p className="text-sm text-text-1 whitespace-pre-wrap line-clamp-4">
                {text}
              </p>
              {imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt=""
                  className="mt-2 max-w-full max-h-32 rounded object-cover bg-bg-elev"
                />
              )}
            </div>

            {/* Copy + Download — the universal escape hatch. Works
                even when every platform link is broken. */}
            <div
              className={`grid ${imageUrl ? 'grid-cols-2' : 'grid-cols-1'} gap-2 mb-4`}
            >
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-bg border border-border rounded-lg hover:border-accent text-sm transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy text
                  </>
                )}
              </button>

              {imageUrl && (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2.5 bg-bg border border-border rounded-lg hover:border-accent text-sm transition-colors"
                >
                  {downloaded ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-500" />
                      Saved!
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Download image
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Per-platform open links. Instagram + Facebook can't
                pre-fill from public web; the others do. */}
            <div className="space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
                Open platform
              </div>

              <PlatformLink
                emoji="📷"
                title="Instagram"
                hint="Copy text first, then upload your image"
                onClick={() => openPlatform(PLATFORM_COMPOSE_URLS.instagram)}
              />
              <PlatformLink
                emoji="📘"
                title="Facebook"
                hint="Open Facebook to create your post"
                onClick={() => openPlatform(PLATFORM_COMPOSE_URLS.facebook)}
              />
              <PlatformLink
                emoji="𝕏"
                title="Post to X"
                hint="Pre-filled tweet ready"
                onClick={() => openPlatform(PLATFORM_COMPOSE_URLS.twitter(text))}
              />
              <PlatformLink
                emoji="💼"
                title="LinkedIn"
                hint="Open LinkedIn share dialog"
                onClick={() => openPlatform(PLATFORM_COMPOSE_URLS.linkedin(text))}
              />
              <PlatformLink
                emoji="@"
                title="Threads"
                hint="Pre-filled thread ready"
                onClick={() => openPlatform(PLATFORM_COMPOSE_URLS.threads(text))}
              />
              <PlatformLink
                emoji="💬"
                title="WhatsApp"
                hint="Send to a contact or group"
                onClick={() => openPlatform(PLATFORM_COMPOSE_URLS.whatsapp(text))}
              />
            </div>

            {/* Roadmap teaser — keeps the V3 promise alive without
                blocking what testers can do today. */}
            <div className="mt-5 pt-4 border-t border-border text-xs text-text-3 text-center">
              🚀 Auto-post to Meta is coming in V3
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Small helper so the platform-link rows stay legible. Keeps the
// component file flat without a separate file for a 6-line subview.
function PlatformLink({
  emoji,
  title,
  hint,
  onClick,
}: {
  emoji: string;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 bg-bg border border-border rounded-lg hover:border-accent text-sm transition-colors text-left"
    >
      <span className="text-lg w-6 text-center" aria-hidden>
        {emoji}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-text-1">{title}</div>
        <div className="text-xs text-text-3 truncate">{hint}</div>
      </div>
      <ExternalLink className="w-4 h-4 text-text-3 shrink-0" />
    </button>
  );
}
