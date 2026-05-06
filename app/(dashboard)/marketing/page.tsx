import { redirect } from 'next/navigation';

// /marketing is now a route group with sub-tabs (Generate / Calendar /
// Library). The bare /marketing URL redirects to the default Generate
// tab so existing links + the sidebar nav still resolve to something.
export default function MarketingPage() {
  redirect('/marketing/generate');
}
