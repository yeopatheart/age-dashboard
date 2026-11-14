// 정산 판매내역의 품목·수량·단위 수정값 적용(순수 함수). 주문 목록 원본은 그대로 두고, 정산에서 고친 값(override)이 있으면 그것을 쓴다.
// sales.ts가 주문 목록 모듈을 불러와 단위 테스트에서 직접 읽을 수 없어 따로 뒀다.
export interface SalesOriginal {
  product: string;
  quantity: number;
  unit: string;
}

export interface SalesOverride {
  productOverride: string | null;
  quantityOverride: number | null;
  unitOverride: string | null;
}

export function resolveSalesEdit(original: SalesOriginal, o: SalesOverride | undefined): SalesOriginal & { edited: boolean } {
  return {
    product: o?.productOverride ?? original.product,
    quantity: o?.quantityOverride ?? original.quantity,
    unit: o?.unitOverride ?? original.unit,
    edited: o?.productOverride != null || o?.quantityOverride != null || o?.unitOverride != null,
  };
}

// ── 줄 입력값 검증(정산표의 저장 액션이 쓴다) ─────────────────────────────────

// 판매 줄에 쓸 값(보낸 것만 바꾼다). price·unitPrice의 null은 비움, product·quantity·unit의 null은 주문 목록 값으로 되돌림.
export interface SalesLineFields {
  price?: number | null;
  unitPrice?: number | null;
  supplierId?: string | null; // 줄 단위 매입(0065). null = 날짜별 품목 단가표를 따른다
  purchaseUnitPrice?: number | null;
  purchasePrice?: number | null;
  product?: string | null;
  quantity?: number | null;
  unit?: string | null;
  memo?: string;
}

export const MAX_PRODUCT_LEN = 60; // 0048의 check와 같다
export const MAX_UNIT_LEN = 10;
export const MAX_QUANTITY = 100_000;
export const MAX_PRICE = 99_999_999_999; // src/lib/money.ts의 MAX_WON_DIGITS(11자리)와 같다

const badPrice = (v: number | null | undefined) => v !== undefined && v !== null && (!Number.isInteger(v) || v < 0 || v > MAX_PRICE);

// 문제가 있으면 사유, 없으면 null.
export function salesFieldsError(f: SalesLineFields): string | null {
  if (badPrice(f.price)) return '판매가가 올바르지 않습니다.';
  if (badPrice(f.unitPrice)) return '단가가 올바르지 않습니다.';
  if (badPrice(f.purchaseUnitPrice)) return '매입 단가가 올바르지 않습니다.';
  if (badPrice(f.purchasePrice)) return '매입가가 올바르지 않습니다.';
  if (f.product !== undefined && f.product !== null && (f.product.trim().length === 0 || f.product.trim().length > MAX_PRODUCT_LEN)) return `품목명은 1~${MAX_PRODUCT_LEN}자로 입력해주세요.`;
  const q = f.quantity;
  if (q !== undefined && q !== null && (!Number.isFinite(q) || q <= 0 || q > MAX_QUANTITY || Math.round(q * 100) / 100 !== q)) return `수량은 0보다 크고 ${MAX_QUANTITY.toLocaleString('ko-KR')} 이하(소수 둘째 자리까지)로 입력해주세요.`;
  if (f.unit !== undefined && f.unit !== null && (f.unit.trim().length === 0 || f.unit.trim().length > MAX_UNIT_LEN)) return `단위는 1~${MAX_UNIT_LEN}자로 입력해주세요.`;
  if (f.memo !== undefined && f.memo.trim().length > 500) return '메모는 500자 이하로 입력해주세요.';
  return null;
}
