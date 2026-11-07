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
