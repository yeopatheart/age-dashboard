// 스티커(칠판 상품 칸에 붙이는 작은 표시)의 규칙. 서버 동작과 관리 화면이 같은 검사를 쓴다.
// 결정: docs/decisions/2026-11-22-stickers.md
import { isHueKey } from './color-palette.ts';

// 칸에 끼워 넣는 글자라 짧아야 한다(줄 높이 17px 안팎). 어머니가 쓰는 "대물/왕대물" 같은 말이 들어가는 길이로 8자.
export const STICKER_LABEL_MAX = 8;
export const STICKER_DEFAULT_COLOR = 'amber';

// 상품 칸에 붙은 스티커 하나(order_item_stickers, 0075). 이름·색은 붙일 당시 값이다.
export interface ItemSticker {
  id: string;
  orderItemId: string;
  label: string;
  fillColor: string;
  borderColor: string;
  quantity: number | null;
}

// 칸에 보이는 글자: 수량이 있으면 "특대 2", 없으면 "냉동실".
export const stickerText = (s: Pick<ItemSticker, 'label' | 'quantity'>): string => (s.quantity === null ? s.label : `${s.label} ${s.quantity}`);

// 붙이는 규칙(결정 2026-11-22): 한 칸에 최대 2개, 같은 스티커는 한 칸에 한 번만, 수량은 정수(1~9999)이고 수량을 쓰는 스티커에만 붙는다.
// 서버 동작과 칠판 화면이 같은 검사를 쓴다(DB의 unique·트리거가 마지막으로 막는다).
export const MAX_STICKERS_PER_ITEM = 2;
export const STICKER_QUANTITY_MAX = 9999;

// 스티커 목록(0074)에서 칠판이 쓰는 값.
export interface StickerPresetOption {
  id: string;
  label: string;
  fillColor: string;
  borderColor: string;
  usesQuantity: boolean;
}

export function stickerQuantityError(usesQuantity: boolean, quantity: number | null): string | null {
  if (!usesQuantity) return quantity === null ? null : '이 스티커는 수량을 쓰지 않습니다.';
  if (quantity === null || !Number.isInteger(quantity) || quantity < 1 || quantity > STICKER_QUANTITY_MAX) return `수량은 1~${STICKER_QUANTITY_MAX} 사이의 정수로 입력해주세요.`;
  return null;
}

export type AddCheck = { ok: true } | { ok: false; reason: 'duplicate' | 'limit' };

// 이미 붙은 스티커 이름들을 보고 이 이름을 더 붙일 수 있는지 판단한다. 같은 이름이 이미 있으면 "중복"(수정 말풍선으로 안내)이 먼저고, 그다음이 "2개 가득"이다.
export function checkAddSticker(existingLabels: readonly string[], label: string): AddCheck {
  if (existingLabels.includes(label)) return { ok: false, reason: 'duplicate' };
  if (existingLabels.length >= MAX_STICKERS_PER_ITEM) return { ok: false, reason: 'limit' };
  return { ok: true };
}

// 전체 키패드(11 이상)에서 숫자를 하나 더한다: 최대 자릿수까지만, 맨 앞 0은 받지 않는다.
export function appendDigit(current: string, digit: string): string {
  if (!/^[0-9]$/.test(digit)) return current;
  if (current === '' && digit === '0') return current;
  const next = current + digit;
  return next.length > String(STICKER_QUANTITY_MAX).length ? current : next;
}

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
