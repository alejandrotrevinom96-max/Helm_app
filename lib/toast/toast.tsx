'use client';

// PR Sprint 7.19 — minimal global toast.
//
// Used by the Disconnect button (and any future flow that needs
// to surface a transient confirmation without dragging in a
// full notifications library). Module-level event bus so any
// component can fire a toast without prop-drilling a callback.
//
// Usage:
//   import { showToast } from '@/lib/toast/toast';
//   showToast('Disconnected from Vercel');           // success (default)
//   showToast('Could not disconnect', 'error');      // error variant
//
// Mount <Toaster /> once near the top of the route subtree that
// should display toasts (we do it inside the Integrations page).

import { useEffect, useState } from 'react';

type ToastKind = 'success' | 'error';

interface ToastMsg {
  id: string;
  kind: ToastKind;
  text: string;
}

const listeners = new Set<(msgs: ToastMsg[]) => void>();
let messages: ToastMsg[] = [];

// Toast auto-dismiss window. Long enough to read a one-line
// confirmation, short enough that stacked toasts don't pile up.
const DISMISS_MS = 3500;

function emit(next: ToastMsg[]) {
  messages = next;
  listeners.forEach((cb) => cb(messages));
}

export function showToast(text: string, kind: ToastKind = 'success'): void {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  emit([...messages, { id, kind, text }]);
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      emit(messages.filter((m) => m.id !== id));
    }, DISMISS_MS);
  }
}

function useToasts(): ToastMsg[] {
  const [state, setState] = useState<ToastMsg[]>(messages);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

export function Toaster() {
  const msgs = useToasts();
  if (msgs.length === 0) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2 pointer-events-none"
    >
      {msgs.map((m) => (
        <div
          key={m.id}
          role="status"
          className={`pointer-events-auto glass-elevated rounded-lg px-4 py-3 text-sm shadow-editorial-lg min-w-[220px] max-w-[360px] flex items-start gap-2 border ${
            m.kind === 'error'
              ? 'border-danger/40 text-danger'
              : 'border-border-bright text-text-1'
          }`}
          style={{ animation: 'helm-toast-in 200ms ease-out' }}
        >
          <span aria-hidden="true" className="leading-none mt-0.5">
            {m.kind === 'error' ? '⚠' : '✓'}
          </span>
          <span className="flex-1">{m.text}</span>
        </div>
      ))}
      <style jsx>{`
        @keyframes helm-toast-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
