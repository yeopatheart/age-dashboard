import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { loadLabelConfirmMode, loadLabelDesigns, loadLabelMargin, loadLabelRotate } from '@/lib/labels/server';
import { migrationsFor } from '@/lib/supabase/missing-table';
import { MigrationNotice } from '@/components/migration-notice';
import { LabelsClient } from './labels-client';
import { requireMenu } from '@/lib/permissions/access';

export default async function LabelsPage() {
  const accessCheck = requireMenu('labels'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  const [, library, settings, marginMm, rotate, confirmMode] = await Promise.all([accessCheck, loadLabelDesigns(supabase), loadAppSettings(supabase), loadLabelMargin(supabase), loadLabelRotate(supabase), loadLabelConfirmMode(supabase)]);
  if (library.missing) return <MigrationNotice feature="라벨 디자인 보관함" migrations={migrationsFor([library.missing])} />;
  return <LabelsClient initialDesigns={library.designs} initialActiveId={library.activeId} company={settings.companyName} contact={settings.contactPhone} initialMarginMm={marginMm} initialRotate={rotate} initialConfirmMode={confirmMode} />;
}
