import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getOrderHistory } from '../actions';
import { NewOrderClient } from './new-order-client';

function todayKST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

export default async function NewOrderPage() {
  const orderDate = todayKST();
  const initialHistory = await getOrderHistory(orderDate);

  // 가이드 문서 파일 하나를 팝업에 그대로 보여준다 — 문서와 화면이 어긋나지 않게 복사본을 두지 않는다.
  const guideMarkdown = await readFile(path.join(process.cwd(), 'docs', 'kakao-message-format-guide.md'), 'utf-8');

  return <NewOrderClient orderDate={orderDate} initialHistory={initialHistory} guideMarkdown={guideMarkdown} />;
}
