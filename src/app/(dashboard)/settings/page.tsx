import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { SettingsClient } from './settings-client';
import { requireMenu } from '@/lib/permissions/access';

export default async function SettingsPage() {
  await requireMenu('settings');
  const supabase = await createClient();
  const settings = await loadAppSettings(supabase);
  return <SettingsClient initial={settings} />;
}
