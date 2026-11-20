// 고객사 간 합포장: 서로 다른 두 고객 카드의 각 1박스를 한 박스로 합쳐 내보낸다. 순수 함수라 서버·클라이언트가 같이 쓴다.
// 연결은 daily_businesses.box_link_id(양쪽 카드가 서로를 가리킨다)로 저장하고, 연결·해제는 DB 함수(0072)로만 한다.
// 한 카드 안의 박스 묶음(box-merge.ts)과는 별개다. 결정은 docs/decisions/2026-11-20-customer-box-link.md.

// 묶음마다 색과 글자(A, B, C…)를 준다. 초록(완료)·빨강(취소·재확인)·노랑(메모)과 겹치지 않는 색만 쓴다.
export const BOX_LINK_COLORS = ['#7c3aed', '#db2777', '#ea580c', '#2563eb', '#0891b2', '#a16207'] as const;

export interface BoxLinkRowRef {
  dailyBusinessId: string;
  boxLinkId: string | null;
  businessName: string;
}

export interface BoxLinkInfo {
  letter: string; // 묶음 글자(A, B, …)
  color: string;
  partnerId: string;
  partnerName: string;
}

const letterOf = (index: number) => String.fromCharCode(65 + (index % 26));

// rows(주문 목록 순서)에서 연결된 쌍을 찾아 카드 id별 표시 정보를 만든다. 글자와 색은 목록에서 먼저 나오는 쌍부터 A, B, …로 붙인다.
// 두 카드가 서로를 가리킬 때만 연결로 본다(한쪽만 가리키거나 짝이 목록에 없으면 표시하지 않는다).
export function boxLinkInfos(rows: BoxLinkRowRef[]): Map<string, BoxLinkInfo> {
  const byId = new Map(rows.map((r) => [r.dailyBusinessId, r]));
  const infos = new Map<string, BoxLinkInfo>();
  let pairIndex = 0;
  for (const row of rows) {
    if (!row.boxLinkId || infos.has(row.dailyBusinessId)) continue;
    const partner = byId.get(row.boxLinkId);
    if (!partner || partner.boxLinkId !== row.dailyBusinessId || partner.dailyBusinessId === row.dailyBusinessId) continue;
    const letter = letterOf(pairIndex);
    const color = BOX_LINK_COLORS[pairIndex % BOX_LINK_COLORS.length];
    infos.set(row.dailyBusinessId, { letter, color, partnerId: partner.dailyBusinessId, partnerName: partner.businessName });
    infos.set(partner.dailyBusinessId, { letter, color, partnerId: row.dailyBusinessId, partnerName: row.businessName });
    pairIndex += 1;
  }
  return infos;
}

// 쌍 가운데 한 카드만 박스 수를 센다(두 박스를 한 박스로 합쳐 내보내므로). 짝이 목록에 없거나 서로 가리키지 않으면 그대로 센다.
export function boxLinkSkipIds(rows: BoxLinkRowRef[]): Set<string> {
  const skip = new Set<string>();
  for (const [id, info] of boxLinkInfos(rows)) {
    if (id > info.partnerId) skip.add(id);
  }
  return skip;
}

export interface LinkCandidate {
  id: string;
  terminal: string;
  parcel: boolean;
  totalBoxes: number | null;
  linked: boolean;
  cancelled: boolean;
  loaded: boolean; // 상차된 박스가 있다
}

// 화면에서 연결 가능 여부를 미리 거른다(서버·DB가 같은 조건을 다시 확인한다). 불가능하면 이유를 돌려준다.
export function linkBlockReason(c: LinkCandidate): string | null {
  if (c.parcel) return '택배 터미널은 합포장할 수 없습니다';
  if (c.cancelled) return '주문이 모두 취소된 고객입니다';
  if (c.linked) return '이미 합포장으로 연결된 고객입니다';
  if (c.totalBoxes !== 1) return '박스를 1개로 할당한 고객만 합포장할 수 있습니다';
  if (c.loaded) return '이미 상차된 박스가 있습니다';
  return null;
}

// 두 고객을 연결할 수 있는지(첫 번째를 고른 뒤 두 번째를 눌렀을 때)
export function linkPairBlockReason(a: LinkCandidate, b: LinkCandidate): string | null {
  if (a.id === b.id) return '같은 고객입니다';
  if (a.terminal !== b.terminal) return '터미널이 다른 고객은 합포장할 수 없습니다';
  return linkBlockReason(b);
}
