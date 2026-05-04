'use client';

import { useEffect } from 'react';

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

export function useBroadcast(handler: (event: BroadcastEvent) => void) {
  useEffect(() => {
    const ch = getChannel();
    if (!ch) return;

    const onMessage = (e: MessageEvent<BroadcastEvent>) => {
      handler(e.data);
    };

    ch.addEventListener('message', onMessage);
    return () => ch.removeEventListener('message', onMessage);
  }, [handler]);
}
