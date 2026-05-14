// PR Sprint 7.19 — admin inbox.
//
// Two-column layout:
//   LEFT  — list of all conversations sorted by recency, showing
//           user identity + last-message preview + mode pill.
//   RIGHT — full transcript of the selected conversation with a
//           reply composer and a mode toggle.
//
// Realtime: subscribes to chat_messages and chat_conversations
// so new user messages stream into the active pane without a
// refetch, and the list re-orders when activity arrives.

import { InboxClient } from './client';

export default function AdminInboxPage() {
  return <InboxClient />;
}
