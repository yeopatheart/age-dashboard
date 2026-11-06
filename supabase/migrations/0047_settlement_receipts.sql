-- 정산 영수증(기존 Auto-Receipt 이관). 정산 판매내역에서 고객사 × 사업자 × 출고일 단위로 영수증 이미지를 만들고, 만든 내용을 이력으로 남긴다.
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 영수증 기능 코드를 배포한다.
-- 권한은 0045 방식이다: 보기=settlement:view, 만들기·지우기=settlement:edit. 수정 정책은 없다(발행한 내용은 바꿀 수 없다).

-- 1) 판매내역의 단가. 영수증의 "단가" 칸에 쓴다. 비어 있으면 단가 칸은 빈칸이다.
--    판매가(price)는 그 줄의 총액으로 그대로 두고, 단가와 판매가를 서로 강제로 맞추지 않는다(화면에서 단가를 입력하면 판매가를 자동으로 채워 줄 뿐이다).
alter table public.settlement_sales
  add column if not exists unit_price bigint check (unit_price is null or unit_price >= 0);

-- 2) 사업자 직인(도장) 이미지. 작게 줄인 PNG를 data URL 글자로 저장한다(약 300KB 이하).
--    별도 공개 주소가 없고, 사업자를 읽을 수 있는 권한(0045의 seller_businesses 정책)이 있는 사용자만 읽는다.
--    목록 화면은 열을 직접 골라 읽으므로 이 값은 영수증을 만들 때만 읽는다.
alter table public.seller_businesses
  add column if not exists seal_image text check (
    seal_image is null
    or (seal_image like 'data:image/png;base64,%' and char_length(seal_image) <= 300000)
  );

-- 3) 발행한 영수증 이력(스냅샷). 이미지는 저장하지 않고, 이력에서 열 때 같은 화면 컴포넌트로 다시 그린다.
--    snapshot에는 발행 시점의 공급자 정보·고객명·품목 줄·합계를 담는다(src/lib/settlement/receipt.ts의 ReceiptSnapshot).
--    직인은 용량 때문에 스냅샷에 넣지 않고 seller_id로 현재 사업자의 직인을 쓴다.
create table if not exists public.settlement_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no integer not null check (receipt_no > 0), -- 영수증의 "NO." — 같은 출고일 안에서 발행 순서대로 붙인다
  order_date date not null,
  customer_name text not null check (char_length(customer_name) between 1 and 60),
  seller_id uuid references public.seller_businesses(id) on delete set null,
  total bigint not null check (total >= 0),
  snapshot jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists settlement_receipts_date_idx on public.settlement_receipts (order_date, created_at);
create index if not exists settlement_receipts_seller_idx on public.settlement_receipts (seller_id);

alter table public.settlement_receipts enable row level security;

drop policy if exists "settlement_receipts select" on public.settlement_receipts;
drop policy if exists "settlement_receipts insert" on public.settlement_receipts;
drop policy if exists "settlement_receipts delete" on public.settlement_receipts;
create policy "settlement_receipts select" on public.settlement_receipts for select using ((select public.has_perm('settlement:view')));
create policy "settlement_receipts insert" on public.settlement_receipts for insert with check ((select public.has_perm('settlement:edit')));
create policy "settlement_receipts delete" on public.settlement_receipts for delete using ((select public.has_perm('settlement:edit')));

-- 되돌리기(필요할 때만):
-- drop table public.settlement_receipts;
-- alter table public.seller_businesses drop column seal_image;
-- alter table public.settlement_sales drop column unit_price;
