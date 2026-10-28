import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { getOrderHistory } from '../actions';
import { NewOrderClient } from './new-order-client';
import { requireMenu } from '@/lib/permissions/access';
import { todayKST } from '@/lib/order-date';

export default async function NewOrderPage() {
  const accessCheck = requireMenu('orders'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const today = todayKST();
  const supabase = await createClient();
  // 가이드 문서 파일 하나를 팝업에 그대로 보여준다 — 문서와 화면이 어긋나지 않게 복사본을 두지 않는다.
  const [, settings, initialHistory, guideMarkdown] = await Promise.all([
    accessCheck,
    loadAppSettings(supabase),
    getOrderHistory(today),
    readFile(path.join(process.cwd(), 'docs', 'kakao-message-format-guide.md'), 'utf-8'),
  ]);

  return <NewOrderClient today={today} allowPast={settings.allowPastOrderEdit} initialHistory={initialHistory} guideMarkdown={guideMarkdown} />;
}
