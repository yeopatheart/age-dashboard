// 스티커(칠판 상품 칸에 붙이는 작은 표시)의 규칙. 서버 동작과 관리 화면이 같은 검사를 쓴다.
// 결정: docs/decisions/2026-11-22-stickers.md
import { isHueKey } from './color-palette.ts';

// 칸에 끼워 넣는 글자라 짧아야 한다(줄 높이 17px 안팎). 어머니가 쓰는 "대물/왕대물" 같은 말이 들어가는 길이로 8자.
export const STICKER_LABEL_MAX = 8;
export const STICKER_DEFAULT_COLOR = 'amber';

export type LabelResult = { ok: true; label: string } | { ok: false; error: string };

// 앞뒤 공백을 지우고, 안쪽의 연속 공백은 한 칸으로 줄인다. 글자 수는 화면에 보이는 글자(코드 포인트) 기준.
export function normalizeStickerLabel(raw: string): LabelResult {
  const label = raw.replace(/\s+/g, ' ').trim();
  if (!label) return { ok: false, error: '스티커 이름을 입력해주세요.' };
  if ([...label].length > STICKER_LABEL_MAX) return { ok: false, error: `스티커 이름은 ${STICKER_LABEL_MAX}자까지 쓸 수 있습니다.` };
  return { ok: true, label };
}

// 색은 팔레트 key로만 저장한다. 모르는 key면 기본색으로 돌린다(자유 입력 없음).
export function stickerColorKey(key: string | null | undefined): string {
  return isHueKey(key) ? key : STICKER_DEFAULT_COLOR;
}

// 순서 바꾸기: ids를 현재 순서로 받아 id를 한 칸 위/아래로 옮긴 새 순서를 돌려준다. 맨 위·아래에서 더 못 가면 null.
export function movedOrder(ids: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
