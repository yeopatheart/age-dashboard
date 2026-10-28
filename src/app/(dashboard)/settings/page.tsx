import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { SettingsClient } from './settings-client';
import { requireMenu } from '@/lib/permissions/access';

export default async function SettingsPage() {
  const accessCheck = requireMenu('settings'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  const [, settings] = await Promise.all([accessCheck, loadAppSettings(supabase)]);
  return <SettingsClient initial={settings} />;
}
