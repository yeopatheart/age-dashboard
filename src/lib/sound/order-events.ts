// 주문 목록 화면이 새 데이터를 받을 때마다 이전 화면과 비교(diff)해서 "무슨 일이 일어났는지"를 이벤트로 바꾸고,
// 이벤트를 소리 계획(톤 + 읽을 문구)으로 바꾼다. 둘 다 화면·소리와 무관한 순수 함수라서 따로 검증할 수 있다.
// change_status 컬럼에 기대지 않고 품목 id 기준으로 직접 비교한다(상태 값이 언제 초기화되는지에 영향받지 않는다).
import { isCardComplete, type OrderItem, type OrderRow } from '@/lib/orders';
import type { ToneName } from './tones';

export type OrderEventKind =
  | 'packed-item-changed' // 이미 포장 완료한 품목이 바뀌거나 취소됨 — 가장 위험(포장을 다시 풀어야 할 수 있다)
  | 'item-cancelled'
  | 'order-removed'
  | 'item-added'
  | 'qty-changed'
  | 'order-new'
  | 'unshipped'
  | 'item-modified'
  | 'card-complete'
  | 'item-packed';

// 앞일수록 급하다(한 번에 여러 이벤트가 오면 가장 앞 종류의 톤을 낸다).
export const EVENT_PRIORITY: OrderEventKind[] = ['packed-item-changed', 'item-cancelled', 'order-removed', 'item-added', 'qty-changed', 'order-new', 'unshipped', 'item-modified', 'card-complete', 'item-packed'];

export const EVENT_LABEL: Record<OrderEventKind, string> = {
  'packed-item-changed': '포장된 품목 변경',
  'item-cancelled': '취소·삭제',
  'order-removed': '주문 삭제',
  'item-added': '품목 추가',
  'qty-changed': '수량 변경',
  'order-new': '새 주문',
  unshipped: '미출고',
  'item-modified': '상품 수정',
  'card-complete': '업체 포장 완료',
  'item-packed': '포장 체크',
};

const TONE_OF: Record<OrderEventKind, ToneName> = {
  'packed-item-changed': 'urgent',
  'item-cancelled': 'cancel',
  'order-removed': 'cancel',
  'item-added': 'added',
  'qty-changed': 'changed',
  'order-new': 'new-order',
  unshipped: 'unshipped',
  'item-modified': 'changed',
  'card-complete': 'complete',
  'item-packed': 'tick',
};

export interface OrderEvent {
  kind: OrderEventKind;
  business: string;
  product?: string;
  round?: number;
}

export interface OrderSnapshot {
  rows: Pick<OrderRow, 'dailyBusinessId' | 'businessName' | 'round'>[];
  items: Pick<OrderItem, 'id' | 'dailyBusinessId' | 'productName' | 'quantity' | 'unit' | 'isMulbong' | 'hasAerator' | 'sizeRequest' | 'isPacked' | 'unshippedQuantity' | 'changeStatus'>[];
}

export function diffOrders(prev: OrderSnapshot, next: OrderSnapshot): OrderEvent[] {
  const events: OrderEvent[] = [];
  const prevRows = new Map(prev.rows.map((r) => [r.dailyBusinessId, r]));
  const nextRows = new Map(next.rows.map((r) => [r.dailyBusinessId, r]));
  const prevItems = new Map(prev.items.map((i) => [i.id, i]));
  const nextItems = new Map(next.items.map((i) => [i.id, i]));

  // 새 업체 카드: 카드와 함께 들어온 품목은 "품목 추가"로 따로 알리지 않는다(새 주문 한 번으로 충분).
  const newBusinesses = new Set<string>();
  for (const r of next.rows) {
    if (prevRows.has(r.dailyBusinessId)) continue;
    newBusinesses.add(r.dailyBusinessId);
    events.push({ kind: 'order-new', business: r.businessName, round: r.round });
  }
  // 지워진 카드: 딸린 품목은 따로 알리지 않는다.
  const removedBusinesses = new Set<string>();
  for (const r of prev.rows) {
    if (nextRows.has(r.dailyBusinessId)) continue;
    removedBusinesses.add(r.dailyBusinessId);
    events.push({ kind: 'order-removed', business: r.businessName });
  }

  const businessName = (id: string) => nextRows.get(id)?.businessName ?? prevRows.get(id)?.businessName ?? '';

  for (const n of next.items) {
    if (newBusinesses.has(n.dailyBusinessId)) continue;
    const p = prevItems.get(n.id);
    const base = { business: businessName(n.dailyBusinessId), product: n.productName };
    if (!p) {
      events.push({ kind: 'item-added', ...base });
      continue;
    }
    if (n.changeStatus === 'cancelled') {
      if (p.changeStatus !== 'cancelled') events.push({ kind: p.isPacked ? 'packed-item-changed' : 'item-cancelled', ...base });
      continue;
    }
    if (p.quantity !== n.quantity || p.unit !== n.unit) {
      events.push({ kind: p.isPacked ? 'packed-item-changed' : 'qty-changed', ...base });
    } else if (p.unshippedQuantity !== n.unshippedQuantity) {
      events.push({ kind: 'unshipped', ...base });
    } else if (p.productName !== n.productName || p.isMulbong !== n.isMulbong || p.hasAerator !== n.hasAerator || p.sizeRequest !== n.sizeRequest) {
      events.push({ kind: p.isPacked ? 'packed-item-changed' : 'item-modified', ...base });
    } else if (!p.isPacked && n.isPacked) {
      events.push({ kind: 'item-packed', ...base });
    }
  }

  for (const p of prev.items) {
    if (nextItems.has(p.id) || removedBusinesses.has(p.dailyBusinessId)) continue;
    events.push({ kind: p.isPacked ? 'packed-item-changed' : 'item-cancelled', business: businessName(p.dailyBusinessId), product: p.productName });
  }

  // 업체 전체 포장 완료: 이전에는 끝나지 않았고 지금은 끝난 카드(방금 만들어진 카드는 제외).
  for (const r of next.rows) {
    if (newBusinesses.has(r.dailyBusinessId)) continue;
    const before = prev.items.filter((i) => i.dailyBusinessId === r.dailyBusinessId);
    const after = next.items.filter((i) => i.dailyBusinessId === r.dailyBusinessId);
    if (!isCardComplete(before) && isCardComplete(after)) events.push({ kind: 'card-complete', business: r.businessName });
  }

  return events;
}

