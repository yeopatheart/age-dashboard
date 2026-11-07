-- 정산 판매내역의 품목·수량·단위 수정. 주문 목록(order_items)의 원본은 그대로 두고, 정산에서 고친 값만 이 열에 저장한다.
-- 비어 있으면(null) 주문 목록 값을 그대로 쓴다. 값을 지우면 원래대로 돌아간다.
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 판매내역 수정 기능 코드를 배포한다.
-- RLS는 0045의 settlement_sales 정책을 그대로 쓴다(보기=settlement:view, 입력=settlement:edit).
alter table public.settlement_sales
  add column if not exists product_override text check (product_override is null or char_length(btrim(product_override)) between 1 and 60),
  add column if not exists quantity_override numeric check (quantity_override is null or (quantity_override > 0 and quantity_override <= 100000)),
  add column if not exists unit_override text check (unit_override is null or char_length(btrim(unit_override)) between 1 and 10);

-- 되돌리기(필요할 때만 직접 실행):
-- alter table public.settlement_sales drop column product_override, drop column quantity_override, drop column unit_override;
