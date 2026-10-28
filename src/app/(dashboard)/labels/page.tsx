import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { loadLabelMargin, loadLabelTemplate } from '@/lib/labels/server';
import { LabelsClient } from './labels-client';
import { requireMenu } from '@/lib/permissions/access';

export default async function LabelsPage() {
  const accessCheck = requireMenu('labels'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  const [, templates, settings, marginMm] = await Promise.all([accessCheck, loadLabelTemplate(supabase), loadAppSettings(supabase), loadLabelMargin(supabase)]);
  return <LabelsClient initial={templates} company={settings.companyName} contact={settings.contactPhone} initialMarginMm={marginMm} />;
}
