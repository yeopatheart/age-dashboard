// 상차 스캔 화면의 "상차 완료 목록" 텍스트(퀵 기사님께 보낼 글). 순수 함수라 서버·클라이언트가 같이 쓴다.
import { mergeGroupOf, normalizeMergeGroups } from '@/lib/box-merge';
import { cleanShareText } from '@/lib/share-text';

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
  business: string;
  terminal: string;
  packages: PackageCount;
}

export const NO_TERMINAL = '터미널 없음';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 'YYYY-MM-DD' → '11/06(금)'. Date를 로컬 시간대로 만들면 하루 어긋날 수 있어 UTC로 요일만 구한다.
function dateText(orderDate: string): string {
  const [y, m, d] = orderDate.split('-').map(Number);
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}(${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

// 한 터미널의 상차 완료 목록. 퀵 기사님은 터미널(행선지)별로 따로 보내므로 터미널 하나씩 만든다.
// 같은 업체의 1·2차는 합산한다. 그 터미널에 상차된 박스가 하나도 없으면 null. terminal은 카드의 터미널 이름('' = 터미널 없음)이다.
export function buildLoadedListText(orderDate: string, cards: ShareCard[], terminal: string): string | null {
  const businesses = new Map<string, PackageCount>(); // 카드 순서대로 처음 나온 순
  for (const c of cards) {
    if ((c.terminal || NO_TERMINAL) !== (terminal || NO_TERMINAL)) continue;
    const sum = businesses.get(c.business) ?? { loaded: 0, total: 0 };
    sum.loaded += c.packages.loaded;
    sum.total += c.packages.total;
    businesses.set(c.business, sum);
  }

  const done: string[] = [];
  const pending: string[] = [];
  let loadedSum = 0;
  for (const [name, p] of businesses) {
    if (p.loaded > 0) {
      done.push(`${name} ${p.loaded === p.total ? p.loaded : `${p.loaded}/${p.total}`}박스`);
      loadedSum += p.loaded;
    }
    if (p.loaded < p.total) pending.push(`${name} ${p.total - p.loaded}박스`);
  }
  if (done.length === 0) return null;

  return cleanShareText([
    `${dateText(orderDate)} ${terminal || NO_TERMINAL} 상차 완료`,
    ...done,
    `합계 ${loadedSum}박스`,
    ...(pending.length ? [`⚠ 미상차: ${pending.join(' / ')}`] : []),
  ].join('\n'));
}
