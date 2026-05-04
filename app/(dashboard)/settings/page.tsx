import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { WebhooksConfig } from './webhooks-config';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="p-6 md:p-10 max-w-3xl">
      <h1 className="font-display text-display-lg font-light tracking-tight mb-2">
        Settings
      </h1>
      <p className="text-text-2 mb-8">Account configuration and integrations.</p>

      <div className="space-y-6">
        <WebhooksConfig />
      </div>
    </div>
  );
}
