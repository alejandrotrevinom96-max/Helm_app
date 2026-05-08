'use client';

// PR #42 — Sprint 6.7: in-app toast.
//
// Why a tiny custom one and not react-hot-toast / sonner: this is
// a single-emit feedback channel for "voted, scheduled, copied"
// — no queueing, stacking, or promise integration is needed yet.
// Pulling a 5KB+ dep + its providers wasn't worth it. If we ever
// need promise toasts or undo actions, swap to sonner.
//
// Architecture: a singleton store of toast messages + a render
// component that subscribes. `showToast()` is callable from any
// client component (handlers, useEffect) without prop-drilling a
// dispatcher. The container mounts once in app/layout.tsx and
// renders fixed bottom-right.
//
// Auto-dismiss is timer-based; interrupting the timer is not
// supported (no "user hovered, pause") because none of our
// flows need it. KISS.
import { useEffect, useState } from 'react';
import { Check, Info, Sparkles, AlertCircle } from 'lucide-react';

export type ToastVariant = 'success' | 'info' | 'sparkle' | 'error';

interface ToastMessage {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
}

// Singleton state. Survives re-renders because the module itself
// is stable in Next's client bundle.
const listeners = new Set<(toasts: ToastMessage[]) => void>();
let toasts: ToastMessage[] = [];

function notify() {
  for (const l of listeners) l(toasts);
}

/**
 * Fire-and-forget toast. Auto-dismisses after `duration` ms
 * (default 3 seconds). Returns the id in case the caller wants
 * to dismiss manually (rare).
 */
export function showToast(
  message: string,
  variant: ToastVariant = 'success',
  duration = 3000
): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  toasts = [...toasts, { id, message, variant, duration }];
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, duration);
  return id;
}

/**
 * Manually dismiss a toast by id. Mostly for tests; the auto-
 * dismiss timer covers the common case.
 */
export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

const VARIANT_ICONS: Record<ToastVariant, typeof Check> = {
  success: Check,
  info: Info,
  sparkle: Sparkles,
  error: AlertCircle,
};

const VARIANT_COLORS: Record<ToastVariant, string> = {
  success: 'text-emerald-500',
  info: 'text-text-3',
  sparkle: 'text-accent',
  error: 'text-danger',
};

/**
 * Mount once, near the root of the tree. Renders the active
 * toast queue fixed bottom-right with a small slide-in.
 */
export function ToastContainer() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const listener = (next: ToastMessage[]) => setItems([...next]);
    listeners.add(listener);
    // Sync immediately in case a toast fired before mount.
    listener(toasts);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((toast) => {
        const Icon = VARIANT_ICONS[toast.variant];
        return (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto bg-bg-elev border border-border rounded-lg px-4 py-3 shadow-lg flex items-center gap-3 min-w-[260px] max-w-[400px] animate-in slide-in-from-bottom-2 fade-in duration-200"
          >
            <Icon
              className={`w-4 h-4 shrink-0 ${VARIANT_COLORS[toast.variant]}`}
              aria-hidden
            />
            <span className="text-sm text-text-1">{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
}
