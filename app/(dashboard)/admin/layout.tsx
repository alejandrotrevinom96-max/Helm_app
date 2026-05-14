// PR Sprint 7.19 — admin section server guard.
//
// All /admin/* pages route through this layout. We re-check the
// admin allowlist here so a non-admin who guesses the URL (or
// who lost admin status while their session was open) gets
// bounced even if the sidebar wouldn't render the link for them.
//
// The sidebar's isAdmin check is UI hygiene; this is the
// security boundary.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/config';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdmin(user.email)) redirect('/marketing');

  return <>{children}</>;
}
