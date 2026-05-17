import { redirect } from 'next/navigation';

// /marketing is now a route group with sub-tabs (Photo Studio /
// UGC Studio / Calendar / Library). The bare /marketing URL
// redirects to the default Photo Studio tab so existing links
// + the sidebar nav still resolve to something.
//
// PR Sprint D-8 — landed on /marketing/photo-studio after the
// rename from /marketing/generate. next.config.mjs 301-redirects
// the legacy /marketing/generate URL for older bookmarks.
export default function MarketingPage() {
  redirect('/marketing/photo-studio');
}
