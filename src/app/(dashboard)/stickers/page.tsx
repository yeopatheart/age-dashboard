import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { migrationsFor, rowsOrMissing } from '@/lib/supabase/missing-table';
import { MigrationNotice } from '@/components/migration-notice';
import { StickersClient } from './stickers-client';

export default async function StickersPage() {
  const accessCheck = requireMenu('stickers'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const supabase = await createClient();
  const [, presets] = await Promise.all([
    accessCheck,
    // 0074 적용 전이면 던지지 않고 안내를 보여 준다(운영은 서버 오류 문구를 가린다).
    rowsOrMissing(
      (async () => {
        const { data, error } = await supabase
          .from('sticker_presets')
          .select('id, label, fill_color, border_color, uses_quantity, sort_order, created_at')
          .order('sort_order')
          .order('created_at');
        if (error) throw new Error(error.message);
        return data ?? [];
      })(),
    ),
  ]);
  if (presets.missing) return <MigrationNotice feature="스티커 관리" migrations={migrationsFor([presets.missing])} />;
  return <StickersClient presets={presets.rows} />;
}
