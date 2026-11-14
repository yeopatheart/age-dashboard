-- 고객사의 사업자명·사업자구분·퀵 이용, 그리고 배송비 기본 금액을 터미널로 옮긴다. 결정은 docs/decisions/2026-11-14-settlement-shipping.md.

-- 1. 고객사: 사업자명(실제 법인·회사명), 사업자구분(각 업체에 공급자로 쓰는 우리 사업자 = seller_businesses), 퀵 이용 여부.
--    사업자구분은 정산 판매내역·배송비·영수증의 사업자 구분 기본값으로 쓴다(줄에서 직접 고르면 그 값이 우선).
alter table businesses add column legal_name text check (legal_name is null or char_length(legal_name) <= 100);
alter table businesses add column seller_id uuid references seller_businesses(id) on delete set null;
alter table businesses add column uses_quick boolean not null default false; -- 퀵 가능 터미널이어도 퀵을 쓰는 고객사만 정산에 퀵을 제안한다(정산에서 뺄 수 있다)

-- 2. 배송비 기본 금액은 터미널별 박스당 원이다(0062에서 고객사에 만들었던 열은 쓰지 않아 지운다 — 입력된 값이 없음을 확인함).
--    버스는 택배가 아닌 터미널, 퀵은 퀵 가능 터미널, 택배는 택배 터미널에서만 쓴다. 비어 있으면 그 수단은 제안하지 않는다.
alter table terminals add column bus_rate integer check (bus_rate is null or bus_rate >= 0);
alter table terminals add column quick_rate integer check (quick_rate is null or quick_rate >= 0);
alter table terminals add column parcel_rate integer check (parcel_rate is null or parcel_rate >= 0);

alter table businesses drop column if exists bus_rate;
alter table businesses drop column if exists quick_rate;
alter table businesses drop column if exists parcel_rate;
