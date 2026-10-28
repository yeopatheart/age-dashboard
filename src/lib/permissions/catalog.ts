// 메뉴와 메뉴 안 기능의 권한 목록. 서버(접근 확인)와 클라이언트(메뉴 숨김, 권한 설정 화면)가 함께 쓴다.
// 권한 키는 "메뉴:동작"이다. 모든 메뉴에 "view"(메뉴 열기)가 있고, 나머지 동작은 아래에서 정한다.
// master 계정은 이 목록과 무관하게 모든 권한을 가지며, "사용자 및 권한" 메뉴는 master만 열 수 있다.
export const MASTER_EMAIL = 'master@ageseafood.com';

export const MENU_DEFS = {
  orders: { label: '주문 입력', href: '/orders/new', paths: ['/orders'], actions: { edit: '주문 분석·확정' } },
  packing: { label: '박스 할당 / 라벨 출력', href: '/packing-log', paths: ['/packing-log'], actions: { submit: '박스 구성 제출·자동 배치', delete: '제출 기록 삭제', print: '송장 라벨 출력' } },
  dashboard: { label: '대시보드', href: '/dashboard', paths: ['/dashboard'], actions: { edit: '포장 체크·주문/상품 수정·순서 변경', delete: '주문·상품 삭제/취소' } },
  scan: { label: '상차 스캔', href: '/scan', paths: ['/scan'], actions: { scan: '상차 스캔', undo: '상차 되돌리기' } },
  reports: { label: '리포트', href: '/reports', paths: ['/reports'], actions: {} },
  businesses: { label: '고객사 관리', href: '/businesses', paths: ['/businesses'], actions: { edit: '등록·수정', delete: '삭제' } },
  terminals: { label: '터미널 관리', href: '/terminals', paths: ['/terminals'], actions: { edit: '등록·수정', delete: '삭제' } },
  products: { label: '상품 관리', href: '/products', paths: ['/products'], actions: { edit: '등록·수정', delete: '삭제' } },
  boxes: { label: '박스 관리', href: '/boxes', paths: ['/boxes'], actions: { edit: '등록·수정', delete: '삭제' } },
  labels: { label: '라벨 설정', href: '/labels', paths: ['/labels'], actions: { edit: '라벨 디자인 저장' } },
  settings: { label: '시스템 설정', href: '/settings', paths: ['/settings'], actions: { edit: '시스템 설정 변경' } },
} as const;

export type MenuKey = keyof typeof MENU_DEFS;
export type PermissionKey = {
  [M in MenuKey]: `${M}:view` | `${M}:${keyof (typeof MENU_DEFS)[M]['actions'] & string}`;
}[MenuKey];

// 화면 순서(사이드바 순서와 같다).
export const MENU_KEYS = Object.keys(MENU_DEFS) as MenuKey[];

export function permissionKeysOf(menu: MenuKey): string[] {
  return [`${menu}:view`, ...Object.keys(MENU_DEFS[menu].actions).map((a) => `${menu}:${a}`)];
}

export const ALL_PERMISSION_KEYS: string[] = MENU_KEYS.flatMap(permissionKeysOf);

// 저장 전에 알 수 없는 키를 버리고, 동작 권한이 있는 메뉴에는 보기 권한을 함께 준다(메뉴를 못 여는데 동작만 있는 상태를 없앤다).
export function normalizePermissions(keys: string[]): string[] {
  const valid = new Set(ALL_PERMISSION_KEYS);
  const chosen = new Set(keys.filter((k) => valid.has(k)));
  for (const k of [...chosen]) chosen.add(`${k.split(':')[0]}:view`);
  return ALL_PERMISSION_KEYS.filter((k) => chosen.has(k));
}
