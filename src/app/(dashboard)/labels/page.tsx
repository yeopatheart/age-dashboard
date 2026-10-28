import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { loadLabelTemplates } from '@/lib/labels/server';
import { LabelsClient } from './labels-client';
import { requireMenu } from '@/lib/permissions/access';

export default async function LabelsPage() {
  await requireMenu('labels');
  const supabase = await createClient();
  const [templates, settings] = await Promise.all([loadLabelTemplates(supabase), loadAppSettings(supabase)]);
  return <LabelsClient initial={templates} company={settings.companyName} contact={settings.contactPhone} />;
}
