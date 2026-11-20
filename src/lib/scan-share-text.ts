// 상차 스캔 화면의 "상차 완료 목록" 텍스트(퀵 기사님께 보낼 글). 순수 함수라 서버·클라이언트가 같이 쓴다.
import { mergeGroupOf, normalizeMergeGroups } from './box-merge.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다
import { linkedCounts, linkedPartners } from './box-link.ts';
import { cleanShareText } from './share-text.ts';
import { DEFAULT_SCAN_SHARE_TEMPLATE, formatShareDate, renderShareSlot, type ScanShareTemplate } from './scan-share-template.ts';

export interface PackageCount {
  loaded: number;
  total: number;
}

// 퀵 기사님이 실제로 싣는 덩이 수. 합포장 묶음은 라벨이 여러 장이어도 한 덩이로 센다.
// 묶음 안에 존재하는 라벨이 모두 상차된 경우에만 그 덩이를 상차 완료로 센다.
export function packageCounts(labels: { seq: number; loaded: boolean }[], mergeGroups: unknown): PackageCount {
  const groups = normalizeMergeGroups(mergeGroups);
  const units = new Map<string, boolean>(); // 덩이 → 속한 라벨이 모두 상차됐는지
  for (const l of labels) {
    const group = mergeGroupOf(groups, l.seq);
    const key = group ? `g${group[0]}` : `s${l.seq}`;
    units.set(key, (units.get(key) ?? true) && l.loaded);
  }
  return { loaded: [...units.values()].filter(Boolean).length, total: units.size };
}

export interface ShareCard {
  id?: string; // 고객사 간 합포장의 짝을 찾는 데 쓴다(없으면 합포장 없는 카드로 본다)
  linkId?: string | null; // 고객사 간 합포장의 짝 카드 id(0072)
  business: string;
  terminal: string;
  packages: PackageCount;
}

export const NO_TERMINAL = '터미널 없음';

// 한 터미널의 상차 완료 목록. 퀵 기사님은 터미널(행선지)별로 따로 보내므로 터미널 하나씩 만든다.
// 같은 업체의 1·2차는 합산한다. 그 터미널에 상차된 박스가 하나도 없으면 null. terminal은 카드의 터미널 이름('' = 터미널 없음)이다.
// 글의 모양(문구·변수·날짜 형식)은 template이 정한다(시스템 설정). 기본값은 설정 기능을 넣기 전의 고정 문구와 같다.
export function buildLoadedListText(orderDate: string, cards: ShareCard[], terminal: string, template: ScanShareTemplate = DEFAULT_SCAN_SHARE_TEMPLATE): string | null {
  const inTerminal = cards.filter((c) => (c.terminal || NO_TERMINAL) === (terminal || NO_TERMINAL));

  // 고객사 간 합포장(0072): 서로 가리키는 두 카드가 한 박스로 나간다. 둘 다 상차돼야 상차 완료로 세고, 아직이면 미상차 줄에 한 덩이로 올린다.
  const byId = new Map(inTerminal.flatMap((c) => (c.id ? [[c.id, c] as const] : [])));
  const partners = linkedPartners(inTerminal.flatMap((c) => (c.id ? [{ id: c.id, linkId: c.linkId ?? null }] : [])));
  const fullyLoaded = (c: ShareCard) => c.packages.total > 0 && c.packages.loaded >= c.packages.total;
  const pairs: { a: ShareCard; b: ShareCard; loaded: boolean }[] = []; // 카드 순서대로 쌍마다 하나
  const seenPair = new Set<string>();
  for (const c of inTerminal) {
    const mateId = c.id ? partners.get(c.id) : undefined;
    if (!c.id || !mateId || seenPair.has(c.id)) continue;
    const mate = byId.get(mateId);
    if (!mate) continue;
    seenPair.add(c.id);
    seenPair.add(mateId);
    pairs.push({ a: c, b: mate, loaded: fullyLoaded(c) && fullyLoaded(mate) });
  }
  const idsOf = (list: typeof pairs) => new Set(list.flatMap((p) => [p.a.id as string, p.b.id as string]));
  const pendingPairIds = idsOf(pairs.filter((p) => !p.loaded));
  const loadedPairs = pairs.filter((p) => p.loaded);
  const loadedPairBusinesses = new Set(loadedPairs.flatMap((p) => [p.a.business, p.b.business]));

  const businesses = new Map<string, PackageCount>(); // 카드 순서대로 처음 나온 순(아직 상차 전인 합포장 카드는 아래 쌍 줄로 따로 올린다)
  for (const c of inTerminal) {
    if (c.id && pendingPairIds.has(c.id)) continue;
    const sum = businesses.get(c.business) ?? { loaded: 0, total: 0 };
    sum.loaded += c.packages.loaded;
    sum.total += c.packages.total;
    businesses.set(c.business, sum);
  }

  const done: { name: string; p: PackageCount }[] = [];
  const pending: string[] = [];
  let loadedSum = 0;
  for (const [name, p] of businesses) {
    if (p.loaded > 0) {
      done.push({ name, p });
      loadedSum += p.loaded;
    }
    if (p.loaded < p.total) pending.push(`${name} ${p.total - p.loaded}박스`);
  }
  if (done.length === 0) return null;
  loadedSum -= loadedPairs.reduce((s, p) => s + p.b.packages.loaded, 0); // 합포장 한 쌍은 한 박스다
  for (const p of pairs.filter((x) => !x.loaded)) pending.push(`${p.a.business} + ${p.b.business} 1박스`);

  const common = { 날짜: formatShareDate(orderDate, template.dateFormat), 터미널명: terminal || NO_TERMINAL, 업체수: done.length, 합계: loadedSum };
  const lines = [
    renderShareSlot(template.header, common),
    ...done.map(({ name, p }) => renderShareSlot(template.line, { 고객사명: name, 박스수: p.loaded === p.total ? p.loaded : `${p.loaded}/${p.total}`, 상차박스: p.loaded, 전체박스: p.total, 합포장표시: loadedPairBusinesses.has(name) ? ' (합포장)' : '' })),
    renderShareSlot(template.total, common),
    ...(loadedPairs.length
      ? [renderShareSlot(template.mergeHeader, { ...common, 합포장수: loadedPairs.length }), ...loadedPairs.map((p) => renderShareSlot(template.merge, { 고객1: p.a.business, 고객2: p.b.business }))]
      : []),
    ...(template.showPending && pending.length ? [renderShareSlot(template.pending, { ...common, 미상차목록: pending.join(' / ') })] : []),
  ];
  // 비워 둔 줄(변수만 쓰고 값이 빈 경우 포함)은 글에서 뺀다: 중간에 빈 줄이 생기지 않게 한다.
  return cleanShareText(lines.filter((l) => l.trim() !== '').join('\n'));
}

