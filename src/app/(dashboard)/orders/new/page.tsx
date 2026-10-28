import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@/lib/supabase/server';
import { loadAppSettings } from '@/lib/settings-server';
import { getOrderHistory } from '../actions';
import { NewOrderClient } from './new-order-client';
import { requireMenu } from '@/lib/permissions/access';

function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

export default async function NewOrderPage() {
  await requireMenu('orders');
  const today = todayKST();
  const supabase = await createClient();
  const [settings, initialHistory] = await Promise.all([loadAppSettings(supabase), getOrderHistory(today)]);

  // 가이드 문서 파일 하나를 팝업에 그대로 보여준다 — 문서와 화면이 어긋나지 않게 복사본을 두지 않는다.
  const guideMarkdown = await readFile(path.join(process.cwd(), 'docs', 'kakao-message-format-guide.md'), 'utf-8');

  return <NewOrderClient today={today} allowPast={settings.allowPastOrderEdit} initialHistory={initialHistory} guideMarkdown={guideMarkdown} />;
}