// ─── 소리 계획 ──────────────────────────────────────────────────────────────────

export interface Cue {
  tone: ToneName;
  say?: string; // 음성 모드에서만 읽는다
}

const SUMMARY_LABEL: Partial<Record<OrderEventKind, string>> = {
  'order-new': '새 주문',
  'order-removed': '주문 삭제',
  'item-added': '추가',
  'qty-changed': '수정',
  'item-modified': '수정',
  unshipped: '미출고',
  'item-cancelled': '취소',
  'card-complete': '포장 완료',
};

const byPriority = (a: OrderEvent, b: OrderEvent) => EVENT_PRIORITY.indexOf(a.kind) - EVENT_PRIORITY.indexOf(b.kind);

// 화면과 목록에 보여줄 한 줄 설명.
export function describeEvent(e: OrderEvent): string {
  const who = e.product ? `${e.business} ${e.product}` : e.business;
  switch (e.kind) {
    case 'packed-item-changed': return `포장된 품목 변경, ${who}`;
    case 'item-cancelled': return `취소, ${who}`;
    case 'order-removed': return `주문 삭제, ${e.business}`;
    case 'item-added': return `품목 추가, ${who}`;
    case 'qty-changed': return `수량 변경, ${who}`;
    case 'order-new': return e.round && e.round > 1 ? `${e.round}차 새 주문, ${e.business}` : `새 주문, ${e.business}`;
    case 'unshipped': return `미출고, ${who}`;
    case 'item-modified': return `상품 수정, ${who}`;
    case 'card-complete': return `${e.business} 포장 완료`;
    case 'item-packed': return `포장 체크, ${who}`;
  }
}

// 한꺼번에 몰려온 이벤트를 소리 몇 번으로 줄인다. 카카오 주문 한 번 확정에 10건 넘게 바뀌어도 줄줄이 읽지 않는다.
// - 포장된 품목 변경(긴급)은 다른 이벤트에 묻히지 않게 항상 따로 먼저 알린다.
// - 나머지가 3건 이하면 가장 급한 톤 하나 + 각각의 문구를 이어 읽고, 4건 이상이면 "N건 변경. 새 주문 2, 추가 4…"로 요약한다.
// - 톤 전용 모드에서는 문구 없이 종류별 톤(최대 3종류)만 급한 순서로 낸다.
export function planCues(events: OrderEvent[], mode: 'voice' | 'tone', disabled: OrderEventKind[]): Cue[] {
  const on = events.filter((e) => !disabled.includes(e.kind));
  if (on.length === 0) return [];
  if (mode === 'tone') {
    const kinds = [...new Set(on.map((e) => e.kind))].sort((a, b) => EVENT_PRIORITY.indexOf(a) - EVENT_PRIORITY.indexOf(b));
    const tones = [...new Set(kinds.map((k) => TONE_OF[k]))].slice(0, 3);
    return tones.map((tone) => ({ tone }));
  }

  const cues: Cue[] = [];
  const urgent = on.filter((e) => e.kind === 'packed-item-changed');
  const rest = on.filter((e) => e.kind !== 'packed-item-changed').sort(byPriority);
  if (urgent.length) {
    cues.push({ tone: 'urgent', say: urgent.length === 1 ? describeEvent(urgent[0]) : `포장된 품목 변경 ${urgent.length}건` });
  }
  if (rest.length) {
    const spoken = rest.filter((e) => e.kind !== 'item-packed');
    const tone = TONE_OF[rest[0].kind];
    if (spoken.length <= 3) {
      cues.push({ tone, say: spoken.map(describeEvent).join('. ') || undefined });
    } else {
      const counts = new Map<string, number>();
      for (const e of spoken) {
        const label = SUMMARY_LABEL[e.kind];
        if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const parts = [...counts].map(([label, n]) => `${label} ${n}`);
      cues.push({ tone, say: `${spoken.length}건 변경. ${parts.join(', ')}` });
    }
  }
  return cues;
}