// 터미널마다 상차 현황(상차/전체 박스)과 기사님께 보낼 글. 터미널은 카드에 처음 나온 순서이고, 상차된 박스가 없으면 text가 null이다.
// 상차 스캔 화면과 보내기 화면이 같이 쓴다.
export interface TerminalShare {
  name: string;
  loaded: number;
  total: number;
  text: string | null;
}

export function terminalShareList(
  orderDate: string,
  cards: (ShareCard & { loaded: number; total: number })[],
  template: ScanShareTemplate = DEFAULT_SCAN_SHARE_TEMPLATE,
): TerminalShare[] {
  const map = new Map<string, { loaded: number; total: number }>();
  // 고객사 간 합포장 한 쌍은 한 박스로 센다(id가 없는 카드는 합포장 없는 카드로 본다).
  const counts = linkedCounts(cards.map((c, i) => ({ id: c.id ?? `#${i}`, linkId: c.linkId ?? null, loaded: c.loaded, total: c.total })));
  cards.forEach((c, i) => {
    const key = c.terminal || NO_TERMINAL;
    const t = map.get(key) ?? { loaded: 0, total: 0 };
    const n = counts.get(c.id ?? `#${i}`) ?? { loaded: c.loaded, total: c.total };
    t.loaded += n.loaded;
    t.total += n.total;
    map.set(key, t);
  });
  return [...map.entries()].map(([name, v]) => ({ name, ...v, text: buildLoadedListText(orderDate, cards, name, template) }));
}

// 설정 화면 미리보기용 예시 데이터(대구 터미널, 1차 날짜 2026-11-06): 모두 상차 / 일부 상차 / 미상차가 한 번에 보이게 만든다.
export const SHARE_SAMPLE_DATE = '2026-11-06';
export const SHARE_SAMPLE_TERMINAL = '대구';
export const SHARE_SAMPLE_CARDS: ShareCard[] = [
  { business: '바다횟집', terminal: '대구', packages: { loaded: 3, total: 3 } },
  { business: '해월일식', terminal: '대구', packages: { loaded: 2, total: 4 } },
  { business: '청해수산', terminal: '대구', packages: { loaded: 0, total: 2 } },
  // 고객사 간 합포장 한 쌍(두 고객의 각 1박스를 한 박스로 내보냄)
  { id: 'sample-a', linkId: 'sample-b', business: '스시렌', terminal: '대구', packages: { loaded: 1, total: 1 } },
  { id: 'sample-b', linkId: 'sample-a', business: '스시쿄세이', terminal: '대구', packages: { loaded: 1, total: 1 } },
];
