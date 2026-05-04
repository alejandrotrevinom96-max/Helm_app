'use client';

import { useEffect, useRef } from 'react';

const CHANNEL_NAME = 'helm-data-changes';

// Add new event types here as we wire them up. Keeping a discriminated union
// keeps consumers honest about which kinds of changes they care to listen to.
export type BroadcastEvent =
  | { type: 'scheduled-post-created' }
  | { type: 'scheduled-post-updated' }
  | { type: 'scheduled-post-deleted' }
  | { type: 'waitlist-created' }
  | { type: 'waitlist-archived' }
  | { type: 'waitlist-duplicated' }
  | { type: 'research-config-updated' };

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function broadcastEvent(event: BroadcastEvent) {
  try {
    getChannel()?.postMessage(event);
  } catch {
    // BroadcastChannel can throw in some sandboxed contexts; never let a
    // failed broadcast block the user-visible action that triggered it.
  }
}

// Ref pattern: register the listener once on mount, but always invoke the
// latest handler via the ref. This frees consumers from having to wrap their
// handlers in useCallback to avoid re-subscriptions on every render.
export function useBroadcast(handler: (event: BroadcastEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const ch = getChannel();
    if (!ch) return;

    const onMessage = (e: MessageEvent<BroadcastEvent>) => {
      handlerRef.current(e.data);
    };

    ch.addEventListener('message', onMessage);
    return () => ch.removeEventListener('message', onMessage);
  }, []);
}
