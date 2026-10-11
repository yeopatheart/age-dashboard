// 상품·터미널 색상 설정에 쓰는 고정 팔레트. 색은 자유 입력이 아니라 이 팔레트의 key로만 저장한다 —
// 글자가 안 보이는 조합이 생기지 않고(안쪽은 항상 연한 색, 글자는 같은 계열의 진한 색), 같은 key는
// 어느 화면에서나 같은 색으로 보인다. 테두리색과 안쪽색을 따로 고를 수 있어 17×17 조합이 가능하다.
export interface ColorHue {
  key: string;
  label: string;
  fill: string; // 연한 안쪽색
  border: string; // 진한 테두리색
  text: string; // 안쪽색 위에서 읽히는 진한 글자색
}

export const COLOR_HUES: ColorHue[] = [
  { key: 'red', label: '빨강', fill: '#fee2e2', border: '#ef4444', text: '#991b1b' },
  { key: 'orange', label: '주황', fill: '#ffedd5', border: '#f97316', text: '#9a3412' },
  { key: 'amber', label: '황토', fill: '#fef3c7', border: '#f59e0b', text: '#92400e' },
  { key: 'lime', label: '연두', fill: '#ecfccb', border: '#84cc16', text: '#3f6212' },
  { key: 'green', label: '초록', fill: '#dcfce7', border: '#22c55e', text: '#166534' },
  { key: 'emerald', label: '에메랄드', fill: '#d1fae5', border: '#10b981', text: '#065f46' },
  { key: 'teal', label: '청록', fill: '#ccfbf1', border: '#14b8a6', text: '#115e59' },
  { key: 'cyan', label: '시안', fill: '#cffafe', border: '#06b6d4', text: '#155e75' },
  { key: 'sky', label: '하늘', fill: '#e0f2fe', border: '#0ea5e9', text: '#075985' },
  { key: 'blue', label: '파랑', fill: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
  { key: 'indigo', label: '남색', fill: '#e0e7ff', border: '#6366f1', text: '#3730a3' },
  { key: 'violet', label: '보라', fill: '#ede9fe', border: '#8b5cf6', text: '#5b21b6' },
  { key: 'purple', label: '자주', fill: '#f3e8ff', border: '#a855f7', text: '#6b21a8' },
  { key: 'fuchsia', label: '자홍', fill: '#fae8ff', border: '#d946ef', text: '#86198f' },
  { key: 'pink', label: '분홍', fill: '#fce7f3', border: '#ec4899', text: '#9d174d' },
  { key: 'rose', label: '장미', fill: '#ffe4e6', border: '#f43f5e', text: '#9f1239' },
  { key: 'slate', label: '회색', fill: '#f1f5f9', border: '#64748b', text: '#1e293b' },
];

const HUE_BY_KEY = new Map(COLOR_HUES.map((h) => [h.key, h]));

// 색이 지정되지 않은 상품의 기본 모양(기존 "최초주문" 팁과 동일).
export const DEFAULT_PILL = { fill: '#f8fafc', border: '#1e293b', text: '#0f172a' };

export function resolveColors(fillKey: string | null | undefined, borderKey: string | null | undefined) {
  const fill = fillKey ? HUE_BY_KEY.get(fillKey) : undefined;
  const border = borderKey ? HUE_BY_KEY.get(borderKey) : undefined;
  if (!fill && !border) return DEFAULT_PILL;
  return {
    fill: fill?.fill ?? DEFAULT_PILL.fill,
    border: border?.border ?? DEFAULT_PILL.border,
    text: fill?.text ?? border?.text ?? DEFAULT_PILL.text,
  };
}

export const isHueKey = (key: string | null | undefined): key is string => !!key && HUE_BY_KEY.has(key);

// 자동 배정은 회색(기본/중립)을 뺀 색으로만 한다. 같은 계열(안쪽=테두리)을 먼저 모두 쓰고, 그다음에
// 테두리를 한 칸씩 비껴 가며 새 조합을 만든다 — 기존 상품이 쓰는 조합과 겹치지 않는 첫 조합을 고른다.
const AUTO_HUES = COLOR_HUES.filter((h) => h.key !== 'slate');

export function pickUnusedColor(used: Set<string>): { fill_color: string; border_color: string } {
  const n = AUTO_HUES.length;
  for (let shift = 0; shift < n; shift++) {
    for (let i = 0; i < n; i++) {
      const fill = AUTO_HUES[i].key;
      const border = AUTO_HUES[(i + shift) % n].key;
      if (!used.has(`${fill}|${border}`)) return { fill_color: fill, border_color: border };
    }
  }
  // 모든 조합이 쓰이는 극단적인 경우(수백 개)에는 처음부터 다시 순환한다.
  const idx = used.size % (n * n);
  return { fill_color: AUTO_HUES[idx % n].key, border_color: AUTO_HUES[(idx % n + Math.floor(idx / n)) % n].key };
}

export const colorComboKey = (fill: string | null, border: string | null) => `${fill}|${border}`;
