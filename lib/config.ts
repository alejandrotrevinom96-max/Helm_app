// PR Sprint 7.19 — admin / operator allowlist.
//
// Single source of truth for who's an admin. Used by:
//   - /admin/* routes (overview dashboard + inbox)
//   - /api/chat/admin/reply endpoint
//   - Sidebar conditional rendering for Inbox + Admin links
//
// Keep this list short. We're not building a roles system — this
// is the founder's panel. When/if the team grows past 2-3
// trusted operators, migrate to a real role on users.role.

export const ADMIN_EMAILS: ReadonlyArray<string> = [
  'alejandro.trevinom96@gmail.com',
];

/** Case-insensitive admin check. Email may be null when the
 * session is half-loaded; treat unknown emails as non-admin. */
export function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return ADMIN_EMAILS.some((e) => e.toLowerCase() === normalized);
}
